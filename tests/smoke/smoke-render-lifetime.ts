import assert from 'node:assert/strict';

import { screenUV, texture } from 'three/tsl';
import {
  Scene,
  PerspectiveCamera,
  RenderTarget,
  RTTNode,
  TextureNode,
  type Node,
} from 'three/webgpu';

import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { createWorldViewPipeline } from '../../src/render/webgpu-pipeline.ts';
import { fixture } from '../lib/fixture.ts';
import { captureMethod, renderFixture } from '../lib/render-fixture.ts';

for (const taa of [false, true]) {
  const scene = new Scene(),
    view = new Scene(),
    camera = new PerspectiveCamera();
  const before = captureMethod(view, 'onBeforeRender'),
    after = captureMethod(view, 'onAfterRender');
  const borrowed = new RenderTarget(1, 1);
  let borrowedDisposals = 0;
  borrowed.addEventListener('dispose', (): void => {
    borrowedDisposals++;
  });
  const owned: RTTNode[] = [],
    counts: number[] = [];
  const watch = (node: Node): Node<'vec4'> => {
    assert(node instanceof TextureNode);
    if (node instanceof RTTNode) {
      const index = owned.length;
      owned.push(node);
      counts.push(0);
      node.renderTarget!.addEventListener('dispose', (): void => {
        counts[index]++;
      });
    }
    return node.sample(screenUV).mul(1);
  };
  const graph = createWorldViewPipeline(renderFixture({}), scene, camera, view, camera, {
    gtao: false,
    bloomStrength: 0,
    taa,
    fog: ({ color }): Node<'vec4'> => {
      watch(color);
      return texture(borrowed.texture);
    },
    warp: watch,
    postPasses: [{ asNode: watch }],
  });
  assert.deepEqual(
    Object.keys(graph.prePass.getMRT()!.outputNodes).sort(),
    taa ? ['linearDepth', 'output', 'velocity'] : ['linearDepth', 'output'],
    'prepass publishes only normals, depth and optional temporal velocity'
  );
  let worldDisposals = 0;
  graph.worldPass.renderTarget.addEventListener('dispose', (): void => {
    worldDisposals++;
  });
  graph.dispose();
  // World-only warp borrows the fog texture rather than materializing the
  // world/view composite. Only the post input is owned, with or without TAA.
  assert.equal(owned.length, 1);
  assert(
    counts.every((n): boolean => n === 1),
    'dispose every created RTT exactly once'
  );
  assert.equal(borrowedDisposals, 0, 'do not recursively destroy borrowed textures');
  assert.equal(worldDisposals, 1, 'explicit passes retain their own disposal');
  assert.equal(captureMethod(view, 'onBeforeRender'), before);
  assert.equal(captureMethod(view, 'onAfterRender'), after);
  borrowed.dispose();
}
// A meter readback delays target disposal, but old view callbacks must detach
// immediately so their later disposal cannot clobber the replacement graph.
const scene = new Scene(),
  view = new Scene(),
  camera = new PerspectiveCamera();
const original = captureMethod(view, 'onBeforeRender');
const make = (): ReturnType<typeof createWorldViewPipeline> =>
  createWorldViewPipeline(renderFixture({}), scene, camera, view, camera, {
    gtao: false,
    bloomStrength: 0,
  });
let finish = (): void => {
  throw Error('missing readback resolver');
};
const pending = new Promise<void>((resolve): void => {
  finish = resolve;
});
const owner = fixture<RenderSystem>({
  _graph: make(),
  _metering: true,
  _meterTask: pending,
  _meterPass: null,
});
RenderSystem.prototype._releaseGraph.call(owner);
const next = make(),
  activeHook = captureMethod(view, 'onBeforeRender');
finish();
await pending;
assert.equal(
  captureMethod(view, 'onBeforeRender'),
  activeHook,
  'old readback completion must not detach the new graph'
);
next.dispose();
assert.equal(captureMethod(view, 'onBeforeRender'), original);
console.log('frame graph owns converted RTTs, not borrowed textures or replacement callbacks');
