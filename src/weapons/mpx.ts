import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene } from './asset-material.ts';
import { sampleAuthoredFire, MAGAZINE_ALIASES } from './authored-actions.ts';
import {
  authoredModel,
  rebaseNativeWeapon,
  requiredNode,
  type AuthoredModelData,
} from './authored-model.ts';
import { createAuthoredRig, sampleAuthoredPose } from './authored-rig.ts';
import handReference from './authored/sig-mpx/hand-reference.json' with { type: 'json' };
import manifest from './authored/sig-mpx/manifest.json' with { type: 'json' };
import { buildManifestClips, type Clip } from './clips.ts';
import type { WeaponAnimation } from './runtime-types.ts';

const MPX_URL = 'models/weapons/mpx.runtime.glb';
const EJECT_DELAY = 0.025;
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(MAGAZINE_ALIASES)];

export function makeMPXModel(gltf: GLTF): MPXModel {
  // Source remains +X-forward for reproducible photo/DCC review.
  rebaseNativeWeapon(gltf);
  const scene = gltf.scene;
  const { root, opticMountRest, animations, point } = authoredModel(
    gltf,
    'MPX_RIG',
    REQUIRED,
    manifest.clips
  );
  const model = {
    id: 'smg' as const,
    label: 'SIG MPX',
    scene,
    root,
    opticMountRest,
    animations,
    reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      sight: point('SOCKET_sight'),
      ejectDir: [0.82, 0.52, 0.24],
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: 0.192 },
  };
  const converted = convertWeaponScene(scene, (_source, material): void => {
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  return { ...model, ...converted };
}

export async function loadMPX(renderer: Pick<Renderer, 'hasFeature'>): Promise<MPXModel> {
  return makeMPXModel(await loadWeaponGLTF(renderer, MPX_URL));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
type MPXModel = AuthoredModelData<'smg'> & {
  label: string;
  reactiveFire: boolean;
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.right.grip;
  };
};
export function createMPXAnimation(model: MPXModel): WeaponAnimation {
  const rig = createAuthoredRig(model);
  const node = (name: string): THREE.Object3D => requiredNode(rig.root, name);
  const bolt = node('bolt');
  const magazine = node('magazine');
  const spare = node('magazine_spare');
  const magazineBody = node('magazine_mesh');
  const rounds = node('magazine_rounds');
  // Inspection may clone a live reload/lockback pose, not the authored rest pose.
  const boltRest = new THREE.Vector3();

  const animation = {
    ...rig,
    magazineBody,
    ejectDelay: EJECT_DELAY,
    clips(): Record<string, Clip> {
      return buildManifestClips(MAGAZINE_ALIASES, manifest.clips);
    },

    _sample(name: string, time: number): void {
      sampleAuthoredPose(this, name, time);
      magazine.visible = magazine.scale.x > 0.5;
      spare.visible = spare.scale.x > 0.5;
    },

    reset(): void {
      this.fireTime = Infinity;
      this._sample('Idle', 0);
      // Mixer caches cannot observe our out-of-band lockback override.
      bolt.position.copy(boltRest);
      this.root.updateMatrixWorld(true);
    },

    update(
      dt: number,
      clipName: string,
      clipTime: number,
      empty: boolean,
      magazineLoaded = !empty
    ): void {
      const gesture = sampleAuthoredFire(this, manifest.clips, dt, clipName, clipTime, empty);
      // Lockback survives idle/inspect/draw/switch; empty reload owns release.
      if (empty && gesture !== 'Reload_Empty' && this.fireTime >= EJECT_DELAY) {
        bolt.position.copy(boltRest);
        bolt.position.z += 0.038;
      }
      rounds.visible = magazineLoaded && rounds.scale.x > 0.5;
      this.root.updateMatrixWorld(true);
    },
  };
  animation._sample('Idle', 0);
  boltRest.copy(bolt.position);
  animation.reset();
  return animation;
}
