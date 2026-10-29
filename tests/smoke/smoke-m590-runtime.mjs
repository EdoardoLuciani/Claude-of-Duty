// Decoded meshopt/KTX2 fixture: real animation, rigid vertices and shell lifecycle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';

import reference from '../../assets/weapons/m590/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/m590/manifest.json' with { type: 'json' };
import { applyAuthoredHand } from '../../src/weapons/authored-hands.ts';
import { Arm } from '../../src/weapons/hands.ts';
import { makeM590Model, M590Animation, M590_URL } from '../../src/weapons/m590.ts';
import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';
import { mechanicalPartViews, finishIndex } from './m590-geometry.mjs';

const runtimeURL = new URL(M590_URL);
const bytes = readFileSync(runtimeURL),
  { json } = inspectGLB(bytes);
assert(json.extensionsRequired.includes('EXT_meshopt_compression'));
assert(json.extensionsRequired.includes('KHR_texture_basisu'));
assert.equal(json.materials.length, 1);
assert(
  bytes.length < 4 * 1024 * 1024,
  'compressed runtime budget replaces the obsolete unskinned native budget'
);
assert.equal(json.images.length, 3);
assert.equal(json.animations.length, 7);
assert.equal(
  json.meshes.reduce((n, mesh) => n + mesh.primitives.length, 0),
  2
);

const native = makeM590Model(
    await parseGLB(readFileSync(new URL('../../assets/weapons/m590/m590.glb', import.meta.url)))
  ),
  runtime = makeM590Model(await parseGLB(bytes)),
  nativeAnimation = new M590Animation(native),
  animation = new M590Animation(runtime);
assert.deepEqual(animation.clips(), nativeAnimation.clips());
assert.equal(animation.magazineBody, undefined);
for (const name of ['receiver', 'forend', 'bolt', 'trigger', 'shell_insert', 'hand_L', 'hand_R'])
  assert.equal(runtime.root.getObjectByName(name).parent, runtime.root);
for (const name of Object.keys(manifest.sockets))
  assert(runtime.root.getObjectByName('SOCKET_' + name));

const skins = [];
let decodedBytes = 0;
runtime.scene.traverse((mesh) => {
  if (mesh.isSkinnedMesh) skins.push(mesh);
  if (!mesh.isMesh) return;
  for (const attribute of Object.values(mesh.geometry.attributes))
    decodedBytes += attribute.array.byteLength;
  decodedBytes += mesh.geometry.index.array.byteLength;
  for (let vertex = 0; vertex < mesh.geometry.attributes.color.count; vertex++)
    finishIndex(mesh.geometry.attributes.color, vertex);
  assert.equal(mesh.material.normalMap.channel, 0);
  assert.equal(mesh.material.map.channel, 0);
  assert.equal(mesh.material.roughnessMap.channel, 1);
  assert.equal(mesh.material.metalnessMap.channel, 1);
});
assert(
  decodedBytes < 3.5 * 1024 * 1024,
  'decoded typed arrays must stay materially below 4.92MB baseline'
);
assert.equal(skins.length, 1, 'one consolidated opaque mechanical primitive');
const v = new THREE.Vector3(),
  restVertices = [];
for (const mesh of skins) {
  mesh.skeleton.update();
  const positions = mesh.geometry.attributes.position,
    joints = mesh.geometry.attributes.skinIndex,
    weights = mesh.geometry.attributes.skinWeight;
  // Every vertex must really be rigid; sample the six spatial extrema per bone
  // through every pose below (not only bone/helper transforms).
  const extrema = new Map();
  for (let i = 0; i < positions.count; i++) {
    assert.equal(weights.getX(i), 1);
    assert.equal(weights.getY(i) + weights.getZ(i) + weights.getW(i), 0);
    const joint = joints.getX(i),
      row = extrema.get(joint) ?? Array(6).fill(i);
    for (let axis = 0; axis < 3; axis++) {
      if (positions.getComponent(i, axis) < positions.getComponent(row[axis * 2], axis))
        row[axis * 2] = i;
      if (positions.getComponent(i, axis) > positions.getComponent(row[axis * 2 + 1], axis))
        row[axis * 2 + 1] = i;
    }
    extrema.set(joint, row);
  }
  for (const [joint, indices] of extrema) {
    const part = runtime.root.getObjectByName(mesh.skeleton.bones[joint].name.replace('MECH_', '')),
      inverse = part.matrixWorld.clone().invert();
    for (const index of new Set(indices)) {
      const rest = mesh
        .getVertexPosition(index, new THREE.Vector3())
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(inverse);
      restVertices.push({ mesh, part, index, rest });
    }
  }
}
const controlPairs = [];
native.root.traverse((node) => {
  if (!node.isMesh && !node.isBone && !node.name.includes('SKIN')) {
    const other = runtime.root.getObjectByName(node.name);
    if (other) controlPairs.push([node, other]);
  }
});
const arm = new Arm(-1, { scale: 0.97 }),
  restPads = reference.sides.left.pads.map((p) => new THREE.Vector3(...p));
