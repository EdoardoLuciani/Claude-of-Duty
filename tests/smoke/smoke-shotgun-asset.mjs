// Actual committed export/source contract; no shotgun adapter or game-state substitute.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import { createAuthoredActions, sampleAuthoredAction } from '../../src/weapons/authored-actions.ts';
import { discoverAuthoredHands, applyAuthoredHand } from '../../src/weapons/authored-hands.ts';
import { Arm } from '../../src/weapons/hands.ts';
import { parseGLB, inspectGLB } from '../../tools/lib/glb-fixture.mjs';
const dir = new URL('../../assets/weapons/m590/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const reference = JSON.parse(readFileSync(new URL('hand-reference.json', dir)));
const file = readFileSync(new URL('m590.glb', dir));
const { json: gltf, bin, accessor: floats, imagePNG } = inspectGLB(file);
assert.equal(
  createHash('sha256').update(bin).digest('hex'),
  'ce33d718719a08c06b83554eb3827917a2440eaa73aced6dc9c61e98a488657d',
  'reviewed optimized geometry, maps and sampled animation bytes'
);
assert.deepEqual(
  JSON.parse(gltf.scenes[0].extras.clips),
  manifest.clips,
  'native exported event metadata matches the generated manifest'
);
const expected = {
  Idle: [2, []],
  Pump: [
    0.45,
    [
      [0.32, 'pump'],
      [0.82, 'boltrelease'],
      [0.995, 'end'],
    ],
  ],
  Reload_Tactical: [
    0.55,
    [
      [0.02, 'start'],
      [0.82, 'shellin'],
      [0.995, 'end'],
    ],
  ],
  Reload_Empty: [
    0.95,
    [
      [0.02, 'start'],
      [0.22, 'pump'],
      [0.68, 'shellin'],
      [0.94, 'boltrelease'],
      [0.995, 'end'],
    ],
  ],
  Inspect: [3, [[0.995, 'end']]],
  Draw: [0.7, [[0.995, 'end']]],
  Holster: [0.45, [[0.995, 'end']]],
};
assert.deepEqual(Object.keys(manifest.clips).sort(), Object.keys(expected).sort());
assert.deepEqual(gltf.animations.map((a) => a.name).sort(), Object.keys(expected).sort());
assert.equal(manifest.units, 'metres');
assert.equal(manifest.blenderForward, '+Y');
assert.equal(manifest.blenderUp, '+Z');
assert.match(manifest.runtimeBasis, /no adapter basis transform/);
assert.deepEqual(manifest.shell, { caseLen: 0.07, rimR: 0.01105 });
assert.deepEqual(manifest.mechanism.stroke, [0, 0, 0.089]);
assert.equal(manifest.reference.sku, '50774');
assert.equal(manifest.dimensions.overallLength, 39.5 * 0.0254);
assert.equal(manifest.dimensions.barrelLength, 18.5 * 0.0254);
assert.equal(manifest.dimensions.lengthOfPull, 13.875 * 0.0254);
assert.deepEqual(manifest.contactWindows, reference.contactWindows);
assert.deepEqual(reference.contactWindows, {
  Pump: { forend: [0, 0.45] },
  Reload_Tactical: {
    shell: [0.34 * 0.55, 0.58 * 0.55],
    release: [0.58 * 0.55, 0.7 * 0.55],
    thumb: [0.7 * 0.55, 0.82 * 0.55],
    insertionClearance: [0.58 * 0.55, 0.55],
  },
  Reload_Empty: {
    shell: [0.44 * 0.95, 0.5 * 0.95],
    release: [0.5 * 0.95, 0.58 * 0.95],
    thumb: [0.58 * 0.95, 0.68 * 0.95],
    insertionClearance: [0.5 * 0.95, 0.95],
    forend: [
      [0, 0.22 * 0.95],
      [0.78 * 0.95, 0.95],
    ],
  },
});
assert.deepEqual(manifest.aliases, {
  pump: 'Pump',
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
  draw: 'Draw',
  holster: 'Holster',
});
assert.equal(manifest.fxClass, 'shotgun');
assert.equal(manifest.opticGlass, null);
assert.ok(
  !gltf.nodes.some((n) => /arm_|spent_case|camera|light/i.test(n.name)),
  'no duplicate arms/cases/studio'
);
assert.ok(!gltf.cameras && gltf.skins.length === 1);
assert.ok(!gltf.extensionsUsed?.includes('KHR_lights_punctual'));
assert.equal(gltf.buffers.length, 1);
assert.equal(gltf.buffers[0].uri, undefined);
const blend = readFileSync(new URL('m590.blend', dir));
assert.ok(
  blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528
);
assert.equal(gltf.images.length, 3);
for (const image of gltf.images) {
  assert.equal(image.uri, undefined);
  const png = imagePNG(image);
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
}
for (const m of gltf.materials) {
  const pbr = m.pbrMetallicRoughness;
  assert.ok(pbr.baseColorTexture && pbr.metallicRoughnessTexture && m.normalTexture, m.name);
  assert.ok([0, 1].includes(pbr.metallicFactor ?? 1), 'binary metalness');
}
const primitives = gltf.meshes.reduce((n, m) => n + m.primitives.length, 0);
const triangles = gltf.nodes.reduce(
  (n, node) =>
    n +
    (node.mesh === undefined
      ? 0
      : gltf.meshes[node.mesh].primitives.reduce(
          (n, p) => n + gltf.accessors[p.indices].count / 3,
          0
        )),
  0
);
assert.deepEqual(manifest.stats, {
  triangleInstances: triangles,
  primitives,
  materials: gltf.materials.length,
  images: 3,
  bytes: file.length,
});
assert.ok(triangles < 110000 && triangles > 10000 && primitives <= 40);
assert.ok(
  gltf.materials.length +
    Number(gltf.meshes.some((m) => m.primitives.some((p) => p.material === undefined))) <=
    16
);
assert.ok(file.length <= 12 * 1024 * 1024);
for (const animation of gltf.animations) {
  const [d, events] = expected[animation.name];
  assert.equal(manifest.clips[animation.name].duration, d);
  assert.deepEqual(
    manifest.clips[animation.name].events,
    events.map(([fraction, event]) => ({ time: fraction * d, event }))
  );
  for (const s of animation.samplers) {
    const times = floats(s.input);
    floats(s.output);
    assert.equal(times[0], 0);
    assert.ok(Math.abs(times.at(-1) - d) < 1e-7, `${animation.name}: exact endpoint`);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1]);
  }
  for (const c of animation.channels)
    if (c.target.path === 'scale')
      assert.equal(animation.samplers[c.sampler].interpolation, 'STEP');
  for (const name of [
    'M590_RIG',
    'receiver',
    'forend',
    'bolt',
    'trigger',
    'shell_insert',
    'hand_L',
    'hand_R',
    ...['L', 'R'].flatMap((p) => [
      ...Array.from({ length: 4 }, (_, i) => [
        `${p}_finger_${i}_root`,
        ...Array.from({ length: 3 }, (_, j) => `${p}_finger_${i}_${j}`),
      ]).flat(),
      `${p}_thumb_base`,
      `${p}_thumb_0`,
      `${p}_thumb_1`,
    ]),
  ])
    assert.ok(
      animation.channels.some((c) => gltf.nodes[c.target.node].name === name),
      `${animation.name}/${name}: native channel`
    );
}
const model = await parseGLB(file);
const node = (name) => {
  const o = model.scene.getObjectByName(name);
  assert.ok(o, name);
  return o;
};
const rig = node('M590_RIG'),
  hands = discoverAuthoredHands(node);
