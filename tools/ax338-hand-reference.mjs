#!/usr/bin/env node
// Offline fitting inputs. Blender owns the resulting wrist/finger curves.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { Arm } from '../src/weapons/hands.ts';
const loader = new GLTFLoader().register(() => ({
  name: 'OFFLINE_TEXTURE',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const bytes = readFileSync(new URL('../public/models/player/arms.glb', import.meta.url));
const skin = await loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  ''
);
skin.scene.updateMatrixWorld(true);
const meshes = [];
skin.scene.traverse((o) => {
  if (o.isSkinnedMesh) meshes.push(o);
});
// Refine the initial joint-axis fit against Blender's real glove vertices.
// A finger-centre proxy alone misses the thick suede/knuckle silhouette.
function skinSamples(arm, prefix, distalWeight = 0.025) {
  const groups = [];
  for (const mesh of arm.skins) {
    const indices = mesh.geometry.attributes.skinIndex,
      weights = mesh.geometry.attributes.skinWeight;
    const selected = new Uint8Array(indices.count),
      distal = new Uint8Array(indices.count);
    for (let v = 0; v < indices.count; v++)
      for (let k = 0; k < 4; k++)
        if (weights.getComponent(v, k) > 0.025) {
          const name = arm.skeleton.bones[indices.getComponent(v, k)].name;
          if (name.startsWith(prefix)) selected[v] = 1;
          if (name.startsWith('thumb_1') && weights.getComponent(v, k) > distalWeight)
            distal[v] = 1;
        }
    const faces = [],
      used = new Set();
    const index = mesh.geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i],
        b = index[i + 1],
        c = index[i + 2];
      if (!selected[a] && !selected[b] && !selected[c]) continue;
      faces.push(a, b, c);
      used.add(a);
      used.add(b);
      used.add(c);
    }
    const ids = [...used],
      points = [];
    for (const id of ids) points[id] = new THREE.Vector3();
    if (ids.length) groups.push({ mesh, ids, points, faces, distal });
  }
  return groups;
}
const samplePoint = new THREE.Vector3();
function skinCost(
  arm,
  groups,
  signedGap,
  contact,
  tipOnly = false,
  contactGap = signedGap,
  contactSide = 0
) {
  arm.updateFlex();
  arm.root.updateMatrixWorld(true);
  let error = 0,
    nearest = Infinity;
  function measure(point, distal) {
    const gap = signedGap(point);
    error += Math.max(0, -0.0003 - gap) ** 2 * 1000;
    if (contact && (!tipOnly || distal) && (!contactSide || point.x * contactSide > 0.01))
      nearest = Math.min(nearest, Math.abs(contactGap(point)));
  }
  for (const g of groups) {
    for (const id of g.ids) {
      g.mesh.getVertexPosition(id, g.points[id]);
      measure(g.points[id], g.distal[id]);
    }
    // Vertices alone miss glove triangles cutting across a corner. Measure
    // actual deformed triangle centroids and all three edge midpoints too.
    for (let i = 0; i < g.faces.length; i += 3) {
      const a = g.faces[i],
        b = g.faces[i + 1],
        c = g.faces[i + 2];
      const distal = contactSide
        ? g.distal[a] && g.distal[b] && g.distal[c]
        : g.distal[a] || g.distal[b] || g.distal[c];
      measure(
        samplePoint
          .copy(g.points[a])
          .add(g.points[b])
          .add(g.points[c])
          .multiplyScalar(1 / 3),
        distal
      );
      measure(samplePoint.copy(g.points[a]).add(g.points[b]).multiplyScalar(0.5), distal);
      measure(samplePoint.copy(g.points[b]).add(g.points[c]).multiplyScalar(0.5), distal);
      measure(samplePoint.copy(g.points[c]).add(g.points[a]).multiplyScalar(0.5), distal);
    }
  }
  return error + (contact ? Math.max(0, nearest - 0.001) ** 2 * (contactSide ? 100 : 10) : 0);
}
function refineFingers(
  arm,
  pose,
  signedGap,
  contact = true,
  first = 0,
  last = 4,
  contactGap = signedGap,
  minimumCurl = -1.95
) {
  for (let i = first; i < last; i++) {
    const groups = skinSamples(arm, `finger_${i}_`),
      joints = arm.fingers[i].joints;
    const cost = () => skinCost(arm, groups, signedGap, contact, false, contactGap);
    for (let pass = 0; pass < (last === 1 ? 8 : 6); pass++)
      for (let j = 0; j < (last === 1 ? 4 : 3); j++) {
        const rotation = j === 3 ? arm.fingers[i].root.rotation : joints[j].rotation,
          axis = j === 3 ? 'y' : 'x';
        const center = rotation[axis],
          radius = pass < 3 ? 0.3 : 0.08;
        let best = center,
          minimum = cost();
        for (let step = 0; step <= 20; step++) {
          const angle = THREE.MathUtils.clamp(
            center + (step / 10 - 1) * radius,
            j === 3 ? -0.6 : minimumCurl,
            j === 3 ? 0.6 : -0.025
          );
          rotation[axis] = angle;
          const value = cost();
          if (value < minimum) {
            minimum = value;
            best = angle;
          }
        }
        rotation[axis] = best;
        if (j === 3) pose.fingerSpread[i] = best;
        else pose.fingers[i][j] = -best;
      }
  }
}
function refineThumb(
  arm,
  pose,
  signedGap,
  contact = true,
  contactGap = signedGap,
  contactSide = 0
) {
  const groups = skinSamples(arm, 'thumb_', contactSide ? 0.2 : 0.025);
  const root = arm.thumb.root.rotation,
    joints = arm.thumb.joints;
  const params = [
    [root, 'x'],
    [root, 'y'],
    [root, 'z'],
    [joints[0].rotation, 'x'],
    [joints[1].rotation, 'x'],
  ];
  const cost = () => skinCost(arm, groups, signedGap, contact, true, contactGap, contactSide);
  for (let pass = 0; pass < 6; pass++)
    for (const [rotation, axis] of params) {
      const center = rotation[axis],
        radius = pass < 3 ? 0.25 : 0.06;
      let best = center,
        minimum = cost();
      for (let step = 0; step <= 20; step++) {
        rotation[axis] = center + (step / 10 - 1) * radius;
        const value = cost();
        if (value < minimum) {
          minimum = value;
          best = rotation[axis];
        }
      }
      rotation[axis] = best;
    }
  pose.thumbBase = root.toArray().slice(0, 3);
  pose.thumb = joints.map((j) => -j.rotation.x);
}
function foreendGap(p) {
  const x = Math.abs(p.x),
    y = Math.abs(p.y - 0.075);
  let gap = Math.max(x - 0.027, y - 0.026, (x + y - 0.04) / Math.SQRT2);
  // Conservative real panel/rib/screw envelopes, separate on the two sides.
  // Do not fill the free space below the tube between the grip panels.
  for (const side of [-1, 1])
    gap = Math.min(
      gap,
      Math.max(
        Math.abs(p.x - side * 0.02675) - 0.00475,
        Math.abs(p.y - 0.043) - 0.015,
        Math.abs(p.z + 0.242) - 0.073
      )
    );
  return gap;
}
const basis = (finger, back) => {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back)
    .addScaledVector(z, -new THREE.Vector3(...back).dot(z))
    .normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z)
  );
};
// Generated from the actual curved mesh samples. Export geometry before this
// offline solve after changing grip-profile.json; runtime never evaluates it.
const pistolSections = JSON.parse(
  readFileSync(new URL('../assets/weapons/ax338/manifest.json', import.meta.url))
).contactGeometry.pistolGripSections;
function pistolGap(p) {
  let i = 0;
  while (i < pistolSections.length - 2 && p.y < pistolSections[i + 1][0]) i++;
  const a = pistolSections[i],
    b = pistolSections[i + 1],
    t = THREE.MathUtils.clamp((a[0] - p.y) / (a[0] - b[0]), 0, 1);
  const z = THREE.MathUtils.lerp(a[1], b[1], t),
    w = THREE.MathUtils.lerp(a[2], b[2], t),
    d = THREE.MathUtils.lerp(a[3], b[3], t);
  const wrap = p.z > z ? 0.0007 : 0;
  return Math.max(
    (Math.hypot(p.x / (w + wrap), (p.z - z) / (d + wrap)) - 1) * Math.min(w, d),
    p.y - pistolSections[0][0],
    pistolSections.at(-1)[0] - p.y
  );
}
function polygonGap(p, poly, width) {
  let inside = false,
    distance = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j],
      b = poly[i],
      dz = b[0] - a[0],
      dy = b[1] - a[1];
    const t = THREE.MathUtils.clamp(
      ((p.z - a[0]) * dz + (p.y - a[1]) * dy) / (dz * dz + dy * dy),
      0,
      1
    );
    distance = Math.min(distance, (p.z - a[0] - t * dz) ** 2 + (p.y - a[1] - t * dy) ** 2);
    if (a[1] > p.y !== b[1] > p.y && p.z < ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return Math.max((inside ? -1 : 1) * Math.sqrt(distance), Math.abs(p.x) - width / 2);
}
function roundedGap(p, z0, z1, y0, y1, r) {
  const x = Math.abs(p.z - (z0 + z1) / 2) - (z1 - z0) / 2 + r,
    y = Math.abs(p.y - (y0 + y1) / 2) - (y1 - y0) / 2 + r;
  return Math.hypot(Math.max(x, 0), Math.max(y, 0)) + Math.min(Math.max(x, y), 0) - r;
}
const housingProfile = [
  [-0.0157, 0.06],
  [0.098, 0.06],
  [0.119, 0.054],
  [0.117, 0.037],
  [0.079, 0.025],
  [-0.0157, 0.025],
];
const mountProfile = [
  [0.06, 0.068],
  [0.094, 0.068],
  [0.12, 0.058],
  [0.12, 0.035],
  [0.096, 0.035],
  [0.073, 0.038],
  [0.06, 0.043],
];
const triggerProfile = [
  [0.022, 0.044],
  [0.028, 0.044],
  [0.027, 0.024],
  [0.027, 0.013],
  [0.023, 0.001],
  [0.015, -0.006],
  [0.008, -0.007],
  [0.008, -0.003],
  [0.013, -0.001],
  [0.019, 0.006],
  [0.021, 0.016],
  [0.021, 0.026],
];
function firingClearance(p) {
  // Conservative broad phase: all of these obstacles fit inside these bounds.
  // Most distal samples are below the guard or lateral to the entire rifle.
  if (Math.abs(p.x) > 0.025) return 0.1;
  if (p.y < -0.015) return pistolGap(p);
  const ring = Math.max(
    roundedGap(p, -0.0157, 0.0522, -0.0148, 0.0293, 0.01),
    -roundedGap(p, -0.0091, 0.0469, -0.0091, 0.0218, 0.008),
    Math.abs(p.x) - 0.0155
  );
  const passage = Math.max(Math.hypot(p.x, p.y - 0.075) - 0.013, Math.abs(p.z - 0.083) - 0.033);
  const mount = Math.max(polygonGap(p, mountProfile, 0.027), -passage);
  return Math.min(
    pistolGap(p),
    ring,
    polygonGap(p, housingProfile, 0.031),
    mount,
    polygonGap(p, triggerProfile, 0.005) - 0.0015
  );
}
const grips = {
  right: { pos: [0.044, -0.021, 0.114], finger: [0.06, 0.04, -0.997], back: [1, 0.03, 0.04] },
  // Support under the moulded panels, within actual hip/ADS arm reach.
  left: { pos: [-0.069, 0.002, -0.205], finger: [0.76, -0.1, -0.64], back: [-0.13, -0.985, 0.001] },
};
// Authored holding pose, checked against saved glove skins and neighbouring
// fingers. Preserve approved wrist/index/thumb; no runtime fitting is added.
function fitHoldingHand(result) {
  const held = result.sides.right.grip;
  held.fingers.splice(1, 3, [2.2625, 0.165, 0.12], [2.15, 0.61, 0.025], [2.45, 0.1, 0.3]);
  held.fingerSpread.splice(1, 3, -0.2025, -0.4, -0.25);
  held.fingerRoll = [0, -0.34, -0.12, -0.12];
  result.rightIndexed.fingerRoll = held.fingerRoll.slice();
  for (let i = 1; i < 4; i++) {
    result.rightIndexed.fingers[i] = held.fingers[i].slice();
    result.rightIndexed.fingerSpread[i] = held.fingerSpread[i];
  }
  const open = structuredClone(result.rightOpen),
    arm = new Arm(1);
  arm.attachAsset({ meshes });
  arm.hand.position.fromArray(result.grips.right.pos);
  arm.hand.quaternion.fromArray(result.sides.right.quaternion);
  // Unhook MCP before unfolding distal joints; reverse for the regrip.
  for (const row of result.rightUnwrap) {
    const t = row.t,
      root = Math.min(1, t * 2),
      distal = Math.max(0, t * 2 - 1);
    row.pose.fingerRoll = [0, 0, 0, 0];
    for (let i = 1; i < 4; i++) {
      for (let j = 0; j < 3; j++)
        row.pose.fingers[i][j] = THREE.MathUtils.lerp(
          held.fingers[i][j],
          open.fingers[i][j],
          j === 0 ? root : distal
        );
      row.pose.fingerSpread[i] = THREE.MathUtils.lerp(
        held.fingerSpread[i],
        open.fingerSpread[i],
        t
      );
      row.pose.fingerRoll[i] =
        THREE.MathUtils.lerp(held.fingerRoll[i], 0, distal) -
        (i === 1 ? 0.35 * Math.sin(Math.PI * t) : 0);
    }
    if (t > 0 && t < 1) {
      arm.poses.releaseHolding = row.pose;
      arm.setPose('releaseHolding');
      for (let i = 1; i < 4; i++) arm.fingers[i].root.rotation.z = row.pose.fingerRoll[i];
      const clearance = (p) =>
        Math.min(
          firingClearance(p),
          pistolGap(p) - 0.0025,
          Math.max(
            roundedGap(p, -0.0157, 0.0522, -0.0148, 0.0293, 0.01),
            -roundedGap(p, -0.0091, 0.0469, -0.0091, 0.0218, 0.008),
            Math.abs(p.x) - 0.0155
          ) - 0.0015
        );
      refineFingers(arm, row.pose, clearance, false, 1, 4, clearance, -2.6);
    }
  }
  result.rightOpen = structuredClone(result.rightUnwrap.at(-1).pose);
}
const out = new URL('../assets/weapons/ax338/', import.meta.url);
function writeReference(result) {
  // release_right() keys only the index. Other controls are unused payload;
  // rightIndexed/rightOpen retain the complete poses needed by full pose keys.
  for (const row of result.rightRelease)
    row.pose = { fingers: [row.pose.fingers[0]], fingerSpread: [row.pose.fingerSpread[0]] };
  writeFileSync(new URL('hand-reference.json', out), JSON.stringify(result, null, 2) + '\n');
}
if (process.argv.includes('--holding-only')) {
  const result = JSON.parse(readFileSync(new URL('hand-reference.json', out)));
  fitHoldingHand(result);
  writeReference(result);
  console.log(
    'Updated middle/ring/little fingers only; approved index, thumb and wrists preserved.'
  );
  process.exit(0);
}
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.attachAsset({ meshes });
  arm.hand.position.fromArray(g.pos);
  arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'right' ? 'gripRifle' : 'clamp');
  if (side === 'left')
    arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, 0.075, 0], [0, 0, 1], 0.03, {
      clearance: 0.0015,
      poseName: 'ax338',
    });
  arm.fitGrip(
    'ax338',
    side === 'right'
      ? { thumb: [-0.02, 0.002, 0.078], index: [0.015, 0.012, 0.03], spread: [0, 0.6, 0.62, 0.64] }
      : { thumb: [-0.041, 0.055, -0.263], thumbPole: [-1, 1, 0] }
  );
  arm.setPose('ax338');
  if (side === 'left') {
    refineFingers(arm, arm.poses.ax338, foreendGap);
    refineThumb(arm, arm.poses.ax338, foreendGap);
  }
  if (side === 'right') {
    // Fit the index around the aperture, the holding fingers against the grip,
    // and the thumb around the new housing; account for actual padded skins.
    refineFingers(arm, arm.poses.ax338, firingClearance, false, 0, 1);
    refineFingers(arm, arm.poses.ax338, firingClearance, true, 1, 4, pistolGap);
    refineThumb(arm, arm.poses.ax338, firingClearance, true, pistolGap, -1);
  }
  result.sides[side] = {
    quaternion: arm.hand.quaternion.toArray(),
    grip: structuredClone(arm.poses.ax338),
  };
  if (side === 'right') {
    // Unhook at MCP first, then unfold the distal joints. Independent linear
    // curl blends sweep the fingertip through the shallow guard's front wall.
    result.rightRelease = [];
    const start = structuredClone(arm.poses.ax338),
      indexSamples = skinSamples(arm, 'finger_0_');
    for (let step = 0; step <= 20; step++) {
      const t = step / 20,
        pose = structuredClone(start),
        first = THREE.MathUtils.clamp(t * 2, 0, 1),
        second = THREE.MathUtils.clamp(t * 2 - 1, 0, 1);
      pose.fingers[0][0] = THREE.MathUtils.lerp(start.fingers[0][0], 0.025, first);
      for (let j = 1; j < 3; j++)
        pose.fingers[0][j] = THREE.MathUtils.lerp(
          start.fingers[0][j],
          j === 1 ? 0.1 : 0.15,
          second
        );
      pose.fingerSpread[0] = THREE.MathUtils.lerp(start.fingerSpread[0], 0.22, t);
      arm.poses.indexRelease = pose;
      arm.setPose('indexRelease');
      if (step > 0 && skinCost(arm, indexSamples, firingClearance, false) > 1e-8)
        refineFingers(arm, pose, firingClearance, false, 0, 1);
      result.rightRelease.push({ t, pose });
    }
    result.rightIndexed = structuredClone(result.rightRelease.at(-1).pose);
    result.rightUnwrap = [];
    const held = structuredClone(result.rightIndexed),
      holdingSamples = skinSamples(arm, '');
    for (let step = 0; step <= 12; step++) {
      const t = step / 12,
        pose = structuredClone(held),
        first = THREE.MathUtils.clamp(t * 2, 0, 1),
        second = THREE.MathUtils.clamp(t * 2 - 1, 0, 1);
      for (let i = 1; i < 4; i++)
        for (let j = 0; j < 3; j++)
          pose.fingers[i][j] = THREE.MathUtils.lerp(
            held.fingers[i][j],
            j === 0 ? 0.15 : 0.2,
            j === 0 ? first : second
          );
      pose.thumb = held.thumb.map((v) => THREE.MathUtils.lerp(v, 0.15, t));
      arm.poses.unwrap = pose;
      arm.setPose('unwrap');
      if (step > 0 && skinCost(arm, holdingSamples, firingClearance, false) > 1e-8) {
        refineFingers(arm, pose, firingClearance, false, 1);
        refineThumb(arm, pose, firingClearance, false);
      }
      result.rightUnwrap.push({ t, pose });
    }
    result.rightOpen = structuredClone(result.rightUnwrap.at(-1).pose);
  }
  if (side === 'left') {
    result.release = [];
    const start = structuredClone(arm.poses.ax338),
      end = structuredClone(start);
    end.fingers = [
      [0.15, 0.25, 0.18],
      [0.2, 0.3, 0.2],
      [0.25, 0.32, 0.24],
      [0.32, 0.36, 0.27],
    ];
    end.thumb = [0.12, 0.2];
    for (let step = 0; step <= 16; step++) {
      const t = step / 16,
        pose = structuredClone(start);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 3; j++)
          pose.fingers[i][j] = THREE.MathUtils.lerp(start.fingers[i][j], end.fingers[i][j], t);
      for (let j = 0; j < 2; j++)
        pose.thumb[j] = THREE.MathUtils.lerp(start.thumb[j], end.thumb[j], t);
      arm.poses.release = pose;
      arm.setPose('release');
      const pos = g.pos.map((v, i) => v + (i < 2 ? -0.06 * t : 0));
      arm.hand.position.fromArray(pos);
      refineFingers(arm, pose, foreendGap, false);
      refineThumb(arm, pose, foreendGap, false);
      result.release.push({ t, pos, pose });
    }
  }
}
function contact(side, pos, finger, back, target, name) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.hand.position.fromArray(pos);
  arm.hand.quaternion.copy(basis(finger, back));
  arm.setPose('wrap');
  arm.fitGrip(name, target);
  return { pos, quaternion: arm.hand.quaternion.toArray(), pose: structuredClone(arm.poses[name]) };
}
// Four fingers wrap the exposed lower body; thumb opposes them across the
// short axis. The old wrist put finger roots at the receiver, above the grip.
const magPos = [-0.039, -0.05, 0.026];
const magQ = basis([0, -0.04, -1], [-1, -0.25, 0]);
const magArm = new Arm(-1, { scale: 0.97 });
magArm.attachAsset({ meshes });
magArm.hand.position.fromArray(magPos);
magArm.hand.quaternion.copy(magQ);
magArm.setPose('wrap');
const envelope = new THREE.Box3(
  new THREE.Vector3(-0.017, -0.0385, -0.127),
  new THREE.Vector3(0.017, 0.0665, -0.023)
);
const point = new THREE.Vector3(),
  near = new THREE.Vector3();
