import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/p320-compact/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/p320-compact/hand-reference.json' with { type: 'json' };
import { Clip } from './clips.ts';
import { createWeaponMaterial } from './asset-material.js';

export const P320_URL = new URL('../../assets/weapons/p320-compact/p320-compact.glb', import.meta.url).href;
export const P320_EJECT_DELAY = 2 / 60;
const ALIASES: Record<string, string> = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];
function isCloseableImage(value: unknown): value is ImageBitmap {
  return typeof value === 'object' && value !== null && 'close' in value && typeof value.close === 'function';
}

export function makeP320Model(gltf: GLTF) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('P320_RIG');
  if (!root) throw new Error('[p320] missing P320_RIG');
  const animations = REQUIRED.map((name: string) => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`[p320] missing ${name} clip`);
    return clip;
  });
  const point = (name: string): [number, number, number] => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`[p320] missing ${name}`);
    const p = node.getWorldPosition(new THREE.Vector3());
    return [p.x, p.y, p.z];
  };
  const model = {
    id: 'pistol', label: 'P320 Compact', scene, root, animations,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'), eject: point('SOCKET_ejection'), sight: point('SOCKET_sight'),
      ejectDir: [.82, .52, .24], gripR: handReference.grips.right, gripL: handReference.grips.left,
      magSeat: { pos: [0, -.04, .025], rot: [0, 0, 0] },
    },
    shell: { caseLen: .0192, rimR: .00478 }, magSize: { len: .09 },
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
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) {
        value.anisotropy = 8;
        model.textures.add(value);
      }
      model.materials.add(mat); replacements.set(source, mat);
    }
    o.material = mat;
    o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true;
  });
  for (const source of replacements.keys()) source.dispose();
  return model;
}

export async function loadP320() {
  return makeP320Model(await new GLTFLoader().loadAsync(P320_URL));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
type P320Model = ReturnType<typeof makeP320Model>;
interface P320Hand { wrist: THREE.Object3D; fingers: { root: THREE.Object3D; joints: THREE.Object3D[] }[]; thumb: THREE.Object3D[] }
interface P320Arm { fingers: { root: THREE.Object3D; joints: THREE.Object3D[] }[]; thumb: { root: THREE.Object3D; joints: THREE.Object3D[] }; updateFlex(): void }
type HandSide = 'left' | 'right';
export class P320Animation {
  model!: P320Model; root!: THREE.Object3D; mixer!: THREE.AnimationMixer; actions!: Record<string, THREE.AnimationAction>;
  slide!: THREE.Object3D; barrel!: THREE.Object3D; slideRest!: THREE.Vector3; barrelRest!: THREE.Vector3; magazine!: THREE.Object3D; spare!: THREE.Object3D; magazineRound!: THREE.Object3D;
  hands!: Record<HandSide, P320Hand>; poseQ!: THREE.Quaternion; idleTime!: number; name!: string | null; fireTime!: number;
  constructor(model: P320Model) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of model.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      this.actions[clip.name] = action;
    }
    const node = (name: string): THREE.Object3D => {
      const o = this.root.getObjectByName(name);
      if (!o) throw new Error(`[p320] missing ${name}`);
      return o;
    };
    this.slide = node('slide'); this.barrel = node('barrel');
    this.slideRest = this.slide.position.clone();
    this.barrelRest = this.barrel.position.clone();
    this.magazine = node('magazine'); this.spare = node('magazine_spare');
    this.magazineRound = node('magazine_round');
    this.hands = {} as Record<HandSide, P320Hand>;
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
    this.poseQ = new THREE.Quaternion();
    this.idleTime = 0; this.name = null;
    this.reset();
  }

  clips(): Record<string, Clip> {
    const clips: Record<string, Clip> = {};
    for (const [name, source] of Object.entries(ALIASES)) {
      const info = manifest.clips[source as keyof typeof manifest.clips];
      const events = name.startsWith('reload') ? [{ t: 0, name: 'start' }] : [];
      for (const ev of info.events) {
        const event = ({ magazine_out: 'magout', magazine_in: 'magin', bolt_forward: 'boltrelease' } as Record<string, string>)[ev.event];
        if (event) events.push({ t: ev.time, name: event });
      }
      events.push({ t: info.duration - .0001, name: 'end' });
      clips[name] = new Clip(name, info.duration, { events });
    }
    return clips;
  }

  _sample(name: string, time: number): void {
    if (name !== this.name) {
      if (this.name) this.actions[this.name].stop();
      this.actions[name].reset().play();
      this.name = name;
    }
    const action = this.actions[name];
    action.paused = false;
    action.time = Math.min(time, action.getClip().duration);
    this.mixer.update(0);
    this.root.updateMatrix(); this.poseQ.copy(this.root.quaternion);
    this.magazine.visible = this.magazine.scale.x > .5;
    this.spare.visible = this.spare.scale.x > .5;
  }

  fire(): void { this.fireTime = 0; }
  reset(): void { this.fireTime = Infinity; this._sample('Idle', 0); }

  update(dt: number, clipName: string, clipTime: number, empty: boolean, magazineLoaded = !empty): void {
    this.idleTime += dt; this.fireTime += dt;
    const gesture = ALIASES[clipName];
    if (gesture) this._sample(gesture, clipTime);
    else if (this.fireTime < manifest.clips.Fire.duration) this._sample(empty ? 'Last_Shot' : 'Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % manifest.clips.Idle.duration);
    // Persist lockback during idle/inspect/draw too, not just the fire clip.
    // Reload_Empty already owns its opening and timed slide-release motion.
    if (empty && gesture !== 'Reload_Empty' && this.fireTime >= 2 / 60) {
      this.slide.position.copy(this.slideRest); this.slide.position.z += .027;
      this.barrel.position.copy(this.barrelRest); this.barrel.position.z += .004;
      this.barrel.rotation.x = THREE.MathUtils.degToRad(3.5);
    }
    this.magazineRound.visible = magazineLoaded;
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    const wrist = this.hands[side].wrist;
    pos.copy(wrist.position).applyMatrix4(this.root.matrix);
    q.copy(this.root.quaternion).multiply(wrist.quaternion);
  }

  applyHands(left: P320Arm, right: P320Arm): void {
    this._applyHand(left, this.hands.left);
    this._applyHand(right, this.hands.right);
  }

  _applyHand(arm: P320Arm, authored: P320Hand): void {
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
