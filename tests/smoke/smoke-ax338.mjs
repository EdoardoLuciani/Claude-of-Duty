// Committed native asset: budgets, dimensions, event parity and hand tracks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import manifest from '../../assets/weapons/ax338/manifest.json' with { type: 'json' };
import { makeAX338Model, AX338Animation } from '../../src/weapons/ax338.ts';
import { WEAPON_DEFS } from '../../src/weapons/defs.ts';
import { Arm } from '../../src/weapons/hands.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';
import { ax338PartTriangles, ax338GeometryControl } from './ax338-geometry.mjs';
const bytes = readFileSync(new URL('../../assets/weapons/ax338/ax338.glb', import.meta.url));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const primitives = json.nodes
  .filter((n) => n.mesh !== undefined)
  .flatMap((n) => json.meshes[n.mesh].primitives);
const triangles = primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, manifest.stats.triangles);
assert.equal(primitives.length, manifest.stats.primitives);
assert.equal(bytes.length, manifest.stats.bytes);
assert(
  triangles < 150000 &&
    primitives.length === 11 &&
    json.materials.length === 2 &&
    bytes.length <= 15 * 1024 * 1024
);
assert.equal(json.images.length, 3);
assert(
  json.buffers.every((b) => !b.uri) && json.images.every((i) => i.bufferView !== undefined),
  'self-contained runtime asset'
);
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView];
  const offset = 20 + bytes.readUInt32LE(12) + 8 + view.byteOffset;
  assert.equal(bytes.readUInt32BE(offset + 16), 1024);
  assert.equal(bytes.readUInt32BE(offset + 20), 1024);
}
for (const mat of json.materials) {
  const p = mat.pbrMetallicRoughness;
  assert(
    p.baseColorTexture && p.metallicRoughnessTexture && mat.normalTexture,
    `${mat.name}: PBR detail`
  );
  assert([0, 1].includes(p.metallicFactor ?? 1), `${mat.name}: dielectric/metal separation`);
}
assert(
  !json.nodes.some((n) => /bipod|spent_case|AX338_arm/.test(n.name)),
  'no duplicate arms/cases or omitted accessories'
);
const gltf = await parseGLB(bytes);
// Freeze the approved rifle and hand channels. Only the three holding fingers
// and an empty-reload wrist hold (preventing early drift) may change.
gltf.scene.updateMatrixWorld(true);
// Hash actual ordinary triangles on the unchanged 10-micrometre lattice.
// Removing the bind rebase reverses its tiny rounding/guard retessellation;
// frozen-baseline comparison and approved hash changes are recorded in README.
// Canonicalize only cyclic index ordering; select optic by actual ownership.
function surfaceHash(root, normals = false, part = null) {
  root.updateMatrixWorld(true);
  const triangles = [],
    point = new THREE.Vector3(),
    normal = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const attributes = o.geometry.attributes,
      index = o.geometry.index;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < index.count; i += 3) {
      if (part && ax338GeometryControl(o)?.name !== part) continue;
      const vertices = [];
      for (let j = 0; j < 3; j++) {
        const id = index.getX(i + j);
        o.getVertexPosition(id, point).applyMatrix4(o.matrixWorld);
        normal.fromBufferAttribute(attributes.normal, id).applyMatrix3(normalMatrix);
        const values = [
          ...point.toArray(),
          ...(normals ? normal.toArray() : []),
          attributes.uv.getX(id),
          attributes.uv.getY(id),
        ];
        // Offset avoids decimal half-grid ties in authored metre coordinates.
        vertices.push(values.map((v) => Math.round(v * 1e5 + 0.12345)).join(','));
      }
      triangles.push(
        [0, 1, 2].map((j) => [...vertices.slice(j), ...vertices.slice(0, j)].join(';')).sort()[0]
      );
    }
  });
  return createHash('sha256').update(triangles.sort().join('\n')).digest('hex');
}
assert.equal(
  surfaceHash(gltf.scene),
  '78675d7fe241add878c0cfb08d14ad3225183895f5b4c5d35f284f4bdd65dd69',
  'locked rifle triangle positions, winding, UV0 and transforms on the unchanged 10 micrometre lattice'
);
const protectedTracks = createHash('sha256');
for (const clip of gltf.animations) {
  protectedTracks.update(clip.name);
  protectedTracks.update(String(clip.duration));
  for (const track of clip.tracks) {
    if (
      /^R_finger_[123]_(root|[012])\./.test(track.name) ||
      (clip.name === 'Reload_Empty' && /^hand_R\.(position|quaternion)$/.test(track.name))
    )
      continue;
    protectedTracks.update(track.name);
    protectedTracks.update(String(track.getInterpolation()));
    protectedTracks.update(Buffer.from(track.times.buffer));
    protectedTracks.update(Buffer.from(track.values.buffer));
  }
}
assert.equal(
  protectedTracks.digest('hex'),
  '0e3a1287a648d96e6727a497ce8017ac901ef0855fe47e0d2a4ed9287e09c92b',
  'approved index/thumb, left hand and weapon clips unchanged'
);
// User-approved optic must not be incidentally rebuilt by furniture fixes.
assert.equal(
  surfaceHash(gltf.scene, true, 'optic'),
  '2f0154718dcc1f99d5cd49f4825002356d593bf9de655fc32c95da130ff0fe61',
  'locked actual PM II geometry, winding, normals and UV0 in ordinary meshes'
);
const model = makeAX338Model(
    process.env.AX338_RUNTIME
      ? await parseGLB(
          readFileSync(new URL('../../assets/weapons/ax338/ax338.runtime.glb', import.meta.url))
        )
      : gltf
  ),
  anim = new AX338Animation(model),
  def = WEAPON_DEFS.sniper;
