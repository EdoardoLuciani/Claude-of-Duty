import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import handReference from '../../assets/weapons/m4a1-block-ii/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/m4a1-block-ii/manifest.json' with { type: 'json' };
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

export const M4_URL = new URL(
  '../../assets/weapons/m4a1-block-ii/m4a1-block-ii.glb',
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

export function makeM4Model(gltf: GLTF) {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(gltf, 'M4_RIG', REQUIRED, scene);
  const model = {
    id: 'rifle',
    label: 'M4A1',
    scene,
    root,
    animations,
    reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: [0.86, 0.44, 0.26],
      gripR: handReference.grips.right,
      gripL: handReference.grips.left,
      magSeat: { pos: [0, 0.054, -0.078], rot: [0, 0, 0] },
      triggerPivot: { pos: point('trigger'), rot: [0, 0, 0] },
      handguard: { axis: [0, 0.075, 0], dir: [0, 0, 1], r: 0.0286, z0: -0.133, z1: -0.44415 },
    },
    shell: { caseLen: 0.0447, rimR: 0.00478 },
    magSize: { len: 0.16 },
  };
  const converted = convertWeaponScene(scene, (_source, material) => {
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  return { ...model, ...converted };
}

export async function loadM4() {
  return makeM4Model(await new GLTFLoader().loadAsync(M4_URL));
}

/** Blender owns mechanisms and wrist/finger choreography; the existing recoil,
 * shared arm skin, upper/forearm IK and ammunition/event system remain in charge. */
type M4Model = ReturnType<typeof makeM4Model>;
type M4Arm = HandRig;
export class M4Animation {
  model!: M4Model;
  root!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  actions!: Record<string, THREE.AnimationAction>;
  bolt!: THREE.Object3D;
  boltRest!: THREE.Vector3;
  boltHead!: THREE.Object3D;
  unlockedHead!: THREE.Quaternion;
  cover!: THREE.Object3D;
  openCover!: THREE.Quaternion;
  magazine!: THREE.Object3D;
  spare!: THREE.Object3D;
  magazineBody!: THREE.Object3D;
  magazineRound!: THREE.Object3D;
  spareRound!: THREE.Object3D;
  reviewCase!: THREE.Object3D;
  hands!: Record<HandSide, AuthoredHand>;
  poseQ = new THREE.Quaternion();
  poseMatrix!: THREE.Matrix4;
  idleTime = 0;
  name: string | null = null;
  coverOpen!: boolean;
  wasOpen!: boolean;
  fireTime!: number;
  constructor(model: M4Model) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
    const node = (name: string) => requiredNode(this.root, name);
    this.bolt = node('bolt');
    this.boltRest = this.bolt.position.clone();
    this.boltHead = node('bolt_head');
    this.unlockedHead = this.boltHead.quaternion
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 8));
    this.cover = node('dust_cover');
    this.openCover = this.cover.quaternion
      .clone()
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          THREE.MathUtils.degToRad(-115)
        )
      );
    this.magazine = node('magazine');
    this.spare = node('magazine_spare');
    this.magazineBody = node('magazine_mesh');
    this.magazineRound = node('magazine_round');
    this.spareRound = node('magazine_spare_round');
    // The editable scene previews ejection. Runtime keeps the existing single
    // physical casing at its original scheduled event, never a duplicate mesh.
    this.reviewCase = node('spent_case');
    this.hands = discoverAuthoredHands(node);
    this.poseMatrix = this.root.matrix;
    this.coverOpen = false;
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildManifestClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
    sampleAuthoredAction(this, name, time);
    this.root.updateMatrix();
    this.poseQ.copy(this.root.quaternion);
    this.magazine.visible = this.magazine.scale.x > 0.5;
    this.spare.visible = this.spare.scale.x > 0.5;
    this.reviewCase.visible = false;
  }

  fire(): void {
    this.wasOpen = this.coverOpen;
    this.coverOpen = true;
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
    if (empty && gesture !== 'Reload_Empty' && this.fireTime >= 0.0465) {
      this.bolt.position.copy(this.boltRest);
      this.bolt.position.z += 0.062;
      this.boltHead.quaternion.copy(this.unlockedHead);
    }
    // The cover opens on the first shot and stays open; it must not snap shut
    // every automatic cycle, inspect or weapon switch.
    if (this.coverOpen && (gesture || this.wasOpen || this.fireTime >= 0.018))
      this.cover.quaternion.copy(this.openCover);
    this.magazineRound.visible = magazineLoaded;
    this.spareRound.visible = this.spare.visible;
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: M4Arm, right: M4Arm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