assert.ok(
  rig.position.length() < 1e-8 &&
    rig.quaternion.angleTo(new THREE.Quaternion()) < 1e-8 &&
    rig.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-8
);
const buttZ = -0.006 + Math.sqrt((13.875 * 0.0254) ** 2 - (-0.0456 - 0.01) ** 2),
  muzzleZ = buttZ + 0.006 - 39.5 * 0.0254;
const sockets = {
  muzzle: [0, 0.068, muzzleZ],
  ejection: [0.0205, 0.063, -0.132],
  sight: [0, 0.096, -0.058],
  loading: [0, 0.024, -0.068],
  chamber: [0, 0.068, muzzleZ + 18.5 * 0.0254],
};
for (const [name, pos] of Object.entries(sockets)) {
  assert.equal(node(`SOCKET_${name}`).parent, rig);
  assert.ok(
    new THREE.Vector3(...manifest.sockets[name]).distanceTo(new THREE.Vector3(...pos)) < 1e-9,
    'independent analytic socket datum'
  );
  assert.ok(node(`SOCKET_${name}`).position.distanceTo(new THREE.Vector3(...pos)) < 1e-7);
}
for (const name of ['receiver', 'forend', 'bolt', 'trigger', 'shell_insert', 'hand_L', 'hand_R'])
  assert.equal(node(name).parent, rig);
