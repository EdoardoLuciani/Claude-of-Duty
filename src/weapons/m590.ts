import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/m590/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/m590/manifest.json' with { type: 'json' };
import { isSkinnedMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { disposeAuthoredMixer } from './authored-actions.ts';
import {
  authoredModel,
  requiredNode,
  type AuthoredModelData,
  type AuthoredNodes,
} from './authored-model.ts';
import { createAuthoredRig, sampleAuthoredPose } from './authored-rig.ts';
import { buildManifestClips, type Clip } from './clips.ts';
import type { WeaponAnimation } from './runtime-types.ts';

type M590Model = AuthoredModelData<
  'shotgun',
  AuthoredNodes & {
    opticGlass: null;
  }
> & {
  label: string;
  fxClass: string;
  reactiveFire: boolean;
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.right.grip;
  };
};

export const M590_URL = '/models/weapons/m590.runtime.glb';
const ALIASES: Record<string, string> = manifest.aliases;

export function makeM590Model(gltf: GLTF): M590Model {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(
    gltf,
    'M590_RIG',
    ['Idle', ...Object.values(ALIASES)],
    manifest.clips,
    scene
  );
  const converted = convertWeaponScene(scene, (_source, material): void => {
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

export async function loadM590(renderer: Pick<Renderer, 'hasFeature'>): Promise<M590Model> {
  return makeM590Model(await loadWeaponGLTF(renderer, M590_URL));
}

/** Provisional native 89 mm pump travel belongs to the asset, not the adapter.
 * Clip supplies event time; one mixer samples mechanisms and shared hand controls. */
export function createM590Animation(model: M590Model): WeaponAnimation {
  const rig = createAuthoredRig(model);
  const skeletons = new Set<THREE.Skeleton>();
  const node = (name: string): THREE.Object3D => requiredNode(rig.root, name);
  const shellInsert = node('shell_insert');
  rig.root.traverse((object): void => {
    if (isSkinnedMesh(object)) skeletons.add(object.skeleton);
  });

  const animation = {
    ...rig,
    clips(): Record<string, Clip> {
      return buildManifestClips(ALIASES, manifest.clips);
    },

    _sample(name: string, time: number): void {
      sampleAuthoredPose(this, name, time);
      // STEP scale is the sole visibility source; never join shared mag hide/drop paths.
      shellInsert.visible = shellInsert.scale.x > 0.5;
      this.root.updateMatrixWorld(true);
    },

    fire(): void {}, // Reactive recoil and the gameplay Pump clip own discharge.

    update(_dt: number, clipName: string | null, clipTime: number): void {
      const gesture = clipName ? ALIASES[clipName] : undefined;
      this._sample(gesture ?? 'Idle', gesture ? clipTime : 0);
    },

    dispose(): void {
      this.reset();
      disposeAuthoredMixer(this);
      for (const skeleton of skeletons) skeleton.dispose();
      skeletons.clear();
      disposeWeaponMaterials(this.model);
    },
  };
  animation.reset();
  return animation;
}
