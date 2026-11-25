import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import { disposeMaterials } from '../core/dispose-materials.ts';
import { isSkinnedMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene } from './asset-material.ts';
import { disposeAuthoredMixer, MAGAZINE_ALIASES } from './authored-actions.ts';
import {
  authoredModel,
  rebaseNativeWeapon,
  requiredNode,
  type AuthoredModelData,
} from './authored-model.ts';
import { createAuthoredRig, sampleAuthoredPose } from './authored-rig.ts';
import handReference from './authored/mcx-virtus/hand-reference.json' with { type: 'json' };
import manifest from './authored/mcx-virtus/manifest.json' with { type: 'json' };
import { buildMagazineClips, type Clip } from './clips.ts';
import type { WeaponDef } from './defs.ts';
import { configureMCXFinishes } from './mcx-finishes.ts';
import type { WeaponAnimation } from './runtime-types.ts';

const MCX_URL = 'models/weapons/mcx-virtus.runtime.glb';
const SHOT_START = 2 / 60;
const EJECT_DELAY = 4 / 60 - SHOT_START;

export function makeMCXModel(gltf: GLTF): MCXModel {
  // Source +X forward; the game origin is the shooting-hand web, not the chamber.
  rebaseNativeWeapon(gltf, manifest.runtime_origin);
  const scene = gltf.scene;
  const { root, opticMountRest, animations, point } = authoredModel(
    gltf,
    'MCX_RIG',
    ['Idle', 'Fire', ...Object.values(MAGAZINE_ALIASES)],
    manifest.clips
  );
  const model = {
    id: 'mcx' as const,
    scene,
    root,
    opticMountRest,
    animations,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      sight: point('SOCKET_sight'),
      ironSights: { troy: point('SOCKET_troy') },
      ejectDir: [1, 0.35, 0.35] as [number, number, number],
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

type MCXModel = AuthoredModelData<'mcx'> & {
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
    // Fire is sampled at `speed`, so the authored ejection beat arrives sooner.
    ejectDelay: EJECT_DELAY / speed,
    clips(): Record<string, Clip> {
      return buildMagazineClips(MAGAZINE_ALIASES, manifest.clips);
    },
    _sample(name: string, time: number): void {
      sampleAuthoredPose(this, name, Math.fround(time));
      magazine.visible = magazine.scale.x > 0.5;
      spare.visible = spare.scale.x > 0.5;
    },
    fire(): void {
      this.fireTime = SHOT_START;
    },
    reset(): void {
      this.fireTime = Infinity;
      this._sample('Idle', 0);
      bolt.position.z = 0;
      boltBone.position.z = 0;
    },
    update(dt: number, clipName: string | null, clipTime: number, empty: boolean): void {
      this.fireTime += dt * speed;
      const gesture = clipName === null ? undefined : MAGAZINE_ALIASES[clipName];
      if (gesture) this._sample(gesture, clipTime);
      else if (this.fireTime < manifest.clips.Fire.duration) this._sample('Fire', this.fireTime);
      else this._sample('Idle', 0);
      // Source -X lockback is game +Z after rebasing.
      if (empty && !gesture && this.fireTime >= 7 / 60) {
        bolt.position.z = 0.068;
        boltBone.position.z = bolt.position.z;
      }
      this.root.updateMatrixWorld(true);
    },
    dispose(): void {
      disposeAuthoredMixer(this);
      for (const skeleton of skeletons) skeleton.dispose();
      disposeMaterials(model);
    },
  };
  animation.reset();
  return animation;
}