const state = { mixer: new THREE.AnimationMixer(model.scene), name: null };
state.actions = createAuthoredActions(state.mixer, model.animations);
const arms = { left: new Arm(-1, { scale: 0.97 }), right: new Arm(1) };
const sample = (name, t) => {
  sampleAuthoredAction(state, name, t);
  model.scene.updateMatrixWorld(true);
};
function pads(side) {
  const arm = arms[side],
    hand = hands[side];
  arm.hand.position.copy(hand.wrist.position);
  arm.hand.quaternion.copy(hand.wrist.quaternion);
  applyAuthoredHand(arm, hand);
  arm.root.updateMatrixWorld(true);
  return arm.fingers.map((f, i) =>
    new THREE.Vector3(0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * 0.5).applyMatrix4(
      f.joints[2].matrixWorld
    )
  );
}
sample('Idle', 0);
// Expose the existing part/material probes to the same triangles after rigid batching.
model.scene.traverse((mesh) => {
  if (!mesh.isSkinnedMesh) return;
  mesh.skeleton.update();
  const { skinIndex, uv1 } = mesh.geometry.attributes;
  const index = mesh.geometry.index,
    point = new THREE.Vector3();
  for (const [joint, bone] of mesh.skeleton.bones.entries()) {
    const part = node(bone.name.replace('MECH_', ''));
    const local = part.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    const geometry = new THREE.BufferGeometry(),
      positions = [];
    const materials = Array.from({ length: 7 }, (_, finish) => {
      const material = mesh.material.clone();
      material.name = String(finish + 1).padStart(2, '0') + ' | encoded finish';
      material.side = THREE.DoubleSide;
      const start = positions.length / 3;
      for (let i = 0; i < index.count; i += 3) {
        const first = index.getX(i);
        const tile = Math.floor(uv1.getX(first) * 4) + 4 * Math.floor((1 - uv1.getY(first)) * 2);
        if (skinIndex.getX(first) !== joint || tile !== finish) continue;
        for (let k = 0; k < 3; k++) {
          mesh.getVertexPosition(index.getX(i + k), point).applyMatrix4(local);
          positions.push(point.x, point.y, point.z);
        }
      }
      geometry.addGroup(start, positions.length / 3 - start, finish);
      return material;
    });
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
    part.add(new THREE.Mesh(geometry, materials));
  }
});
model.scene.updateMatrixWorld(true);
const exteriorBounds = new THREE.Box3();
node('receiver').traverse((o) => {
  if (o.isMesh) exteriorBounds.expandByObject(o);
});
exteriorBounds.expandByObject(node('forend'));
assert.ok(
  Math.abs(exteriorBounds.getSize(new THREE.Vector3()).z - 39.5 * 0.0254) < 0.0002,
  'actual exported manufacturer nominal OAL'
);
assert.ok(
  Math.abs(
    node('DATUM_closed_breech').position.distanceTo(node('SOCKET_muzzle').position) - 18.5 * 0.0254
  ) < 1e-6,
  'actual native closed-breech barrel'
);
assert.ok(
  Math.abs(
    node('DATUM_trigger_face').position.distanceTo(node('DATUM_butt_center').position) -
      13.875 * 0.0254
  ) < 1e-6,
  'physical trigger/butt LOP datums'
);
// The frozen firing calibration must reach the runtime controls too: testing
// reference points alone would still pass if export lost the finger channels.
const rightPads = pads('right');
for (const [i, pad] of rightPads.entries()) {
  // pads() uses the ordinary distal patch; the index owns a trigger patch.
  if (i === 0) pad.set(0, -0.006, -0.013).applyMatrix4(arms.right.fingers[0].joints[2].matrixWorld);
  assert.ok(pad.distanceTo(new THREE.Vector3(...reference.sides.right.pads[i])) < 1e-7);
}
assert.ok(
  new THREE.Vector3(0, -0.0078, -0.026)
    .applyMatrix4(arms.right.thumb.joints[1].matrixWorld)
    .distanceTo(new THREE.Vector3(...reference.sides.right.thumbPad)) < 1e-7,
  'native thumb calibration, not just a reference-only contact claim'
);
const restPads = pads('left'),
  shell = node('shell_insert'),
  forend = node('forend');
