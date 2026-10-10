import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/fn-evolys-762/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/fn-evolys-762/hand-reference.json' with { type: 'json' };
import { Clip } from './clips.ts';
import { createWeaponMaterial } from './asset-material.ts';

export const EVOLYS_URL = new URL('../../assets/weapons/fn-evolys-762/fn-evolys-762.glb', import.meta.url).href;
const ALIASES: Record<string, string> = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];
function isCloseableImage(value: unknown): value is ImageBitmap {
  return typeof value === 'object' && value !== null && 'close' in value && typeof value.close === 'function';
}

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
  const replacements = new Map();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const o = object;
    const source = o.material;
    let mat = replacements.get(source);
    if (!mat) {
      mat = createWeaponMaterial(source);
      if (source.name.startsWith('10 |')) {
        mat.transparent = true; mat.opacity = .13; mat.depthWrite = false; mat.side = THREE.DoubleSide;
      }
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) {
        value.anisotropy = 8; model.textures.add(value);
      }
      model.materials.add(mat); replacements.set(source, mat);
    }
    o.material = mat; o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true;
  });
  for (const source of replacements.keys()) source.dispose();
  return model;
}

export async function loadEvolys() {
  return makeEvolysModel(await new GLTFLoader().loadAsync(EVOLYS_URL));
}

/** Native Blender mechanism/belt/hand tracks, under shared ADS/sway/recoil.
 * Only ammunition-tail visibility is runtime-driven. No per-shot belt objects,
 * new textures, duplicate cases, frame allocations or second animation rig. */
type EvolysModel = ReturnType<typeof makeEvolysModel>;
interface EvolysHand { wrist: THREE.Object3D; fingers: { root: THREE.Object3D; joints: THREE.Object3D[] }[]; thumb: THREE.Object3D[] }
interface EvolysArm { fingers: { root: THREE.Object3D; joints: THREE.Object3D[] }[]; thumb: { root: THREE.Object3D; joints: THREE.Object3D[] }; updateFlex(): void }
type HandSide = 'left' | 'right';
export class EvolysAnimation {
  model!: EvolysModel; root!: THREE.Object3D; mixer!: THREE.AnimationMixer; actions!: Record<string, THREE.AnimationAction>;
  pouch!: THREE.Object3D; spare!: THREE.Object3D; cover!: THREE.Object3D; bolt!: THREE.Object3D; charging!: THREE.Object3D; belt!: THREE.Object3D; bones!: THREE.Object3D[];
  hands!: Record<HandSide, EvolysHand>; poseQ!: THREE.Quaternion; poseMatrix!: THREE.Matrix4; idleTime!: number; name!: string | null; remainingRounds!: number; fireTime!: number;
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
    this.hands = {} as Record<HandSide, EvolysHand>;
    for (const [side, prefix] of [['left', 'L'], ['right', 'R']] as const) {
      this.hands[side] = {
        wrist: node(`hand_${prefix}`),
        fingers: Array.from({ length: 4 }, (_, i) => ({
          root: node(`${prefix}_finger_${i}_root`),
          joints: Array.from({ length: 3 }, (_, j) => node(`${prefix}_finger_${i}_${j}`)),
        })),
        thumb: ['thumb_base', 'thumb_0', 'thumb_1'].map(name => node(`${prefix}_${name}`)),
      };
    }
    this.poseQ = new THREE.Quaternion(); this.poseMatrix = this.root.matrix;
    this.idleTime = 0; this.name = null; this.remainingRounds = 100;
    this.reset();
  }

  clips(): Record<string, Clip> {
    const clips: Record<string, Clip> = {};
    for (const [name, source] of Object.entries(ALIASES)) {
      const info = manifest.clips[source as keyof typeof manifest.clips];
      clips[name] = new Clip(name, info.duration, { events: info.events.map((ev) => ({ t: ev.time, name: ev.event })) });
    }
    return clips;
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
    const wrist = this.hands[side].wrist;
    pos.copy(wrist.position).applyMatrix4(this.root.matrix);
    q.copy(this.root.quaternion).multiply(wrist.quaternion);
  }

  applyHands(left: EvolysArm, right: EvolysArm): void {
    this._applyHand(left, this.hands.left); this._applyHand(right, this.hands.right);
  }

  _applyHand(arm: EvolysArm, authored: EvolysHand): void {
    for (let i = 0; i < 4; i++) {
      arm.fingers[i].root.quaternion.copy(authored.fingers[i].root.quaternion);
      for (let j = 0; j < 3; j++) arm.fingers[i].joints[j].quaternion.copy(authored.fingers[i].joints[j].quaternion);
    }
    arm.thumb.root.quaternion.copy(authored.thumb[0].quaternion);
    for (let j = 0; j < 2; j++) arm.thumb.joints[j].quaternion.copy(authored.thumb[j + 1].quaternion);
    arm.updateFlex();
  }

  dispose(): void {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    for (const m of this.model.materials) m.dispose();
    const images = new Set<ImageBitmap>();
    for (const t of this.model.textures) { if (isCloseableImage(t.source?.data)) images.add(t.source.data); t.dispose(); }
    for (const image of images) image.close();
    this.model.materials.clear(); this.model.textures.clear();
  }
}
