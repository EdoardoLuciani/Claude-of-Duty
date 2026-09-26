import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/p320-compact/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/p320-compact/hand-reference.json' with { type: 'json' };
import { Clip } from './clips.js';

export const P320_URL = new URL('../../assets/weapons/p320-compact/p320-compact.glb', import.meta.url).href;
export const P320_EJECT_DELAY = 2 / 60;
const ALIASES = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeP320Model(gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('P320_RIG');
  if (!root) throw new Error('[p320] missing P320_RIG');
  const animations = REQUIRED.map(name => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`[p320] missing ${name} clip`);
    return clip;
  });
  const point = name => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`[p320] missing ${name}`);
    return node.getWorldPosition(new THREE.Vector3()).toArray();
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
    materials: new Set(), textures: new Set(),
  };
  const replacements = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    const source = o.material;
    let mat = replacements.get(source);
    if (!mat) {
      mat = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(mat, source);
      mat.defines.PHYSICAL = '';
      // Local exposure calibration, never a global light/other-weapon change.
      // Preserve the authored atlas and its per-pixel metallic/roughness values.
      mat.color.multiplyScalar(.42);
      mat.specularIntensity = .12;
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

export async function loadP320() {
  return makeP320Model(await new GLTFLoader().loadAsync(P320_URL));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
export class P320Animation {
  constructor(model) {
    this.model = model;
    this.root = model.root;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of model.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      this.actions[clip.name] = action;
    }
    const node = name => {
      const o = this.root.getObjectByName(name);
      if (!o) throw new Error(`[p320] missing ${name}`);
      return o;
    };
    this.slide = node('slide'); this.barrel = node('barrel');
    this.slideRest = this.slide.position.clone();
    this.barrelRest = this.barrel.position.clone();
    this.magazine = node('magazine'); this.spare = node('magazine_spare');
    this.magazineRound = node('magazine_round');
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
    this.poseQ = new THREE.Quaternion();
    this.poseMatrix = new THREE.Matrix4();
    this.idleTime = 0; this.name = null;
    this.reset();
  }

  clips() {
    const clips = {};
    for (const [name, source] of Object.entries(ALIASES)) {
      const info = manifest.clips[source];
      const events = name.startsWith('reload') ? [{ t: 0, name: 'start' }] : [];
      for (const ev of info.events) {
        const event = { magazine_out: 'magout', magazine_in: 'magin', bolt_forward: 'boltrelease' }[ev.event];
        if (event) events.push({ t: ev.time, name: event });
      }
      events.push({ t: info.duration - .0001, name: 'end' });
      clips[name] = new Clip(name, info.duration, { events });
    }
    return clips;
  }

  _sample(name, time) {
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
    this.poseMatrix.copy(this.root.matrix);
    this.magazine.visible = this.magazine.scale.x > .5;
    this.spare.visible = this.spare.scale.x > .5;
  }

  fire() { this.fireTime = 0; }
  reset() { this.fireTime = Infinity; this._sample('Idle', 0); }

  update(dt, clipName, clipTime, empty, magazineLoaded = !empty) {
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

  handTarget(side, pos, q) {
    const wrist = this.hands[side].wrist;
    pos.copy(wrist.position).applyMatrix4(this.root.matrix);
    q.copy(this.root.quaternion).multiply(wrist.quaternion);
  }

  applyHands(left, right) {
    this._applyHand(left, this.hands.left);
    this._applyHand(right, this.hands.right);
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
