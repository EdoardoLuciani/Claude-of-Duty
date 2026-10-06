import assert from 'node:assert/strict';
import { trackNodeBuilders } from '../../src/dev/native-builds.js';
import { TelemetrySystem } from '../../src/dev/telemetry.js';
import { validateCombatProfile } from '../../tools/lib/profile-combat.js';

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
console.log('native diagnostic lifecycle, telemetry deltas and combat coverage gates passed');
