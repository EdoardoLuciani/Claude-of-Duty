import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { prewarm } from '../../src/core/prewarm.js';
import { RadioSystem } from '../../src/radio/index.js';
import { WorldSystem } from '../../src/world/index.js';
import { FxSystem } from '../../src/fx/index.js';

for (const failure of [null, 'compile', 'returned', 'thrown']) {
  const camera = new PerspectiveCamera(); camera.position.set(1, 2, 3);
  const saved = camera.position.clone(), originalTarget = {};
  let target = originalTarget;
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: value => { target = value; },
    async compileAsync() { if (failure === 'compile') throw Error('compile failure'); },
  };
  const engine = { camera, scene: new Scene(), viewScene: new Scene(), viewCamera: camera,
    ctx: { peek: () => ({ renderer, patchMaterials() {} }) },
    registry: { ordered: [{ constructor: { id: 'fixture' }, async prewarmMaterials() {
      if (failure === 'thrown') throw Error('hook failure');
      return failure === 'returned' ? { ok: false } : undefined;
    } }] } };
  const warn = console.warn;
  let result;
  try { console.warn = () => {}; result = await prewarm(engine); }
  finally { console.warn = warn; }
  assert.equal(result.ok, failure === null, `aggregate warmup status: ${failure}`);
  assert(camera.position.equals(saved), 'restore camera even after failure');
  assert.equal(target, originalTarget, 'restore render target');
}

// Stage only borrowed visual assets in the real scene until the graph warmup
// settles. The graph owns target/range restoration; radio owns scene cleanup.
for (const fail of [false, true]) {
  let settle, patches = 0, disposed = 0;
  const scene = new Scene(), sentinel = new Scene(); scene.add(sentinel);
  const render = { renderer: {}, patchMaterials(stage) {
    assert.equal(stage.parent, scene); patches++;
    stage.traverse(mesh => {
      if (!mesh.isMesh) return;
      assert.equal(mesh.material.isMeshStandardNodeMaterial, true);
      mesh.geometry.addEventListener('dispose', () => disposed++);
      mesh.material.addEventListener('dispose', () => disposed++);
    });
  }, _warmGraph: () => new Promise((resolve, reject) => {
    settle = () => fail ? reject(Error('radio compile failure')) : resolve({ frameUnchanged: true });
  }) };
  const radio = new RadioSystem(); radio.active = [];
  radio.ctx = { scene, peek: () => render, rng: { float() { assert.fail('warmup consumed gameplay RNG'); } } };
  const task = radio.prewarmMaterials();
  assert.notEqual(radio._warmed, true, 'radio is not ready while compiling');
  assert.equal(scene.children.length, 2); assert.equal(patches, 1);
  settle(); const result = await task;
  assert.deepEqual(scene.children, [sentinel]); assert.deepEqual(radio.active, []);
  assert.equal(disposed, 0, 'shared geometry/materials remain borrowed');
  assert.equal(radio._warmed === true, !fail);
  assert.equal(result.ok, !fail, 'radio compile rejection must not become success');
}
const failingRenderer = { info: {}, async compileAsync() { throw Error('native compile rejection'); } };
await assert.rejects(() => new WorldSystem().prewarmMaterials({ peek: () => ({ renderer: failingRenderer }) }), /native compile rejection/);
const fx = new FxSystem();
fx.render = { renderer: failingRenderer }; fx.ctx = {}; fx._viewAttached = true;
for (const key of ['lit', 'add', 'motes', 'decals', 'shells']) fx[key] = { mesh: {} };
await assert.rejects(() => fx.prewarmMaterials(), /native compile rejection/);
assert.equal(fx._warmScene.children.length, 0, 'failed FX compile detaches borrowed meshes');
console.log('warmup failure status, async radio readiness and restoration preserved');
