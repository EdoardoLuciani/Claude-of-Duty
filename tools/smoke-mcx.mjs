// Standalone Blender asset contract. No Blender, DOM or image decoder needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { PNG } from 'pngjs';

const dir = new URL('../assets/weapons/mcx-virtus/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const file = readFileSync(new URL('mcx-virtus.glb', dir));
assert.equal(file.readUInt32LE(0), 0x46546c67);
assert.equal(file.readUInt32LE(4), 2);
assert.equal(file.readUInt32LE(8), file.length);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const bin = file.subarray(28 + jsonLength);
assert.equal(gltf.asset.version, '2.0');
assert.ok(file.length < 16 * 1024 * 1024, 'standalone GLB size budget');
const blend = readFileSync(new URL('mcx-virtus.blend', dir));
assert.ok(blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528,
  'editable Blender file (raw or Blender 5 Zstandard compression)');
assert.equal(gltf.images.length, 3);
for (const image of gltf.images) {
  assert.ok(Number.isInteger(image.bufferView), 'textures must be embedded');
  assert.equal(image.uri, undefined);
  const view = gltf.bufferViews[image.bufferView];
  const png = PNG.sync.read(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  assert.equal(png.width, manifest.textures.resolution);
  assert.equal(png.height, manifest.textures.resolution);
  if (image.name === 'roughness_variation') {
    for (let i = 0; i < png.data.length; i += 64) {
      assert.equal(png.data[i + 2], 255, 'untextured metalness must pack as white, not roughness');
    }
  }
}
assert.ok(gltf.extensionsUsed.includes('KHR_materials_transmission'), 'coated lenses');
for (const buffer of gltf.buffers) assert.equal(buffer.uri, undefined);
for (const material of gltf.materials) {
  const pbr = material.pbrMetallicRoughness;
  assert.ok(pbr.baseColorFactor, `${material.name}: preserve authored tint, not white`);
  assert.ok(pbr.baseColorTexture && pbr.metallicRoughnessTexture && material.normalTexture);
  assert.ok(pbr.baseColorFactor.slice(0, 3).every(v => v > 0 && v < .6));
}

const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const formats = { 5126: ['readFloatLE', 4], 5125: ['readUInt32LE', 4], 5123: ['readUInt16LE', 2] };
function accessor(index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const [read, bytes] = formats[a.componentType];
  const width = widths[a.type];
  assert.ok(width && !a.sparse, 'supported dense accessor');
  const data = new Float32Array(a.count * width);
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? width * bytes;
  for (let i = 0; i < a.count; i++) {
    for (let j = 0; j < width; j++) {
      const value = bin[read](start + i * stride + j * bytes);
      assert.ok(Number.isFinite(value));
      data[i * width + j] = value;
    }
  }
  return data;
}
let triangles = 0;
for (const mesh of gltf.meshes) {
  for (const p of mesh.primitives) {
    for (const name of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
      assert.ok(Number.isInteger(p.attributes[name]), `${mesh.name}: ${name}`);
      accessor(p.attributes[name]);
    }
    const indices = accessor(p.indices);
    assert.ok(indices.every(i => i < gltf.accessors[p.attributes.POSITION].count));
    triangles += indices.length / 3;
  }
}
assert.equal(triangles, manifest.stats.triangles);
assert.ok(triangles > 30000 && triangles < 150000);
assert.equal(gltf.meshes.length, 10, 'merge static components under ten rigid pivots');

// Replay the exported sampler data in Three.js, including clip transitions.
const nodes = gltf.nodes.map(n => {
  const obj = new THREE.Object3D();
  obj.name = n.name;
  if (n.translation) obj.position.fromArray(n.translation);
  if (n.rotation) obj.quaternion.fromArray(n.rotation);
  if (n.scale) obj.scale.fromArray(n.scale);
  return obj;
});
for (let i = 0; i < nodes.length; i++) {
  for (const child of gltf.nodes[i].children ?? []) nodes[i].add(nodes[child]);
}
const root = new THREE.Group();
for (const i of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[i]);
const named = Object.fromEntries(nodes.map(o => [o.name, o]));
for (const name of ['SOCKET_muzzle', 'SOCKET_ejection', 'SOCKET_grip_R', 'SOCKET_grip_L', 'SOCKET_sight']) {
  assert.ok(named[name], name);
}
const expected = ['Idle', 'Fire', 'Reload_Tactical', 'Reload_Empty', 'Inspect', 'Stock_Fold'];
assert.deepEqual(gltf.animations.map(a => a.name).sort(), [...expected].sort());
const mixer = new THREE.AnimationMixer(root);
const clips = {};
for (const a of gltf.animations) {
  assert.equal(a.channels.length, 30, `${a.name}: every rig TRS channel must reset`);
  const tracks = a.channels.map(c => {
    const s = a.samplers[c.sampler];
    assert.ok(['LINEAR', 'STEP'].includes(s.interpolation));
    if (c.target.path === 'scale') assert.equal(s.interpolation, 'STEP', 'no visibility shrink/pop');
    const property = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[c.target.path];
    const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(`${nodes[c.target.node].name}.${property}`, accessor(s.input), accessor(s.output),
      s.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear);
  });
  clips[a.name] = new THREE.AnimationClip(a.name, -1, tracks);
  assert.ok(Math.abs(clips[a.name].duration - manifest.clips[a.name].duration) < 1e-5);
}
function pose(name, time) {
  mixer.stopAllAction();
  const action = mixer.clipAction(clips[name]);
  action.reset().setLoop(THREE.LoopOnce, 1).play();
  action.clampWhenFinished = true;
  // glTF timestamps are float32: sample the actual key, not a double a few
  // nanoseconds before a STEP boundary (e.g. 4/60 vs 0.06666667014360428).
  action.time = Math.fround(time);
  mixer.update(0);
  root.updateMatrixWorld(true);
}
const { magazine: mag, magazine_spare: spare, spent_case: shell, bolt, charging_handle: handle } = named;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} ≈ ${expected}`);
pose('Idle', 0);
assert.equal(mag.scale.x, 1);
assert.equal(spare.scale.x, 0);
assert.equal(shell.scale.x, 0);
pose('Fire', 4 / 60);
near(shell.scale.x, 1);
assert.ok(shell.position.z > .03, 'eject from right side (+Z in glTF)');
assert.ok(bolt.position.x < -.06, 'bolt reciprocates');
assert.ok(named.MCX_RIG.position.x < -.008, 'weapon recoil');
pose('Fire', .35);
assert.ok(shell.position.z > .2 && shell.position.y > .05, 'casing arc');
pose('Fire', .8);
assert.equal(shell.scale.x, 0);
assert.ok(Math.abs(bolt.position.x) < 1e-6);
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  pose(name, 43 / 60);
  assert.ok(mag.position.y < -.11, 'magazine clears well');
  pose(name, 70 / 60);
  near(mag.scale.x, 0);
  near(spare.scale.x, 1);
  assert.ok(spare.position.y < -.19, 'fresh magazine approaches from below');
  pose(name, 117 / 60);
  assert.ok(spare.position.length() < .001, 'fresh magazine seats at original pivot');
  pose(name, manifest.clips[name].duration - 1 / 120);
  near(mag.scale.x, 0);
  near(spare.scale.x, 1);
  pose(name, manifest.clips[name].duration);
  near(mag.scale.x, 1);
  near(spare.scale.x, 0);
  assert.ok(mag.position.length() < 1e-6);
}
pose('Reload_Empty', 145 / 60);
assert.ok(handle.position.x < -.07 && bolt.position.x < -.07);
pose('Reload_Tactical', 145 / 60);
assert.ok(Math.abs(handle.position.x) < 1e-6, 'tactical reload does not rack');
pose('Stock_Fold', 60 / 60);
assert.ok(Math.abs(named.stock_hinge.quaternion.y) > .98);
pose('Inspect', 1);
assert.ok(Math.abs(named.MCX_RIG.quaternion.x) > .2);
pose('Idle', 0);
assert.equal(shell.scale.x, 0);
assert.ok(Math.abs(handle.position.x) < 1e-6);
assert.ok(named.stock_hinge.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
console.log(`MCX: ${triangles} triangles; 6 clips; PBR maps, sockets, ejection, reloads and resets verified (${fileURLToPath(dir)})`);
