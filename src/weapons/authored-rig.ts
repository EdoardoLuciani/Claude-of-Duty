import * as THREE from 'three';

import { disposeWeaponMaterials } from './asset-material.ts';
import {
  createAuthoredActions,
  disposeAuthoredMixer,
  sampleAuthoredAction,
} from './authored-actions.ts';
import {
  applyAuthoredHands,
  authoredHandTarget,
  discoverAuthoredHands,
  type AuthoredHand,
  type HandRig,
  type HandSide,
} from './authored-hands.ts';
import { requiredNode } from './authored-model.ts';
import type { WeaponModelRecord } from './runtime-types.ts';

type RigModel = Pick<WeaponModelRecord, 'root' | 'animations' | 'materials' | 'textures'>;
export interface AuthoredRig {
  model: RigModel;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  hands: Record<HandSide, AuthoredHand>;
  poseQ: THREE.Quaternion;
  name: string | null;
  idleTime: number;
  fireTime: number;
  _sample(name: string, time: number): void;
  fire(): void;
  reset(): void;
  dispose(): void;
  handTarget(side: HandSide, position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  applyHands(left: HandRig, right: HandRig): void;
}

export function sampleAuthoredPose(state: AuthoredRig, name: string, time: number): void {
  sampleAuthoredAction(state, name, time);
  state.root.updateMatrix();
  state.poseQ.copy(state.root.quaternion);
}

/** Shared native mixer and hands; weapon-local functions still own mechanisms and visibility. */
export function createAuthoredRig(model: RigModel): AuthoredRig {
  const root = model.root;
  const mixer = new THREE.AnimationMixer(root);
  return {
    model,
    root,
    mixer,
    actions: createAuthoredActions(mixer, model.animations),
    hands: discoverAuthoredHands((name): THREE.Object3D => requiredNode(root, name)),
    poseQ: new THREE.Quaternion(),
    name: null,
    idleTime: 0,
    fireTime: Infinity,
    _sample(name: string, time: number): void {
      sampleAuthoredPose(this, name, time);
    },
    fire(): void {
      this.fireTime = 0;
    },
    reset(): void {
      this.fireTime = Infinity;
      this._sample('Idle', 0);
    },
    handTarget: authoredHandTarget,
    applyHands: applyAuthoredHands,
    dispose(): void {
      disposeAuthoredMixer(this);
      disposeWeaponMaterials(model);
    },
  };
}
