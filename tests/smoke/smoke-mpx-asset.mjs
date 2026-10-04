// Committed MPX geometry/PBR/native-clip contract. Human visual review is separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PNG } from 'pngjs';

const dir = new URL('../../assets/weapons/sig-mpx/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const file = readFileSync(new URL('mpx.glb', dir));
assert.equal(file.readUInt32LE(0), 0x46546c67);
assert.equal(file.readUInt32LE(4), 2);
assert.equal(file.readUInt32LE(8), file.length);
assert.equal(file.readUInt32LE(16), 0x4e4f534a);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binHeader = 20 + jsonLength;
assert.equal(file.readUInt32LE(binHeader + 4), 0x004e4942);
const bin = file.subarray(binHeader + 8);
assert.equal(gltf.asset.version, '2.0');
const required = ['Idle', 'Fire', 'Last_Shot', 'Reload_Tactical', 'Reload_Empty', 'Inspect', 'Draw', 'Holster'];
assert.deepEqual(Object.keys(manifest.clips).sort(), [...required].sort());
assert.deepEqual(gltf.animations.map(a => a.name).sort(), [...required].sort());
assert.ok(!gltf.nodes.some(n => /MPX_arm|spent_case/.test(n.name)), 'shared skins/live casings are not duplicated in export');
assert.equal(manifest.textures.resolution, 1024);
assert.ok(manifest.textures.packed && manifest.textures.embedded);
assert.ok(file.length <= 10 * 1024 * 1024);
const usesDefaultMaterial = gltf.meshes.some(m => m.primitives.some(p => p.material === undefined));
assert.ok(gltf.materials.length + Number(usesDefaultMaterial) <= 16, 'include the implicit glTF fallback in the runtime material budget');
const primitives = gltf.meshes.reduce((n, mesh) => n + mesh.primitives.length, 0);
assert.ok(primitives <= 40);
assert.equal(primitives, manifest.stats.primitives);
assert.equal(gltf.materials.length, manifest.stats.materials);
assert.equal(file.length, manifest.stats.bytes);
const blend = readFileSync(new URL('mpx.blend', dir));
assert.ok(blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528,
  'editable Blender source (raw or Zstandard-compressed)');
assert.equal(gltf.images.length, 3);
assert.equal(gltf.images.length, manifest.stats.images);
for (const image of gltf.images) {
  assert.equal(image.uri, undefined);
  assert.ok(Number.isInteger(image.bufferView));
  const view = gltf.bufferViews[image.bufferView];
  const png = PNG.sync.read(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  if (image.name === 'mpx-orm') {
    for (let i = 0; i < png.data.length; i += 64) {
      assert.equal(png.data[i + 2], 255, 'constant metalness must not inherit roughness variation');
    }
  }
}
for (const buffer of gltf.buffers) assert.equal(buffer.uri, undefined);
assert.ok(gltf.extensionsUsed.includes('KHR_materials_transmission'));
for (const material of gltf.materials) {
  const pbr = material.pbrMetallicRoughness;
  assert.ok(pbr.baseColorTexture && pbr.metallicRoughnessTexture && material.normalTexture,
    `${material.name}: preserve all three original PBR maps`);
  assert.ok(pbr.baseColorFactor.slice(0, 3).every(n => n > 0 && n < .6));
  assert.ok([0, 1].includes(pbr.metallicFactor ?? 1), 'metals are binary');
}

const formats = { 5126: ['readFloatLE', 4], 5125: ['readUInt32LE', 4], 5123: ['readUInt16LE', 2] };
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(index) {
  const a = gltf.accessors[index];
  assert.ok(a && !a.sparse);
  const [read, bytes] = formats[a.componentType];
  const width = widths[a.type];
  const view = gltf.bufferViews[a.bufferView];
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? width * bytes;
  const values = new Float64Array(a.count * width);
  for (let i = 0; i < a.count; i++) {
    for (let j = 0; j < width; j++) {
      const value = bin[read](start + i * stride + j * bytes);
      assert.ok(Number.isFinite(value));
      values[i * width + j] = value;
    }
  }
  return values;
}
const interiorMaterial = gltf.materials.findIndex(m => m.name.startsWith('15 |'));
assert.ok(interiorMaterial >= 0, 'dedicated absorptive optic finish exported');
let interiorUsed = false;
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    if (primitive.material === interiorMaterial) interiorUsed = true;
    const name = gltf.materials[primitive.material]?.name ?? '';
    if (name.startsWith('11 |') || name.startsWith('12 |')) {
      const normals = accessor(primitive.attributes.NORMAL), first = new THREE.Vector3().fromArray(normals);
      for (let i = 0; i < normals.length; i += 3) {
        assert.ok(first.dot(new THREE.Vector3().fromArray(normals, i)) > .999, 'optical surface is one sheet, not a closed cylinder');
      }
    }
    assert.equal(primitive.mode ?? 4, 4, 'triangle export');
    for (const name of ['POSITION', 'NORMAL', 'TEXCOORD_0']) accessor(primitive.attributes[name]);
    const indices = accessor(primitive.indices);
    assert.equal(indices.length % 3, 0);
    assert.ok(indices.every(i => Number.isInteger(i) && i < gltf.accessors[primitive.attributes.POSITION].count));
  }
}
assert.ok(interiorUsed, 'optic finish must actually be assigned to exported faces');
for (const animation of gltf.animations) {
  const info = manifest.clips[animation.name];
  for (const sampler of animation.samplers) {
    const times = accessor(sampler.input);
    assert.ok(Math.abs(times.at(-1) - info.duration) < 1e-6, `${animation.name}: exact gameplay endpoint`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], 'ordered native sampler');
    accessor(sampler.output);
  }
  for (const channel of animation.channels) {
    if (channel.target.path === 'scale') assert.equal(animation.samplers[channel.sampler].interpolation, 'STEP');
  }
  for (const target of ['MPX_RIG', 'bolt', 'trigger', 'magazine', 'magazine_spare', 'hand_L', 'hand_R', 'L_finger_0_0', 'R_finger_0_0']) {
    assert.ok(animation.channels.some(c => gltf.nodes[c.target.node].name === target), `${animation.name}: ${target} authored channel`);
  }
}
let triangles = 0;
for (const node of gltf.nodes) {
  if (node.mesh !== undefined) {
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      triangles += gltf.accessors[primitive.indices].count / 3;
    }
  }
}
assert.equal(triangles, manifest.stats.triangleInstances);
assert.ok(triangles > 30000 && triangles < 110000);

