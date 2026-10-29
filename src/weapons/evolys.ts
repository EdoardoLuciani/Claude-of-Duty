import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import handReference from '../../assets/weapons/fn-evolys-762/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/fn-evolys-762/manifest.json' with { type: 'json' };
import { hasOwn } from '../core/guards.ts';
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

export const EVOLYS_URL = new URL(
  '../../assets/weapons/fn-evolys-762/fn-evolys-762.glb',
  import.meta.url
).href;
const ALIASES: Record<string, string> = {
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
  draw: 'Draw',
  holster: 'Holster',
};
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeEvolysModel(gltf: GLTF): EvolysModel {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(gltf, 'EVOLYS_RIG', REQUIRED, scene);
  // gltfpack retains constant channels but reduces their keys to t=0. Idle is
  // entirely constant, so recover its authored duration from the weapon source.
  for (const clip of animations) {
    if (
      clip.name === 'Idle' &&
      clip.duration === 0 &&
      clip.tracks.length > 0 &&
      clip.tracks.every((track): boolean => track.times.length === 1 && track.times[0] === 0)
    )
      clip.duration = Math.fround(manifest.clips.Idle.duration);
  }
  const sight = point('SOCKET_sight');
  const model = {
    id: 'lmg' as const,
    label: 'EVOLYS-7.62',
    scene,
    root,
    animations,
    reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight,
      ejectDir: [0.86, 0.44, 0.26],
      gripR: handReference.grips.right,
      gripL: handReference.grips.left,
      magSeat: { pos: point('SOCKET_pouch'), rot: [0, 0, 0] },
      triggerPivot: { pos: point('trigger'), rot: [0, 0, 0] },
      handguard: { axis: [0, 0.075, 0], dir: [0, 0, 1], r: 0.027, z0: -0.23, z1: -0.4 },
      opticGlass: {
        center: sight,
        apertureR: 0.0055,
        windowW: 0.0098,
        windowH: 0.0058,
        // Size the RMR aiming dot against the world, not the enlarged weapon window.
        reticle: 'dot',
        dotMoa: 3.25,
        minDotPixels: 5,
        dotOpacity: 0.9,
      },
    },
    shell: { caseLen: 0.051, rimR: 0.005975 },
    magSize: { len: 0.125 },
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

export async function loadEvolys(): Promise<EvolysModel> {
  return makeEvolysModel(await new GLTFLoader().loadAsync(EVOLYS_URL));
}

/** Native Blender mechanism/belt/hand tracks, under shared ADS/sway/recoil.
 * Only ammunition-tail visibility is runtime-driven. No per-shot belt objects,
 * new textures, duplicate cases, frame allocations or second animation rig. */
type EvolysModel = {
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  id: 'lmg';
  label: string;
  scene: THREE.Group;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  reactiveFire: boolean;
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
    magSeat: { pos: [number, number, number]; rot: number[] };
    triggerPivot: { pos: [number, number, number]; rot: number[] };
    handguard: { axis: number[]; dir: number[]; r: number; z0: number; z1: number };
    opticGlass: {
      center: [number, number, number];
      apertureR: number;
      windowW: number;
      windowH: number;
      reticle: string;
      dotMoa: number;
      minDotPixels: number;
      dotOpacity: number;
    };
  };
  shell: { caseLen: number; rimR: number };
  magSize: { len: number };
};
type EvolysArm = HandRig;
export class EvolysAnimation {
  model!: EvolysModel;
  root!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  actions!: Record<string, THREE.AnimationAction>;
  pouch!: THREE.Object3D;
  spare!: THREE.Object3D;
  cover!: THREE.Object3D;
  bolt!: THREE.Object3D;
  charging!: THREE.Object3D;
  belt!: THREE.Object3D;
  bones!: THREE.Object3D[];
  hands!: Record<HandSide, AuthoredHand>;
  poseQ = new THREE.Quaternion();
  poseMatrix!: THREE.Matrix4;
  idleTime = 0;
  name: string | null = null;
  remainingRounds!: number;
  fireTime!: number;
  constructor(model: EvolysModel) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
    const node = (name: string): THREE.Object3D => requiredNode(this.root, name);
    this.pouch = node('pouch');
    this.spare = node('pouch_spare');
    this.cover = node('feed_cover');
    this.bolt = node('bolt');
    this.charging = node('charging_handle');
    this.belt = node('belt_mesh');
    this.bones = Array.from({ length: manifest.belt.rounds }, (_, i): THREE.Object3D =>
      node(`belt_${i}`)
    );
    this.hands = discoverAuthoredHands(node);
    this.poseMatrix = this.root.matrix;
    this.remainingRounds = 100;
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildManifestClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
    sampleAuthoredAction(this, name, time);
    this.root.updateMatrix();
    this.poseQ.copy(this.root.quaternion);
    this.pouch.visible = this.pouch.scale.x > 0.5;
    this.spare.visible = this.spare.scale.x > 0.5;
  }

  fire(): void {
    this.fireTime = 0;
  }
  reset(): void {
    this.fireTime = Infinity;
    this.idleTime = 0;
    this._sample('Idle', 0);
    this._beltVisibility(this.remainingRounds, false);
  }

  _beltVisibility(rounds: number, departing: boolean, loaded = true): void {
    const count = Math.min(this.bones.length, Math.max(0, rounds) + (departing ? 1 : 0));
    for (let i = 0; i < this.bones.length; i++) {
      // Explicitly restore scales: mixer caches constant native values and
      // cannot see our ammunition masks from the preceding frame.
      this.bones[i].scale.setScalar(loaded && i < count ? 1 : 0);
    }
    this.belt.visible = loaded && count > 0;
  }

  update(
    dt: number,
    clipName: string,
    clipTime: number,
    empty: boolean,
    magazineLoaded = !empty,
    remainingRounds = magazineLoaded ? 100 : 0
  ): void {
    this.remainingRounds = remainingRounds;
    this.idleTime += dt;
    this.fireTime += dt;
    const gesture = ALIASES[clipName];
    const firing = !gesture && this.fireTime < manifest.clips.Fire.duration;
    if (gesture) this._sample(gesture, clipTime);
    else if (firing) this._sample(empty ? 'Last_Shot' : 'Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % manifest.clips.Idle.duration);
    const info = gesture && hasOwn(manifest.clips, gesture) ? manifest.clips[gesture] : undefined;
    const clearTime =
      info && 'beltClearTime' in info && typeof info.beltClearTime === 'number'
        ? info.beltClearTime
        : undefined;
    const insertTime =
      info && 'beltInsertTime' in info && typeof info.beltInsertTime === 'number'
        ? info.beltInsertTime
        : undefined;
    const loaded =
      !clearTime || clipTime < clearTime || (insertTime !== undefined && clipTime >= insertTime);
    this._beltVisibility(remainingRounds, firing, loaded);
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: EvolysArm, right: EvolysArm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
