import assert from 'node:assert/strict';
import { trackNodeBuilders } from '../../src/dev/native-builds.js';
import { rendererCounters } from '../../src/dev/render-info.js';
import Info from 'three/src/renderers/common/Info.js';
import { packedReadback } from '../../tools/lib/native-readback.js';
import { TelemetrySystem } from '../../src/dev/telemetry.js';
import { createCombatProfile, validateCombatProfile } from '../../tools/lib/profile-combat.js';
import { Vector3 } from 'three';

let calls = 0;
const original = function (value) { assert.equal(this, renderer.debug); calls++; return value; };
const renderer = { backend: { isWebGPUBackend: true }, debug: { onNodeBuilderCreated: original },
  info: { memory: { geometries: 2, textures: 3 } } };
const builds = trackNodeBuilders(renderer);
assert.equal(renderer.debug.onNodeBuilderCreated(42), 42);
assert.equal(builds.count, 1);
assert.equal(calls, 1);
const nested = trackNodeBuilders(renderer);
renderer.debug.onNodeBuilderCreated();
assert.equal(builds.count, 2);
assert.equal(nested.count, 1);
builds.dispose(); // Out-of-order teardown must not clobber the newer observer.
renderer.debug.onNodeBuilderCreated();
assert.equal(builds.count, 2);
assert.equal(nested.count, 2);
nested.dispose();
renderer.debug.onNodeBuilderCreated();
assert.equal(builds.count, 2); // a retained disposed wrapper is inert
builds.dispose();
assert.equal(renderer.debug.onNodeBuilderCreated, original);
const normal = trackNodeBuilders(renderer);
normal.dispose(); normal.dispose();
assert.equal(renderer.debug.onNodeBuilderCreated, original);
for (const unsupported of [undefined, {}, { debug: {}, info: { programs: [] } }]) {
  const counter = trackNodeBuilders(unsupported);
  assert.equal(counter.count, null);
  counter.dispose();
}
const throwing = { backend: renderer.backend, debug: { onNodeBuilderCreated() { throw new Error('observer failed'); } } };
const failed = trackNodeBuilders(throwing);
assert.throws(() => throwing.debug.onNodeBuilderCreated(), /observer failed/);
assert.equal(failed.count, 1);
failed.dispose();
const localFailure = trackNodeBuilders(renderer, { onBuild() { throw Error('local observer failed'); } });
const previousCalls = calls;
assert.throws(() => renderer.debug.onNodeBuilderCreated(), /local observer failed/);
assert.equal(calls, previousCalls + 1, 'local observer failure must not suppress the existing callback');
localFailure.dispose();

const telemetry = new TelemetrySystem();
telemetry.ctx = { peek: () => ({ renderer }) };
telemetry._nativeBuilds = trackNodeBuilders(renderer);
telemetry._snapInfo();
assert.equal(telemetry._prevInfo.programs, null);
renderer.debug.onNodeBuilderCreated();
assert.equal(telemetry._frameDeltas().render.dNodeBuilders, 1);
assert.equal(telemetry._frameDeltas().render.dPrograms, null);
telemetry._nativeBuilds.dispose();
renderer.info.programs = [{}];
telemetry._snapInfo();
renderer.info.programs.push({});
assert.equal(telemetry._frameDeltas().render.dPrograms, 1); // retain legacy metrics

const nativeInfo = new Info(), stage = { code: 'a shader stage' };
nativeInfo.render.calls = 31; nativeInfo.render.frameCalls = 8; nativeInfo.render.drawCalls = 12;
nativeInfo.compute.calls = 9; nativeInfo.compute.frameCalls = 2; nativeInfo.createProgram(stage);
const native = { backend: { isWebGPUBackend: true }, info: nativeInfo };
assert.deepEqual(rendererCounters(native), { rendererFrame: 0,
  renderCallsTotal: 31, renderCallsFrame: 8, drawCallsFrame: 12,
  computeCallsTotal: 9, computeCallsFrame: 2, shaderStagesLive: 1, webglProgramsLive: null });
nativeInfo.reset();
assert.deepEqual(rendererCounters(native), { rendererFrame: 0,
  renderCallsTotal: 31, renderCallsFrame: 0, drawCallsFrame: 0,
  computeCallsTotal: 9, computeCallsFrame: 0, shaderStagesLive: 1, webglProgramsLive: null });
nativeInfo.destroyProgram(stage); assert.equal(rendererCounters(native).shaderStagesLive, 0);
assert(Object.values(rendererCounters()).every(value => value === null), 'unavailable is not zero');
assert(Object.values(rendererCounters({ backend: native.backend, info: {} })).every(value => value === null));
const legacy = rendererCounters({ info: { render: { calls: 5 }, programs: [{}, {}] } });
assert.equal(legacy.webglProgramsLive, 2); assert.equal(legacy.drawCallsFrame, 5);
assert.equal(legacy.renderCallsTotal, null); assert.equal(legacy.shaderStagesLive, null);
for (const [Type, channels] of [[Uint8Array, 4], [Uint16Array, 2], [Float32Array, 4]]) {
  for (const height of [1, 3]) {
    const values = new Type(7 * height * channels); values[0] = 1;
    assert.equal(packedReadback(values, 7, height, channels), values, 'preserve storage and raw values');
    assert.throws(() => packedReadback(new Type(256 * height), 7, height, channels), /invalid packed readback/);
    assert.throws(() => packedReadback(values.subarray(1), 7, height, channels), /invalid packed readback/);
  }
}

