import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/fn-evolys-762/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/fn-evolys-762/manifest.json' with { type: 'json' };
import { hasOwn } from '../core/guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { sampleAuthoredFire, MAGAZINE_ALIASES, disposeAuthoredMixer } from './authored-actions.ts';
import {
  authoredModel,
  requiredNode,
  type AuthoredModelData,
  type AuthoredNodes,
} from './authored-model.ts';
import { createAuthoredRig, sampleAuthoredPose } from './authored-rig.ts';
import { buildManifestClips, type Clip } from './clips.ts';
import type { WeaponAnimation } from './runtime-types.ts';

export const EVOLYS_URL = new URL(
  '../../assets/weapons/fn-evolys-762/fn-evolys-762.runtime.glb',
  import.meta.url
).href;
const ALIASES = MAGAZINE_ALIASES;
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

export async function loadEvolys(renderer: Pick<Renderer, 'hasFeature'>): Promise<EvolysModel> {
  return makeEvolysModel(await loadWeaponGLTF(renderer, EVOLYS_URL));
}

/** Native Blender mechanism/belt/hand tracks, under shared ADS/sway/recoil.
 * Only ammunition-tail visibility is runtime-driven. No per-shot belt objects,
 * new textures, duplicate cases, frame allocations or second animation rig. */
type EvolysModel = AuthoredModelData<
  'lmg',
  AuthoredNodes & {
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
  }
> & {
  label: string;
  reactiveFire: boolean;
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.right.grip;
  };
};
export function createEvolysAnimation(model: EvolysModel): WeaponAnimation {
  const rig = createAuthoredRig(model);
  const node = (name: string): THREE.Object3D => requiredNode(rig.root, name);
  const pouch = node('pouch');
  const spare = node('pouch_spare');
  node('feed_cover');
  node('bolt');
  node('charging_handle');
  const belt = node('belt_mesh');
  const bones = Array.from({ length: manifest.belt.rounds }, (_, i): THREE.Object3D =>
    node(`belt_${i}`)
  );
  let lastRounds = 100;
  const animation = {
    ...rig,
    clips(): Record<string, Clip> {
      return buildManifestClips(ALIASES, manifest.clips);
    },

    _sample(name: string, time: number): void {
      sampleAuthoredPose(this, name, time);
      pouch.visible = pouch.scale.x > 0.5;
      spare.visible = spare.scale.x > 0.5;
    },

    reset(): void {
      this.fireTime = Infinity;
      this.idleTime = 0;
      this._sample('Idle', 0);
      this._beltVisibility(lastRounds, false);
    },

    _beltVisibility(rounds: number, departing: boolean, loaded = true): void {
      const count = Math.min(bones.length, Math.max(0, rounds) + (departing ? 1 : 0));
      for (let i = 0; i < bones.length; i++) {
        // Explicitly restore scales: mixer caches constant native values and
        // cannot see our ammunition masks from the preceding frame.
        bones[i].scale.setScalar(loaded && i < count ? 1 : 0);
      }
      belt.visible = loaded && count > 0;
    },

    update(
      dt: number,
      clipName: string,
      clipTime: number,
      empty: boolean,
      magazineLoaded = !empty,
      remainingRounds = magazineLoaded ? 100 : 0
    ): void {
      lastRounds = remainingRounds;
      const gesture = sampleAuthoredFire(this, manifest.clips, dt, clipName, clipTime, empty);
      const firing = !gesture && this.fireTime < manifest.clips.Fire.duration;
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
    },

    dispose(): void {
      disposeAuthoredMixer(this);
      const skeletons = new Set<THREE.Skeleton>();
      this.root.traverse((node): void => {
        if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
      });
      for (const skeleton of skeletons) skeleton.dispose();
      disposeWeaponMaterials(this.model);
    },
  };
  animation.reset();
  return animation;
}
