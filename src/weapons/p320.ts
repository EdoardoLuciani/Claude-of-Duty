import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/p320-compact/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/p320-compact/manifest.json' with { type: 'json' };
import { isSkinnedMesh } from '../core/three-guards.ts';
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
import { buildMagazineClips, type Clip } from './clips.ts';
import type { WeaponAnimation } from './runtime-types.ts';

export const P320_URL = '/models/weapons/p320-compact.runtime.glb';
export const P320_EJECT_DELAY = 2 / 60;
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(MAGAZINE_ALIASES)];

export function makeP320Model(gltf: GLTF): P320Model {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(
    gltf,
    'P320_RIG',
    REQUIRED,
    manifest.clips,
    scene
  );
  const model = {
    id: 'pistol' as const,
    label: 'P320 Compact',
    scene,
    root,
    animations,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: [0.82, 0.52, 0.24],
      gripR: handReference.grips.right,
      gripL: handReference.grips.left,
      magSeat: { pos: [0, -0.04, 0.025], rot: [0, 0, 0] },
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: 0.09 },
  };
  const converted = convertWeaponScene(scene, (_source, material): void => {
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  return { ...model, ...converted };
}

export async function loadP320(
  renderer: Pick<Renderer, 'hasFeature'>,
  url = P320_URL
): Promise<P320Model> {
  return makeP320Model(await loadWeaponGLTF(renderer, url));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
type P320Model = AuthoredModelData<'pistol', AuthoredNodes> & {
  label: string;
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.right.grip;
  };
};
export function createP320Animation(model: P320Model): WeaponAnimation {
  const rig = createAuthoredRig(model);
  const node = (name: string): THREE.Object3D => requiredNode(rig.root, name);
  const slide = node('slide');
  const barrel = node('barrel');
  const slideRest = slide.position.clone();
  const barrelRest = barrel.position.clone();
  const magazine = node('magazine');
  const spare = node('magazine_spare');
  const magazineRound = node('magazine_round');
  const skin = node('P320_surface');
  if (!isSkinnedMesh(skin)) throw new Error('P320: missing mechanical skin');
  const magazineRoundAuthoredScale = new THREE.Vector3();
  let magazineRoundScaleOverridden = false;
  const animation = {
    ...rig,
    clips(): Record<string, Clip> {
      return buildMagazineClips(MAGAZINE_ALIASES, manifest.clips);
    },

    _sample(name: string, time: number): void {
      // PropertyMixer skips unchanged constant channels. Undo our visibility
      // override before sampling so authored hidden/visible scales stay authoritative.
      if (magazineRoundScaleOverridden) {
        magazineRound.scale.copy(magazineRoundAuthoredScale);
        magazineRoundScaleOverridden = false;
      }
      sampleAuthoredPose(this, name, time);
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
      const gesture = sampleAuthoredFire(this, manifest.clips, dt, clipName, clipTime, empty);
      // Persist lockback during idle/inspect/draw too, not just the fire clip.
      // Reload_Empty already owns its opening and timed slide-release motion.
      if (empty && gesture !== 'Reload_Empty' && this.fireTime >= 2 / 60) {
        slide.position.copy(slideRest);
        slide.position.z += 0.027;
        barrel.position.copy(barrelRest);
        barrel.position.z += 0.004;
        barrel.rotation.x = THREE.MathUtils.degToRad(3.5);
      }
      magazineRound.visible = magazineLoaded;
      // Bone visibility does not hide its weighted vertices. Preserve the native
      // scale before collapsing the cartridge, then restore it in _sample().
      if (!magazineLoaded) {
        magazineRoundAuthoredScale.copy(magazineRound.scale);
        magazineRound.scale.setScalar(0);
        magazineRoundScaleOverridden = true;
      }
      this.root.updateMatrixWorld(true);
    },

    dispose(): void {
      disposeAuthoredMixer(this);
      skin.skeleton.dispose();
      disposeWeaponMaterials(this.model);
    },
  };
  animation.reset();
  return animation;
}
