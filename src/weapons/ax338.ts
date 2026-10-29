import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/ax338/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/ax338/manifest.json' with { type: 'json' };
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { createAuthoredActions, sampleAuthoredAction } from './authored-actions.ts';
import {
  applyAuthoredHand,
  authoredHandTarget,
  discoverAuthoredHands,
  type AuthoredHand,
  type HandRig,
  type HandSide,
} from './authored-hands.ts';
import { authoredModel, requiredNode } from './authored-model.ts';
import { buildManifestClips, type Clip } from './clips.ts';

export const AX338_URL = new URL('../../assets/weapons/ax338/ax338.runtime.glb', import.meta.url)
  .href;
const ALIASES: Record<string, string> = {
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
  draw: 'Draw',
  holster: 'Holster',
  cycle: 'Bolt_Cycle',
};
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeAX338Model(gltf: GLTF): AX338Model {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(gltf, 'AX338_RIG', REQUIRED, scene);
  // glTF infers duration from keys; gltfpack folds the wholly constant Idle to
  // t=0. Restore only that authored hold, never normalize moving clip timing.
  const idle = animations.find((clip): boolean => clip.name === 'Idle');
  if (idle?.duration === 0) idle.duration = manifest.clips.Idle.duration;
  const model = {
    id: 'sniper' as const,
    label: 'AX-338',
    scene,
    root,
    animations,
    reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: [0.88, 0.4, 0.22],
      gripR: handReference.grips.right,
      gripL: handReference.grips.left,
      magSeat: { pos: point('SOCKET_magazine'), rot: [0, 0, 0] },
      triggerPivot: { pos: point('trigger'), rot: [0, 0, 0] },
      opticGlass: { kind: 'scope', center: point('SOCKET_sight'), reticle: 'p4fl' },
      handguard: { axis: [0, 0.075, 0], dir: [0, 0, 1], r: 0.027, z0: -0.175, z1: -0.581 },
    },
    shell: { caseLen: 0.0697, rimR: 0.0074 },
    magSize: { len: manifest.dimensions.magazineHeight },
  };
  const converted = convertWeaponScene(scene, (source, material): void => {
    if (source.name.startsWith('10 |')) {
      material.transparent = true;
      material.opacity = 0.13;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
    }
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  return { ...model, ...converted };
}

export async function loadAX338(renderer: Pick<Renderer, 'hasFeature'>): Promise<AX338Model> {
  return makeAX338Model(await loadWeaponGLTF(renderer, AX338_URL));
}

/** Blender owns mechanisms and wrist/finger choreography; the existing recoil,
 * shared arm skin, upper/forearm IK and ammunition/event system remain in charge. */
type AX338Model = {
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  id: 'sniper';
  label: string;
  scene: THREE.Group;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  reactiveFire: boolean;
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: {
      fingers: number[][];
      thumb: number[];
      thumbBase: number[];
      fingerSpread: number[];
      fingerRoll: number[];
    };
  };
  nodes: {
    muzzle: [number, number, number];
    eject: [number, number, number];
    sight: [number, number, number];
    ejectDir: number[];
    gripR: { pos: number[]; finger: number[]; back: number[] };
    gripL: { pos: number[]; finger: number[]; back: number[] };
    magSeat: { pos: [number, number, number]; rot: number[] };
    triggerPivot: { pos: [number, number, number]; rot: number[] };
    opticGlass: { kind: string; center: [number, number, number]; reticle: string };
    handguard: { axis: number[]; dir: number[]; r: number; z0: number; z1: number };
  };
  shell: { caseLen: number; rimR: number };
  magSize: { len: number };
};
type AX338Arm = HandRig;
export class AX338Animation {
  model!: AX338Model;
  root!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  actions!: Record<string, THREE.AnimationAction>;
  bolt!: THREE.Object3D;
  magazine!: THREE.Object3D;
  spare!: THREE.Object3D;
  magazineBody!: THREE.Object3D;
  magazineRound!: THREE.Object3D;
  spareRound!: THREE.Object3D;
  hands!: Record<HandSide, AuthoredHand>;
  rotationControls: THREE.Object3D[];
  poseQ = new THREE.Quaternion();
  poseMatrix!: THREE.Matrix4;
  idleTime = 0;
  name: string | null = null;
  fireTime!: number;
  constructor(model: AX338Model) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
    const node = (name: string): THREE.Object3D => requiredNode(this.root, name);
    this.bolt = node('bolt');
    this.magazine = node('magazine');
    this.spare = node('magazine_spare');
    this.magazineBody = node('magazine_mesh');
    this.magazineRound = node('magazine_round');
    this.spareRound = node('magazine_spare_round');
    this.hands = discoverAuthoredHands(node);
    this.rotationControls = [this.root, this.bolt, node('trigger'), this.magazine, this.spare];
    for (const hand of Object.values(this.hands)) {
      this.rotationControls.push(hand.wrist, ...hand.thumb);
      for (const finger of hand.fingers) this.rotationControls.push(finger.root, ...finger.joints);
    }
    this.poseMatrix = this.root.matrix;
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildManifestClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
    sampleAuthoredAction(this, name, time);
    // Integer-encoded animation components are normalized individually by glTF,
    // not as a quaternion. Restore unit rotations before matrices/hand contacts.
    for (const control of this.rotationControls) control.quaternion.normalize();
    this.root.updateMatrix();
    this.poseQ.copy(this.root.quaternion);
    this.magazine.visible = this.magazine.scale.x > 0.5;
    this.spare.visible = this.spare.scale.x > 0.5;
  }

  fire(): void {
    this.fireTime = 0;
  }
  reset(): void {
    this.fireTime = Infinity;
    this._sample('Idle', 0);
  }

  update(
    dt: number,
    clipName: string,
    clipTime: number,
    empty: boolean,
    magazineLoaded = !empty
  ): void {
    this.idleTime += dt;
    this.fireTime += dt;
    const gesture = ALIASES[clipName];
    if (gesture) this._sample(gesture, clipTime);
    else if (this.fireTime < manifest.clips.Fire.duration)
      this._sample(empty ? 'Last_Shot' : 'Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % manifest.clips.Idle.duration);
    this.magazineRound.visible = magazineLoaded;
    this.spareRound.visible = this.spare.visible;
    // On interruption every channel is sampled from the complete Idle action.
    // No persistent scale/bolt state or duplicate casing is introduced here.
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: AX338Arm, right: AX338Arm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
