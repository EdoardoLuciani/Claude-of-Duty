import assert from 'node:assert/strict';
import { DirectionalLight, PointLight, Vector3 } from 'three/webgpu';
import { lightPosition, lightTargetPosition, lightViewPosition, sharedUniformGroup } from 'three/tsl';
import { IndirectFill } from '../../src/render/indirect-webgpu.js';
import { RenderSystem } from '../../src/render/index-webgpu.js';

const world = {
  buildings: [{ spec: { enterable: true, x: 8, z: -3, w: 6, d: 4 }, roofY: 9 }],
  levelToWorld(x, y, z, out) { return out.set(x, y, z); },
};
let ready = false;
const fill = new IndirectFill({ peek: () => ready ? world : null });
assert.equal(fill.roomGroup.shared, true);
assert.equal(fill.roomGroup.updateType, 'none');
assert.equal(fill.roomBoxes.groupNode, fill.roomGroup);
assert.equal(fill.roomHeights.groupNode, fill.roomGroup);
assert.equal(fill.roomBoxes.updateType, 'none');
fill._updateRooms();
assert.equal(fill._roomsReady, undefined, 'not published before world initialization');
assert.equal(fill.roomGroup.version, 0);
// Simulate arrays allocated by an early shader build before the world is ready.
fill.roomBoxes.value = new Float32Array(40);
fill.roomHeights.value = new Float32Array(40);
ready = true;
fill._updateRooms();
assert.equal(fill._roomsReady, true);
assert.equal(fill.roomCount.value, 1);
assert.deepEqual(Array.from(fill.roomBoxes.value.slice(0, 4)), [8, -3, 3, 2]);
assert(Math.abs(fill.roomHeights.value[1] - 8.94) < 1e-6);
assert.equal(fill.roomGroup.version, 1, 'publish allocated arrays once');
const version = fill.roomGroup.version;
fill._updateRooms();
assert.equal(fill.roomGroup.version, version, 'immutable room group does not advance per frame');
const next = new IndirectFill({ peek: () => world });
next._updateRooms();
assert.notEqual(next.roomGroup, fill.roomGroup, 'restart owns a fresh publication lifetime');
assert.equal(next.roomGroup.version, 1);

const renderer = new RenderSystem();
// CPU-only partial owner: init() requires a real canvas/device (covered by the GPU tool).
renderer._lightPositionGroup = sharedUniformGroup('testLightPositions', 0, 'render');
renderer._lightUniformGroups = new Map();
const point = new PointLight(), sun = new DirectionalLight();
point.position.copy(new Vector3(2, 3, 4));
const nodes = [lightViewPosition(point), lightPosition(sun), lightTargetPosition(sun)];
const originalGroups = nodes.map(node => node.groupNode);
renderer._tagLight(point);
renderer._tagLight(sun);
for (const node of nodes) assert.equal(node.groupNode, renderer._lightPositionGroup);
renderer._tagLight(point);
renderer._tagLight(sun);
assert.equal(renderer._lightUniformGroups.size, 3, 'tagging is idempotent');
renderer.grade = { texture: { dispose() {} } };
renderer._fallbackEnv = { dispose() {} };
renderer.renderer = { async dispose() {} };
renderer.sun = new DirectionalLight(); renderer._skyKey = new DirectionalLight(); renderer._skySecondary = new DirectionalLight();
const removed = [];
renderer.ctx = { scene: { remove(...objects) { removed.push(...objects); } } };
await renderer.dispose();
assert.equal(removed.length, 6, 'owned directional proxies and targets are removed');
for (let i = 0; i < nodes.length; i++) assert.equal(nodes[i].groupNode, originalGroups[i]);
assert.equal(renderer._lightUniformGroups.size, 0, 'owner releases cached light node references');
console.log('Render uniforms: immutable room publication, late initialization, restart and light-group restoration passed');
