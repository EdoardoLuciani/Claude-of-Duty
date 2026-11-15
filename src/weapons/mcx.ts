import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/mcx-virtus/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/mcx-virtus/manifest.json' with { type: 'json' };
import { isSkinnedMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { disposeAuthoredMixer, MAGAZINE_ALIASES } from './authored-actions.ts';
import {
  authoredModel,
  requiredNode,
  type AuthoredModelData,
  type AuthoredNodes,
} from './authored-model.ts';
import { createAuthoredRig, sampleAuthoredPose } from './authored-rig.ts';
import { buildMagazineClips, type Clip } from './clips.ts';
import type { WeaponDef } from './defs.ts';
import { configureMCXFinishes } from './mcx-finishes.ts';
import type { WeaponAnimation } from './runtime-types.ts';

export const MCX_URL = '/models/weapons/mcx-virtus.runtime.glb';
const SHOT_START = 2 / 60;
export const MCX_EJECT_DELAY = 4 / 60 - SHOT_START;

// Source +X forward -> game -Z forward; retain the authored mechanical skin frame.
export function makeMCXModel(gltf: GLTF): MCXModel {
  const scene = new THREE.Group();
  scene.name = 'mcx-coordinate-frame';
  scene.rotation.y = Math.PI / 2;
  scene.position.set(0, 0.07, -0.14);
  scene.add(gltf.scene);
  // Finger controls are copied onto the game-basis shared arm rig. Rebase them
  // once, not per frame; wrists and geometry retain the MCX source frame.
  const inverse = scene.quaternion.clone().invert();
  const fingerControl = (name: string): boolean => /^[LR]_(finger_|thumb_)/.test(name);
  gltf.scene.traverse((object): void => {
    if (fingerControl(object.name))
      object.quaternion.premultiply(scene.quaternion).multiply(inverse);
  });
  for (const clip of gltf.animations)
    for (const track of clip.tracks) {
      if (!fingerControl(track.name) || !track.name.endsWith('.quaternion')) continue;
      const values = track.values.slice();
      track.values = values;
      for (let i = 0; i < values.length; i += 4) {
        const x = values[i];
        values[i] = values[i + 2];
        values[i + 2] = -x;
      }
    }
  const { root, opticMountRest, animations, point } = authoredModel(
    gltf,
    'MCX_RIG',
    ['Idle', 'Fire', ...Object.values(MAGAZINE_ALIASES)],
    manifest.clips,
    scene
  );
  const model = {
    id: 'mcx' as const,
    scene,
    root,
    opticMountRest,
    animations,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: [1, 0.35, 0.35] as [number, number, number],
      magSeat: { pos: point('SOCKET_magazine'), rot: [0, 0, 0] },
    },
    shell: { caseLen: 0.0348, rimR: 0.0048 },
    magSize: { len: 0.18 },
  };
  const converted = convertWeaponScene(
    scene,
    (original, material): void => {
      if (original.name === 'MCX | opaque finishes') configureMCXFinishes(material);
    },
    true
  );
  return { ...model, ...converted };
}

export async function loadMCX(renderer: Pick<Renderer, 'hasFeature'>): Promise<MCXModel> {
  return makeMCXModel(await loadWeaponGLTF(renderer, MCX_URL));
}

type MCXModel = AuthoredModelData<
  'mcx',
  AuthoredNodes & {
    magSeat: { pos: [number, number, number]; rot: number[] };
  }
> & {
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.right.grip;
  };
};

/** Native Blender wrists/fingers and mechanisms under shared movement/ADS/arm IK. */
export function createMCXAnimation(model: MCXModel, def: WeaponDef): WeaponAnimation {
  const rig = createAuthoredRig(model);
  const node = (name: string): THREE.Object3D => requiredNode(rig.root, name);
  const magazine = node('magazine');
  const spare = node('magazine_spare');
  const bolt = node('bolt');
  const boltBone = node('MECH_bolt');
  const frame = model.scene;
  frame.updateMatrix();
  const inverse = frame.quaternion.clone().invert();
  const speed = def.fireAnimationSpeed;
  if (speed === undefined) throw new Error('MCX: missing authored fire animation speed');
  const skeletons = new Set<THREE.Skeleton>();
  rig.root.traverse((object): void => {
    if (isSkinnedMesh(object)) skeletons.add(object.skeleton);
  });
  // Runtime FX owns independent casings; the source showcase casing stays hidden.
  node('spent_case').visible = false;
  const animation = {
    ...rig,
    clips(): Record<string, Clip> {
      return buildMagazineClips(MAGAZINE_ALIASES, manifest.clips);
    },
    _sample(name: string, time: number): void {
      sampleAuthoredPose(this, name, Math.fround(time));
      this.poseQ.premultiply(frame.quaternion).multiply(inverse);
      magazine.visible = magazine.scale.x > 0.5;
      spare.visible = spare.scale.x > 0.5;
    },
    handTarget(
      side: 'left' | 'right',
      position: THREE.Vector3,
      quaternion: THREE.Quaternion
    ): void {
      const hand = this.hands[side].wrist;
      position.copy(hand.position).applyMatrix4(this.root.matrix).applyMatrix4(frame.matrix);
      quaternion
        .copy(frame.quaternion)
        .multiply(this.root.quaternion)
        .multiply(hand.quaternion)
        .multiply(inverse);
    },
    fire(): void {
      this.fireTime = SHOT_START;
    },
    reset(): void {
      this.fireTime = Infinity;
      this._sample('Idle', 0);
      bolt.position.x = 0;
      boltBone.position.x = 0;
    },
    update(dt: number, clipName: string | null, clipTime: number, empty: boolean): void {
      this.fireTime += dt * speed;
      const gesture = clipName === null ? undefined : MAGAZINE_ALIASES[clipName];
      if (gesture) this._sample(gesture, clipTime);
      else if (this.fireTime < manifest.clips.Fire.duration) this._sample('Fire', this.fireTime);
      else this._sample('Idle', 0);
      if (empty && !gesture && this.fireTime >= 7 / 60) {
        bolt.position.x = -0.068;
        boltBone.position.x = bolt.position.x;
      }
      frame.updateMatrixWorld(true);
    },
    dispose(): void {
      disposeAuthoredMixer(this);
      for (const skeleton of skeletons) skeleton.dispose();
      disposeWeaponMaterials(model);
    },
  };
  animation.reset();
  return animation;
}