for (const side of ['left', 'right']) {
  assert.ok(
    hands[side].wrist.position.distanceTo(new THREE.Vector3(...reference.grips[side].pos)) < 1e-7
  );
  assert.ok(
    hands[side].wrist.quaternion
      .clone()
      .normalize()
      .angleTo(new THREE.Quaternion(...reference.sides[side].quaternion)) < 1e-6
  );
}
shell.scale.setScalar(1);
model.scene.updateMatrixWorld(true);
assert.ok(
  new THREE.Box3().setFromObject(shell).getSize(new THREE.Vector3()).z > 0.069,
  'hidden parent must not collapse exported hull descendants'
);
// Surface contacts and openings on the exported triangles, independent of source claims.
function surface(part) {
  part.updateWorldMatrix(true, true);
  const inverse = part.matrixWorld.clone().invert(),
    triangles = [];
  part.traverse((o) => {
    if (!o.isMesh) return;
    const matrix = inverse.clone().multiply(o.matrixWorld),
      p = o.geometry.attributes.position,
      ix = o.geometry.index;
    for (let i = 0; i < ix.count; i += 3)
      triangles.push(
        new THREE.Triangle(
          ...[0, 1, 2].map((k) =>
            new THREE.Vector3().fromBufferAttribute(p, ix.getX(i + k)).applyMatrix4(matrix)
          )
        )
      );
  });
  return (point) => {
    const closest = new THREE.Vector3();
    let best = Infinity;
    for (const t of triangles)
      best = Math.min(best, t.closestPointToPoint(point, closest).distanceTo(point));
    return best;
  };
}
const supportSurface = surface(forend),
  hullSurface = surface(shell),
  gripSurface = surface(node('receiver')),
  triggerSurface = surface(node('trigger'));
assert.ok(gripSurface(node('DATUM_butt_center').position) < 0.001, 'LOP datum on actual butt face');
assert.ok(
  triggerSurface(node('DATUM_trigger_face').position.clone().sub(node('trigger').position)) < 0.001,
  'LOP datum on actual trigger face'
);
assert.ok(
  surface(node('bolt'))(node('DATUM_closed_breech').position.clone().sub(node('bolt').position)) <
    1e-6,
  'barrel datum on actual closed bolt face'
);
for (const p of [...reference.sides.left.pads, reference.sides.left.thumbPad])
  assert.ok(supportSurface(new THREE.Vector3(...p)) < 0.002, 'actual forend mesh contact');
for (const p of [...reference.shell.pads, reference.shell.thumbPad])
  assert.ok(
    hullSurface(new THREE.Vector3(...p).sub(new THREE.Vector3(...reference.shell.hullPosition))) <
      0.002,
    'actual shell mesh contact'
  );
