import * as THREE from 'three';

import type { Arm } from './hands.ts';

export type HandSide = 'left' | 'right';
export interface AuthoredHand {
  wrist: THREE.Object3D;
  fingers: { root: THREE.Object3D; joints: THREE.Object3D[] }[];
  thumb: THREE.Object3D[];
}
export type HandRig = Pick<Arm, 'fingers' | 'thumb' | 'updateFlex'>;

export function discoverAuthoredHands(
  node: (name: string) => THREE.Object3D
): Record<HandSide, AuthoredHand> {
  const hand = (prefix: string): AuthoredHand => ({
    wrist: node(`hand_${prefix}`),
    fingers: Array.from(
      { length: 4 },
      (_, i): { root: THREE.Object3D; joints: THREE.Object3D[] } => ({
        root: node(`${prefix}_finger_${i}_root`),
        joints: Array.from({ length: 3 }, (_, j): THREE.Object3D =>
          node(`${prefix}_finger_${i}_${j}`)
        ),
      })
    ),
    thumb: ['thumb_base', 'thumb_0', 'thumb_1'].map((name): THREE.Object3D =>
      node(`${prefix}_${name}`)
    ),
  });
  return { left: hand('L'), right: hand('R') };
}

interface AuthoredHandsState {
  root: THREE.Object3D;
  hands: Record<HandSide, AuthoredHand>;
}

export function authoredHandTarget(
  this: AuthoredHandsState,
  side: HandSide,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion
): void {
  const hand = this.hands[side];
  position.copy(hand.wrist.position).applyMatrix4(this.root.matrix);
  quaternion.copy(this.root.quaternion).multiply(hand.wrist.quaternion);
}

export function applyAuthoredHand(arm: HandRig, authored: AuthoredHand): void {
  for (let i = 0; i < 4; i++) {
    arm.fingers[i].root.quaternion.copy(authored.fingers[i].root.quaternion);
    for (let j = 0; j < 3; j++)
      arm.fingers[i].joints[j].quaternion.copy(authored.fingers[i].joints[j].quaternion);
  }
  arm.thumb.root.quaternion.copy(authored.thumb[0].quaternion);
  for (let j = 0; j < 2; j++) arm.thumb.joints[j].quaternion.copy(authored.thumb[j + 1].quaternion);
  arm.updateFlex();
}

export function applyAuthoredHands(this: AuthoredHandsState, left: HandRig, right: HandRig): void {
  applyAuthoredHand(left, this.hands.left);
  applyAuthoredHand(right, this.hands.right);
}
