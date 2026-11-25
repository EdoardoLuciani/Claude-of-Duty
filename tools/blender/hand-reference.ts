import assert from 'node:assert/strict';

import {
  MathUtils,
  Matrix4,
  Quaternion,
  Vector3,
  type QuaternionTuple,
  type Vector3Tuple,
} from 'three';

import type { Arm } from '../../src/weapons/hands.ts';

export type Side = 'right' | 'left';
export type HandPose = NonNullable<Arm['poses'][string]>;
export type GripOptions = NonNullable<Parameters<Arm['fitGrip']>[1]>;
export interface GripFrame {
  pos: Vector3Tuple;
  finger: Vector3Tuple;
  back: Vector3Tuple;
}
export interface HandSideReference {
  quaternion: QuaternionTuple;
  grip: HandPose;
}
export interface HandContact {
  pos: Vector3Tuple;
  quaternion: QuaternionTuple;
  pose: HandPose;
}
export function basis(finger: Vector3Tuple, back: Vector3Tuple): Quaternion {
  const z = new Vector3(...finger).negate().normalize();
  const y = new Vector3(...back).addScaledVector(z, -new Vector3(...back).dot(z)).normalize();
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(new Vector3().crossVectors(y, z), y, z)
  );
}
export function handPose(arm: Arm, name: string): HandPose {
  const pose = arm.poses[name];
  assert(pose, `missing fitted hand pose ${name}`);
  return pose;
}

export function snapshotFingers(arm: Arm): Pick<HandPose, 'fingers' | 'fingerSpread'> {
  return {
    fingers: arm.fingers.map((f): number[] => f.joints.map((j): number => -j.rotation.x)),
    fingerSpread: arm.fingers.map((f): number => f.root.rotation.y),
  };
}

// Fit a palmar patch, not just a wrist or an infinite cylinder. Joint bounds
// keep the solution out of hyper-flexed DIP and folded-back MCP configurations.
export function fitFinger(
  arm: Arm,
  i: number,
  target: Vector3Tuple,
  label: string,
  index = false,
  surface?: (point: Vector3) => number
): void {
  const f = arm.fingers[i],
    point = new Vector3(),
    goal = new Vector3(...target);
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
            : MathUtils.clamp(centre + radius * ((2 * n) / 48 - 1), lo, hi);
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
    `${label} finger ${i}: unreachable patch ${point.distanceTo(goal)}; got ${point.toArray().join(',')}, target ${target.join(',')}`
  );
}