assert.ok(
  hullSurface(
    new THREE.Vector3(...reference.insertion.thumbPad).sub(
      new THREE.Vector3(...reference.shell.hullPosition)
    )
  ) < 0.002,
  'insertion thumb reaches actual rim, not a floating helper'
);
for (const [i, p] of reference.sides.right.pads.entries()) {
  const target = new THREE.Vector3(...p);
  if (i === 0) target.sub(node('trigger').position);
  assert.ok(
    (i === 0 ? triggerSurface : gripSurface)(target) < 0.003,
    'actual firing grip/trigger contact'
  );
}
assert.ok(
  gripSurface(new THREE.Vector3(...reference.sides.right.thumbPad)) < 0.003,
  'actual thumb/beavertail contact'
);
const receiverMeshes = [];
node('receiver').traverse((o) => {
  if (o.isMesh) {
    receiverMeshes.push(o);
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      m.side = THREE.DoubleSide;
  }
});
function clearRay(origin, direction, length) {
  return (
    new THREE.Raycaster(
      new THREE.Vector3(...origin),
      new THREE.Vector3(...direction),
      0,
      length
    ).intersectObjects(receiverMeshes, false).length === 0
  );
}
// Paired material-specific exported surfaces: a steel filler cannot mask a stock gap.
const junctionRay = new THREE.Raycaster();
function junctionHit(materialPrefix, origin, direction, length) {
  junctionRay.set(
    new THREE.Vector3(...origin).applyMatrix4(rig.matrixWorld),
    new THREE.Vector3(...direction).transformDirection(rig.matrixWorld)
  );
  junctionRay.far = length;
  const hit = junctionRay.intersectObjects(receiverMeshes, false).find((hit) => {
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face.materialIndex]
      : hit.object.material;
    return material.name.startsWith(materialPrefix);
  });
  assert.ok(hit, `actual exported junction surface ${materialPrefix}/${origin}`);
  return hit.point.clone().applyMatrix4(rig.matrixWorld.clone().invert());
}
// Bilateral shoulder roofs must be the first actual aluminium surface, not
// the chamber floor reached through the old triangular breaches.
for (const x of [-0.014, 0.014])
  for (const z of [0, 0.005, 0.01, 0.012]) {
    const roof = junctionHit('07', [x, 0.1, z], [0, -1, 0], 0.1);
    assert.ok(
      roof.y > 0.074 && roof.y < 0.082,
      `exported receiver shoulder roof breach ${x}/${z}: ${roof.y}`
    );
  }
for (const side of [-1, 1])
  for (const z of [-0.024, -0.016, -0.008, 0, 0.008]) {
    const clearance = junctionHit('07', [0, 0.068, z], [side, 0, 0], 0.03);
    assert.ok(
      Math.abs(Math.abs(clearance.x) - 0.015) < 0.0001,
      `exported rear bolt chamber clearance ${side}/${z}`
    );
  }
