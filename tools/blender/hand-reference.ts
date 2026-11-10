import assert from 'node:assert/strict';

import { Matrix4, Quaternion, Vector3, type QuaternionTuple, type Vector3Tuple } from 'three';

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
