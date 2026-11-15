import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/sig-mpx/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/sig-mpx/manifest.json' with { type: 'json' };
import { isMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene } from './asset-material.ts';
import { sampleAuthoredFire, MAGAZINE_ALIASES } from './authored-actions.ts';
import {
  authoredModel,
  requiredNode,
  type AuthoredModelData,
  type AuthoredNodes,
} from './authored-model.ts';
import { createAuthoredRig, sampleAuthoredPose } from './authored-rig.ts';
import { buildManifestClips, type Clip } from './clips.ts';
import type { WeaponAnimation } from './runtime-types.ts';

export const MPX_URL = '/models/weapons/mpx.runtime.glb';
export const MPX_EJECT_DELAY = 0.025;
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(MAGAZINE_ALIASES)];

export function makeMPXModel(gltf: GLTF): MPXModel {
  const scene = gltf.scene;
  // Source remains +X-forward for reproducible photo/DCC review. Normalize
  // the full native hierarchy and curves once; no extra runtime orientation rig.
  const basis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const inverse = basis.clone().invert(),
    geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((o): void => {
    o.position.applyQuaternion(basis);
    o.quaternion.premultiply(basis).multiply(inverse);
    const x = o.scale.x;
    o.scale.x = o.scale.z;
    o.scale.z = x;
    if (isMesh(o)) {
      const mesh = o;
      if (!geometries.has(mesh.geometry)) {
        mesh.geometry.applyQuaternion(basis);
        geometries.add(mesh.geometry);
      }
    }
    o.updateMatrix();
  });
  // Geometry/control locals were rebased above; attachment locals are shared
  // canonical assets, not MPX geometry. Preserve that frame at the slot boundary.
  for (const name of ['MOUNT_optic', 'MOUNT_muzzle', 'MOUNT_rail']) {
    const mount = scene.getObjectByName(name);
    if (mount) {
      mount.quaternion.multiply(basis);
      mount.updateMatrix();
    }
  }
  for (const clip of gltf.animations)
    for (const track of clip.tracks) {
      // GLTFLoader shares accessor arrays across clips/constant controls. Never
      // transform that shared storage repeatedly (it rotates idle hands twice).
      const v = track.values.slice(),
        width = track.getValueSize();
      track.values = v;
      const scaleTrack = track.name.endsWith('.scale');
      if (scaleTrack || track.name.endsWith('.position') || track.name.endsWith('.quaternion')) {
        for (let i = 0; i < v.length; i += width) {
          const x = v[i];
          v[i] = v[i + 2];
          v[i + 2] = scaleTrack ? x : -x;
        }
      }
    }
  const { root, opticMountRest, animations, point } = authoredModel(
    gltf,
    'MPX_RIG',
    REQUIRED,
    manifest.clips,
    scene
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
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: [0.82, 0.52, 0.24],
      magSeat: { pos: point('SOCKET_magazine'), rot: [0, 0, 0] },
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
type MPXModel = AuthoredModelData<
  'smg',
  AuthoredNodes & {
    magSeat: { pos: [number, number, number]; rot: number[] };
  }
> & {
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
      if (empty && gesture !== 'Reload_Empty' && this.fireTime >= MPX_EJECT_DELAY) {
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
