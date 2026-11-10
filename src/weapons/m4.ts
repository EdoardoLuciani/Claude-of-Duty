import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/m4a1-block-ii/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/m4a1-block-ii/manifest.json' with { type: 'json' };
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
import { configureM4Finishes } from './m4-finishes.ts';
import type { WeaponAnimation } from './runtime-types.ts';

export const M4_URL = '/models/weapons/m4a1-block-ii.runtime.glb';
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(MAGAZINE_ALIASES)];

export function makeM4Model(gltf: GLTF): M4Model {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(gltf, 'M4_RIG', REQUIRED, manifest.clips);
  const model = {
    id: 'rifle' as const,
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
  const converted = convertWeaponScene(scene, (_source, material): void => {
    configureM4Finishes(material);
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  return { ...model, ...converted };
}

export async function loadM4(renderer: Pick<Renderer, 'hasFeature'>): Promise<M4Model> {
  return makeM4Model(await loadWeaponGLTF(renderer, M4_URL));
}

/** Blender owns mechanisms and wrist/finger choreography; the existing recoil,
 * shared arm skin, upper/forearm IK and ammunition/event system remain in charge. */
type M4Model = AuthoredModelData<
  'rifle',
  AuthoredNodes & {
    triggerPivot: { pos: [number, number, number]; rot: number[] };
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
export function createM4Animation(model: M4Model): WeaponAnimation {
  const rig = createAuthoredRig(model);
  const node = (name: string): THREE.Object3D => requiredNode(rig.root, name);
  const bolt = node('bolt');
  const boltRest = bolt.position.clone();
  const boltHead = node('bolt_head');
  const unlockedHead = boltHead.quaternion
    .clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 8));
  const cover = node('dust_cover');
  const openCover = cover.quaternion
    .clone()
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(-115)
      )
    );
  const magazine = node('magazine');
  const spare = node('magazine_spare');
  const magazineBody = node('magazine_mesh');
  const magazineRound = node('magazine_round');
  const spareRound = node('magazine_spare_round');
  // The editable scene previews ejection. Runtime keeps the existing single
  // physical casing at its original scheduled event, never a duplicate mesh.
  const reviewCase = node('spent_case');
  let wasOpen: boolean | undefined;
  let coverOpen = false;
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
      reviewCase.visible = false;
    },

    fire(): void {
      wasOpen = coverOpen;
      coverOpen = true;
      this.fireTime = 0;
    },

    update(
      dt: number,
      clipName: string,
      clipTime: number,
      empty: boolean,
      magazineLoaded = !empty
    ): void {
      const gesture = sampleAuthoredFire(this, manifest.clips, dt, clipName, clipTime, empty);
      if (empty && gesture !== 'Reload_Empty' && this.fireTime >= 0.0465) {
        bolt.position.copy(boltRest);
        bolt.position.z += 0.062;
        boltHead.quaternion.copy(unlockedHead);
      }
      // The cover opens on the first shot and stays open; it must not snap shut
      // every automatic cycle, inspect or weapon switch.
      if (coverOpen && (gesture || wasOpen || this.fireTime >= 0.018))
        cover.quaternion.copy(openCover);
      magazineRound.visible = magazineLoaded;
      spareRound.visible = spare.visible;
      this.root.updateMatrixWorld(true);
    },
  };
  animation.reset();
  return animation;
}