for (const side of [-1, 1]) {
  const skirt = junctionHit('01', [side * 0.05, 0.0845, muzzleZ + 0.019], [-side, 0, 0], 0.05);
  assert.ok(Math.abs(skirt.x) > 0.0075, `exported front cheek/base slit ${side}`);
}
const rearBed = junctionHit('01', [0, 0.12, -0.095], [0, -1, 0], 0.05);
const rearBedEdge = junctionHit('01', [0.007, 0.12, -0.095], [0, -1, 0], 0.05);
assert.ok(
  rearBedEdge.y - rearBed.y > 0.0005 && rearBedEdge.y - rearBed.y < 0.0015,
  'exported shallow rear sight bed'
);
const toeHead = junctionHit('01', [0, 0.12, -0.115], [0, -1, 0], 0.05);
const toeRecess = junctionHit('01', [0.003, 0.12, -0.115], [0, -1, 0], 0.05);
assert.ok(
  toeHead.y - toeRecess.y > 0.0003 && toeHead.y - toeRecess.y < 0.001,
  'exported rear toe head/recess'
);
const railMeshes = [];
forend.traverse((o) => {
  if (o.isMesh) {
    railMeshes.push(o);
    o.material.side = THREE.DoubleSide;
  }
});
function railHit(origin, direction) {
  const hits = new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction),
    0,
    0.04
  ).intersectObjects(railMeshes, false);
  assert.ok(hits.length, `actual exported rail surface ${origin}`);
  return hits[0].point;
}
for (const side of [-1, 1])
  for (let i = 0; i < 7; i++) {
    const z = -0.428 - i * 0.0107;
    const neck = railHit([side * 0.014, 0.0355, z], [side, 0, 0]);
    // Start beyond the sleeve/transition; otherwise their inner surfaces can
    // mask the inward relief on the merged exported forend primitive.
    const head = railHit([side * 0.0255, 0.027, z], [-side, 0, 0]);
    const outer = railHit([side * 0.05, 0.0355, z], [-side, 0, 0]);
    assert.ok(
      Math.abs(neck.x) < 0.019 &&
        Math.abs(head.x) > 0.024 &&
        Math.abs(outer.x - side * 0.028) < 0.0001,
      `exported inward side-lug neck ${side}/${i}: ${neck.x}/${head.x}/${outer.x}`
    );
  }
for (const [x, y] of [
  [0, 0.03],
  [0, 0.045],
  [0.012, 0.045],
  [-0.012, 0.045],
  [0, 0.06],
]) {
  const metal = junctionHit('07', [x, y, 0.04], [0, 0, -1], 0.04);
  const stock = junctionHit('02', [x, y, 0], [0, 0, 1], 0.06);
  assert.ok(
    Math.abs(stock.z - metal.z) < 0.0002,
    `exported receiver/stock seam gap ${x}/${y}: ${stock.z - metal.z}`
  );
}
for (const x of [-0.006, 0, 0.006])
  for (const z of [0.036, 0.038, 0.039, 0.041]) {
    const metal = junctionHit('01', [x, 0.1, z], [0, -1, 0], 0.1);
    const stock = junctionHit('02', [x, 0.1, z], [0, -1, 0], 0.1);
    assert.ok(
      Math.abs(metal.y - stock.y) < 0.0005,
      `exported rear tang/crown step ${x}/${z}: ${metal.y - stock.y}`
    );
  }
