import * as THREE from 'three';
import { createWeaponMaterial } from './asset-material.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/m4a1-block-ii/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/m4a1-block-ii/hand-reference.json' with { type: 'json' };
import { Clip } from './clips.js';

export const M4_URL = new URL('../../assets/weapons/m4a1-block-ii/m4a1-block-ii.glb', import.meta.url).href;
const ALIASES = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeM4Model(gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('M4_RIG');
  if (!root) throw new Error('[m4] missing M4_RIG');
  const animations = REQUIRED.map(name => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`[m4] missing ${name} clip`);
    return clip;
  });
  const point = name => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`[m4] missing ${name}`);
    return node.getWorldPosition(new THREE.Vector3()).toArray();
  };
  const model = {
    id: 'rifle', label: 'M4A1', scene, root, animations, reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'), eject: point('SOCKET_ejection'), sight: point('SOCKET_sight'),
      ejectDir: [.86, .44, .26], gripR: handReference.grips.right, gripL: handReference.grips.left,
      magSeat: { pos: [0, .054, -.078], rot: [0, 0, 0] },
      triggerPivot: { pos: point('trigger'), rot: [0, 0, 0] },
      handguard: { axis: [0, .075, 0], dir: [0, 0, 1], r: .0286, z0: -.133, z1: -.44415 },
    },
    shell: { caseLen: .0447, rimR: .00478 }, magSize: { len: .160 },
    materials: new Set(), textures: new Set(),
  };
  const replacements = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const source = o.material;
    let mat = replacements.get(source);
    if (!mat) {
      mat = createWeaponMaterial(source);
      for (const value of Object.values(mat)) if (value?.isTexture) {
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

export async function loadM4() {
  return makeM4Model(await new GLTFLoader().loadAsync(M4_URL));
}

/** Blender owns mechanisms and wrist/finger choreography; the existing recoil,
 * shared arm skin, upper/forearm IK and ammunition/event system remain in charge. */
export class M4Animation {
  constructor(model) {
    this.model = model; this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of model.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      this.actions[clip.name] = action;
    }
    const node = name => {
      const o = this.root.getObjectByName(name);
      if (!o) throw new Error(`[m4] missing ${name}`);
      return o;
    };
    this.bolt = node('bolt'); this.boltRest = this.bolt.position.clone();
    this.boltHead = node('bolt_head');
    this.unlockedHead = this.boltHead.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 8));
    this.cover = node('dust_cover');
    this.openCover = this.cover.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-115)));
    this.magazine = node('magazine'); this.spare = node('magazine_spare');
    this.magazineBody = node('magazine_mesh');
    this.magazineRound = node('magazine_round'); this.spareRound = node('magazine_spare_round');
    // The editable scene previews ejection. Runtime keeps the existing single
    // physical casing at its original scheduled event, never a duplicate mesh.
    this.reviewCase = node('spent_case');
    this.hands = {};
    for (const [side, prefix] of [['left', 'L'], ['right', 'R']]) {
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
    this.idleTime = 0; this.name = null; this.coverOpen = false;
    this.reset();
  }

  clips() {
    const clips = {};
    for (const [name, source] of Object.entries(ALIASES)) {
      const info = manifest.clips[source];
      clips[name] = new Clip(name, info.duration, { events: info.events.map(ev => ({ t: ev.time, name: ev.event })) });
    }
    return clips;
  }

  _sample(name, time) {
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
    this.reviewCase.visible = false;
  }

  fire() { this.wasOpen = this.coverOpen; this.coverOpen = true; this.fireTime = 0; }
  reset() { this.fireTime = Infinity; this._sample('Idle', 0); }

  update(dt, clipName, clipTime, empty, magazineLoaded = !empty) {
    this.idleTime += dt; this.fireTime += dt;
    const gesture = ALIASES[clipName];
    if (gesture) this._sample(gesture, clipTime);
    else if (this.fireTime < manifest.clips.Fire.duration) this._sample(empty ? 'Last_Shot' : 'Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % manifest.clips.Idle.duration);
    if (empty && gesture !== 'Reload_Empty' && this.fireTime >= .0465) {
      this.bolt.position.copy(this.boltRest); this.bolt.position.z += .062;
      this.boltHead.quaternion.copy(this.unlockedHead);
    }
    // The cover opens on the first shot and stays open; it must not snap shut
    // every automatic cycle, inspect or weapon switch.
    if (this.coverOpen && (gesture || this.wasOpen || this.fireTime >= .018)) this.cover.quaternion.copy(this.openCover);
    this.magazineRound.visible = magazineLoaded; this.spareRound.visible = this.spare.visible;
    this.root.updateMatrixWorld(true);
  }

  handTarget(side, pos, q) {
    const wrist = this.hands[side].wrist;
    pos.copy(wrist.position).applyMatrix4(this.root.matrix);
    q.copy(this.root.quaternion).multiply(wrist.quaternion);
  }

  applyHands(left, right) {
    this._applyHand(left, this.hands.left); this._applyHand(right, this.hands.right);
  }

  _applyHand(arm, authored) {
    for (let i = 0; i < 4; i++) {
      arm.fingers[i].root.quaternion.copy(authored.fingers[i].root.quaternion);
      for (let j = 0; j < 3; j++) arm.fingers[i].joints[j].quaternion.copy(authored.fingers[i].joints[j].quaternion);
    }
    arm.thumb.root.quaternion.copy(authored.thumb[0].quaternion);
    for (let j = 0; j < 2; j++) arm.thumb.joints[j].quaternion.copy(authored.thumb[j + 1].quaternion);
    arm.updateFlex();
  }

  dispose() {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    for (const m of this.model.materials) m.dispose();
    const images = new Set();
    for (const t of this.model.textures) { if (t.source?.data?.close) images.add(t.source.data); t.dispose(); }
    for (const image of images) image.close();
    this.model.materials.clear(); this.model.textures.clear();
  }
}
