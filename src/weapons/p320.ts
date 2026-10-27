import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { Renderer } from 'three/webgpu';

import handReference from '../../assets/weapons/p320-compact/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/p320-compact/manifest.json' with { type: 'json' };
import { isSkinnedMesh } from '../core/three-guards.ts';
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
import { buildMagazineClips, type Clip } from './clips.ts';

export const P320_URL = new URL(
  '../../assets/weapons/p320-compact/p320-compact.runtime.glb',
  import.meta.url
).href;
export const P320_EJECT_DELAY = 2 / 60;
const ALIASES: Record<string, string> = {
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
  draw: 'Draw',
  holster: 'Holster',
};
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeP320Model(gltf: GLTF): P320Model {
  const scene = gltf.scene;
  const { root, animations, point } = authoredModel(gltf, 'P320_RIG', REQUIRED, scene);
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
  const decoder = new KTX2Loader().setWorkerLimit(2);
  // Our strict native Renderer has no isWebGPURenderer flag. Use the public
  // worker config rather than detectSupport()'s WebGL renderer branch.
  decoder.workerConfig = {
    astcSupported: renderer.hasFeature('texture-compression-astc'),
    bptcSupported: renderer.hasFeature('texture-compression-bc'),
    astcHDRSupported: false,
    etc1Supported: false,
    etc2Supported: false,
    dxtSupported: false,
    pvrtcSupported: false,
  };
  // GLTFLoader converts image failures to null textures; retain their original cause.
  let textureFailed = false;
  let textureFailure: unknown;
  const loadTexture = decoder.load.bind(decoder);
  decoder.load = (source, onLoad, onProgress, onError): void => {
    loadTexture(source, onLoad, onProgress, (error): void => {
      if (!textureFailed) {
        textureFailed = true;
        textureFailure = error;
      }
      onError?.(error);
    });
  };
  // UASTC data maps fall back to RGBA when ASTC/BC7 are unavailable, avoiding
  // lower-quality transcoding of normal/ORM channels into color-only formats.
  try {
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(decoder)
      .loadAsync(url);
    await decoder.transcoderPending;
    if (textureFailed) throw textureFailure;
    return makeP320Model(gltf);
  } finally {
    // PNG diagnostic loads never initialize the decoder or increment its count.
    if (decoder.transcoderPending) {
      // Prevent late worker-URL creation; preserve any load/initialization error.
      await decoder.transcoderPending.catch((): void => {});
      decoder.dispose();
    }
  }
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
type P320Model = {
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  id: 'pistol';
  label: string;
  scene: THREE.Group;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  handPoses: {
    left: typeof handReference.sides.left.grip;
    right: typeof handReference.sides.left.grip;
  };
  nodes: {
    muzzle: [number, number, number];
    eject: [number, number, number];
    sight: [number, number, number];
    ejectDir: number[];
    gripR: { pos: number[]; finger: number[]; back: number[] };
    gripL: { pos: number[]; finger: number[]; back: number[] };
    magSeat: { pos: number[]; rot: number[] };
  };
  shell: { caseLen: number; rimR: number };
  magSize: { len: number };
};
type P320Arm = HandRig;
export class P320Animation {
  model!: P320Model;
  root!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  actions!: Record<string, THREE.AnimationAction>;
  slide!: THREE.Object3D;
  barrel!: THREE.Object3D;
  slideRest!: THREE.Vector3;
  barrelRest!: THREE.Vector3;
  magazine!: THREE.Object3D;
  spare!: THREE.Object3D;
  magazineRound!: THREE.Object3D;
  skin!: THREE.SkinnedMesh;
  hands!: Record<HandSide, AuthoredHand>;
  poseQ = new THREE.Quaternion();
  private magazineRoundAuthoredScale = new THREE.Vector3();
  private magazineRoundScaleOverridden = false;
  idleTime = 0;
  name: string | null = null;
  fireTime!: number;
  constructor(model: P320Model) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
    const node = (name: string): THREE.Object3D => requiredNode(this.root, name);
    this.slide = node('slide');
    this.barrel = node('barrel');
    this.slideRest = this.slide.position.clone();
    this.barrelRest = this.barrel.position.clone();
    this.magazine = node('magazine');
    this.spare = node('magazine_spare');
    this.magazineRound = node('magazine_round');
    const skin = node('P320_surface');
    if (!isSkinnedMesh(skin)) throw new Error('P320: missing mechanical skin');
    this.skin = skin;
    this.hands = discoverAuthoredHands(node);
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildMagazineClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
    // PropertyMixer skips unchanged constant channels. Undo our visibility
    // override before sampling so authored hidden/visible scales stay authoritative.
    if (this.magazineRoundScaleOverridden) {
      this.magazineRound.scale.copy(this.magazineRoundAuthoredScale);
      this.magazineRoundScaleOverridden = false;
    }
    sampleAuthoredAction(this, name, time);
    this.root.updateMatrix();
    this.poseQ.copy(this.root.quaternion);
    this.magazine.visible = this.magazine.scale.x > 0.5;
    this.spare.visible = this.spare.scale.x > 0.5;
  }

  fire(): void {
    this.fireTime = 0;
  }
  reset(): void {
    this.fireTime = Infinity;
    this._sample('Idle', 0);
  }

  update(
    dt: number,
    clipName: string,
    clipTime: number,
    empty: boolean,
    magazineLoaded = !empty
  ): void {
    this.idleTime += dt;
    this.fireTime += dt;
    const gesture = ALIASES[clipName];
    if (gesture) this._sample(gesture, clipTime);
    else if (this.fireTime < manifest.clips.Fire.duration)
      this._sample(empty ? 'Last_Shot' : 'Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % manifest.clips.Idle.duration);
    // Persist lockback during idle/inspect/draw too, not just the fire clip.
    // Reload_Empty already owns its opening and timed slide-release motion.
    if (empty && gesture !== 'Reload_Empty' && this.fireTime >= 2 / 60) {
      this.slide.position.copy(this.slideRest);
      this.slide.position.z += 0.027;
      this.barrel.position.copy(this.barrelRest);
      this.barrel.position.z += 0.004;
      this.barrel.rotation.x = THREE.MathUtils.degToRad(3.5);
    }
    this.magazineRound.visible = magazineLoaded;
    // Bone visibility does not hide its weighted vertices. Preserve the native
    // scale before collapsing the cartridge, then restore it in _sample().
    if (!magazineLoaded) {
      this.magazineRoundAuthoredScale.copy(this.magazineRound.scale);
      this.magazineRound.scale.setScalar(0);
      this.magazineRoundScaleOverridden = true;
    }
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: P320Arm, right: P320Arm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.skin.skeleton.dispose();
    disposeWeaponMaterials(this.model);
  }
}
