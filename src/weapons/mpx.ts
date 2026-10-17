import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import handReference from '../../assets/weapons/sig-mpx/hand-reference.json' with { type: 'json' };
import manifest from '../../assets/weapons/sig-mpx/manifest.json' with { type: 'json' };
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
import { buildManifestClips, type Clip } from './clips.ts';

export const MPX_URL = new URL('../../assets/weapons/sig-mpx/mpx.glb', import.meta.url).href;
export const MPX_EJECT_DELAY = 0.025;
const ALIASES: Record<string, string> = {
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
  draw: 'Draw',
  holster: 'Holster',
};
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeMPXModel(gltf: GLTF) {
  const scene = gltf.scene;
  // Source remains +X-forward for reproducible photo/DCC review. Normalize
  // the full native hierarchy and curves once; no extra runtime orientation rig.
  const basis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const inverse = basis.clone().invert(),
    geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((o) => {
    o.position.applyQuaternion(basis);
    o.quaternion.premultiply(basis).multiply(inverse);
    const x = o.scale.x;
    o.scale.x = o.scale.z;
    o.scale.z = x;
    if (o instanceof THREE.Mesh) {
      const mesh = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
      if (!geometries.has(mesh.geometry)) {
        mesh.geometry.applyQuaternion(basis);
        geometries.add(mesh.geometry);
      }
    }
    o.updateMatrix();
  });
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
  const { root, animations, point } = authoredModel(gltf, 'MPX_RIG', REQUIRED, scene);
  const model = {
    id: 'smg',
    label: 'SIG MPX',
    scene,
    root,
    animations,
    reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight: point('SOCKET_sight'),
      ejectDir: [0.82, 0.52, 0.24],
      gripR: handReference.grips.right,
      gripL: handReference.grips.left,
      magSeat: { pos: point('SOCKET_magazine'), rot: [0, 0, 0] },
      opticGlass: {
        center: point('SOCKET_sight'),
        apertureR: 0.01,
        windowW: 0.018,
        windowH: 0.018,
        // Six-pixel minimum diameter makes the 2 MOA dot easier to see without a halo or ring.
        reticle: 'dot',
        dotMoa: 2,
        minDotPixels: 6,
        dotOpacity: 0.9,
      },
    },
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    magSize: { len: 0.192 },
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>(),
  };
  const converted = convertWeaponScene(scene, (source, material) => {
    // Keep authored reflectance; only optical sheets/interior have view-pass policies.
    if (source.name.startsWith('11 |') || source.name.startsWith('12 |')) {
      // World colour is already behind the separate weapon pass. Use one
      // faint coating per optical sheet, not a foggy stack of solid discs or
      // transmission sampling a viewmodel-only render target.
      material.transparent = true;
      material.opacity = source.name.startsWith('11 |') ? 0.02 : 0.01;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
      material.forceSinglePass = true;
      material.transmission = 0;
      material.specularIntensity = 0.03;
      material.envMapIntensity = 0.05;
    } else if (source.name.startsWith('15 |')) {
      // Absorptive interior coating, not the reflective exterior alloy.
      material.specularIntensity = 0.02;
      material.envMapIntensity = 0.03;
    }
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  model.materials = converted.materials;
  model.textures = converted.textures;
  return model;
}

export async function loadMPX() {
  return makeMPXModel(await new GLTFLoader().loadAsync(MPX_URL));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
type MPXModel = ReturnType<typeof makeMPXModel>;
type MPXArm = HandRig;
export class MPXAnimation {
  model!: MPXModel;
  root!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  actions!: Record<string, THREE.AnimationAction>;
  bolt!: THREE.Object3D;
  boltRest!: THREE.Vector3;
  poseMatrix!: THREE.Matrix4;
  magazine!: THREE.Object3D;
  spare!: THREE.Object3D;
  magazineBody!: THREE.Object3D;
  rounds!: THREE.Object3D;
  hands!: Record<HandSide, AuthoredHand>;
  poseQ!: THREE.Quaternion;
  idleTime!: number;
  name!: string | null;
  fireTime!: number;
  constructor(model: MPXModel) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
    const node = (name: string) => requiredNode(this.root, name);
    this.bolt = node('bolt');
    this.boltRest = this.bolt.position.clone();
    this.poseMatrix = this.root.matrix;
    this.magazine = node('magazine');
    this.spare = node('magazine_spare');
    this.magazineBody = node('magazine_mesh');
    this.rounds = node('magazine_rounds');
    this.hands = discoverAuthoredHands(node);
    this.poseQ = new THREE.Quaternion();
    this.idleTime = 0;
    this.name = null;
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildManifestClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
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
    // Lockback survives idle/inspect/draw/switch; empty reload owns release.
    if (empty && gesture !== 'Reload_Empty' && this.fireTime >= MPX_EJECT_DELAY) {
      this.bolt.position.copy(this.boltRest);
      this.bolt.position.z += 0.038;
    }
    this.rounds.visible = magazineLoaded && this.rounds.scale.x > 0.5;
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: MPXArm, right: MPXArm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