const valid = { frames: 900, playerShots: 25, reloadStarts: 2, reloadEnds: 2, switches: 2,
  yawTravel: 1.4, impacts: 400, damageTaken: 1500,
  blocks: [0, 300, 600].map(start => ({ start, frames: 300, livingFrames: 300,
    activeAiFrames: 300, aiShots: 50, distance: 18 })) };
validateCombatProfile(valid);
for (const [change, expected] of [
  [r => { r.frames = 899; }, /complete.*cycles/],
  [r => { r.blocks.pop(); }, /missing combat blocks/],
  [r => { r.blocks[1].livingFrames--; }, /not living/],
  [r => { r.blocks[1].aiShots = 0; }, /no sustained AI/],
  [r => { r.blocks[1].activeAiFrames = 0; }, /no sustained AI/],
  [r => { r.blocks[1].distance = 0; }, /no player movement/],
  [r => { r.playerShots = 0; }, /did not fire/],
  [r => { r.reloadEnds = 0; }, /reloads did not complete/],
  [r => { r.switches = 0; }, /switches did not complete/],
  [r => { r.yawTravel = 0; }, /camera did not turn/],
  [r => { r.impacts = 0; }, /effects were not exercised/],
  [r => { r.damageTaken = 0; }, /effects were not exercised/],
]) {
  const report = structuredClone(valid);
  change(report);
  assert.throws(() => validateCombatProfile(report), expected);
}
const realtimeReport = { ...structuredClone(valid), fixture: 'living-combat-realtime-v1', frames: 1800,
  simulationSeconds: 29.99, blocks: [...structuredClone(valid.blocks), ...structuredClone(valid.blocks)] };
validateCombatProfile(realtimeReport); // one complete 15-second input cycle, not two fixed-step cycles
assert.throws(() => validateCombatProfile({ ...realtimeReport, simulationSeconds: 30 }), /reloads did not complete/);
for (const simulationSeconds of [null, NaN, 0, 14.99])
  assert.throws(() => validateCombatProfile({ ...realtimeReport, simulationSeconds }), /complete action cycle/);
assert.throws(() => validateCombatProfile({ ...realtimeReport, fixture: 'living-combat-v1' }), /reloads did not complete/);

for (const realtime of [false, true]) {
  const input = { down: new Set(), _pendingDown: new Set(), _pendingUp: new Set(), _rawLook: { x: 0, y: 0 } };
  const player = { position: new Vector3(), eyeHeight: 1.6, yaw: 0, health: {},
    teleport(p, yaw) { this.position.copy(p); this.yaw = yaw; }, setControlEnabled() {} };
  const ai = { agents: [], squads: [], createSquad: () => ({ add() {} }),
    spawn(type, p) { const actor = { position: p.clone(), alive: true, dispose() {} }; this.agents.push(actor); return actor; } };
  const systems = { ai, player, weapons: { activeId: 'rifle' }, world: {}, physics: {} }; let unsubscribed = 0;
  const handlers = new Map();
  const engine = { input, config: { sensitivity: .01 }, ctx: { get: id => systems[id],
    events: { on: (event, fn) => { handlers.set(event, fn); return () => { unsubscribed++; handlers.delete(event); }; } } } };
  const fixture = createCombatProfile(engine, () => ({ fx: 0, fz: 1,
    positions: Array.from({ length: 6 }, (_, i) => new Vector3(i, 0, 0)) }), { realtime });
  const before = (frame, actionFrame) => {
    fixture.before(frame, actionFrame);
    const pressed = new Set(input._pendingDown);
    for (const key of input._pendingDown) input.down.add(key);
    for (const key of input._pendingUp) input.down.delete(key);
    input._pendingDown.clear(); input._pendingUp.clear();
    return pressed;
  };
  before(-1, -1); before(0, 0);
  if (realtime) {
    before(0, 119.7);
    assert(before(1, 120.2).has('KeyR'), 'reload edge must survive fractional/skipped input ticks');
    assert(!before(2, 120.7).has('KeyR'), 'crossed edge must fire only once');
    before(3, 359.7);
    assert(before(4, 360.2).has('Tab'), 'switch edge must survive fractional/skipped input ticks');
    before(5, 1019.7);
    before(6, 1019.9); // release the earlier reload edge crossed by the synthetic jump
    assert(before(7, 1020.2).has('KeyR'), 'reload edge must survive cycle wrap');
  } else {
    before(119); assert(before(120).has('KeyR')); assert(!before(121).has('KeyR'));
    before(359); assert(before(360).has('Tab'));
    assert.equal(fixture.report.simulationHz, 60);
  }
  const activity = fixture.activity();
  handlers.get('weapon:fire')({ actor: 'player' });
  handlers.get('weapon:fire')({ actor: 'ai', weapon: 'ai_rifle' });
  handlers.get('bullet:impact')();
  assert.deepEqual(activity, { playerShots: 0, aiShots: 0, impacts: 0 }, 'activity is a scalar snapshot, not a live alias');
  assert.deepEqual(fixture.activity(), { playerShots: 1, aiShots: 1, impacts: 1 });
  fixture.dispose(); assert.equal(unsubscribed, 4); assert.equal(handlers.size, 0);
  assert.equal(input.down.size, 0); assert.equal(input._pendingDown.size, 0);
}
console.log('native diagnostic lifecycle, telemetry deltas and combat coverage gates passed');