for (const z of [0.073, 0.081, 0.094, 0.101]) {
  const stock = junctionHit('02', [0, -0.1, z], [0, 1, 0], 0.2);
  assert.ok(
    Math.abs(stock.y - (-0.04 + 0.3 * (z - 0.068))) < 0.00015,
    `exported lower wrist flat/slanted run ${z}`
  );
}
const wristLow = junctionHit('02', [0, -0.1, 0.068], [0, 1, 0], 0.2).y;
assert.ok(Math.abs(wristLow + 0.04) < 0.0006, 'exported wrist neck-low corner');
assert.ok(
  (wristLow - junctionHit('02', [0, -0.1, 0.062], [0, 1, 0], 0.2).y) / 0.006 < -1.4 &&
    (junctionHit('02', [0, -0.1, 0.073], [0, 1, 0], 0.2).y - wristLow) / 0.005 > 0.15,
  'exported deliberate wrist corner'
);
for (const [z, y] of [
  [-0.022, -0.015],
  [-0.005, -0.016],
  [0.014, -0.012],
  [0.022, -0.005],
]) {
  assert.ok(
    Math.abs(junctionHit('01', [0, -0.04, z], [0, 1, 0], 0.08).y - y) < 0.0003,
    `exported lower/rear guard curvature ${z}`
  );
}
assert.ok(clearRay([0.05, 0.063, -0.132], [-1, 0, 0], 0.05), 'real exported ejection opening');
const boltMeshes = [];
node('bolt').traverse((o) => {
  if (o.isMesh) {
    boltMeshes.push(o);
    o.material.side = THREE.DoubleSide;
  }
});
const boltRay = new THREE.Raycaster();
boltRay.far = 0.05;
for (const [name, time, closed] of [
  ['Idle', 0, true],
  ['Pump', 0.144, false],
]) {
  sample(name, time);
  for (const z of [-0.16, -0.132, -0.104]) {
    // Root-local rays remove the authored handling tilt from the mechanical check.
    boltRay.set(
      new THREE.Vector3(0.05, 0.063, z).applyMatrix4(rig.matrixWorld),
      new THREE.Vector3(-1, 0, 0).transformDirection(rig.matrixWorld)
    );
    assert.equal(
      boltRay.intersectObjects(boltMeshes, false).length > 0,
      closed,
      `${name}: broad moving bolt/window presentation at ${z}`
    );
  }
}
sample('Idle', 0);
boltRay.set(new THREE.Vector3(0.05, 0.073, -0.132), new THREE.Vector3(-1, 0, 0));
assert.equal(
  boltRay.intersectObjects(boltMeshes, false).length,
  0,
  'closed bolt retains upper port recess'
);
assert.ok(clearRay([0, -0.03, -0.068], [0, 1, 0], 0.075), 'real exported loading opening');
assert.ok(clearRay([0, 0.096, 0], [0, 0, -1], 0.13), 'real ghost-ring aperture');
assert.ok(!clearRay([0.0055, 0.096, 0], [0, 0, -1], 0.13), 'ghost-ring rim remains real geometry');
assert.ok(
  !clearRay([0, 0.0959, muzzleZ + 0.05], [0, 0, -1], 0.05),
  'front blade tip is aligned with ghost ring'
);
shell.scale.setScalar(0);
let maxError = 0,
  maxThumbError = 0,
  maxWristStep = 0,
  maxFingerStep = 0,
  poses = 0;
