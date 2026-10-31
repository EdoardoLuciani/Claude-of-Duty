import assert from 'node:assert/strict';

import { RenderSystem } from '../../src/render/index-webgpu.ts';
import { PixiCanvasComposite } from '../../src/ui/pixi-canvas-composite.ts';

const render = Object.create(RenderSystem.prototype);
let presented = 0;
const off = render.registerDisplayOverlay(() => presented++);
assert.throws(() => render.registerDisplayOverlay(() => {}), /already registered/);
render.displayOverlay();
assert.equal(presented, 1);
off();
off();
assert.equal(render.displayOverlay, null);
const off2 = render.registerDisplayOverlay(() => presented++);
off();
assert.equal(
  typeof render.displayOverlay,
  'function',
  'stale unsubscribe cannot remove another owner'
);
off2();

const composite = Object.create(PixiCanvasComposite.prototype);
let binds = 0,
  writes = 0,
  submissions = 0,
  destroyed = 0,
  resized = 0;
const source = { createView: () => ({ source: true }) };
const target = {
  width: 1,
  height: 1,
  source: {
    resolution: 1,
    resize(w, h, resolution) {
      target.width = w;
      target.height = h;
      this.resolution = resolution;
      resized++;
    },
  },
  destroy() {
    destroyed++;
  },
};
let descriptor;
Object.assign(composite, {
  disposed: false,
  active: false,
  opacity: 1,
  draws: 0,
  target,
  game: { domElement: { width: 1920, height: 1080 } },
  pixi: { texture: { getGpuSource: () => source } },
  pipeline: { getBindGroupLayout: () => ({}) },
  sampler: {},
  uniform: {
    destroy() {
      destroyed++;
    },
  },
  value: new Float32Array(4),
  source: null,
  bindGroup: null,
  device: {
    createBindGroup() {
      binds++;
      return {};
    },
    createCommandEncoder: () => ({
      beginRenderPass(options) {
        descriptor = options;
        return {
          setPipeline() {},
          setBindGroup() {},
          draw(n) {
            assert.equal(n, 3);
          },
          end() {},
        };
      },
      finish: () => ({}),
    }),
    queue: {
      writeBuffer() {
        writes++;
      },
      submit() {
        submissions++;
      },
    },
  },
});
composite.resize(1920, 1080, 1);
assert.equal(composite.active, true);
composite.resize(1920, 1080, 1);
assert.equal(resized, 1);
composite.resize(1920, 1080, 2);
assert.equal(composite.active, false, 'do not silently reduce HUD DPR');
composite.resize(1280, 720, 1);
assert.equal(composite.active, false, 'world/render scaling mismatch falls back');
composite.resize(1920, 1080, 1);
const output = { createView: () => ({ output: true }) };
composite.drawTo(output);
composite.drawTo(output);
assert.equal(binds, 1, 'cache source/bind group until GPU texture changes');
assert.equal(writes, 2);
assert.equal(submissions, 2);
assert.equal(composite.draws, 2);
assert.equal(descriptor.colorAttachments[0].loadOp, 'load', 'preserve Three output');
assert.equal(descriptor.colorAttachments[0].storeOp, 'store');
composite.opacity = 0;
composite.drawTo(output);
assert.equal(submissions, 2);
composite.dispose();
composite.dispose();
assert.equal(destroyed, 2, 'only owned RT and uniform disposed once');
console.log(
  'ok same-canvas Pixi: overlay ownership, exact-resolution gating, cached GPU bindings, load-preserving presentation and owned-resource cleanup'
);
