#!/usr/bin/env node
// Offline shared Arm fitting, in game metres. Blender authors the actual paths.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { Arm } from '../src/weapons/hands.ts';
// Offline fitting reads the committed exterior, never changes runtime loading.
const bytes = readFileSync(new URL('../assets/weapons/m590/m590.glb', import.meta.url));
const loader = new GLTFLoader().register(() => ({
  name: 'OFFLINE_TEXTURE_STUB',
  loadTexture: () => Promise.resolve(new THREE.Texture()),
}));
const model = await loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  ''
);
model.scene.updateMatrixWorld(true);
const neckTriangles = [];
model.scene.getObjectByName('receiver').traverse((o) => {
  if (!o.isMesh || !o.material.name.startsWith('02')) return;
  const p = o.geometry.attributes.position,
    ix = o.geometry.index;
  for (let i = 0; i < ix.count; i += 3)
    neckTriangles.push(
      new THREE.Triangle(
        ...[0, 1, 2].map((k) =>
          new THREE.Vector3().fromBufferAttribute(p, ix.getX(i + k)).applyMatrix4(o.matrixWorld)
        )
      )
    );
});
assert(neckTriangles.length > 0, 'factory stock exterior required for offline hand fitting');
const closest = new THREE.Vector3();
function neckDistance(point) {
  let best = Infinity;
  for (const t of neckTriangles)
    best = Math.min(best, t.closestPointToPoint(point, closest).distanceToSquared(point));
  return Math.sqrt(best);
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
const grips = {
  right: { pos: [0.047, 0.05, 0.14], finger: [0.05, -0.65, -0.758], back: [1, 0, 0] },
  left: {
    pos: [-0.0504, 0.0279, -0.29],
    finger: [0.326, -0.3, -0.897],
    back: [-0.473, -0.873, 0.12],
  },
};
function fitFinger(arm, i, target, index = false, surface = null) {
  const f = arm.fingers[i],
    point = new THREE.Vector3(),
    goal = new THREE.Vector3(...target);
  const patch = index
    ? [0, -0.006 * arm.scale, -0.013 * arm.scale]
    : [0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * 0.5];
  const limits = [
    [-1.5, 0.2],
    [-1.65, 0.1],
    [-1.35, 0.1],
    [-0.6, 0.6],
  ];
  arm.root.updateMatrixWorld(true);
  for (let pass = 0; pass < 12; pass++)
    for (let j = 0; j < 4; j++) {
      const rotation = j < 3 ? f.joints[j].rotation : f.root.rotation,
        axis = j < 3 ? 'x' : 'y';
      const [lo, hi] = limits[j],
        centre = rotation[axis],
        radius = 0.1 * 2 ** (7 - pass);
      let best = centre,
        cost = Infinity;
      for (let n = 0; n <= 48; n++) {
        const angle =
          pass < 7
            ? lo + ((hi - lo) * n) / 48
            : THREE.MathUtils.clamp(centre + radius * ((2 * n) / 48 - 1), lo, hi);
        rotation[axis] = angle;
        f.joints[2].updateWorldMatrix(true, false);
        point.fromArray(patch).applyMatrix4(f.joints[2].matrixWorld);
        const c = surface
          ? surface(point) ** 2 + 0.015 * point.distanceToSquared(goal)
          : point.distanceToSquared(goal);
        if (c < cost) {
          cost = c;
          best = angle;
        }
      }
      rotation[axis] = best;
    }
  f.joints[2].updateWorldMatrix(true, false);
  point.fromArray(patch).applyMatrix4(f.joints[2].matrixWorld);
  assert(
    surface
      ? surface(point) < 0.002 && point.distanceTo(goal) < 0.04
      : point.distanceTo(goal) < 0.002,
    `M590 finger ${i}: unreachable patch ${point.distanceTo(goal)}; got ${point.toArray()}, target ${target}`
  );
}

function measure(arm) {
  arm.root.updateMatrixWorld(true);
  const pads = arm.fingers.map((f, i) =>
    new THREE.Vector3(0, -arm._segRadius[i][3] * 1.05, -arm._segLength[i][2] * 0.5)
      .applyMatrix4(f.joints[2].matrixWorld)
      .toArray()
  );
  // Common runtime contact test uses this same trigger patch and thumb centre.
  if (arm.side === 1)
    pads[0] = new THREE.Vector3(0, -0.006, -0.013)
      .applyMatrix4(arm.fingers[0].joints[2].matrixWorld)
      .toArray();
  const thumb = new THREE.Vector3(0, 0, -0.026 * arm.scale)
    .applyMatrix4(arm.thumb.joints[1].matrixWorld)
    .toArray();
  const thumbPad = new THREE.Vector3(0, -0.0078 * arm.scale, -0.026 * arm.scale)
    .applyMatrix4(arm.thumb.joints[1].matrixWorld)
    .toArray();
  return { pads, thumb, thumbPad };
}
const result = { grips, sides: {} };
for (const [side, g] of Object.entries(grips)) {
  const arm = new Arm(side === 'left' ? -1 : 1, { scale: side === 'left' ? 0.97 : 1 });
  arm.hand.position.fromArray(g.pos);
  arm.hand.quaternion.copy(basis(g.finger, g.back));
  arm.setPose(side === 'left' ? 'clamp' : 'gripShotgun');
  if (side === 'left')
    arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, 0.0348, 0], [0, 0, 1], 0.0225, {
      clearance: 0.001,
      poseName: 'm590',
    });
  else arm.fitGrip('m590', { index: [0, 0.01, -0.006], spread: [0, 0.3, 0.3, 0.3] });
  arm.setPose('m590');
  if (side === 'left') {
    for (const [i, p] of measure(arm).pads.entries()) {
      if (i === 0) {
        fitFinger(arm, i, [-0.001, 0.004, -0.457]);
        continue;
      }
      const r = Math.hypot(p[0], p[1] - 0.0348);
      fitFinger(
        arm,
        i,
        [
          (p[0] * 0.0225) / r,
          0.0348 + ((p[1] - 0.0348) * 0.0225) / r,
          THREE.MathUtils.clamp(p[2], -0.49, -0.298),
        ],
        false,
        (point) => Math.abs(Math.hypot(point.x, point.y - 0.0348) - 0.0225)
      );
    }
  } else {
    for (const [i, target] of [
      [1, [0.006, -0.036, 0.066]],
      [2, [0.006, -0.042, 0.085]],
      [3, [0.006, -0.019, 0.108]],
    ])
      fitFinger(arm, i, target, false, neckDistance);
  }
  arm.poses.m590.fingers = arm.fingers.map((f) => f.joints.map((j) => -j.rotation.x));
  arm.poses.m590.fingerSpread = arm.fingers.map((f) => f.root.rotation.y);
  // Palmar pad, not just thumb-centre: fit to the actual tri-rail/neck surface.
  const goal = new THREE.Vector3(
    ...(side === 'left' ? [-0.0223, 0.0378, -0.385] : [-0.0134, 0.041, 0.066])
  );
  if (side === 'right') {
    let distance = Infinity;
    const seed = goal.clone();
    for (const triangle of neckTriangles) {
      triangle.closestPointToPoint(seed, closest);
      const candidate = closest.distanceToSquared(seed);
      if (candidate < distance) {
        distance = candidate;
        goal.copy(closest);
      }
    }
  }
  const centre = goal.clone().add(new THREE.Vector3(-0.006, 0.006, 0));
  for (let pass = 0; pass < 18; pass++) {
    arm.fitGrip('m590', {
      thumb: centre.toArray(),
      thumbPole: side === 'left' ? [-1, 0, 0] : [0, 0, 1],
    });
    const pad = new THREE.Vector3(...measure(arm).thumbPad);
    centre.add(goal.clone().sub(pad));
    if (pad.distanceTo(goal) < 0.0001) break;
  }
  assert(
    new THREE.Vector3(...measure(arm).thumbPad).distanceTo(goal) < 0.001,
    `${side} palmar thumb must reach factory furniture`
  );
  arm.setPose('m590');
  result.sides[side] = {
    quaternion: arm.hand.quaternion.toArray(),
    grip: structuredClone(arm.poses.m590),
    ...measure(arm),
  };
}
const arm = new Arm(-1, { scale: 0.97 });
const g = { pos: [-0.035, -0.137, -0.05], finger: [0, 1, 0], back: [-1, 0, 0] };
arm.hand.position.fromArray(g.pos);
arm.hand.quaternion.copy(basis(g.finger, g.back));
arm.setPose('clamp');
arm.fitToCylinder(arm.hand.position, arm.hand.quaternion, [0, -0.0281, 0], [0, 0, 1], 0.00906, {
  clearance: 0.001,
  poseName: 'shell',
});
for (const [i, z] of [-0.025, -0.042, -0.058, -0.073].entries())
  fitFinger(arm, i, [0.0096, -0.0281, z]);
