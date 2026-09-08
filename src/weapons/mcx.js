import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import manifest from '../../assets/weapons/mcx-virtus/manifest.json' with { type: 'json' };
import { Clip } from './clips.js';
import { smootherstep } from './mathx.js';

// Vite bundles the committed Blender export; never rebuild Blender at game boot.
export const MCX_URL = new URL('../../assets/weapons/mcx-virtus/mcx-virtus.glb', import.meta.url).href;
const ALIASES = { reloadTac: 'Reload_Tactical', reloadEmpty: 'Reload_Empty', inspect: 'Inspect' };
const SHOT_START = 2 / 60;
export const MCX_EJECT_DELAY = 4 / 60 - SHOT_START;
const ONE = new THREE.Vector3(1, 1, 1);

// Authored +X forward/+Y up/+Z right -> game -Z forward/+Y up/+X right.
// Move the origin to the shooting-hand web, not the Blender chamber origin.
export function makeMCXModel(gltf) {
  const scene = new THREE.Group();
  scene.name = 'mcx-coordinate-frame';
  scene.rotation.y = Math.PI / 2;
  scene.position.set(0, .070, -.140);
  scene.add(gltf.scene);
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('MCX_RIG');
  if (!root) throw new Error('[mcx] missing MCX_RIG');
  const animations = ['Idle', 'Fire', ...Object.values(ALIASES)].map(name => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`[mcx] missing ${name} clip`);
    return clip;
  });
  const point = name => {
    const node = scene.getObjectByName(name);
    if (!node) throw new Error(`[mcx] missing ${name}`);
    return node.getWorldPosition(new THREE.Vector3()).toArray();
  };
  const sight = point('SOCKET_sight');
  const model = {
    id: 'mcx', scene, root, animations,
    nodes: {
      muzzle: point('SOCKET_muzzle'), eject: point('SOCKET_ejection'), sight,
      ejectDir: [1, .35, .35],
      // Wrist targets (not the palm-centred Blender sockets); same glove rig as M4.
      gripR: { pos: [.0351, .030, .100], finger: [.15, -.35, -.92], back: [1, .03, .04] },
      gripL: { pos: [-.105, .067, -.251], finger: [.8977, -.3267, -.2955], back: [-.2784, -.7648, .581] },
      handguard: { axis: [0, .070, 0], dir: [0, 0, 1], r: .029, z0: -.215, z1: -.398 },
      magSeat: { pos: [0, -.012, -.157], rot: [0, 0, 0] },
      opticGlass: { kind: 'scope', reticle: 'chevron', center: sight, apertureR: .0154 },
    },
    shell: { caseLen: .0348, rimR: .0048 }, magSize: { len: .18 },
    materials: new Set(), textures: new Set(),
  };
  // Keep authored PBR instead of remapping the Blender material names to the
  // procedural weapon library. Thin alpha lenses avoid a second full-scene
  // transmission pass; the gameplay scope supplies the magnified sight picture.
  const replacements = new Map();
  scene.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) throw new Error('[mcx] expected glTF material primitives');
    const original = o.material;
    let mat = replacements.get(original);
    if (!mat) {
      mat = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(mat, original);
      mat.defines.PHYSICAL = '';
      // Match the existing viewmodel exposure calibration (materials.js): its
      // fill is much hotter than Blender's studio. Anodizing is a dielectric
      // coating, not bare alloy. Keep the packed albedo/normal/roughness detail.
      const surface = Number.parseInt(original.name, 10);
      if ([1, 3, 4, 6].includes(surface)) {
        mat.color.multiplyScalar(.24);
        mat.metalness = 0; mat.specularIntensity = .12;
      } else if (surface === 2 || surface === 5) {
        mat.color.multiplyScalar(.42);
        mat.metalness = surface === 2 ? .4 : .9;
      } else if (surface === 9) mat.color.multiplyScalar(.28);
      if (surface === 11) {
        mat.color.setRGB(.035, .075, .085);
        mat.transparent = true; mat.opacity = .10; mat.depthWrite = false;
        mat.metalness = 0; mat.roughness = .12; mat.specularIntensity = .25;
      }
      replacements.set(original, mat);
      model.materials.add(mat);
      for (const value of Object.values(mat)) if (value?.isTexture) model.textures.add(value);
    }
    o.material = mat;
    o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false;
  });
  for (const original of replacements.keys()) original.dispose();
  return model;
}

export async function loadMCX() {
  return makeMCXModel(await new GLTFLoader().loadAsync(MCX_URL));
}

