// Standalone Blender asset contract. No Blender, DOM or native image decoder needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const dir = new URL('../../assets/weapons/mcx-virtus/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const file = readFileSync(new URL('mcx-virtus.glb', dir));
const { json: gltf, accessor, imagePNG } = inspectGLB(file);
assert.ok(file.length <= 10 * 1024 * 1024, 'approved MCX GLB size budget');
assert.equal(gltf.materials.length, 5, 'fine/polymer/rubber finishes plus independent lens/fiber');
assert.ok(
  gltf.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0) <= 13,
  'consolidated mechanics and finishes primitive budget'
);
const blend = readFileSync(new URL('mcx-virtus.blend', dir));
assert.ok(
  blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528,
  'editable Blender file (raw or Blender 5 Zstandard compression)'
);
assert.equal(gltf.images.length, 3);
for (const image of gltf.images) {
  assert.ok(Number.isInteger(image.bufferView), 'textures must be embedded');
  assert.equal(image.uri, undefined);
  const png = imagePNG(image);
  const resolution =
    image.name === 'mcx_finish_scalars'
      ? manifest.textures.finish_lookup_resolution
      : manifest.textures.resolution;
  assert.equal(png.width, resolution);
  assert.equal(png.height, resolution);
  assert.equal(
    resolution,
    image.name === 'mcx_finish_scalars' ? 64 : 1024,
    'retain full albedo/normal detail; scalar lookup has a separate resolution contract'
  );
}
assert.ok(gltf.extensionsUsed.includes('KHR_materials_transmission'), 'coated lenses');
for (const buffer of gltf.buffers) assert.equal(buffer.uri, undefined);
for (const material of gltf.materials) {
  const pbr = material.pbrMetallicRoughness;
  assert.ok(pbr.baseColorTexture && pbr.metallicRoughnessTexture && material.normalTexture);
  assert.equal(pbr.baseColorTexture.texCoord ?? 0, 0, 'repeating albedo UV0');
  assert.equal(material.normalTexture.texCoord ?? 0, 0, 'repeating normal UV0');
  assert.equal(pbr.metallicRoughnessTexture.texCoord, 1, 'independent scalar finish lookup UV1');
  if (/^(11|12) /.test(material.name)) {
    assert.ok(pbr.baseColorFactor.slice(0, 3).every((v) => v > 0 && v < 0.6));
  }
}

let triangles = 0;
for (const mesh of gltf.meshes) {
  for (const p of mesh.primitives) {
    for (const name of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
      assert.ok(Number.isInteger(p.attributes[name]), `${mesh.name}: ${name}`);
      accessor(p.attributes[name]);
    }
    const indices = accessor(p.indices);
    assert.ok(indices.every((i) => i < gltf.accessors[p.attributes.POSITION].count));
    triangles += indices.length / 3;
  }
}
assert.equal(triangles, manifest.stats.triangles);
assert.ok(triangles > 30000 && triangles < 110000, 'strictly below approved 110k triangle cap');
assert.equal(gltf.meshes.length, 4, 'one mechanical skin plus independent magazines/casing');
assert.equal(gltf.skins.length, 1);
const decoded = await parseGLB(file);
decoded.scene.updateMatrixWorld(true);
// Read the actual bound skin at rest, partitioned by its single rigid influence.
// Geometry checks below retain their physical thresholds after consolidation.
function mechanicalVertices(part) {
  const vertices = [];
  decoded.scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      assert.equal(skinWeight.getX(i), 1, 'single rigid influence');
      assert.equal(skinWeight.getY(i) + skinWeight.getZ(i) + skinWeight.getW(i), 0);
      if (mesh.skeleton.bones[skinIndex.getX(i)].name !== `MECH_${part}`) continue;
      vertices.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  });
  assert.ok(vertices.length, `${part}: actual skinned geometry present`);
  return vertices;
}