let maxPosition = 0,
  maxRotation = 0,
  maxSkinError = 0,
  maxPadError = 0,
  maxThumbError = 0,
  poses = 0;
const q = new THREE.Quaternion(),
  otherQ = new THREE.Quaternion();
for (const [name, info] of Object.entries(manifest.clips)) {
  const times = new Set(
    Array.from({ length: Math.ceil(info.duration * 240) + 1 }, (_, i) =>
      Math.min(i / 240, info.duration)
    )
  );
  if (name.startsWith('Reload')) {
    const appear = (name === 'Reload_Empty' ? 0.44 : 0.34) * info.duration,
      hide = (name === 'Reload_Empty' ? 0.7 : 0.84) * info.duration;
    for (const beat of [appear, hide])
      for (const delta of [-0.00001, 0.00001]) times.add(beat + delta);
  }
  for (const time of [...times].sort((a, b) => a - b)) {
    nativeAnimation._sample(name, time);
    animation._sample(name, time);
    poses++;
    for (const [source, target] of controlPairs) {
      maxPosition = Math.max(maxPosition, source.position.distanceTo(target.position));
      maxRotation = Math.max(
        maxRotation,
        q.copy(source.quaternion).normalize().angleTo(otherQ.copy(target.quaternion).normalize())
      );
      assert(source.scale.distanceTo(target.scale) < 1e-7, 'exact STEP/reset scale');
    }
    for (const mesh of skins) mesh.skeleton.update();
    for (const { mesh, part, index, rest } of restVertices) {
      const actual = mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld),
        expected = rest.clone().applyMatrix4(part.matrixWorld);
      maxSkinError = Math.max(maxSkinError, actual.distanceTo(expected));
    }
    assert.equal(animation.shellInsert.visible, nativeAnimation.shellInsert.visible);
    if (animation.shellInsert.visible) {
      const bounds = new THREE.Box3().setFromObject(animation.shellInsert);
      assert(bounds.getSize(v).length() > 0.06, 'visible shell has actual non-collapsed geometry');
    }
    const hand = animation.hands.left;
    arm.hand.position.copy(hand.wrist.position);
    arm.hand.quaternion.copy(hand.wrist.quaternion);
    applyAuthoredHand(arm, hand);
    arm.root.updateMatrixWorld(true);
    const pads = arm.fingers.map((f, i) =>
      new THREE.Vector3(0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * 0.5).applyMatrix4(
        f.joints[2].matrixWorld
      )
    );
    if (
      name === 'Pump' ||
      (name === 'Reload_Empty' && (time <= 0.22 * info.duration || time >= 0.78 * info.duration))
    ) {
      const forend = runtime.root.getObjectByName('forend');
      pads.forEach((pad, i) => {
        maxPadError = Math.max(
          maxPadError,
          pad.distanceTo(restPads[i].clone().add(forend.position))
        );
      });
    }
    const shell = animation.shellInsert;
    const target = (point) =>
      new THREE.Vector3(...point)
        .sub(new THREE.Vector3(...reference.shell.hullPosition))
        .applyQuaternion(shell.quaternion)
        .add(shell.position);
    const window = reference.contactWindows[name]?.shell;
    if (window && time >= window[0] && time <= window[1])
      pads.forEach((pad, i) => {
        maxPadError = Math.max(maxPadError, pad.distanceTo(target(reference.shell.pads[i])));
      });
    const thumbWindow = reference.contactWindows[name]?.thumb;
    if (thumbWindow && time >= thumbWindow[0] && time <= thumbWindow[1]) {
      const thumb = new THREE.Vector3(0, -0.0078 * arm.scale, -0.026 * arm.scale).applyMatrix4(
        arm.thumb.joints[1].matrixWorld
      );
      maxThumbError = Math.max(
        maxThumbError,
        thumb.distanceTo(target(reference.insertion.thumbPad))
      );
      assert(
        pads.every((pad) => pad.y < 0.033),
        'released fingers clear receiver'
      );
    }
  }
}
// Native frozen calibration still has its original 0.1um gate in smoke-shotgun-asset.
// Here independently bound the additional encoder error to a tiny fraction of
// the unchanged 2mm physical contact budget; no blanket geometry tolerance.
assert(maxPosition < 0.000002, `decoded control translation ${maxPosition}`);
assert(maxRotation < 0.0002, `decoded control rotation ${maxRotation}`);
assert(maxSkinError < 0.00002, `actual rigid skin/control mismatch ${maxSkinError}`);
assert(maxPadError < 0.002, `decoded pump/shell pad drift ${maxPadError}`);
assert(maxThumbError < 0.002, `decoded rim thumb drift ${maxThumbError}`);