function handQuaternion(finger, back) {
  const z = new THREE.Vector3(...finger).negate().normalize();
  const y = new THREE.Vector3(...back).addScaledVector(z, -new THREE.Vector3(...back).dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Baked rigid-part animation under the shared movement/ADS/arm rig. */
export class MCXAnimation {
  constructor(model, def) {
    this.model = model;
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
      const tracks = source.tracks.filter(t => !t.name.startsWith('spent_case.'));
      const clip = new THREE.AnimationClip(source.name, source.duration, tracks);
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      this.actions[source.name] = action;
    }
    this.magazine = this.root.getObjectByName('magazine');
    this.spare = this.root.getObjectByName('magazine_spare');
    this.bolt = this.root.getObjectByName('bolt');
    this.charging = this.root.getObjectByName('charging_handle');
    this.root.getObjectByName('spent_case').visible = false;
    this.poseMatrix = new THREE.Matrix4();
    this.poseQ = new THREE.Quaternion();
    this.partMatrix = new THREE.Matrix4();
    this.target = new THREE.Vector3();
    this.targetQ = new THREE.Quaternion();
    this.magPoint = new THREE.Vector3(.005, -.205, -.04);
    this.chargePoint = new THREE.Vector3(-.179, .020, -.052);
    this.magQ = handQuaternion([.1, .72, -.68], [-.86, .34, -.38]);
    this.chargeQ = handQuaternion([.55, .2, .81], [-.2, .94, -.27]);
    this.idleTime = 0;
    this.name = null;
    this.reset();
  }

  clips() {
    const result = {};
    for (const [name, source] of Object.entries(ALIASES)) {
      const duration = this.actions[source].getClip().duration;
      const events = name.startsWith('reload') ? [{ t: 0, name: 'start' }] : [];
      for (const ev of manifest.clips[source].events) {
        const event = { magazine_out: 'magout', magazine_in: 'magin', bolt_forward: 'boltrelease' }[ev.event];
        if (event) events.push({ t: ev.time, name: event });
      }
      events.push({ t: duration - .0001, name: 'end' });
      // Shared viewmodel handles event crossing/interruption; pose/parts come
      // solely from Blender, not the old procedural reload offsets.
      result[name] = new Clip(name, duration, { events });
    }
    return result;
  }

  _sample(name, time) {
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
    this.magazine.visible = this.magazine.scale.x > .5;
    this.spare.visible = this.spare.scale.x > .5;
  }

  fire() { this.fireTime = SHOT_START; }

  reset() {
    this.fireTime = Infinity;
    this.gesture = null;
    this.gestureTime = 0;
    this._sample('Idle', 0);
  }

  update(dt, clipName, clipTime, empty) {
    this.idleTime += dt;
    this.fireTime += dt * this.fireSpeed;
    this.gesture = ALIASES[clipName] ? clipName : null;
    this.gestureTime = clipTime;
    if (this.gesture) this._sample(ALIASES[clipName], clipTime);
    else if (this.fireTime < this.actions.Fire.getClip().duration) this._sample('Fire', this.fireTime);
    else this._sample('Idle', this.idleTime % this.actions.Idle.getClip().duration);
    if (empty && !this.gesture && this.fireTime >= 7 / 60) this.bolt.position.x = -.068;
    this.frame.updateMatrixWorld(true);
  }

  handTarget(side, pos, quat) {
    pos.applyMatrix4(this.poseMatrix);
    quat.premultiply(this.poseQ);
    if (side !== 'left' || !this.gesture?.startsWith('reload')) return;
    const t = this.gestureTime;
    let part, point, baseQ, weight;
    if (this.gesture === 'reloadEmpty' && t > 2.0) {
      part = this.charging; point = this.chargePoint; baseQ = this.chargeQ;
      weight = smootherstep(2.02, 2.28, t) * (1 - smootherstep(2.70, 3.12, t));
    } else {
      part = t < 64 / 60 ? this.magazine : this.spare;
      point = this.magPoint; baseQ = this.magQ;
      weight = smootherstep(.10, .32, t) * (1 - smootherstep(1.95, 2.35, t));
    }
    if (weight <= 0) return;
    // Ignore visibility scale during off-screen magazine handoffs: the wrist
    // follows a rigid part, never a collapsing zero-scale transform.
    this.partMatrix.compose(part.position, part.quaternion, ONE);
    this.target.copy(point).applyMatrix4(this.partMatrix).applyMatrix4(this.root.matrix).applyMatrix4(this.frame.matrix);
    this.targetQ.copy(this.frameQ).multiply(this.root.quaternion).multiply(part.quaternion).multiply(this.inverseQ).multiply(baseQ);
    pos.lerp(this.target, weight);
    quat.slerp(this.targetQ, weight);
  }

  get leftPose() {
    if (this.gesture?.startsWith('reload') && this.gestureTime > .2 && this.gestureTime < (this.gesture === 'reloadEmpty' ? 2.9 : 2.15)) return 'pinch';
    return null;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const m of this.model.materials) m.dispose();
    for (const t of this.model.textures) { t.source?.data?.close?.(); t.dispose(); }
    this.model.materials.clear(); this.model.textures.clear();
  }
}