// Replay the exported sampler data in Three.js, including clip transitions.
const nodes = gltf.nodes.map((n) => {
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
const named = Object.fromEntries(nodes.map((o) => [o.name, o]));
for (const name of [
  'SOCKET_muzzle',
  'SOCKET_ejection',
  'SOCKET_grip_R',
  'SOCKET_grip_L',
  'SOCKET_sight',
]) {
  assert.ok(named[name], name);
}
assert.equal(manifest.optic, 'ACOG 4x32 (TA31F / TA51)');
assert.equal(gltf.nodes.find((n) => n.name === 'receiver').extras.optic, manifest.optic);
assert.ok(
  named.SOCKET_sight.position.distanceTo(new THREE.Vector3(-0.149, 0.087, 0)) < 1e-6,
  'sight socket follows the reference-backed TA31F ocular axis'
);
assert.ok(
  named.SOCKET_muzzle.position.distanceTo(new THREE.Vector3(0.512, 0, 0)) < 1e-6,
  'muzzle FX socket clears the longer SRD762Ti endcap'
);
assert.ok(
  named.SOCKET_magazine.position.distanceTo(new THREE.Vector3(0.004, -0.042, 0)) < 1e-6,
  'magazine socket follows the corrected lower receiver seat'
);
const expected = ['Idle', 'Fire', 'Reload_Tactical', 'Reload_Empty', 'Inspect', 'Stock_Fold'];
assert.deepEqual(gltf.animations.map((a) => a.name).sort(), [...expected].sort());
const mixer = new THREE.AnimationMixer(root);
const clips = {};
for (const a of gltf.animations) {
  assert.equal(a.channels.length, 48, `${a.name}: helper and mechanical-bone TRS resets`);
  for (const name of [
    'MCX_RIG',
    'magazine',
    'magazine_spare',
    'bolt',
    'charging_handle',
    'trigger',
    'dust_cover',
    'stock_hinge',
    'spent_case',
    'bolt_release',
  ]) {
    assert.deepEqual(
      a.channels
        .filter((c) => gltf.nodes[c.target.node].name === name)
        .map((c) => c.target.path)
        .sort(),
      ['rotation', 'scale', 'translation'],
      `${name}: complete reset channels`
    );
  }
  const tracks = a.channels.map((c) => {
    const s = a.samplers[c.sampler];
    assert.ok(['LINEAR', 'STEP'].includes(s.interpolation));
    if (c.target.path === 'scale')
      assert.equal(s.interpolation, 'STEP', 'no visibility shrink/pop');
    const property = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[
      c.target.path
    ];
    const Track =
      property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(
      `${nodes[c.target.node].name}.${property}`,
      accessor(s.input),
      accessor(s.output),
      s.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear
    );
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
const {
  magazine: mag,
  magazine_spare: spare,
  spent_case: shell,
  bolt,
  charging_handle: handle,
} = named;
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} ≈ ${expected}`);
pose('Idle', 0);
// Probe actual exported support surfaces, not the authoring box dimensions.
// The foot extends past the shoe at X=-28 mm; Z=13 mm is outside the foot
// but inside the shoe. These rays independently measure both seating levels.
const receiverNode = gltf.nodes.find((n) => n.name === 'receiver_mesh');
const mountMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const mountSurfaces = gltf.meshes[receiverNode.mesh].primitives.map((p) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(accessor(p.attributes.POSITION), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(accessor(p.indices)), 1));
  const mesh = new THREE.Mesh(geometry, mountMaterial);
  mesh.matrixWorld.copy(named.receiver_mesh.matrixWorld);
  return mesh;
});
const mountRay = new THREE.Raycaster(
  new THREE.Vector3(-0.028, 0.0615, 0),
  new THREE.Vector3(0, -1, 0)
);
const footHit = mountRay
  .intersectObjects(mountSurfaces, false)
  .filter((hit) => hit.point.y > 0.05)
  .at(-1); // Lowest foot surface above the rifle rail.
assert.ok(footHit, 'exported optic foot present');
near(footHit.point.y, 0.06);
for (const x of [-0.12, -0.1, -0.08, -0.06, -0.04]) {
  mountRay.ray.origin.set(x, 0.064, 0.013);
  const shoeHit = mountRay.intersectObjects(mountSurfaces, false)[0];
  assert.ok(
    shoeHit && shoeHit.point.y >= footHit.point.y - 1e-6,
    `exported TA51 shoe reaches optic foot at X=${x}`
  );
}
// Between rail teeth, the downward ray exits the shoe at its lower face.
mountRay.ray.origin.set(-0.1, 0.05, 0.013);
const shoeBottomHit = mountRay.intersectObjects(mountSurfaces, false)[0];
mountRay.ray.origin.set(0.065, 0.055, 0); // An exposed forward rail tooth.
const railHit = mountRay.intersectObjects(mountSurfaces, false)[0];
assert.ok(
  shoeBottomHit && railHit && shoeBottomHit.point.y <= railHit.point.y + 1e-6,
  'exported TA51 shoe reaches the rifle rail'
);
for (const mesh of mountSurfaces) mesh.geometry.dispose();
mountMaterial.dispose();
// Verify the exported rear stock/hinge region, including cap and fasteners,
// rather than relying on authoring dimensions. Blender independently checks
// all stock components through the full stroke/fold, including midframes.
let hingeTop = -Infinity,
  chargeBottom = Infinity;
const vertex = new THREE.Vector3();
const inverseRig = named.MCX_RIG.matrixWorld.clone().invert();
for (const part of ['stock_hinge', 'charging_handle']) {
  for (const position of mechanicalVertices(part)) {
    vertex.copy(position).applyMatrix4(inverseRig);
    if (part === 'stock_hinge' && vertex.x > -0.204) hingeTop = Math.max(hingeTop, vertex.y);
    if (part === 'charging_handle') chargeBottom = Math.min(chargeBottom, vertex.y);
  }
}
assert.ok(
  named.stock_hinge.position.distanceTo(new THREE.Vector3(-0.183, 0.007, -0.016)) < 1e-6,
  'stock pivot unchanged'
);
assert.ok(Number.isFinite(hingeTop) && Number.isFinite(chargeBottom));
assert.ok(
  chargeBottom - hingeTop >= 0.0019,
  'exported hinge hardware must clear charging handle by at least 1.9 mm'
);
// This vertical separation also holds BETWEEN sampler keys: translations have
// constant Y, rotations only about Y, and scales are unit (glTF Y is vertical).
for (const animation of gltf.animations) {
  for (const channel of animation.channels) {
    const name = nodes[channel.target.node].name;
    if (name !== 'stock_hinge' && name !== 'charging_handle') continue;
    const values = accessor(animation.samplers[channel.sampler].output);
    const path = channel.target.path;
    const width = path === 'rotation' ? 4 : 3;
    for (let i = 0; i < values.length; i += width) {
      if (path === 'rotation')
        assert.ok(
          Math.abs(values[i]) < 1e-6 && Math.abs(values[i + 2]) < 1e-6,
          'no vertical hinge/handle rotation'
        );
      if (path === 'translation')
        assert.ok(
          Math.abs(values[i + 1] - named[name].position.y) < 1e-6,
          'no vertical hinge/handle travel'
        );
      if (path === 'scale')
        assert.ok(
          Math.abs(values[i + 1] - 1) < 1e-6,
          'unit vertical hinge/handle scale (float32 tolerance)'
        );
    }
  }
}
// Complete polymer exterior, not shell-only or accessory/cartridge bounds.
// This is our documented envelope convention, not an unpublished Magpul datum.
function magazineLength(meshName) {
  const node = gltf.nodes.find((n) => n.name === meshName);
  const inverseRig = named.MCX_RIG.matrixWorld.clone().invert();
  const vertex = new THREE.Vector3();
  const points = [];
  for (const p of gltf.meshes[node.mesh].primitives) {
    // Consolidated fine finish on magazines contains only brass/projectiles.
    if (gltf.materials[p.material].name === 'MCX | fine finishes') continue;
    const positions = accessor(p.attributes.POSITION);
    for (const index of accessor(p.indices)) {
      vertex
        .fromArray(positions, index * 3)
        .applyMatrix4(named[meshName].matrixWorld)
        .applyMatrix4(inverseRig);
      points.push([vertex.x, vertex.y]);
    }
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list) => {
    const hull = [];
    for (const p of list) {
      while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  const hull = [...half(points), ...half([...points].reverse())];
  let area = Infinity,
    length = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i],
      b = hull[(i + 1) % hull.length];
    const norm = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / norm,
      uy = (b[1] - a[1]) / norm;
    let loU = Infinity,
      hiU = -Infinity,
      loV = Infinity,
      hiV = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy,
        v = -p[0] * uy + p[1] * ux;
      loU = Math.min(loU, u);
      hiU = Math.max(hiU, u);
      loV = Math.min(loV, v);
      hiV = Math.max(hiV, v);
    }
    const w = hiU - loU,
      h = hiV - loV;
    if (w * h < area) {
      area = w * h;
      length = Math.max(w, h);
    }
  }
  return length;
}
assert.ok(
  Math.abs(magazineLength('magazine_mesh') - 0.1905) < 0.0001,
  'MAG800 full exported envelope, floorplate included'
);
// Check the actual exported blade silhouette, not just its name or rotation.
const bands = { head: [], belly: [], tip: [] };
for (const point of mechanicalVertices('trigger')) {
  // Shape bands follow the corrected assembly; pull direction/timing stay.
  if (point.y > -0.04) bands.head.push(point.x);
  if (point.y < -0.049 && point.y > -0.06) bands.belly.push(point.x);
  if (point.y < -0.066) bands.tip.push(point.x);
}
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
assert.ok(
  mean(bands.belly) < Math.min(mean(bands.head), mean(bands.tip)) - 0.004,
  'trigger concavity must open towards muzzle (+X)'
);
assert.equal(mag.scale.x, 1);
assert.equal(spare.scale.x, 0);
assert.equal(shell.scale.x, 0);
pose('Fire', 2 / 60);
assert.ok(named.trigger.quaternion.z < -0.08, 'trigger rotates rearwards (-Z in glTF)');
pose('Fire', 4 / 60);
near(shell.scale.x, 1);
assert.ok(shell.position.z > 0.03, 'eject from right side (+Z in glTF)');
assert.ok(bolt.position.x < -0.06, 'bolt reciprocates');
assert.ok(named.MCX_RIG.position.x < -0.008, 'weapon recoil');
pose('Fire', 0.35);
assert.ok(shell.position.z > 0.2 && shell.position.y > 0.05, 'casing arc');
pose('Fire', 0.8);
assert.equal(shell.scale.x, 0);
assert.ok(Math.abs(bolt.position.x) < 1e-6);
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  pose(name, 43 / 60);
  assert.ok(mag.position.y < -0.11, 'magazine clears well');
  pose(name, 70 / 60);
  near(mag.scale.x, 0);
  near(spare.scale.x, 1);
  assert.ok(spare.position.y < -0.19, 'fresh magazine approaches from below');
  pose(name, 117 / 60);
  assert.ok(spare.position.length() < 0.001, 'fresh magazine seats at original pivot');
  assert.ok(
    Math.abs(magazineLength('magazine_spare_mesh') - 0.1905) < 0.0001,
    'replacement retains full magazine envelope'
  );
  pose(name, manifest.clips[name].duration - 1 / 120);
  near(mag.scale.x, 0);
  near(spare.scale.x, 1);
  pose(name, manifest.clips[name].duration);
  near(mag.scale.x, 1);
  near(spare.scale.x, 0);
  assert.ok(mag.position.length() < 1e-6);
}
pose('Reload_Empty', 145 / 60);
assert.ok(handle.position.x < -0.07 && bolt.position.x < -0.07);
pose('Reload_Tactical', 145 / 60);
assert.ok(Math.abs(handle.position.x) < 1e-6, 'tactical reload does not rack');
pose('Stock_Fold', 60 / 60);
assert.ok(Math.abs(named.stock_hinge.quaternion.y) > 0.98);
pose('Inspect', 1);
assert.ok(Math.abs(named.MCX_RIG.quaternion.x) > 0.2);
pose('Idle', 0);
assert.equal(shell.scale.x, 0);
assert.ok(Math.abs(handle.position.x) < 1e-6);
assert.ok(named.stock_hinge.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
console.log(
  `MCX hinge: ${((chargeBottom - hingeTop) * 1000).toFixed(3)} mm exported vertical clearance; sampler invariance verified`
);
console.log(
  `MCX: ${triangles} triangles; 6 clips; PBR maps, sockets, ejection, reloads and resets verified (${fileURLToPath(dir)})`
);