function gap(joint, local) {
  joint.updateWorldMatrix(true, false);
  point.fromArray(local).applyMatrix4(joint.matrixWorld);
  envelope.clampPoint(point, near);
  return envelope.containsPoint(point)
    ? -Math.min(
        point.x + 0.017,
        0.017 - point.x,
        point.y + 0.0385,
        0.0665 - point.y,
        point.z + 0.127,
        -0.023 - point.z
      )
    : point.distanceTo(near);
}
const curls = [];
for (let i = 0; i < 4; i++) {
  const f = magArm.fingers[i],
    lengths = magArm._segLength[i],
    radii = magArm._segRadius[i];
  const curl = [];
  for (let j = 0; j < 3; j++) {
    let best = 0,
      cost = Infinity;
    const local = j < 2 ? [0, 0, -lengths[j]] : [0, -radii[3], -lengths[2] * 0.5];
    const clearance = j < 2 ? radii[j + 1] + 0.002 : 0.002;
    for (let step = 0; step <= 100; step++) {
      const angle = -0.05 - (step * 1.8) / 100;
      f.joints[j].rotation.x = angle;
      const g = gap(f.joints[j], local);
      const middle = gap(f.joints[j], [0, 0, -lengths[j] * 0.5]);
      const c =
        Math.abs(g - clearance) +
        Math.max(0, -g) * 12 +
        Math.max(0, radii[j] - 0.001 - middle) * 15;
      if (c < cost) {
        cost = c;
        best = angle;
      }
    }
    f.joints[j].rotation.x = best;
    curl.push(-best);
  }
  curls.push(curl);
}
magArm.fitGrip('magazine', {
  fingers: curls,
  thumb: [0.029, -0.031, -0.024],
  thumbPole: [0, 0, 1],
});
magArm.setPose('magazine');
const floor = new THREE.Box3(
  new THREE.Vector3(-0.019, -0.0435, -0.1285),
  new THREE.Vector3(0.019, -0.0385, -0.0215)
);
function boxGap(box, p) {
  box.clampPoint(p, near);
  return box.containsPoint(p)
    ? -Math.min(
        p.x - box.min.x,
        box.max.x - p.x,
        p.y - box.min.y,
        box.max.y - p.y,
        p.z - box.min.z,
        box.max.z - p.z
      )
    : p.distanceTo(near);
}
const magGap = (p) => Math.min(boxGap(envelope, p), boxGap(floor, p));
refineFingers(magArm, magArm.poses.magazine, magGap);
const rear = new THREE.Box3(
  new THREE.Vector3(-0.023, -0.008, -0.023),
  new THREE.Vector3(0.023, 0.062, 0.022)
);
const guard = new THREE.Box3(
  new THREE.Vector3(-0.016, -0.025, -0.012),
  new THREE.Vector3(0.016, 0.06, 0.077)
);
const magClearance = (p) => Math.min(magGap(p), boxGap(rear, p), boxGap(guard, p));
refineThumb(magArm, magArm.poses.magazine, magClearance, true, magGap, 1);
result.magazine = {
  pos: magPos,
  quaternion: magQ.toArray(),
  pose: structuredClone(magArm.poses.magazine),
};
magArm.setPose('magazine');
magArm.fitGrip('magazineOpen', {
  fingers: [
    [0.05, 0.1, 0.12],
    [0.05, 0.1, 0.12],
    [0.08, 0.12, 0.15],
    [0.12, 0.16, 0.18],
  ],
  thumb: [-0.065, -0.035, -0.042],
  thumbPole: [0, 0, 1],
});
magArm.setPose('magazineOpen');
refineFingers(magArm, magArm.poses.magazineOpen, magGap, false);
refineThumb(magArm, magArm.poses.magazineOpen, magClearance, false);
result.magazine.open = structuredClone(magArm.poses.magazineOpen);
result.magazine.grasp = [];
const open = result.magazine.open,
  closed = result.magazine.pose;
const openQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...open.thumbBase));
const closedQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...closed.thumbBase));
for (let step = 0; step <= 16; step++) {
  const t = step / 16,
    pose = structuredClone(open);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++)
      pose.fingers[i][j] = THREE.MathUtils.lerp(open.fingers[i][j], closed.fingers[i][j], t);
  pose.thumbBase = new THREE.Euler()
    .setFromQuaternion(openQ.clone().slerp(closedQ, t))
    .toArray()
    .slice(0, 3);
  for (let j = 0; j < 2; j++)
    pose.thumb[j] = THREE.MathUtils.lerp(open.thumb[j], closed.thumb[j], t);
  magArm.poses.squeeze = pose;
  magArm.setPose('squeeze');
  refineFingers(magArm, pose, magGap, false);
  refineThumb(magArm, pose, magClearance, false);
  result.magazine.grasp.push({ t, pose });
}
result.bolt = contact(
  'right',
  [0.135, 0.02, 0.085],
  [-0.3, 0.5, -0.81],
  [0.9, 0.25, -0.18],
  { index: [0.069, 0.049, 0.057], thumb: [0.055, 0.06, 0.056], thumbPole: [1, 0, 0] },
  'bolt'
);
fitHoldingHand(result);
mkdirSync(out, { recursive: true });
writeReference(result);
console.log('AX338 hand reference written; regenerate Blender actions after changes.');
