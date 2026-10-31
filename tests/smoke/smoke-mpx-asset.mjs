// Committed MPX geometry/PBR/native-clip contract. Human visual review is separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/sig-mpx/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const file = readFileSync(new URL('mpx.glb', dir));
const { json: gltf, accessor, imagePNG } = inspectGLB(file);
const required = [
  'Idle',
  'Fire',
  'Last_Shot',
  'Reload_Tactical',
  'Reload_Empty',
  'Inspect',
  'Draw',
  'Holster',
];
assert.deepEqual(Object.keys(manifest.clips).sort(), [...required].sort());
assert.deepEqual(gltf.animations.map((a) => a.name).sort(), [...required].sort());
assert.ok(
  !gltf.nodes.some((n) => /MPX_arm|spent_case/.test(n.name)),
  'shared skins/live casings are not duplicated in export'
);
assert.equal(manifest.textures.resolution, 1024);
assert.ok(manifest.textures.packed && manifest.textures.embedded);
// Local rigid surfaces retain all authored geometry without skin attributes.
assert.ok(file.length <= 10 * 1024 * 1024);
const usesDefaultMaterial = gltf.meshes.some((m) =>
  m.primitives.some((p) => p.material === undefined)
);
assert.equal(
  gltf.materials.length + Number(usesDefaultMaterial),
  3,
  'include the implicit glTF fallback in the runtime material budget'
);
const primitives = gltf.meshes.reduce((n, mesh) => n + mesh.primitives.length, 0);
assert.equal(
  primitives,
  16,
  'ten rigid owners, four magazine/round primitives, body glass and interior'
);
assert.equal(primitives, manifest.stats.primitives);
assert.equal(gltf.materials.length, manifest.stats.materials);
assert.equal(file.length, manifest.stats.bytes);
const blend = readFileSync(new URL('mpx.blend', dir));
assert.ok(
  blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528,
  'editable Blender source (raw or Zstandard-compressed)'
);
assert.equal(gltf.images.length, 3);
assert.equal(gltf.images.length, manifest.stats.images);
for (const image of gltf.images) {
  assert.equal(image.uri, undefined);
  assert.ok(Number.isInteger(image.bufferView));
  const png = imagePNG(image);
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  if (image.name === 'mpx-finish-orm') {
    const metals = [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0];
    for (let finish = 0; finish < metals.length; finish++) {
      const x = (finish % 4) * 256 + 128,
        y = 1023 - (Math.floor(finish / 4) * 256 + 128);
      assert.equal(
        png.data[(y * 1024 + x) * 4 + 2],
        metals[finish] * 255,
        'per-finish metalness is binary and independent of roughness'
      );
      if (finish === 14)
        assert.ok(
          png.data[(y * 1024 + x) * 4 + 1] > 208,
          'absorptive interior retains its original high roughness'
        );
    }
  }
}
for (const buffer of gltf.buffers) assert.equal(buffer.uri, undefined);
assert.ok(gltf.extensionsUsed.includes('KHR_materials_transmission'));
for (const material of gltf.materials) {
  const pbr = material.pbrMetallicRoughness;
  assert.ok(
    pbr.baseColorTexture && pbr.metallicRoughnessTexture && material.normalTexture,
    `${material.name}: preserve all three original PBR maps`
  );
  assert.deepEqual(
    pbr.baseColorFactor ?? [1, 1, 1, 1],
    [1, 1, 1, 1],
    'per-corner reflectance, not averaged material factors'
  );
  assert.equal(
    pbr.metallicFactor ?? 1,
    1,
    'binary per-finish metalness comes from the shared ORM atlas'
  );
  assert.equal(pbr.metallicRoughnessTexture.texCoord, 1);
  assert.equal(material.normalTexture.texCoord, 1);
  assert.equal(
    material.normalTexture.scale ?? 1,
    1,
    'normal XYZ already incorporates source strength'
  );
}