const nodes = gltf.nodes.map(n => {
  const object = new THREE.Object3D();
  object.name = n.name;
  if (n.matrix) {
    object.matrix.fromArray(n.matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
  } else {
    if (n.translation) object.position.fromArray(n.translation);
    if (n.rotation) object.quaternion.fromArray(n.rotation);
    if (n.scale) object.scale.fromArray(n.scale);
  }
  return object;
});
for (let i = 0; i < nodes.length; i++) {
  for (const child of gltf.nodes[i].children ?? []) nodes[i].add(nodes[child]);
}
const root = new THREE.Group();
for (const i of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[i]);
root.updateMatrixWorld(true);
for (const name of ['MPX_RIG', 'receiver', 'magazine', 'bolt', 'charging_handle', 'selector', 'trigger',
  'stock_hinge', 'bolt_release', 'lens_cap_front', 'lens_cap_rear',
  'SOCKET_grip_right', 'SOCKET_grip_left', 'SOCKET_magazine']) {
  assert.ok(root.getObjectByName(name), name);
}
function point(name) {
  const node = root.getObjectByName(`SOCKET_${name}`);
  assert.ok(node, name);
  return node.getWorldPosition(new THREE.Vector3());
}
assert.ok(Math.abs(point('barrel_crown').x - point('breech').x - .2032) < 1e-6);
assert.ok(point('muzzle').distanceTo(new THREE.Vector3(manifest.dimensions.muzzle, 0, 0)) < 1e-6);
assert.ok(point('sight').distanceTo(new THREE.Vector3(.074, .044 + .035814, 0)) < 1e-6);
assert.ok(point('ejection').z > .02, 'right side in exported coordinates');
// Regression checks on the exported hierarchy, not only Blender/source metadata.
const axis = .044 + .035814;
for (const [tag, side] of [['rear', -1], ['front', 1]]) {
  const pivot = root.getObjectByName(`lens_cap_${tag}`).getWorldPosition(new THREE.Vector3());
  assert.ok(pivot.distanceTo(new THREE.Vector3(.074 + side * (.0855 / 2 + .0005), axis - .0154, 0)) < 1e-6,
    `${tag} cover pivot must mount to the optic, not float below it`);
}
function meshBounds(name) {
  const nodeIndex = gltf.nodes.findIndex(n => n.name === name);
  assert.ok(nodeIndex >= 0, name);
  const object = nodes[nodeIndex];
  const result = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const primitive of gltf.meshes[gltf.nodes[nodeIndex].mesh].primitives) {
    const positions = accessor(primitive.attributes.POSITION);
    for (let i = 0; i < positions.length; i += 3) {
      p.fromArray(positions, i).applyMatrix4(object.matrixWorld);
      result.expandByPoint(p);
    }
  }
  return result;
}
assert.ok(meshBounds('trigger_mesh').max.y > -.040, 'trigger root must extend into the receiver pocket');
for (const tag of ['rear', 'front']) {
  assert.ok(meshBounds(`lens_cap_${tag}_mesh`).max.y < axis - .010, 'open covers must clear the sight aperture');
}
const magBounds = meshBounds('magazine_mesh');
assert.ok(magBounds.max.z - magBounds.min.z <= .031, 'magazine thickness must not grow during export');
assert.ok(magBounds.max.y - magBounds.min.y > .175 && magBounds.max.y - magBounds.min.y < .190,
  'retain the photo-informed full magazine envelope, not an arbitrary rescale');
assert.equal(manifest.dimensions.suppressorEnvelope[0], .175);
assert.equal(manifest.dimensions.suppressorEnvelope[1], .035);
console.log(`MPX: ${triangles} triangle instances / ${primitives} primitives / ${gltf.materials.length} materials / three 1K maps / eight native clips; human animation/gameplay approval pending`);
