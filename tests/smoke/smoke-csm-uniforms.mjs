import assert from 'node:assert/strict';
import { DirectionalLight, PCFShadowMap, PerspectiveCamera, VSMShadowMap, WebGPUCoordinateSystem } from 'three/webgpu';
import { renderGroup } from 'three/tsl';
import { StableCSMShadowNode, groupedReference, stablePCFShadowFilter } from '../../src/render/csm-webgpu.js';

function fixture() {
  return new StableCSMShadowNode(new DirectionalLight(), { cascades: 3, maxFar: 80 });
}
// Native frustum/light initialization is CPU-only; texture creation and shader
// execution are separately covered by the GPU tool and gameplay checks.
const node = fixture(), builder = { camera: new PerspectiveCamera(), renderer: {
  coordinateSystem: WebGPUCoordinateSystem, reversedDepthBuffer: false, shadowMap: { type: PCFShadowMap },
} };
const first = node.setup(builder);
assert.equal(node.camera, builder.camera);
assert.equal(node.lights.length, 3, 'run native initialization before caching');
assert.equal(groupedReference('bias', 'float', node.lights[0].shadow).group, renderGroup);
assert.equal(groupedReference('mapSize', 'vec2', node.lights[0].shadow).group, renderGroup);
assert.equal(node.setup(builder), first, 'reuse one expression across material builders');
assert.equal(node.setup({ renderer: builder.renderer }), first);
assert(node.lights.every(light => light.shadow.filterNode === stablePCFShadowFilter));
node.camera.near = 0.2; node.camera.far = 250; node.maxFar = 100;
node.lights[0].shadow.radius = 2;
node.lights[0].shadow.mapSize.set(1024, 1024);
assert.equal(node.setup(builder), first, 'live numeric values do not replace reference identities');
node.fade = true;
const faded = node.setup(builder);
assert.notEqual(faded, first, 'fade changes select a new native expression');
assert.equal(node.setup(builder), faded);
node.cascades = 2;
assert.notEqual(node.setup(builder), faded, 'cascade-count changes invalidate captured loop bounds');
const custom = {};
node.lights[1].shadow.filterNode = custom;
node.setup(builder);
assert.equal(node.lights[1].shadow.filterNode, custom, 'preserve caller-supplied filters');
builder.renderer.shadowMap.type = VSMShadowMap;
node.setup(builder);
assert.equal(node.lights[0].shadow.filterNode, null, 'do not use PCF for a different shadow-map type');
assert.equal(node.lights[1].shadow.filterNode, custom);
builder.renderer.shadowMap.type = PCFShadowMap;
node.setup(builder);
assert.equal(node.lights[0].shadow.filterNode, stablePCFShadowFilter);
const fresh = fixture();
assert.notEqual(fresh.setup(builder), first, 'a new CSM owns a new expression lifetime');
node.dispose(); fresh.dispose();
console.log('CSM uniforms: stable expressions, live parameter identities, layout invalidation and filter ownership passed');
