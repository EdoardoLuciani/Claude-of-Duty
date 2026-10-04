import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, RenderTarget } from 'three/webgpu';
import { screenUV, texture } from 'three/tsl';
import { createWorldViewPipeline } from '../../src/render/webgpu-pipeline.js';
import { RenderSystem } from '../../src/render/index-webgpu.js';

for (const ssrEnabled of [false, true]) {
  const scene = new Scene(), view = new Scene(), camera = new PerspectiveCamera();
  const before = view.onBeforeRender, after = view.onAfterRender;
  const borrowed = new RenderTarget(1, 1);
  let borrowedDisposals = 0;
  borrowed.addEventListener('dispose', () => borrowedDisposals++);
  const owned = [], counts = [];
  const watch = node => {
    if (node.isRTTNode) {
      const index = owned.length; owned.push(node); counts.push(0);
      node.renderTarget.addEventListener('dispose', () => counts[index]++);
    }
    return node.sample(screenUV).mul(1);
  };
  const graph = createWorldViewPipeline({}, scene, camera, view, camera, {
    gtao: false, bloomStrength: 0, ssrEnabled,
    fog: ({ color }) => { watch(color); return texture(borrowed.texture); },
    warp: watch, postPasses: [{ asNode: watch }],
  });
  let worldDisposals = 0;
  graph.worldPass.renderTarget.addEventListener('dispose', () => worldDisposals++);
  graph.dispose();
  assert.equal(owned.length, ssrEnabled ? 3 : 2);
  assert(counts.every(n => n === 1), 'dispose every created RTT exactly once');
  assert.equal(borrowedDisposals, 0, 'do not recursively destroy borrowed textures');
  assert.equal(worldDisposals, 1, 'explicit passes retain their own disposal');
  assert.equal(view.onBeforeRender, before); assert.equal(view.onAfterRender, after);
  borrowed.dispose();
}
// A meter readback delays target disposal, but old view callbacks must detach
// immediately so their later disposal cannot clobber the replacement graph.
const scene = new Scene(), view = new Scene(), camera = new PerspectiveCamera();
const original = view.onBeforeRender;
const make = () => createWorldViewPipeline({}, scene, camera, view, camera, { gtao: false, bloomStrength: 0 });
let finish;
const pending = new Promise(resolve => { finish = resolve; });
const owner = { _graph: make(), _metering: true, _meterTask: pending };
RenderSystem.prototype._releaseGraph.call(owner);
const next = make(), activeHook = view.onBeforeRender;
finish(); await pending;
assert.equal(view.onBeforeRender, activeHook, 'old readback completion must not detach the new graph');
next.dispose();
assert.equal(view.onBeforeRender, original);
console.log('frame graph owns converted RTTs, not borrowed textures or replacement callbacks');
