import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/fn-evolys-762/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/fn-evolys-762/hand-reference.json' with { type: 'json' };
import { buildManifestClips, type Clip } from './clips.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { applyAuthoredHand, authoredHandTarget, discoverAuthoredHands, type AuthoredHand, type HandRig, type HandSide } from './authored-hands.ts';

export const EVOLYS_URL = new URL('../../assets/weapons/fn-evolys-762/fn-evolys-762.glb', import.meta.url).href;
const ALIASES: Record<string, string> = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeEvolysModel(gltf: GLTF) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('EVOLYS_RIG');
  if (!root) throw new Error('[evolys] missing EVOLYS_RIG');
  const animations = REQUIRED.map((name: string) => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`[evolys] missing ${name}`);
    return clip;
  });
  const point = (name: string): [number, number, number] => {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`[evolys] missing ${name}`);
    const p = o.getWorldPosition(new THREE.Vector3());
    return [p.x, p.y, p.z];
  };
  const sight = point('SOCKET_sight');
  const model = {
    id: 'lmg', label: 'EVOLYS-7.62', scene, root, animations, reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'), eject: point('SOCKET_ejection'), sight,
      ejectDir: [.86, .44, .26], gripR: handReference.grips.right, gripL: handReference.grips.left,
      magSeat: { pos: point('SOCKET_pouch'), rot: [0, 0, 0] },
      triggerPivot: { pos: point('trigger'), rot: [0, 0, 0] },
      handguard: { axis: [0, .075, 0], dir: [0, 0, 1], r: .027, z0: -.230, z1: -.400 },
      opticGlass: { center: sight, apertureR: .0055, windowW: .0098, windowH: .0058 },
    },
    shell: { caseLen: .051, rimR: .005975 }, magSize: { len: .125 },
    materials: new Set<THREE.Material>(), textures: new Set<THREE.Texture>(),
  };
  const converted = convertWeaponScene(scene, (source, material) => {
    if (source.name.startsWith('10 |')) {
      material.transparent = true; material.opacity = .13; material.depthWrite = false; material.side = THREE.DoubleSide;
    }
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  model.materials = converted.materials;
  model.textures = converted.textures;
  return model;
}

export async function loadEvolys() {
  return makeEvolysModel(await new GLTFLoader().loadAsync(EVOLYS_URL));
}

/** Native Blender mechanism/belt/hand tracks, under shared ADS/sway/recoil.
 * Only ammunition-tail visibility is runtime-driven. No per-shot belt objects,
 * new textures, duplicate cases, frame allocations or second animation rig. */
type EvolysModel = ReturnType<typeof makeEvolysModel>;
type EvolysArm = HandRig;
export class EvolysAnimation {
  model!: EvolysModel; root!: THREE.Object3D; mixer!: THREE.AnimationMixer; actions!: Record<string, THREE.AnimationAction>;
  pouch!: THREE.Object3D; spare!: THREE.Object3D; cover!: THREE.Object3D; bolt!: THREE.Object3D; charging!: THREE.Object3D; belt!: THREE.Object3D; bones!: THREE.Object3D[];
  hands!: Record<HandSide, AuthoredHand>; poseQ!: THREE.Quaternion; poseMatrix!: THREE.Matrix4; idleTime!: number; name!: string | null; remainingRounds!: number; fireTime!: number;
  constructor(model: EvolysModel) {
    this.model = model; this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root); this.actions = {};
    for (const clip of model.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      this.actions[clip.name] = action;
    }
    const node = (name: string): THREE.Object3D => {
      const o = this.root.getObjectByName(name);
      if (!o) throw new Error(`[evolys] missing ${name}`);
      return o;
    };
    this.pouch = node('pouch'); this.spare = node('pouch_spare');
    this.cover = node('feed_cover'); this.bolt = node('bolt'); this.charging = node('charging_handle');
    this.belt = node('belt_mesh');
    this.bones = Array.from({ length: manifest.belt.rounds }, (_, i) => node(`belt_${i}`));
    this.hands = discoverAuthoredHands(node);
    this.poseQ = new THREE.Quaternion(); this.poseMatrix = this.root.matrix;
    this.idleTime = 0; this.name = null; this.remainingRounds = 100;
    this.reset();
  }

  clips(): Record<string, Clip> {
    return buildManifestClips(ALIASES, manifest.clips);
  }

  _sample(name: string, time: number): void {
    if (name !== this.name) {
      if (this.name) this.actions[this.name].stop();
      this.actions[name].reset().play(); this.name = name;
    }
    const action = this.actions[name];
    action.paused = false; action.time = Math.min(time, action.getClip().duration);
    this.mixer.update(0); this.root.updateMatrix(); this.poseQ.copy(this.root.quaternion);
    this.pouch.visible = this.pouch.scale.x > .5; this.spare.visible = this.spare.scale.x > .5;
  }

  fire(): void { this.fireTime = 0; }
  reset(): void {
    this.fireTime = Infinity; this.idleTime = 0; this._sample('Idle', 0);
    this._beltVisibility(this.remainingRounds, false);
  }

  _beltVisibility(rounds: number, departing: boolean, loaded = true): void {
    const count = Math.min(this.bones.length, Math.max(0, rounds) + (departing ? 1 : 0));
    for (let i = 0; i < this.bones.length; i++) {
      // Explicitly restore scales: mixer caches constant native values and
      // cannot see our ammunition masks from the preceding frame.
      this.bones[i].scale.setScalar(loaded && i < count ? 1 : 0);
    }
    this.belt.visible = loaded && count > 0;
  }

  update(dt: number, clipName: string, clipTime: number, empty: boolean, magazineLoaded = !empty, remainingRounds = magazineLoaded ? 100 : 0): void {
    this.remainingRounds = remainingRounds;
    this.idleTime += dt; this.fireTime += dt;
    const gesture = ALIASES[clipName];
    const firing = !gesture && this.fireTime < manifest.clips.Fire.duration;
    if (gesture) this._sample(gesture, clipTime);
    else if (firing) this._sample(empty ? 'Last_Shot' : 'Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % manifest.clips.Idle.duration);
    const info = gesture ? manifest.clips[gesture as keyof typeof manifest.clips] as { beltClearTime?: number; beltInsertTime?: number } : undefined;
    const loaded = !info?.beltClearTime || clipTime < info.beltClearTime
      || (info.beltInsertTime !== undefined && clipTime >= info.beltInsertTime);
    this._beltVisibility(remainingRounds, firing, loaded);
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: EvolysArm, right: EvolysArm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