assert(
  [...model.materials].every((m) => m.isMeshPhysicalNodeMaterial),
  'authored weapons must use native PBR node materials'
);
assert.equal(model.nodes.opticGlass.kind, 'scope');
assert.equal(model.reactiveFire, true);
assert.equal(Object.keys(anim.actions).length, 9);
// Independent gameplay contract; do not retain a retired renderer as the oracle.
const expectedClips = {
  reloadTac: [
    2.8,
    [
      [0.02, 'start'],
      [0.2, 'magout'],
      [0.34, 'magdrop'],
      [0.81, 'magin'],
      [0.88, 'slap'],
      [0.995, 'end'],
    ],
  ],
  reloadEmpty: [
    3.6,
    [
      [0.02, 'start'],
      [0.16, 'magout'],
      [0.3, 'magdrop'],
      [0.71, 'magin'],
      [0.9, 'charge'],
      [0.917, 'boltrelease'],
      [0.995, 'end'],
    ],
  ],
  inspect: [3.6, [[0.995, 'end']]],
  draw: [0.88, [[0.995, 'end']]],
  holster: [0.56, [[0.995, 'end']]],
  cycle: [
    1.1,
    [
      [0.22, 'bolt:open'],
      [0.52, 'chamber'],
      [0.74, 'bolt:close'],
      [0.995, 'end'],
    ],
  ],
};
assert.deepEqual(Object.keys(anim.clips()).sort(), Object.keys(expectedClips).sort());
for (const [name, clip] of Object.entries(anim.clips())) {
  const [duration, events] = expectedClips[name];
  assert.equal(clip.duration, duration, name);
  assert.deepEqual(
    clip.events,
    events.map(([fraction, name]) => ({ t: fraction * duration, name })),
    name
  );
}
for (const action of Object.values(anim.actions)) {
  const clip = action.getClip();
  for (const track of clip.tracks) {
    assert(track.values.every(Number.isFinite));
    if (!process.env.AX338_RUNTIME)
      assert(
        Math.abs(track.times.at(-1) - clip.duration) < 1e-6,
        `${clip.name}: complete native channel`
      );
    else
      assert(
        track.times[0] === 0 && track.times.at(-1) <= clip.duration + 1e-6,
        `${clip.name}: bounded cooked channel`
      );
    for (let i = 1; i < track.times.length; i++) assert(track.times[i] >= track.times[i - 1]);
  }
}
const rest = anim.bolt.position.clone(),
  restQ = anim.bolt.quaternion.clone();
anim.fire();
anim.update(0.04, null, 0, false);
assert(
  anim.bolt.position.distanceTo(rest) < 1e-6 && anim.bolt.quaternion.angleTo(restQ) < 1e-6,
  'manual bolt stays locked on discharge'
);
anim.update(0, 'cycle', 0.032, false);
assert(
  model.root.getObjectByName('trigger').quaternion.angleTo(new THREE.Quaternion()) > 0.1,
  'cycle includes the discharge trigger beat, not just bolt motion'
);
anim.update(0, 'cycle', 0.22 * def.boltTime, false);
assert(Math.abs(anim.bolt.position.z - rest.z - 0.1) < 0.00001, '100 mm authored rear stroke');
assert(
  Math.abs(anim.bolt.quaternion.angleTo(restQ) - Math.PI / 3) <
    (process.env.AX338_RUNTIME ? 0.0001 : 0.00001),
  '60-degree bolt lift'
);
const p = new THREE.Vector3(),
  q = new THREE.Quaternion();
const armL = new Arm(-1, { scale: 0.97 }),
  armR = new Arm(1);
