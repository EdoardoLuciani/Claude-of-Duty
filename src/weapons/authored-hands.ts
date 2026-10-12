import * as THREE from 'three';

export type HandSide = 'left' | 'right';
export interface AuthoredHand {
  wrist: THREE.Object3D;
  fingers: { root: THREE.Object3D; joints: THREE.Object3D[] }[];
  thumb: THREE.Object3D[];
}
export interface HandRig {
  fingers: { root: THREE.Object3D; joints: THREE.Object3D[] }[];
  thumb: { root: THREE.Object3D; joints: THREE.Object3D[] };
  updateFlex(): void;
}

export function discoverAuthoredHands(node: (name: string) => THREE.Object3D): Record<HandSide, AuthoredHand> {
  const hand = (prefix: string): AuthoredHand => ({
    wrist: node(`hand_${prefix}`),
    fingers: Array.from({ length: 4 }, (_, i) => ({
      root: node(`${prefix}_finger_${i}_root`),
      joints: Array.from({ length: 3 }, (_, j) => node(`${prefix}_finger_${i}_${j}`)),
    })),
    thumb: ['thumb_base', 'thumb_0', 'thumb_1'].map(name => node(`${prefix}_${name}`)),
  });
  return { left: hand('L'), right: hand('R') };
}

export function authoredHandTarget(root: THREE.Object3D, hand: AuthoredHand, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
  position.copy(hand.wrist.position).applyMatrix4(root.matrix);
  quaternion.copy(root.quaternion).multiply(hand.wrist.quaternion);
}

export function applyAuthoredHand(arm: HandRig, authored: AuthoredHand): void {
  for (let i = 0; i < 4; i++) {
    arm.fingers[i].root.quaternion.copy(authored.fingers[i].root.quaternion);
    for (let j = 0; j < 3; j++) arm.fingers[i].joints[j].quaternion.copy(authored.fingers[i].joints[j].quaternion);
  }
  arm.thumb.root.quaternion.copy(authored.thumb[0].quaternion);
  for (let j = 0; j < 2; j++) arm.thumb.joints[j].quaternion.copy(authored.thumb[j + 1].quaternion);
  arm.updateFlex();
}
