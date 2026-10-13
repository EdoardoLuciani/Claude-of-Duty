import * as THREE from 'three';
import { createAuthoredActions, sampleAuthoredAction } from './authored-actions.ts';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/p320-compact/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/p320-compact/hand-reference.json' with { type: 'json' };
import { Clip } from './clips.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { applyAuthoredHand, authoredHandTarget, discoverAuthoredHands, type AuthoredHand, type HandRig, type HandSide } from './authored-hands.ts';

export const P320_URL = new URL('../../assets/weapons/p320-compact/p320-compact.glb', import.meta.url).href;
export const P320_EJECT_DELAY = 2 / 60;
const ALIASES: Record<string, string> = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

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
  const converted = convertWeaponScene(scene, (_source, material) => {
    for (const value of Object.values(material as object)) {
      if (value instanceof THREE.Texture) value.anisotropy = 8;
    }
  });
  model.materials = converted.materials;
  model.textures = converted.textures;
  return model;
}

export async function loadP320() {
  return makeP320Model(await new GLTFLoader().loadAsync(P320_URL));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
type P320Model = ReturnType<typeof makeP320Model>;
type P320Arm = HandRig;
export class P320Animation {
  model!: P320Model; root!: THREE.Object3D; mixer!: THREE.AnimationMixer; actions!: Record<string, THREE.AnimationAction>;
  slide!: THREE.Object3D; barrel!: THREE.Object3D; slideRest!: THREE.Vector3; barrelRest!: THREE.Vector3; magazine!: THREE.Object3D; spare!: THREE.Object3D; magazineRound!: THREE.Object3D;
  hands!: Record<HandSide, AuthoredHand>; poseQ!: THREE.Quaternion; idleTime!: number; name!: string | null; fireTime!: number;
  constructor(model: P320Model) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = createAuthoredActions(this.mixer, model.animations);
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
    this.hands = discoverAuthoredHands(node);
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
    sampleAuthoredAction(this, name, time);
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
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: P320Arm, right: P320Arm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
