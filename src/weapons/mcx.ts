import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Renderer } from 'three/webgpu';

import manifest from '../../assets/weapons/mcx-virtus/manifest.json' with { type: 'json' };
import { isSkinnedMesh } from '../core/three-guards.ts';
import { loadWeaponGLTF } from './asset-loader.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { authoredModel } from './authored-model.ts';
import { buildEquipClips, buildMagazineClips } from './clips.ts';
import { smootherstep } from './mathx.ts';
import { configureMCXFinishes } from './mcx-finishes.ts';

export const MCX_URL = new URL(
  '../../assets/weapons/mcx-virtus/mcx-virtus.runtime.glb',
  import.meta.url
).href;
const ALIASES: Record<string, string> = {
  reloadTac: 'Reload_Tactical',
  reloadEmpty: 'Reload_Empty',
  inspect: 'Inspect',
};
const SHOT_START = 2 / 60;
export const MCX_EJECT_DELAY = 4 / 60 - SHOT_START;
const ONE = new THREE.Vector3(1, 1, 1);

// Authored +X forward/+Y up/+Z right -> game -Z forward/+Y up/+X right.
// Move the origin to the shooting-hand web, not the Blender chamber origin.
export function makeMCXModel(gltf: GLTF): MCXModel {
  const scene = new THREE.Group();
  scene.name = 'mcx-coordinate-frame';
  scene.rotation.y = Math.PI / 2;
  scene.position.set(0, 0.07, -0.14);
  scene.add(gltf.scene);
  const { root, animations, point } = authoredModel(
    gltf,
    'MCX_RIG',
    ['Idle', 'Fire', ...Object.values(ALIASES)],
    scene
  );
  const sight = point('SOCKET_sight');
  const model = {
    id: 'mcx' as const,
    scene,
    root,
    animations,
    nodes: {
      muzzle: point('SOCKET_muzzle'),
      eject: point('SOCKET_ejection'),
      sight,
      ejectDir: [1, 0.35, 0.35] as [number, number, number],
      // Wrist targets (not the palm-centred Blender sockets); same glove rig as M4.
      gripR: {
        pos: [0.0351, -0.012, 0.086] as [number, number, number],
        finger: [0.15, 0.35, -0.92] as [number, number, number],
        back: [1, 0.03, 0.04] as [number, number, number],
      },
      gripL: {
        pos: [-0.073, 0.04, -0.243] as [number, number, number],
        finger: [0.7, -0.1, -0.71] as [number, number, number],
        back: [-0.14, -0.985, 0.001] as [number, number, number],
      },
      handguard: {
        axis: [0, 0.07, 0] as [number, number, number],
        dir: [0, 0, 1] as [number, number, number],
        r: 0.026,
        z0: -0.185,
        z1: -0.3882,
      },
      magSeat: { pos: point('SOCKET_magazine'), rot: [0, 0, 0] },
      opticGlass: { kind: 'scope', reticle: 'chevron', center: sight, apertureR: 0.0137 },
    },
    shell: { caseLen: 0.0348, rimR: 0.0048 },
    magSize: { len: 0.18 },
  };
  // Keep authored PBR instead of remapping the Blender material names to the
  // procedural weapon library. Thin alpha lenses avoid a second full-scene
  // transmission pass; the gameplay scope supplies the magnified sight picture.
  const converted = convertWeaponScene(
    scene,
    (original, material): void => {
      // Intentional scope approximation, not exposure calibration: the gameplay
      // scope supplies the sight picture. Keep its established thin-alpha tint
      // instead of adding a second full-scene transmission pass.
      if (Number.parseInt(original.name, 10) === 11) {
        material.transmission = 0;
        material.color.setRGB(0.035, 0.075, 0.085);
        material.transparent = true;
        material.opacity = 0.1;
        material.depthWrite = false;
        material.metalness = 0;
        material.roughness = 0.12;
        material.specularIntensity = 0.25;
      } else if (original.name === 'MCX | opaque finishes') {
        configureMCXFinishes(material);
      }
    },
    true
  );
  return { ...model, ...converted };
}

export async function loadMCX(renderer: Pick<Renderer, 'hasFeature'>): Promise<MCXModel> {
  return makeMCXModel(await loadWeaponGLTF(renderer, MCX_URL));
}

