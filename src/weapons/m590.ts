import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import handReference from '../../assets/weapons/m590/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/m590/manifest.json' with { type: 'json' };
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

export const M590_URL = new URL('../../assets/weapons/m590/m590.glb', import.meta.url).href;
const ALIASES: Record<string, string> = manifest.aliases;

export function makeM590Model(gltf: GLTF) {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(
    gltf,
    'M590_RIG',
    ['Idle', ...Object.values(ALIASES)],
    scene
  );
  const converted = convertWeaponScene(scene, (_source, material) => {
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  return {
    id: 'shotgun',
    label: 'M-590',
    fxClass: manifest.fxClass,
    scene,
    root,
    animations,
    reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: manifest.ejectionDirection,
      gripR: handReference.grips.right,
      gripL: handReference.grips.left,
      // Legacy below-mouth helper, not a detachable magazine or hull control.
      magSeat: { pos: [0, -0.039, -0.068], rot: [1.2, 0, 0] },
      opticGlass: null,
    },
    shell: manifest.shell,
    magSize: { len: manifest.shell.caseLen },
    ...converted,
  };
}

export async function loadM590() {
  return makeM590Model(await new GLTFLoader().loadAsync(M590_URL));
}

/** Provisional native 89 mm pump travel belongs to the asset, not the adapter.
 * Clip supplies event time; one mixer samples mechanisms and shared hand controls. */
export class M590Animation {
  model: ReturnType<typeof makeM590Model>;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  shellInsert: THREE.Object3D;
  poseMatrix: THREE.Matrix4;
  hands: Record<HandSide, AuthoredHand>;
  poseQ = new THREE.Quaternion();
  idleTime = 0;
  name: string | null = null;

  constructor(model: ReturnType<typeof makeM590Model>) {
    this.model = model;
    this.root = model.root;
    this.poseMatrix = this.root.matrix;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
    const node = (name: string) => requiredNode(this.root, name);
    this.shellInsert = node('shell_insert');
    this.hands = discoverAuthoredHands(node);
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildManifestClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
    sampleAuthoredAction(this, name, time);
    this.root.updateMatrix();
    this.poseQ.copy(this.root.quaternion);
    // STEP scale is the sole visibility source; never join shared mag hide/drop paths.
    this.shellInsert.visible = this.shellInsert.scale.x > 0.5;
    this.root.updateMatrixWorld(true);
  }

  fire(): void {} // Reactive recoil and the gameplay Pump clip own discharge.
  reset(): void {
    this.idleTime = 0;
    this._sample('Idle', 0);
  }

  update(dt: number, clipName: string | null, clipTime: number): void {
    this.idleTime += dt;
    const gesture = clipName ? ALIASES[clipName] : undefined;
    this._sample(
      gesture ?? 'Idle',
      gesture ? clipTime : this.idleTime % manifest.clips.Idle.duration
    );
  }

  handTarget(side: HandSide, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], position, quaternion);
  }

  applyHands(left: HandRig, right: HandRig): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.reset();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