for (const [name, [d]] of Object.entries(expected)) {
  let previous = null;
  for (let f = 0; f <= Math.ceil(d * 240); f++) {
    const t = Math.min(f / 240, d);
    sample(name, t);
    poses++;
    const ps = pads('left');
    const current = {
      pos: hands.left.wrist.position.clone(),
      q: [
        hands.left.wrist,
        ...hands.left.fingers.flatMap((f) => [f.root, ...f.joints]),
        ...hands.left.thumb,
      ].map((j) => j.quaternion.clone().normalize()),
    };
    if (previous) {
      const distance = current.pos.distanceTo(previous.pos),
        angle = Math.max(...current.q.map((q, i) => q.angleTo(previous.q[i])));
      maxWristStep = Math.max(maxWristStep, distance);
      maxFingerStep = Math.max(maxFingerStep, angle);
      assert.ok(distance < 0.02, `${name}/${t}: discontinuous wrist jump ${distance}`);
      assert.ok(angle < 0.4, `${name}/${t}: discontinuous wrist/finger/thumb rotation ${angle}`);
    }
    previous = current;
    for (const side of ['left', 'right']) {
      const wrist = hands[side].wrist;
      assert.ok(wrist.position.toArray().every(Number.isFinite));
    }
    if (name === 'Pump' || (name === 'Reload_Empty' && (t <= 0.22 * d || t >= 0.78 * d))) {
      for (let i = 0; i < 4; i++) {
        const error = ps[i].distanceTo(restPads[i].clone().add(forend.position));
        maxError = Math.max(maxError, error);
        assert.ok(error < 0.002, `${name}/${t}: planted pump pad ${error}`);
      }
      assert.ok(forend.position.z >= -1e-7 && forend.position.z <= 0.0890001);
      assert.ok(
        Math.abs(node('bolt').position.z - manifest.mechanism.boltRest[2] - forend.position.z) <
          1e-7
      );
    }
    const window = reference.contactWindows[name]?.shell;
    if (window && t >= window[0] && t <= window[1]) {
      assert.equal(shell.scale.x, 1, 'contact window hull is visible');
      for (let i = 0; i < 4; i++) {
        const target = new THREE.Vector3(...reference.shell.pads[i])
          .sub(new THREE.Vector3(...reference.shell.hullPosition))
          .applyQuaternion(shell.quaternion)
          .add(shell.position);
        const error = ps[i].distanceTo(target);
        maxError = Math.max(maxError, error);
        assert.ok(error < 0.002, `${name}/${t}: shell contact pad ${i}: ${error}`);
      }
      const arm = arms.left;
      const thumbPad = new THREE.Vector3(0, -0.0078 * arm.scale, -0.026 * arm.scale).applyMatrix4(
        arm.thumb.joints[1].matrixWorld
      );
      const target = new THREE.Vector3(...reference.shell.thumbPad)
        .sub(new THREE.Vector3(...reference.shell.hullPosition))
        .applyQuaternion(shell.quaternion)
        .add(shell.position);
      assert.ok(thumbPad.distanceTo(target) < 0.002, 'shell thumb remains planted');
    }
    const thumbWindow = reference.contactWindows[name]?.thumb;
    if (thumbWindow && t >= thumbWindow[0] && t <= thumbWindow[1]) {
      const arm = arms.left;
      const pad = new THREE.Vector3(0, -0.0078 * arm.scale, -0.026 * arm.scale).applyMatrix4(
        arm.thumb.joints[1].matrixWorld
      );
      const target = new THREE.Vector3(...reference.insertion.thumbPad)
        .sub(new THREE.Vector3(...reference.shell.hullPosition))
        .applyQuaternion(shell.quaternion)
        .add(shell.position);
      const error = pad.distanceTo(target);
      maxThumbError = Math.max(maxThumbError, error);
      assert.ok(error < 0.002, `${name}/${t}: rim push thumb drift ${error}`);
      // Withdrawn distal fingers must remain below the receiver's belly. The
      // saved-source BVH additionally sweeps the entire real deformed glove.
      assert.ok(
        ps.every((p) => p.y < 0.033),
        `${name}/${t}: fingers did not release outside the receiver`
      );
    }
    if (!name.startsWith('Reload')) assert.ok(shell.scale.x < 0.001, `${name}: stray insert shell`);
  }
}
sample('Pump', 0.144);
assert.ok(Math.abs(forend.position.z - 0.089) < 0.0001);
sample('Pump', 0.369);
assert.ok(Math.abs(forend.position.z) < 0.0001);
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  const info = manifest.clips[name],
    beat = info.events.find((e) => e.event === 'shellin').time;
  const [appear] = reference.contactWindows[name].shell,
    hide = (name === 'Reload_Empty' ? 0.7 : 0.84) * info.duration;
  sample(name, appear - 0.00001);
  assert.equal(shell.scale.x, 0);
  sample(name, appear + 0.00001);
  assert.equal(shell.scale.x, 1);
  sample(name, hide - 0.00001);
  assert.equal(shell.scale.x, 1);
  sample(name, hide + 0.00001);
  assert.equal(shell.scale.x, 0);
  sample(name, beat);
  assert.ok(
    shell.position.distanceTo(new THREE.Vector3(0, 0.0348, -0.068)) < 0.002,
    'accepted hull is inside real loading mouth'
  );
  assert.ok(
    shell.quaternion.angleTo(new THREE.Quaternion()) < 0.04,
    'hull aligned with tube at acceptance'
  );
  sample(name, info.duration);
  assert.ok(shell.scale.x < 0.001);
}
sample('Idle', 0);
assert.ok(rig.position.length() < 1e-8);
assert.ok(forend.position.length() < 1e-8);
console.log(
  `M590 actual GLB: ${triangles} triangles / ${primitives} primitives / ${gltf.materials.length} materials / ${file.length} bytes; seven clips, ${poses} 240Hz poses, wrap/pump drift ${(maxError * 1000).toFixed(3)}mm, rim-thumb drift ${(maxThumbError * 1000).toFixed(3)}mm, max wrist step ${(maxWristStep * 1000).toFixed(2)}mm / hand rotation step ${maxFingerStep.toFixed(3)}rad; asset-only contract gate (runtime acceptance separate)`
);