animation.reset();
const traversePart = mechanicalPartViews(runtime.scene);
function surfaceDistance(part, point) {
  let distance = Infinity;
  traversePart(part, (mesh) => {
    if (!mesh.isMesh) return;
    const indices = mesh.geometry.index,
      positions = mesh.geometry.attributes.position,
      triangle = new THREE.Triangle(),
      closest = new THREE.Vector3(),
      local = part.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
    for (let i = 0; i < indices.count; i += 3) {
      triangle.a.fromBufferAttribute(positions, indices.getX(i)).applyMatrix4(local);
      triangle.b.fromBufferAttribute(positions, indices.getX(i + 1)).applyMatrix4(local);
      triangle.c.fromBufferAttribute(positions, indices.getX(i + 2)).applyMatrix4(local);
      distance = Math.min(distance, triangle.closestPointToPoint(point, closest).distanceTo(point));
    }
  });
  return distance;
}
for (const p of [...reference.sides.left.pads, reference.sides.left.thumbPad])
  assert(
    surfaceDistance(runtime.root.getObjectByName('forend'), new THREE.Vector3(...p)) < 0.002,
    'decoded actual forend triangles retain contacts'
  );
for (const p of [...reference.shell.pads, reference.shell.thumbPad, reference.insertion.thumbPad]) {
  // Unhide to inspect the real independent shell, then restore it below.
  animation.shellInsert.scale.setScalar(1);
  runtime.scene.updateMatrixWorld(true);
  assert(
    surfaceDistance(
      animation.shellInsert,
      new THREE.Vector3(...p).sub(new THREE.Vector3(...reference.shell.hullPosition))
    ) < 0.002,
    'decoded actual hull/rim triangles retain contacts'
  );
}
for (const alias of ['reloadTac', 'reloadEmpty']) {
  animation.update(0, alias, alias === 'reloadTac' ? 0.3 : 0.55);
  assert(animation.shellInsert.visible);
  animation.reset();
  assert(!animation.shellInsert.visible && animation.shellInsert.scale.x === 0);
}
const skeletons = new Set(skins.map((mesh) => mesh.skeleton));
let boneTextureDisposals = 0;
for (const skeleton of skeletons) {
  skeleton.computeBoneTexture();
  skeleton.boneTexture.addEventListener('dispose', () => {
    boneTextureDisposals++;
  });
}
animation.dispose();
assert.equal(boneTextureDisposals, skeletons.size, 'mechanical bone textures are released');
assert([...skeletons].every((skeleton) => skeleton.boneTexture === null));
nativeAnimation.dispose();
console.log(
  `M590 decoded runtime: ${poses} poses; control position ${maxPosition}m / rotation ${maxRotation}rad; rigid vertex error ${maxSkinError}m; pump/shell ${maxPadError * 1000}mm; rim thumb ${maxThumbError * 1000}mm; exact STEP visibility/reset and actual contact surfaces passed`
);
