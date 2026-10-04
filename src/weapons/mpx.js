import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/sig-mpx/manifest.json' with { type: 'json' };
import handReference from '../../assets/weapons/sig-mpx/hand-reference.json' with { type: 'json' };
import { Clip } from './clips.js';

export const MPX_URL = new URL('../../assets/weapons/sig-mpx/mpx.glb', import.meta.url).href;
export const MPX_EJECT_DELAY = .025;
const ALIASES = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect', draw: 'Draw', holster: 'Holster' };
const REQUIRED = ['Idle', 'Fire', 'Last_Shot', ...Object.values(ALIASES)];

export function makeMPXModel(gltf) {
  const scene = gltf.scene;
  // Source remains +X-forward for reproducible photo/DCC review. Normalize
  // the full native hierarchy and curves once; no extra runtime orientation rig.
  const basis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const inverse = basis.clone().invert(), geometries = new Set();
  scene.traverse(o => {
    o.position.applyQuaternion(basis);
    o.quaternion.premultiply(basis).multiply(inverse);
    const x = o.scale.x; o.scale.x = o.scale.z; o.scale.z = x;
    if (o.isMesh && !geometries.has(o.geometry)) {
      o.geometry.applyQuaternion(basis); geometries.add(o.geometry);
    }
    o.updateMatrix();
  });
  for (const clip of gltf.animations) for (const track of clip.tracks) {
    // GLTFLoader shares accessor arrays across clips/constant controls. Never
    // transform that shared storage repeatedly (it rotates idle hands twice).
    const v = track.values.slice(), width = track.getValueSize();
    track.values = v;
    if (track.name.endsWith('.position') || track.name.endsWith('.quaternion')) {
      for (let i = 0; i < v.length; i += width) {
        const x = v[i]; v[i] = v[i + 2]; v[i + 2] = -x;
      }
    } else if (track.name.endsWith('.scale')) {
      for (let i = 0; i < v.length; i += width) {
        const x = v[i]; v[i] = v[i + 2]; v[i + 2] = x;
      }
    }
  }
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('MPX_RIG');
  if (!root) throw new Error('[mpx] missing MPX_RIG');
  const animations = REQUIRED.map(name => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`[mpx] missing ${name} clip`);
    return clip;
  });
  const point = name => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`[mpx] missing ${name}`);
    return node.getWorldPosition(new THREE.Vector3()).toArray();
  };
  const model = {
    id: 'smg', label: 'SIG MPX', scene, root, animations, reactiveFire: true,
    handPoses: { left: handReference.sides.left.grip, right: handReference.sides.right.grip },
    nodes: {
      muzzle: point('SOCKET_muzzle'), eject: point('SOCKET_ejection'), sight: point('SOCKET_sight'),
      ejectDir: [.82, .52, .24], gripR: handReference.grips.right, gripL: handReference.grips.left,
      magSeat: { pos: point('SOCKET_magazine'), rot: [0, 0, 0] },
      opticGlass: { center: point('SOCKET_sight'), apertureR: .010, windowW: .018, windowH: .018,
        reticle: 'dot', dotMoa: 2, minDotPixels: 1.5, dotOpacity: .9 },
    },
    shell: { caseLen: .0192, rimR: .00478 }, magSize: { len: .192 },
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
      if (source.name.startsWith('11 |') || source.name.startsWith('12 |')) {
        // World colour is already behind the separate weapon pass. Use one
        // faint coating per optical sheet, not a foggy stack of solid discs or
        // transmission sampling a viewmodel-only render target.
        mat.transparent = true; mat.opacity = source.name.startsWith('11 |') ? .02 : .01;
        mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.forceSinglePass = true;
        mat.transmission = 0; mat.specularIntensity = .03; mat.envMapIntensity = .05;
      } else if (source.name.startsWith('15 |')) {
        // Absorptive interior coating, not the reflective exterior alloy.
        mat.specularIntensity = .02; mat.envMapIntensity = .03;
      }
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

export async function loadMPX() {
  return makeMPXModel(await new GLTFLoader().loadAsync(MPX_URL));
}

/** Samples the actual Blender curves, including fingers. Upper/forearm IK is
 * the only runtime solve; wrists and finger contact are not reconstructed. */
export class MPXAnimation {
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
      if (!o) throw new Error(`[mpx] missing ${name}`);
      return o;
    };
    this.bolt = node('bolt'); this.boltRest = this.bolt.position.clone();
    this.poseMatrix = this.root.matrix;
    this.magazine = node('magazine'); this.spare = node('magazine_spare');
    this.magazineBody = node('magazine_mesh');
    this.rounds = node('magazine_rounds');
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
    this.idleTime = 0; this.name = null;
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

  fire() { this.fireTime = 0; }
  reset() { this.fireTime = Infinity; this._sample('Idle', 0); }

  update(dt, clipName, clipTime, empty, magazineLoaded = !empty) {
    this.idleTime += dt; this.fireTime += dt;
    const gesture = ALIASES[clipName];
    if (gesture) this._sample(gesture, clipTime);
    else if (this.fireTime < manifest.clips.Fire.duration) this._sample(empty ? 'Last_Shot' : 'Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % manifest.clips.Idle.duration);
    // Lockback survives idle/inspect/draw/switch; empty reload owns release.
    if (empty && gesture !== 'Reload_Empty' && this.fireTime >= MPX_EJECT_DELAY) {
      this.bolt.position.copy(this.boltRest); this.bolt.position.z += .038;
    }
    this.rounds.visible = magazineLoaded && this.rounds.scale.x > .5;
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
