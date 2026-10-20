import assert from 'node:assert/strict';

import { screenUV, texture } from 'three/tsl';
import { Scene, PerspectiveCamera, RenderTarget, Object3D } from 'three/webgpu';

import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { createWorldViewPipeline } from '../../src/render/webgpu-pipeline.ts';

for (const taa of [false, true]) {
  const scene = new Scene(),
    view = new Scene(),
    camera = new PerspectiveCamera();
  const before = view.onBeforeRender,
    after = view.onAfterRender;
  const borrowed = new RenderTarget(1, 1);
  let borrowedDisposals = 0;
  borrowed.addEventListener('dispose', () => borrowedDisposals++);
  const owned = [],
    counts = [];
  const watch = (node) => {
    if (node.isRTTNode) {
      const index = owned.length;
      owned.push(node);
      counts.push(0);
      node.renderTarget.addEventListener('dispose', () => counts[index]++);
    }
    return node.sample(screenUV).mul(1);
  };
  const graph = createWorldViewPipeline({}, scene, camera, view, camera, {
    gtao: false,
    bloomStrength: 0,
    taa,
    fog: ({ color }) => {
      watch(color);
      return texture(borrowed.texture);
    },
    warp: watch,
    postPasses: [{ asNode: watch }],
  });
  assert.deepEqual(
    Object.keys(graph.prePass.getMRT().outputNodes).sort(),
    taa ? ['linearDepth', 'output', 'velocity'] : ['linearDepth', 'output'],
    'prepass publishes only normals, depth and optional temporal velocity'
  );
  let worldDisposals = 0;
  graph.worldPass.renderTarget.addEventListener('dispose', () => worldDisposals++);
  graph.dispose();
  // World-only warp borrows the fog texture rather than materializing the
  // world/view composite. Only the post input is owned, with or without TAA.
  assert.equal(owned.length, 1);
  assert(
    counts.every((n) => n === 1),
    'dispose every created RTT exactly once'
  );
  assert.equal(borrowedDisposals, 0, 'do not recursively destroy borrowed textures');
  assert.equal(worldDisposals, 1, 'explicit passes retain their own disposal');
  assert.equal(view.onBeforeRender, before);
  assert.equal(view.onAfterRender, after);
  borrowed.dispose();
}
// A meter readback delays target disposal, but old view callbacks must detach
// immediately so their later disposal cannot clobber the replacement graph.
const scene = new Scene(),
  view = new Scene(),
  camera = new PerspectiveCamera();
const original = view.onBeforeRender;
const make = () =>
  createWorldViewPipeline({}, scene, camera, view, camera, { gtao: false, bloomStrength: 0 });
let finish;
const pending = new Promise((resolve) => {
  finish = resolve;
});
const owner = { _graph: make(), _metering: true, _meterTask: pending };
RenderSystem.prototype._releaseGraph.call(owner);
const next = make(),
  activeHook = view.onBeforeRender;
finish();
await pending;
assert.equal(
  view.onBeforeRender,
  activeHook,
  'old readback completion must not detach the new graph'
);
next.dispose();
assert.equal(view.onBeforeRender, original);
// The production graph owns transform publication, not an entire browser frame.
// Generic/probe graphs retain native per-pass updates unless explicitly opted in.
for (const worldMatricesPerGraph of [false, true]) {
  const world = new Scene(),
    first = new Scene(),
    object = new Object3D();
  world.add(object);
  const renderer = { getDrawingBufferSize: (size) => size.set(32, 32) };
  const graph = createWorldViewPipeline(renderer, world, camera, first, camera, {
    gtao: false,
    bloomStrength: 0,
    worldMatricesPerGraph,
  });
  let updates = 0;
  const update = world.updateMatrixWorld;
  world.updateMatrixWorld = function (...args) {
    updates++;
    return update.apply(this, args);
  };
  graph.pipeline.render = () => {
    for (let pass = 0; pass < 3; pass++) {
      if (world.matrixWorldAutoUpdate) world.updateMatrixWorld();
      assert.equal(object.matrixWorld.elements[12], object.position.x, 'publish before drawing');
    }
    assert.equal(first.matrixWorldAutoUpdate, true);
  };
  graph.render();
  assert.equal(updates, worldMatricesPerGraph ? 1 : 3);
  object.position.x = 7;
  graph.render(); // No rAF or frame-number change: new publications must still be visible.
  assert.equal(object.matrixWorld.elements[12], 7);
  assert.equal(world.matrixWorldAutoUpdate, true);
  assert.equal(first.matrixWorldAutoUpdate, true);
  first.matrixWorldAutoUpdate = false; // Caller-owned transforms must remain caller-owned.
  graph.pipeline.render = () => {
    throw new Error('draw failure');
  };
  assert.throws(() => graph.render(), /draw failure/);
  assert.equal(world.matrixWorldAutoUpdate, true);
  assert.equal(first.matrixWorldAutoUpdate, false);
  world.matrixWorldAutoUpdate = false;
  const priorUpdates = updates;
  graph.pipeline.render = () => assert.equal(world.matrixWorldAutoUpdate, false);
  graph.render();
  assert.equal(updates, priorUpdates, 'never publish transforms owned by the caller');
  assert.equal(world.matrixWorldAutoUpdate, false);
  graph.dispose();
}
console.log('frame graph owns RTTs, callbacks and scoped transform publication');
