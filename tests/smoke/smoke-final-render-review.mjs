import assert from 'node:assert/strict';
import { Color, Scene, PerspectiveCamera, Mesh, BoxGeometry, MeshBasicNodeMaterial, DataUtils } from 'three/webgpu';
import { Engine } from '../../src/core/engine.js';
import { RenderSystem } from '../../src/render/index-webgpu.js';
import { warmFrame } from '../../src/render/warm-frame.js';
import { createHdrMeter } from '../../src/render/meter-webgpu.js';

// Teardown must report both sync and async failures, after all owners and events.
const order = [], error = console.error;
console.error = () => {};
try {
  const engine = Object.create(Engine.prototype);
  Object.assign(engine, { stop() {}, _onResize() {}, input: { detach() {} },
    events: { clear() { order.push('events'); } }, registry: { ordered: [
      { dispose() { order.push('last'); } },
      { dispose() { order.push('sync'); throw Error('sync'); } },
      { async dispose() { order.push('async'); throw Error('async'); } },
    ] } });
  globalThis.removeEventListener = () => {};
  await assert.rejects(engine.dispose(), e => e instanceof AggregateError && e.errors.length === 2);
  assert.deepEqual(order, ['async', 'sync', 'last', 'events']);
} finally { console.error = error; delete globalThis.removeEventListener; }

// rAF scheduling stays native, but cancellation/deadline removes pending work.
const callbacks = new Map(); let serial = 0, draws = 0;
globalThis.requestAnimationFrame = cb => { callbacks.set(++serial, cb); return serial; };
globalThis.cancelAnimationFrame = id => callbacks.delete(id);
const fireFrame = () => {
  const [id, callback] = callbacks.entries().next().value;
  callbacks.delete(id); // The browser consumes a delivered rAF automatically.
  callback();
};
try {
  const abort = new AbortController();
  const resumed = warmFrame(() => draws++, abort.signal, performance.now() + 1000);
  assert.equal(draws, 0);
  fireFrame(); await resumed;
  assert.equal(draws, 1); assert.equal(callbacks.size, 0);
  const stalled = warmFrame(() => draws++, abort.signal, performance.now() + 5);
  await assert.rejects(stalled, /keep this tab visible/);
  assert.equal(callbacks.size, 0, 'pending rAF must be cancelled after timeout'); assert.equal(draws, 1);
  const cancelled = warmFrame(() => draws++, abort.signal, performance.now() + 1000);
  abort.abort(Error('cancelled')); await assert.rejects(cancelled, /cancelled/);
  assert.equal(callbacks.size, 0);
  await assert.rejects(warmFrame(() => draws++, abort.signal, performance.now() + 1000), /cancelled/);

  // Throw after jitter/state mutation: preserve authored sub-frustum, matrices,
  // pass flags, hidden mesh, geometry range and render state.
  const owner = new RenderSystem(), camera = new PerspectiveCamera(60, 2, .1, 100);
  camera.setViewOffset(640, 320, 10, 0, 620, 320);
  const view = { ...camera.view }, projection = camera.projectionMatrix.clone();
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  mesh.visible = false; mesh.geometry.setDrawRange(2, 12);
  const scene = new Scene(); scene.add(mesh);
  let target = {}, clear = new Color(.1, .2, .3), alpha = .4, failed;
  const originalTarget = target;
  owner.ctx = { scene, viewScene: new Scene(), camera, time: { frame: 42 },
    engine: { fail(_system, _method, e) { failed = e; } } };
  owner.renderer = { xr: { enabled: true }, toneMapping: 4, outputColorSpace: 'original',
    getRenderTarget: () => target, setRenderTarget: t => { target = t; },
    getClearColor: c => c.copy(clear), getClearAlpha: () => alpha,
    setClearColor(c, a) { clear = new Color(c); alpha = a; } };
  owner._warmAbort = new AbortController();
  owner._tagPrepassMesh = owner._tagViewMesh = () => {};
  const passes = Array.from({ length: 3 }, () => ({ opaque: true, transparent: false }));
  owner._graph = { prePass: passes[0], worldPass: passes[1], viewPass: passes[2],
    taaPass: { setSize() {}, clearViewOffset() { camera.clearViewOffset(); } },
    render() {
      camera.setViewOffset(640, 320, .5, .5, 640, 320);
      owner.renderer.toneMapping = 0; owner.renderer.outputColorSpace = 'changed';
      owner.renderer.xr.enabled = false; owner.renderer.setClearColor(0, 0);
      throw Error('injected draw failure');
    } };
  const warm = owner._warmGraph();
  fireFrame();
  await assert.rejects(warm, /injected draw failure/);
  assert.match(failed.message, /injected draw failure/);
  assert.deepEqual(camera.view, view, 'restore original camera sub-frustum on failure');
  assert(camera.projectionMatrix.equals(projection));
  assert.equal(mesh.visible, false); assert.deepEqual(mesh.geometry.drawRange, { start: 2, count: 12 });
  assert(passes.every(p => p.opaque && !p.transparent));
  assert.equal(target, originalTarget); assert.equal(alpha, .4); assert.equal(clear.r, .1);
  assert.equal(owner.renderer.toneMapping, 4); assert.equal(owner.renderer.outputColorSpace, 'original');
  assert.equal(owner.renderer.xr.enabled, true); assert.equal(callbacks.size, 0);
  assert.equal(owner.ctx.time.frame, 42);
  mesh.geometry.dispose(); mesh.material.dispose();
} finally { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }

// Explicit fixed-target readback layout, including a wrong layout that would
// pass the old inferred-integer-stride test. Last valid exposure is not reset.
let pixels = new Uint16Array(64 * 64 * 4), target = null, warnings = 0;
for (let i = 0; i < pixels.length; i += 4) {
  pixels[i] = DataUtils.toHalfFloat(-1); pixels[i + 1] = DataUtils.toHalfFloat(1);
}
const renderer = { xr: { enabled: false }, toneMapping: 0, outputColorSpace: 'srgb-linear',
  getRenderTarget: () => target, setRenderTarget: t => { target = t; }, render() {},
  async readRenderTargetPixelsAsync() { return pixels; } };
const meter = createHdrMeter(renderer, null, null), warn = console.warn;
try {
  assert.equal(await meter.sample(), .5);
  console.warn = () => warnings++;
  pixels = new Uint16Array(256 + 63 * 512);
  assert.equal(await meter.sample(), null);
  pixels = new Float32Array(64 * 64 * 4);
  assert.equal(await meter.sample(), null);
  assert.equal(warnings, 1); assert.equal(target, null);
} finally { console.warn = warn; meter.dispose(); }
console.log('teardown isolation, bounded/cancelled warmup, jitter restoration and meter layout passed');
