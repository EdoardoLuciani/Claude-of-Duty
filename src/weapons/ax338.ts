import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/ax338/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/ax338/hand-reference.json' with { type: 'json' };
import { buildManifestClips, type Clip } from './clips.ts';
import { convertWeaponScene, disposeWeaponMaterials } from './asset-material.ts';
import { applyAuthoredHand, authoredHandTarget, discoverAuthoredHands, type AuthoredHand, type HandRig, type HandSide } from './authored-hands.ts';

export const AX338_URL = new URL('../../assets/weapons/ax338/ax338.glb', import.meta.url).href;
const ALIASES: Record<string, string> = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster', cycle: 'Bolt_Cycle' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeAX338Model(gltf: GLTF) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('AX338_RIG');
  if (!root) throw new Error('[ax338] missing AX338_RIG');
  const animations = REQUIRED.map((name: string) => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`[ax338] missing ${name} clip`);
    return clip;
  });
  const point = (name: string): [number, number, number] => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`[ax338] missing ${name}`);
    const p = node.getWorldPosition(new THREE.Vector3());
    return [p.x, p.y, p.z];
  };
  const model = {
    id: 'sniper', label: 'AX-338', scene, root, animations, reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'), eject: point('SOCKET_ejection'), sight: point('SOCKET_sight'),
      ejectDir: [.88, .4, .22], gripR: handReference.grips.right, gripL: handReference.grips.left,
      magSeat: { pos: point('SOCKET_magazine'), rot: [0, 0, 0] },
      triggerPivot: { pos: point('trigger'), rot: [0, 0, 0] },
      opticGlass: { kind: 'scope', center: point('SOCKET_sight'), reticle: 'mil' },
      handguard: { axis: [0, .075, 0], dir: [0, 0, 1], r: .027, z0: -.175, z1: -.581 },
    },
    shell: { caseLen: .0697, rimR: .0074 }, magSize: { len: manifest.dimensions.magazineHeight },
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

export async function loadAX338() {
  return makeAX338Model(await new GLTFLoader().loadAsync(AX338_URL));
}

/** Blender owns mechanisms and wrist/finger choreography; the existing recoil,
 * shared arm skin, upper/forearm IK and ammunition/event system remain in charge. */
type AX338Model = ReturnType<typeof makeAX338Model>;
type AX338Arm = HandRig;
export class AX338Animation {
  model!: AX338Model; root!: THREE.Object3D; mixer!: THREE.AnimationMixer; actions!: Record<string, THREE.AnimationAction>;
  bolt!: THREE.Object3D; magazine!: THREE.Object3D; spare!: THREE.Object3D; magazineBody!: THREE.Object3D; magazineRound!: THREE.Object3D; spareRound!: THREE.Object3D;
  hands!: Record<HandSide, AuthoredHand>; poseQ!: THREE.Quaternion; poseMatrix!: THREE.Matrix4; idleTime!: number; name!: string | null; fireTime!: number;
  constructor(model: AX338Model) {
    this.model = model; this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of model.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      this.actions[clip.name] = action;
    }
    const node = (name: string): THREE.Object3D => {
      const o = this.root.getObjectByName(name);
      if (!o) throw new Error(`[ax338] missing ${name}`);
      return o;
    };
    this.bolt = node('bolt');
    this.magazine = node('magazine'); this.spare = node('magazine_spare');
    this.magazineBody = node('magazine_mesh');
    this.magazineRound = node('magazine_round'); this.spareRound = node('magazine_spare_round');
    this.hands = discoverAuthoredHands(node);
    this.poseQ = new THREE.Quaternion(); this.poseMatrix = this.root.matrix;
    this.idleTime = 0; this.name = null;
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
    this.magazineRound.visible = magazineLoaded; this.spareRound.visible = this.spare.visible;
    // On interruption every channel is sampled from the complete Idle action.
    // No persistent scale/bolt state or duplicate casing is introduced here.
    this.root.updateMatrixWorld(true);
  }

  handTarget(side: HandSide, pos: THREE.Vector3, q: THREE.Quaternion): void {
    authoredHandTarget(this.root, this.hands[side], pos, q);
  }

  applyHands(left: AX338Arm, right: AX338Arm): void {
    applyAuthoredHand(left, this.hands.left);
    applyAuthoredHand(right, this.hands.right);
  }

  dispose(): void {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    disposeWeaponMaterials(this.model);
  }
}