arm.poses.shell.fingers = arm.fingers.map((f) => f.joints.map((j) => -j.rotation.x));
arm.poses.shell.fingerSpread = arm.fingers.map((f) => f.root.rotation.y);
arm.fitGrip('shell', { thumb: [-0.0064, -0.034, -0.04], thumbPole: [-1, 0, 0] });
arm.setPose('shell');
result.shell = {
  pos: g.pos,
  quaternion: arm.hand.quaternion.toArray(),
  pose: structuredClone(arm.poses.shell),
  ...measure(arm),
  hullPosition: [0, -0.0281, -0.015],
  hullQuaternion: [0, 0, 0, 1],
  length: 0.07,
  rimRadius: 0.01105,
};
for (const p of [...result.shell.pads, result.shell.thumbPad]) {
  assert(p[2] <= -0.015 && p[2] >= -0.085, `shell pad outside 70mm hull: ${p}`);
  assert(
    Math.abs(Math.hypot(p[0], p[1] + 0.0281) - 0.00906) < 0.002,
    `shell pad misses hull: ${p}`
  );
}
// Release the wrap before insertion; the thumb pushes the rim from below while
// the curled finger chain remains outside the receiver, not inside the hull.
arm.hand.position.set(-0.0113, -0.146, -0.024);
arm.hand.quaternion.copy(basis(g.finger, g.back));
arm.poses.insertion = {
  ...structuredClone(result.shell.pose),
  fingers: Array.from({ length: 4 }, (_, i) => [i === 3 ? 1.7 : 1.48, 1.45, 1.15]),
  fingerSpread: [0, 0, 0, 0],
};
arm.setPose('insertion');
const rimPad = new THREE.Vector3(0, -0.0386, -0.01475),
  centre = rimPad.clone().add(new THREE.Vector3(0, -0.007, 0.006));