function handQuaternion(
  finger: [number, number, number],
  back: [number, number, number]
): THREE.Quaternion {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back)
    .addScaledVector(z, -new THREE.Vector3(...back).dot(z))
    .normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Baked rigid-part animation under the shared movement/ADS/arm rig. */
type MCXModel = {
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  id: 'mcx';
  scene: THREE.Group;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
  nodes: {
    muzzle: [number, number, number];
    eject: [number, number, number];
    sight: [number, number, number];
    ejectDir: [number, number, number];
    gripR: {
      pos: [number, number, number];
      finger: [number, number, number];
      back: [number, number, number];
    };
    gripL: {
      pos: [number, number, number];
      finger: [number, number, number];
      back: [number, number, number];
    };
    handguard: {
      axis: [number, number, number];
      dir: [number, number, number];
      r: number;
      z0: number;
      z1: number;
    };
    magSeat: { pos: [number, number, number]; rot: number[] };
    opticGlass: {
      kind: string;
      reticle: string;
      center: [number, number, number];
      apertureR: number;
    };
  };
  shell: { caseLen: number; rimR: number };
  magSize: { len: number };
};
type MCXDefinition = Parameters<typeof buildEquipClips>[1];
export class MCXAnimation {
  model!: MCXModel;
  def!: MCXDefinition;
  fireSpeed!: number;
  root!: THREE.Object3D;
  frame!: THREE.Group;
  inverseFrame!: THREE.Matrix4;
  frameQ!: THREE.Quaternion;
  inverseQ!: THREE.Quaternion;
  mixer!: THREE.AnimationMixer;
  actions!: Record<string, THREE.AnimationAction>;
  magazine!: THREE.Object3D;
  spare!: THREE.Object3D;
  bolt!: THREE.Object3D;
  boltBone!: THREE.Object3D;
  private skeletons = new Set<THREE.Skeleton>();
  charging!: THREE.Object3D;
  poseMatrix!: THREE.Matrix4;
  poseQ = new THREE.Quaternion();
  partMatrix!: THREE.Matrix4;
  target!: THREE.Vector3;
  targetQ!: THREE.Quaternion;
  magPoint!: THREE.Vector3;
  chargePoint!: THREE.Vector3;
  magQ!: THREE.Quaternion;
  chargeQ!: THREE.Quaternion;
  idleTime = 0;
  name: string | null = null;
  fireTime!: number;
  gesture!: string | null;
  gestureTime!: number;
  constructor(model: MCXModel, def: MCXDefinition) {
    this.model = model;
    this.def = def;
    if (!('fireAnimationSpeed' in def) || typeof def.fireAnimationSpeed !== 'number')
      throw new Error('MCX: missing authored fire animation speed');
    this.fireSpeed = def.fireAnimationSpeed;
    this.root = model.root;
    this.frame = model.scene;
    this.frame.updateMatrix();
    this.inverseFrame = this.frame.matrix.clone().invert();
    this.frameQ = this.frame.quaternion.clone();
    this.inverseQ = this.frameQ.clone().invert();
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const source of model.animations) {
      // The single showcase casing must not replay under the gun on every
      // shot. Live fire emits independent .300 cases via the existing FX pool.
      const tracks = source.tracks.filter((t): boolean => !t.name.startsWith('spent_case.'));
      const clip = new THREE.AnimationClip(source.name, source.duration, tracks);
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      this.actions[source.name] = action;
    }
    this.magazine = this.root.getObjectByName('magazine')!;
    this.spare = this.root.getObjectByName('magazine_spare')!;
    this.bolt = this.root.getObjectByName('bolt')!;
    this.boltBone = this.root.getObjectByName('MECH_bolt')!;
    this.root.traverse((object): void => {
      if (isSkinnedMesh(object)) this.skeletons.add(object.skeleton);
    });
    this.charging = this.root.getObjectByName('charging_handle')!;
    this.root.getObjectByName('spent_case')!.visible = false;
    this.poseMatrix = new THREE.Matrix4();
    this.partMatrix = new THREE.Matrix4();
    this.target = new THREE.Vector3();
    this.targetQ = new THREE.Quaternion();
    // Fit-only contacts follow the revised magazine seat and OEM latch bow.
    this.magPoint = new THREE.Vector3(-0.007, -0.16, -0.039);
    this.chargePoint = new THREE.Vector3(-0.184, 0.02, -0.05);
    this.magQ = handQuaternion([0.1, 0.72, -0.68], [-0.86, 0.34, -0.38]);
    this.chargeQ = handQuaternion([0.55, 0.2, 0.81], [-0.2, 0.94, -0.27]);
    this.reset();
  }

  clips(): { [x: string]: import('./clips.ts').Clip } {
    return {
      ...buildEquipClips(this.model.nodes, this.def),
      ...buildMagazineClips(
        ALIASES,
        manifest.clips,
        (source): number => this.actions[source].getClip().duration
      ),
    };
  }

  _sample(name: string, time: number): void {
    if (this.name !== name) {
      if (this.name) this.actions[this.name].stop();
      this.actions[name].reset().play();
      this.name = name;
    }
    const action = this.actions[name];
    action.paused = false;
    action.time = Math.fround(Math.min(time, action.getClip().duration));
    this.mixer.update(0);
    this.root.updateMatrix();
    this.poseMatrix.copy(this.frame.matrix).multiply(this.root.matrix).multiply(this.inverseFrame);
    this.poseQ.copy(this.frameQ).multiply(this.root.quaternion).multiply(this.inverseQ);
    this.magazine.visible = this.magazine.scale.x > 0.5;
    this.spare.visible = this.spare.scale.x > 0.5;
  }

  fire(): void {
    this.fireTime = SHOT_START;
  }

  reset(): void {
    this.fireTime = Infinity;
    this.gesture = null;
    this.gestureTime = 0;
    this._sample('Idle', 0);
    // Mixer property caching may skip an unchanged Idle value after our
    // out-of-band empty-state override; reset both contact and visible skin.
    this.bolt.position.x = 0;
    this.boltBone.position.x = 0;
  }

  update(dt: number, clipName: string, clipTime: number, empty: boolean): void {
    this.idleTime += dt;
    this.fireTime += dt * this.fireSpeed;
    this.gesture = ALIASES[clipName] ? clipName : null;
    this.gestureTime = clipTime;
    if (this.gesture) this._sample(ALIASES[clipName], clipTime);
    else if (this.fireTime < this.actions.Fire.getClip().duration)
      this._sample('Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % this.actions.Idle.getClip().duration);
    if (empty && !this.gesture && this.fireTime >= 7 / 60) {
      this.bolt.position.x = -0.068;
      this.boltBone.position.x = this.bolt.position.x;
    }
    this.frame.updateMatrixWorld(true);
  }

  handTarget(side: 'left' | 'right', pos: THREE.Vector3, quat: THREE.Quaternion): void {
    pos.applyMatrix4(this.poseMatrix);
    quat.premultiply(this.poseQ);
    if (side !== 'left' || !this.gesture?.startsWith('reload')) return;
    const t = this.gestureTime;
    let part, point, baseQ, weight;
    if (this.gesture === 'reloadEmpty' && t > 2.0) {
      part = this.charging;
      point = this.chargePoint;
      baseQ = this.chargeQ;
      weight = smootherstep(2.02, 2.28, t) * (1 - smootherstep(2.7, 3.12, t));
    } else {
      part = t < 64 / 60 ? this.magazine : this.spare;
      point = this.magPoint;
      baseQ = this.magQ;
      weight = smootherstep(0.1, 0.32, t) * (1 - smootherstep(1.95, 2.35, t));
    }
    if (weight <= 0) return;
    // Ignore visibility scale during off-screen magazine handoffs: the wrist
    // follows a rigid part, never a collapsing zero-scale transform.
    this.partMatrix.compose(part.position, part.quaternion, ONE);
    this.target
      .copy(point)
      .applyMatrix4(this.partMatrix)
      .applyMatrix4(this.root.matrix)
      .applyMatrix4(this.frame.matrix);
    this.targetQ
      .copy(this.frameQ)
      .multiply(this.root.quaternion)
      .multiply(part.quaternion)
      .multiply(this.inverseQ)
      .multiply(baseQ);
    pos.lerp(this.target, weight);
    quat.slerp(this.targetQ, weight);
  }

  get leftPose(): 'pinch' | null {
    if (
      this.gesture?.startsWith('reload') &&
      this.gestureTime > 0.2 &&
      this.gestureTime < (this.gesture === 'reloadEmpty' ? 2.9 : 2.15)
    )
      return 'pinch';
    return null;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const skeleton of this.skeletons) skeleton.dispose();
    this.skeletons.clear();
    disposeWeaponMaterials(this.model);
  }
}