const finishColors = [
  [0.06, 0.065, 0.071],
  [0.112, 0.117, 0.125],
  [0.03, 0.032, 0.035],
  [0.022, 0.024, 0.026],
  [0.066, 0.072, 0.08],
  [0.18, 0.19, 0.21],
  [0.039, 0.041, 0.044],
  [0.052, 0.058, 0.062],
  [0.28, 0.29, 0.3],
  [0.033, 0.049, 0.075],
  [0.31, 0.4, 0.46],
  [0.35, 0.4, 0.42],
  [0.25, 0.15, 0.055],
  [0.22, 0.09, 0.045],
  [0.004, 0.0045, 0.005],
];
const usedFinishes = new Set();
const interiorMaterial = gltf.materials.findIndex((m) => m.name.startsWith('15 |'));
assert.ok(interiorMaterial >= 0, 'dedicated absorptive optic finish exported');
let interiorUsed = false;
for (const mesh of gltf.meshes) {
  for (const primitive of mesh.primitives) {
    if (primitive.material === interiorMaterial) interiorUsed = true;
    const name = gltf.materials[primitive.material]?.name ?? '';
    if (name.startsWith('11 |')) {
      const normals = accessor(primitive.attributes.NORMAL),
        first = new THREE.Vector3().fromArray(normals);
      for (let i = 0; i < normals.length; i += 3) {
        assert.ok(
          first.dot(new THREE.Vector3().fromArray(normals, i)) > 0.999,
          'optical surface is one sheet, not a closed cylinder'
        );
      }
    }
    assert.equal(primitive.mode ?? 4, 4, 'triangle export');
    for (const name of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'])
      accessor(primitive.attributes[name]);
    const color = accessor(primitive.attributes.COLOR_0);
    const denominator =
      gltf.accessors[primitive.attributes.COLOR_0].componentType === 5123 ? 65535 : 1;
    const uv0 = accessor(primitive.attributes.TEXCOORD_0),
      uv1 = accessor(primitive.attributes.TEXCOORD_1);
    for (let i = 0; i < color.length; i += 4) {
      const finish = finishColors.findIndex((rgb) =>
        rgb.every((c, channel) => Math.abs(c - color[i + channel] / denominator) < 1 / 65535)
      );
      assert.ok(finish >= 0, 'preserve every original linear reflectance, including fine markings');
      usedFinishes.add(finish);
      assert.equal(color[i + 3] / denominator, 1);
      const vertex = i / 4;
      // glTF flips both UV sets. Check the full per-vertex affine mapping so a
      // material-slot reset cannot silently turn mixed surfaces into alloy.
      assert.ok(
        Math.abs(uv1[vertex * 2] - ((finish % 4) * 256 + 4 + uv0[vertex * 2] * 248) / 1024) < 1e-6
      );
      assert.ok(
        Math.abs(
          1 -
            uv1[vertex * 2 + 1] -
            (Math.floor(finish / 4) * 256 + 4 + (1 - uv0[vertex * 2 + 1]) * 248) / 1024
        ) < 1e-6
      );
      const expected = finish === 10 ? '11 |' : finish === 14 ? '15 |' : 'MPX |';
      assert.ok(
        name.startsWith(expected),
        'optical and absorptive finishes keep independent pass policies'
      );
    }
    const indices = accessor(primitive.indices);
    assert.equal(indices.length % 3, 0);
    assert.ok(
      indices.every(
        (i) => Number.isInteger(i) && i < gltf.accessors[primitive.attributes.POSITION].count
      )
    );
  }
}
assert.ok(interiorUsed, 'optic finish must actually be assigned to exported faces');
assert.deepEqual(
  [...usedFinishes].sort((a, b) => a - b),
  Array.from({ length: 15 }, (_, i) => i).filter((i) => i !== 11),
  'only the explicitly replaced clear-cover finish is unused; all other finishes survive'
);
for (const animation of gltf.animations) {
  const info = manifest.clips[animation.name];
  for (const sampler of animation.samplers) {
    const times = accessor(sampler.input);
    assert.ok(
      Math.abs(times.at(-1) - info.duration) < 1e-6,
      `${animation.name}: exact gameplay endpoint`
    );
    for (let i = 1; i < times.length; i++)
      assert.ok(times[i] > times[i - 1], 'ordered native sampler');
    accessor(sampler.output);
  }
  for (const channel of animation.channels) {
    if (channel.target.path === 'scale')
      assert.equal(animation.samplers[channel.sampler].interpolation, 'STEP');
  }
  for (const target of [
    'MPX_RIG',
    'bolt',
    'trigger',
    'magazine',
    'magazine_spare',
    'hand_L',
    'hand_R',
    'L_finger_0_0',
    'R_finger_0_0',
  ]) {
    assert.ok(
      animation.channels.some((c) => gltf.nodes[c.target.node].name === target),
      `${animation.name}: ${target} authored channel`
    );
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
assert.ok(
  triangles > 30000 && triangles < 80000,
  'source-level rim/dot reduction, not only encoder simplification'
);

const root = (await parseGLB(file)).scene;
root.updateMatrixWorld(true);
const nodes = gltf.nodes.map((node) => root.getObjectByName(node.name));
root.traverse((mesh) => {
  if (!mesh.isMesh) return;
  assert.ok(!mesh.isSkinnedMesh, 'ordinary rigid geometry, no stationary-body skin');
  assert.equal(mesh.geometry.groups.length, 0, 'one real primitive per surface');
  assert.equal(mesh.geometry.attributes.skinIndex, undefined);
  assert.equal(mesh.geometry.attributes.skinWeight, undefined);
});
for (const name of [
  'MPX_RIG',
  'receiver',
  'magazine',
  'bolt',
  'charging_handle',
  'selector',
  'trigger',
  'stock_hinge',
  'bolt_release',
  'lens_cap_front',
  'lens_cap_rear',
  'SOCKET_grip_right',
  'SOCKET_grip_left',
  'SOCKET_magazine',
]) {
  assert.ok(root.getObjectByName(name), name);
}
function point(name) {
  const node = root.getObjectByName(`SOCKET_${name}`);
  assert.ok(node, name);
  return node.getWorldPosition(new THREE.Vector3());
}
assert.ok(Math.abs(point('barrel_crown').x - point('breech').x - 0.2032) < 1e-6);
assert.ok(point('muzzle').distanceTo(new THREE.Vector3(manifest.dimensions.muzzle, 0, 0)) < 1e-6);
assert.ok(point('sight').distanceTo(new THREE.Vector3(0.074, 0.044 + 0.035814, 0)) < 1e-6);
assert.ok(point('ejection').z > 0.02, 'right side in exported coordinates');
// Regression checks on the exported hierarchy, not only Blender/source metadata.
const axis = 0.044 + 0.035814;
for (const [tag, side] of [
  ['rear', -1],
  ['front', 1],
]) {
  const pivot = root.getObjectByName(`lens_cap_${tag}`).getWorldPosition(new THREE.Vector3());
  assert.ok(
    pivot.distanceTo(new THREE.Vector3(0.074 + side * (0.07 / 2 + 0.0045), axis - 0.0129, 0)) <
      1e-6,
    `${tag} cover pivot must mount to the optic, not float below it`
  );
}
// Read actual ordinary part geometry, never empty control helpers.
function partVertices(name, visit) {
  const mesh = root.getObjectByName(name);
  assert.ok(mesh?.isMesh && !mesh.isSkinnedMesh, name);
  const p = new THREE.Vector3();
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i, p);
    visit(p.applyMatrix4(mesh.matrixWorld));
  }
}
function meshBounds(name) {
  const result = new THREE.Box3();
  partVertices(name, (p) => result.expandByPoint(p));
  return result;
}
const closedBounds = new THREE.Box3(),
  lensBounds = new THREE.Box3(),
  vertex = new THREE.Vector3();
for (const tag of ['rear', 'front']) {
  const pivot = root.getObjectByName(`lens_cap_${tag}`);
  const closed = pivot.parent.matrixWorld
    .clone()
    .multiply(new THREE.Matrix4().compose(pivot.position, new THREE.Quaternion(), pivot.scale))
    .multiply(pivot.matrixWorld.clone().invert());
  partVertices(`lens_cap_${tag}_mesh`, (p) => closedBounds.expandByPoint(p.applyMatrix4(closed)));
  assert.equal(
    root.getObjectByName(`lens_cap_${tag}_optical`),
    undefined,
    'solid cover surfaces belong to the existing opaque cap frame, not a separate glass mesh'
  );
}
assert.ok(
  Math.abs(closedBounds.max.x - closedBounds.min.x - 0.0855) < 1e-6,
  `85.5mm includes closed covers, not only the tube: ${closedBounds.max.x - closedBounds.min.x}`
);
for (let n = 0; n < gltf.nodes.length; n++) {
  if (gltf.nodes[n].name !== 'receiver_optical') continue;
  for (const primitive of gltf.meshes[gltf.nodes[n].mesh].primitives) {
    if (!gltf.materials[primitive.material]?.name.startsWith('11 |')) continue;
    const positions = accessor(primitive.attributes.POSITION);
    for (let i = 0; i < positions.length; i += 3)
      lensBounds.expandByPoint(vertex.fromArray(positions, i).applyMatrix4(nodes[n].matrixWorld));
  }
}
assert.ok(
  Math.abs(lensBounds.max.x - lensBounds.min.x - 0.064) < 1e-6,
  'committed lens spacing matches the inferred, not manufacturer-certified, datum'
);
assert.ok(
  Math.abs(lensBounds.max.y - lensBounds.min.y - 0.02) < 1e-6,
  'published aperture is not enlarged to hide the tunnel'
);
// The cap is merged into receiver_mesh. Select its alloy perimeter by the
// unchanged centre/radius; exclude the smaller neck and steel face knurls.
const capBounds = new THREE.Box3();
const receiverIndex = gltf.nodes.findIndex((n) => n.name === 'receiver_mesh');
for (const primitive of gltf.meshes[gltf.nodes[receiverIndex].mesh].primitives) {
  if (gltf.materials[primitive.material]?.name !== 'MPX | consolidated opaque finishes') continue;
  const positions = accessor(primitive.attributes.POSITION);
  const colors = accessor(primitive.attributes.COLOR_0);
  const denominator =
    gltf.accessors[primitive.attributes.COLOR_0].componentType === 5123 ? 65535 : 1;
  for (let i = 0; i < positions.length; i += 3) {
    // Select the original alloy finish, not the steel knurls in the same draw.
    if (Math.abs(colors[(i / 3) * 4] / denominator - 0.06) > 1 / 65535) continue;
    vertex.fromArray(positions, i).applyMatrix4(nodes[receiverIndex].matrixWorld);
    const radius = Math.hypot(vertex.x - 0.088, vertex.y - axis);
    if (vertex.z > 0.014 && radius > 0.0125 && radius < 0.013001) capBounds.expandByPoint(vertex);
  }
}
assert.ok(!capBounds.isEmpty(), 'committed battery cap perimeter');
assert.ok(Math.abs(capBounds.max.x - capBounds.min.x - 0.026) < 1e-6, 'cap diameter remains 26mm');
assert.ok(
  Math.abs(capBounds.max.z - capBounds.min.z - 0.006) < 1e-6,
  'drawing-derived thin 6mm cap'
);
assert.ok(Math.abs(capBounds.max.z - 0.0269) < 1e-6, 'outer face/overall width unchanged');
assert.equal(manifest.dimensions.opticClosedLength, 0.0855);
assert.equal(manifest.dimensions.opticRimDiameter, 0.027);
assert.match(manifest.opticDepthAuthority, /inferred/);
assert.ok(
  meshBounds('trigger_mesh').max.y > -0.04,
  'trigger root must extend into the receiver pocket'
);
for (const tag of ['rear', 'front']) {
  assert.ok(
    meshBounds(`lens_cap_${tag}_mesh`).max.y < axis - 0.01,
    'open covers must clear the sight aperture'
  );
}
const magBounds = meshBounds('magazine_mesh');
assert.ok(
  magBounds.max.z - magBounds.min.z <= 0.031,
  'magazine thickness must not grow during export'
);
assert.ok(
  magBounds.max.y - magBounds.min.y > 0.175 && magBounds.max.y - magBounds.min.y < 0.19,
  'retain the photo-informed full magazine envelope, not an arbitrary rescale'
);
assert.equal(manifest.dimensions.suppressorEnvelope[0], 0.175);
assert.equal(manifest.dimensions.suppressorEnvelope[1], 0.035);
const runtimeFile = readFileSync(new URL('mpx.runtime.glb', dir));
const { json: runtime } = inspectGLB(runtimeFile);
assert.ok(
  runtimeFile.length < 2.7 * 1024 * 1024,
  'bounded cooked delivery size, independent of native skin storage'
);
const vertexViews = new Set(
  runtime.meshes.flatMap((mesh) =>
    mesh.primitives.flatMap((primitive) =>
      Object.values(primitive.attributes).map((index) => runtime.accessors[index].bufferView)
    )
  )
);
assert.ok(
  [...vertexViews].reduce((bytes, index) => bytes + runtime.bufferViews[index].byteLength, 0) <
    4.1 * 1024 * 1024,
  'decoded vertex buffer-view budget for ordinary rigid surfaces'
);
assert.ok(
  runtimeFile.length < file.length / 3,
  'cooked delivery savings, independent of native source compression'
);
assert.equal(
  runtime.materials.length,
  3,
  '-km retains the exact absorptive interior runtime policy'
);
assert.equal(
  runtime.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
  16
);
assert.equal(runtime.images.length, 3);
assert.ok(
  runtime.images.every((image) => image.mimeType === 'image/ktx2' && image.uri === undefined)
);
assert.ok(runtime.extensionsRequired.includes('KHR_texture_basisu'));
assert.ok(runtime.extensionsRequired.includes('EXT_meshopt_compression'));
assert.deepEqual(
  runtime.nodes.map((node) => node.name).sort(),
  gltf.nodes.map((node) => node.name).sort(),
  '-kn retains every named socket, rigid part and hand helper'
);
console.log(
  `MPX: ${triangles} triangle instances / ${primitives} primitives / ${gltf.materials.length} materials / three 1K maps / eight native clips; human animation/gameplay approval pending`
);