for (let pass = 0; pass < 18; pass++) {
  arm.fitGrip('insertion', { thumb: centre.toArray(), thumbPole: [0, 0, 1] });
  const pad = new THREE.Vector3(...measure(arm).thumbPad);
  centre.add(rimPad.clone().sub(pad));
  if (pad.distanceTo(rimPad) < 0.0001) break;
}
assert(
  new THREE.Vector3(...measure(arm).thumbPad).distanceTo(rimPad) < 0.001,
  `insertion thumb must reach real rim: ${JSON.stringify(measure(arm).thumbPad)}, error ${new THREE.Vector3(...measure(arm).thumbPad).distanceTo(rimPad)}`
);
result.insertion = {
  pos: arm.hand.position.toArray(),
  quaternion: arm.hand.quaternion.toArray(),
  pose: structuredClone(arm.poses.insertion),
  ...measure(arm),
  rimPad: rimPad.toArray(),
};
result.contactWindows = {
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
};
result.pump = {
  stroke: [0, 0, 0.089],
  provenance:
    'Provisional photo-inferred exterior travel; not a verified factory mechanism dimension',
  restPads: result.sides.left.pads,
  strokePads: result.sides.left.pads.map((p) => [p[0], p[1], p[2] + 0.089]),
};
writeFileSync(
  new URL('../assets/weapons/m590/hand-reference.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n'
);
console.log(
  'M590 shared wrist/finger, shell contact and pump seed written. Rebuild Blender source/export.'
);
