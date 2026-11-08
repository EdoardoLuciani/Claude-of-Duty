import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/ax338/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/ax338/manifest.json' with { type: 'json' };
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene } from './asset-material.ts';
import { sampleAuthoredAction, sampleAuthoredFire, MAGAZINE_ALIASES } from './authored-actions.ts';
import {
  authoredModel,
  requiredNode,
  type AuthoredModelData,
  type AuthoredNodes,
} from './authored-model.ts';
import { createAuthoredRig } from './authored-rig.ts';
import { buildManifestClips, type Clip } from './clips.ts';
import type { WeaponAnimation } from './runtime-types.ts';

export const AX338_URL = '/models/weapons/ax338.runtime.glb';
const ALIASES = { ...MAGAZINE_ALIASES, cycle: 'Bolt_Cycle' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeAX338Model(gltf: GLTF): AX338Model {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(gltf, 'AX338_RIG', REQUIRED, scene);
  // glTF infers duration from keys; gltfpack folds the wholly constant Idle to
  // t=0. Restore only that authored hold, never normalize moving clip timing.
  const idle = animations.find((clip): boolean => clip.name === 'Idle');
  if (
    idle?.duration === 0 &&
    idle.tracks.length > 0 &&
    idle.tracks.every((track): boolean => track.times.length === 1 && track.times[0] === 0)
  )
    idle.duration = manifest.clips.Idle.duration;
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
type AX338Model = AuthoredModelData<
  'sniper',
  AuthoredNodes & {
    magSeat: { pos: [number, number, number]; rot: number[] };
    triggerPivot: { pos: [number, number, number]; rot: number[] };
    opticGlass: { kind: string; center: [number, number, number]; reticle: string };
    handguard: { axis: number[]; dir: number[]; r: number; z0: number; z1: number };
  }
> & {
  label: string;
  reactiveFire: boolean;
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.right.grip;
  };
};
export function createAX338Animation(model: AX338Model): WeaponAnimation {
  const rig = createAuthoredRig(model);
  const node = (name: string): THREE.Object3D => requiredNode(rig.root, name);
  const bolt = node('bolt');
  const magazine = node('magazine');
  const spare = node('magazine_spare');
  const magazineBody = node('magazine_mesh');
  const magazineRound = node('magazine_round');
  const spareRound = node('magazine_spare_round');
  const rotationControls = [rig.root, bolt, node('trigger'), magazine, spare];
  for (const hand of Object.values(rig.hands)) {
    rotationControls.push(hand.wrist, ...hand.thumb);
    for (const finger of hand.fingers) rotationControls.push(finger.root, ...finger.joints);
  }

  const animation = {
    ...rig,
    magazineBody,
    clips(): Record<string, Clip> {
      return buildManifestClips(ALIASES, manifest.clips);
    },

    _sample(name: string, time: number): void {
      sampleAuthoredAction(this, name, time);
      // Integer-encoded animation components are normalized individually by glTF,
      // not as a quaternion. Restore unit rotations before matrices/hand contacts.
      for (const control of rotationControls) control.quaternion.normalize();
      this.root.updateMatrix();
      this.poseQ.copy(this.root.quaternion);
      magazine.visible = magazine.scale.x > 0.5;
      spare.visible = spare.scale.x > 0.5;
    },

    update(
      dt: number,
      clipName: string,
      clipTime: number,
      empty: boolean,
      magazineLoaded = !empty
    ): void {
      sampleAuthoredFire(this, manifest.clips, dt, clipName, clipTime, empty, ALIASES);
      magazineRound.visible = magazineLoaded;
      spareRound.visible = spare.visible;
      // On interruption every channel is sampled from the complete Idle action.
      // No persistent scale/bolt state or duplicate casing is introduced here.
      this.root.updateMatrixWorld(true);
    },
  };
  animation.reset();
  return animation;
}