anim.update(0, 'reloadEmpty', 0.62 * 3.6, false);
anim.handTarget('right', p, q);
assert(
  p.distanceTo(new THREE.Vector3(...model.nodes.gripR.pos).applyMatrix4(model.root.matrix)) <
    0.000001,
  'empty-reload wrist stays seated until holding-finger unwrap'
);
let maximumContactGap = 0;
for (const [name, first, last] of [
  ['cycle', 16, 99],
  ['reloadEmpty', Math.ceil(0.05 * 3.6 * 120), Math.floor(0.13 * 3.6 * 120)],
  ['reloadEmpty', Math.ceil(0.83 * 3.6 * 120), Math.floor(0.925 * 3.6 * 120)],
])
  for (let frame = first; frame <= last; frame++) {
    const t = frame / 120;
    anim.update(0, name, t, false);
    anim.handTarget('right', armR.hand.position, armR.hand.quaternion);
    anim.applyHands(armL, armR);
    armR.root.updateMatrixWorld(true);
    const knob = ax338PartTriangles(model.root, 'bolt').filter((tri) =>
      [tri.a, tri.b, tri.c].every(
        (v) =>
          v
            .clone()
            .applyMatrix4(anim.bolt.matrixWorld.clone().invert().multiply(model.root.matrixWorld))
            .x > 0.049
      )
    );
    assert(knob.length > 100, 'actual bolt-knob surface retained');
    for (const [joint, pad, target] of [
      [armR.fingers[0].joints[2], [0, -0.006, -0.013], [0.069, 0.049, 0.057]],
      [armR.thumb.joints[1], [0, 0, -0.026], [0.055, 0.06, 0.056]],
    ]) {
      const contact = new THREE.Vector3(...pad).applyMatrix4(joint.matrixWorld);
      const expected = new THREE.Vector3(...target)
        .sub(rest)
        .applyQuaternion(anim.bolt.quaternion)
        .add(anim.bolt.position)
        .applyMatrix4(model.root.matrix);
      const localContact = contact.clone().applyMatrix4(model.root.matrix.clone().invert());
      const closest = new THREE.Vector3();
      const surfaceGap = Math.min(
        ...knob.map((tri) => {
          tri.closestPointToPoint(localContact, closest);
          return localContact.distanceTo(closest);
        })
      );
      assert(surfaceGap < 0.003, `${name}/${t}: real glove pad loses actual knob`);
      maximumContactGap = Math.max(maximumContactGap, contact.distanceTo(expected));
      assert(
        contact.distanceTo(expected) < 0.003,
        `${name}/${t}: fingertip loses bolt-knob contact`
      );
    }
  }
for (const name of Object.keys(anim.clips())) {
  const d = anim.clips()[name].duration;
  for (let i = 0; i <= 120; i++) {
    anim.update(0, name, (d * i) / 120, false);
    for (const side of ['left', 'right']) {
      anim.handTarget(side, p, q);
      assert(p.toArray().every(Number.isFinite) && q.toArray().every(Number.isFinite));
      assert(Math.abs(q.length() - 1) < 0.00001);
    }
  }
}
for (const name of ['reloadTac', 'reloadEmpty']) {
  anim.update(0, name, anim.clips()[name].duration * 0.48, true);
  assert(anim.spare.visible && !anim.magazine.visible);
  let meshes = 0;
  anim.spare.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      assert(
        Math.abs(Math.abs(o.matrixWorld.determinant()) - 1) < 1e-5,
        'spare descendants not collapsed'
      );
    }
  });
  assert(meshes > 0);
  anim.reset();
  assert(!anim.spare.visible && anim.magazine.visible);
  assert(
    anim.bolt.position.distanceTo(rest) < 1e-6 && anim.bolt.quaternion.angleTo(restQ) < 1e-6,
    'reset clears bolt action'
  );
}
anim.update(0, null, 0, true, false);
assert(
  !anim.magazineRound.visible && !anim.spareRound.visible,
  'empty ammunition is not resurrected'
);
anim.update(0, null, 0, false, true);
assert(anim.magazineRound.visible, 'refill restores visible rounds');
assert.equal(def.damage, 145);
assert.equal(def.magSize, 10);
assert.equal(def.boltTime, 1.1);
assert.equal(def.muzzleVelocity, 880);
assert.equal(def.adsFovScale, 0.25);
assert.equal(model.magSize.len, 0.1125);
assert(manifest.contactGeometry.magazine.some((b) => b.part === 'Magazine steel body'));
assert.equal(model.shell.caseLen, 0.0697);
assert.equal(model.shell.rimR, 0.0074);
assert(Math.abs(model.nodes.muzzle[2] - manifest.dimensions.muzzle) < 1e-6);
anim.dispose();
assert.equal(model.materials.size, 0);
assert.equal(model.textures.size, 0);
console.log(
  `AX338: ${triangles} triangles / ${primitives.length} primitives; native manual bolt, nine clips, PBR, event parity, ${maximumContactGap.toFixed(6)} m maximum bolt contact gap, spare/round visibility and reset passed`
);
