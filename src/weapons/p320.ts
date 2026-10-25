import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import handReference from '../../assets/weapons/p320-compact/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/p320-compact/manifest.json' with { type: 'json' };
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
import { buildMagazineClips, type Clip } from './clips.ts';

export const P320_URL = new URL(
  '../../assets/weapons/p320-compact/p320-compact.glb',
  import.meta.url
).href;
export const P320_EJECT_DELAY = 2 / 60;
const ALIASES: Record<string, string> = {
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
  draw: 'Draw',
  holster: 'Holster',
};
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeP320Model(gltf: GLTF): P320Model {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(gltf, 'P320_RIG', REQUIRED, scene);
  const model = {
    id: 'pistol',
    label: 'P320 Compact',
    scene,
    root,
    animations,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: [0.82, 0.52, 0.24],
      gripR: handReference.grips.right,
      gripL: handReference.grips.left,
      magSeat: { pos: [0, -0.04, 0.025], rot: [0, 0, 0] },
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: 0.09 },
  };
  const converted = convertWeaponScene(scene, (_source, material): void => {
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  return { ...model, ...converted };
}

export async function loadP320(): Promise<P320Model> {
  return makeP320Model(await new GLTFLoader().loadAsync(P320_URL));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
type P320Model = {
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  id: string;
  label: string;
  scene: THREE.Group;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.left.grip;
  };
  nodes: {
    muzzle: [number, number, number];
    eject: [number, number, number];
    sight: [number, number, number];
    ejectDir: number[];
    gripR: { pos: number[]; finger: number[]; back: number[] };
    gripL: { pos: number[]; finger: number[]; back: number[] };
    magSeat: { pos: number[]; rot: number[] };
  };
  shell: { caseLen: number; rimR: number };
  magSize: { len: number };
};
type P320Arm = HandRig;
export class P320Animation {
  model!: P320Model;
  root!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  actions!: Record<string, THREE.AnimationAction>;
  slide!: THREE.Object3D;
  barrel!: THREE.Object3D;
  slideRest!: THREE.Vector3;
  barrelRest!: THREE.Vector3;
  magazine!: THREE.Object3D;
  spare!: THREE.Object3D;
  magazineRound!: THREE.Object3D;
  hands!: Record<HandSide, AuthoredHand>;
  poseQ = new THREE.Quaternion();
  idleTime = 0;
  name: string | null = null;
  fireTime!: number;
  constructor(model: P320Model) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
    const node = (name: string): THREE.Object3D => requiredNode(this.root, name);
    this.slide = node('slide');
    this.barrel = node('barrel');
    this.slideRest = this.slide.position.clone();
    this.barrelRest = this.barrel.position.clone();
    this.magazine = node('magazine');
    this.spare = node('magazine_spare');
    this.magazineRound = node('magazine_round');
    this.hands = discoverAuthoredHands(node);
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildMagazineClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
    sampleAuthoredAction(this, name, time);
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
    // Persist lockback during idle/inspect/draw too, not just the fire clip.
    // Reload_Empty already owns its opening and timed slide-release motion.
    if (empty && gesture !== 'Reload_Empty' && this.fireTime >= 2 / 60) {
      this.slide.position.copy(this.slideRest);
      this.slide.position.z += 0.027;
      this.barrel.position.copy(this.barrelRest);
      this.barrel.position.z += 0.004;
      this.barrel.rotation.x = THREE.MathUtils.degToRad(3.5);
    }
    this.magazineRound.visible = magazineLoaded;
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: P320Arm, right: P320Arm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
