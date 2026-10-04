import assert from 'node:assert/strict';
import { DirectionalLight, PerspectiveCamera, WebGPUCoordinateSystem } from 'three/webgpu';
import { StableCSMShadowNode } from '../../src/render/csm-webgpu.js';
import { WorldSystem } from '../../src/world/index.js';
import { RenderSystem } from '../../src/render/index-webgpu.js';
import { grenadeMaterials } from '../../src/weapons/grenade-mesh.js';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.js';

const camera = new PerspectiveCamera(75, 16 / 9, .05, 1200);
camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
const csm = new StableCSMShadowNode(new DirectionalLight(), { cascades: 3, maxFar: 120 });
// Exercise the pinned native frustum/bounds implementation, not a fake fit.
csm.refreshCameraFrustums(); // legal before lazy native initialization
csm._init({ camera, renderer: { coordinateSystem: WebGPUCoordinateSystem, reversedDepthBuffer: false } });
const lights = csm.lights.slice(), splits = csm._cascades.slice();
let updates = 0;
const update = csm.updateFrustums.bind(csm);
csm.updateFrustums = () => { updates++; update(); };
const width = () => csm.lights[0].shadow.camera.right * 2;
const initial = width();
csm.refreshCameraFrustums(); assert.equal(updates, 0);
camera.aspect = 4; camera.updateProjectionMatrix(); csm.refreshCameraFrustums();
assert(width() > initial * 1.5, 'wide aspect must expand shadow coverage');
const wide = width();
camera.fov = 40; camera.updateProjectionMatrix(); csm.refreshCameraFrustums();
assert(width() < wide, 'ADS projection must refit cascades');
for (let i = 0; i < 32; i++) {
  // A temporal pass jitters/restores between owner renders, not lens changes.
  camera.setViewOffset(1280, 320, (i % 8) / 8, (i % 4) / 4, 1280, 320);
  camera.clearViewOffset(); csm.refreshCameraFrustums();
}
assert.equal(updates, 2, 'unchanged unjittered projection must not refit');
assert.deepEqual(csm.lights, lights); assert.deepEqual(csm._cascades, splits);
csm.dispose();

const interval = 16 / 60, rate = -Math.log(.76) / interval;
const makeMeter = (sample = async () => 1.06 / (9.6 * 5)) => Object.assign(new RenderSystem(), {
  settings: { autoExposure: true, exposureKey: 1.06 }, _exposure: 1, _exposureTarget: 5,
  _meterElapsed: 0, _meterReady: true, _metering: false, _meterPass: { sample },
});
for (const fps of [20, 60, 120]) for (const [from, to] of [[1, 5], [5, 1]]) {
  let samples = 0; const times = [];
  const r = makeMeter(async () => { samples++; return 1.06 / (9.6 * to); });
  r._exposure = from; r._exposureTarget = to;
  for (let frame = 1; frame <= 2 * fps; frame++) {
    const previous = r._exposure, before = samples;
    r._updateExposure(1 / fps); await r._meterTask;
    assert((r._exposure - previous) * (to - from) > 0, 'adapt every frame, not only on measurement completion');
    if (samples > before) times.push(frame / fps);
  }
  assert(Math.abs(r._exposure - (to + (from - to) * Math.exp(-rate * 2))) < 1e-12, `time invariant at ${fps} FPS`);
  assert(samples >= 7 && samples <= 8, 'sparse sampling rate independent of rendered frame count');
  assert(times[0] <= interval + 1 / fps + 1e-9);
  for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] <= interval + 1 / fps + 1e-9);
  const held = r._exposure;
  r._updateExposure(0); assert.equal(r._exposure, held, 'paused time does not adapt');
  r.settings.autoExposure = false; r._updateExposure(1); assert.equal(r._exposure, held);
}
let release, requests = 0;
const r = makeMeter(() => { requests++; return new Promise(resolve => { release = resolve; }); });
r._updateExposure(1);
for (let i = 0; i < 120; i++) r._updateExposure(1 / 60);
assert.equal(requests, 1, 'never overlap async measurements');
r.settings.autoExposure = false; release(1e-9); await r._meterTask;
assert.equal(r._metering, false); assert.equal(r._exposureTarget, 5, 'pending readback cannot overwrite manual mode');
for (const luminance of [0, NaN, Infinity]) {
  const meter = makeMeter(async () => luminance); await meter._meter(); assert.equal(meter._exposureTarget, 5);
}
const cold = makeMeter(async () => 1e9); cold._meterReady = false;
await cold._meter(); assert.equal(cold._exposureTarget, .003); assert.equal(cold._exposure, .003);
cold._meterPass.sample = async () => { throw Error('readback failed'); };
await assert.rejects(() => cold._meter(), /readback failed/); assert.equal(cold._metering, false);

for (const material of grenadeMaterials()) assert.equal(material.isMeshStandardNodeMaterial, true);
const pickups = new AmmoPickups({ ctx: {}, rng: {} });
for (const name of ['case', 'edge', 'latch']) assert.equal(pickups.materials[name].isMeshStandardNodeMaterial, true);
assert.equal(pickups.materials.glow.isMeshBasicMaterial, true, 'intentional unlit marker remains unlit');
for (const value of Object.values(pickups.geometries)) value.dispose();
for (const value of Object.values(pickups.materials)) value.dispose();
const warm = await new WorldSystem().prewarmMaterials({ peek: () => ({ renderer: {
  async compileAsync() {}, get info() { throw Error('native warmup must not read a WebGL program counter'); },
} }) });
assert.equal(warm.ok, true); assert.equal('compiled' in warm, false);
console.log('native projection fits, time-based exposure, sparse async sampling and runtime material types passed');
