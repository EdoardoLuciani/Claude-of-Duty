import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeP320Model, P320_URL } from '../src/weapons/p320.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../src/weapons/defs.js';
import { Viewmodel } from '../src/weapons/viewmodel.js';
import { WeaponSystem } from '../src/weapons/index.js';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { Rng } from '../src/core/rng.js';
import { resolveProfile, WEAPON_PROFILES } from '../src/audio/weapons.js';

const dir = new URL('../assets/weapons/p320-compact/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const handReference = JSON.parse(readFileSync(new URL('hand-reference.json', dir)));
const blend = readFileSync(new URL('p320-compact.blend', dir));
assert(blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528, 'editable Blender source');
const bytes = readFileSync(new URL(P320_URL));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
assert.equal(json.animations.length, 8);
assert.equal(json.images.length, 3, 'one shared unique UV PBR atlas, no duplicated arm textures');
assert(json.buffers.every(b => !b.uri) && json.images.every(i => i.bufferView !== undefined), 'self-contained offline GLB');
assert(manifest.stats.triangles < 93606, 'less geometry than MCX');
assert(manifest.stats.primitives < 37, 'fewer submissions than MCX');
for (const mesh of json.meshes) for (const p of mesh.primitives) {
  const pos = json.accessors[p.attributes.POSITION];
  assert(pos.max.some((v, i) => v - pos.min[i] > .0001), `${mesh.name}: not collapsed by zero-scale merge`);
  assert(p.attributes.NORMAL !== undefined && p.attributes.TEXCOORD_0 !== undefined);
}
for (const clip of json.animations) {
  const names = clip.channels.map(c => json.nodes[c.target.node].name);
  for (const name of ['hand_L', 'hand_R', 'L_thumb_base', 'R_finger_0_0']) assert(names.includes(name), `${clip.name}: authored ${name}`);
  for (const c of clip.channels) if (c.target.path === 'scale') {
    assert.equal(clip.samplers[c.sampler].interpolation, 'STEP', 'magazines never shrink across subframes');
  }
}
const loader = new GLTFLoader().register(() => ({ name: 'NODE_TEXTURE_STUB', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const model = makeP320Model(gltf);
assert(model.nodes.muzzle[2] < -.12 && Math.abs(model.nodes.muzzle[0]) < 1e-6);
assert(model.nodes.eject[0] > .01);
assert.equal(model.nodes.opticGlass, undefined, 'stock iron sights, no reflex');
assert.equal(WEAPON_DEFS.pistol.magSize, 15); assert.equal(WEAPON_DEFS.pistol.reserve, 60);
assert.equal(WEAPON_DEFS.pistol.rpm, 460); assert.equal(WEAPON_DEFS.pistol.damage, 28);
assert.equal(resolveProfile(WEAPON_DEFS.pistol.audio), WEAPON_PROFILES.pistol);
const camera = new THREE.PerspectiveCamera(80, 16 / 9, .004, 60);
const messages = [];
const ctx = { viewScene: new THREE.Scene(), camera, viewCamera: camera, rng: new Rng(320),
  time: { elapsed: 0, scale: 1 }, events: { emit: (name, data) => messages.push({ name, ...data }) } };
const vm = new Viewmodel(ctx, { get: () => new THREE.MeshStandardMaterial(),
  reticle: () => new THREE.MeshBasicMaterial(), reticleOutline: () => new THREE.MeshBasicMaterial() });
vm.addWeapon(buildRifle(), { ...WEAPON_DEFS.rifle, cycleTime: 60 / WEAPON_DEFS.rifle.rpm });
const entry = vm.addWeapon(model, { ...WEAPON_DEFS.pistol, cycleTime: 60 / 460 });
const anim = entry.animation;
anim._sample('Last_Shot', manifest.clips.Last_Shot.duration);
assert(anim.slide.position.z > .025, 'authored last-shot endpoint holds open without a runtime override');
// The requested reload pose keeps every right-thumb joint fixed at the idle
// grip, including fractional frames and clip boundaries. No release gesture.
anim._sample('Idle', 0);
const thumbGrip = anim.hands.right.thumb.map(node => node.quaternion.clone().normalize());
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  for (let frame = 0; frame <= manifest.clips[name].duration * 240; frame++) {
    anim._sample(name, frame / 240);
    for (let joint = 0; joint < 3; joint++) {
      const q = anim.hands.right.thumb[joint].quaternion.clone().normalize();
      assert(q.angleTo(thumbGrip[joint]) < 1e-4, `${name}: right thumb joint ${joint} leaves idle grip at ${(frame / 240).toFixed(4)}s`);
    }
  }
}
anim.reset();
for (const [name, key] of [['reloadTac', 'reloadTac'], ['reloadEmpty', 'reloadEmpty'], ['inspect', 'inspectTime'], ['draw', 'drawTime'], ['holster', 'holsterTime']]) {
  assert.equal(entry.clips[name].duration, WEAPON_DEFS.pistol[key]);
}
// The shared event system owns ammunition; Blender's motion is not another state machine.
const wp = new WeaponSystem(); wp.ctx = ctx; wp.rng = ctx.rng; wp.viewmodel = vm;
wp.sim = { spawn() {}, clear() {} }; wp.stats = { tris: 0, drawCalls: 0, live: 0, fired: 0 };
for (const id of WEAPON_IDS) {
  const d = { ...WEAPON_DEFS[id], cycleTime: 60 / WEAPON_DEFS[id].rpm };
  wp.states.set(id, { def: d, pattern: buildRecoilPattern(d, Rng), mag: d.magSize, chambered: true, reserve: d.reserve, mode: d.modes[0], modeIndex: 0 });
}
vm.onClipEvent = (name, clip) => wp._onClipEvent(name, clip);
function step(seconds) {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    ctx.time.elapsed += 1 / 120;
    wp._fireTimer = Math.max(0, wp._fireTimer - 1 / 120 - 1e-12);
    wp._state.empty = !wp.state.mag && !wp.state.chambered;
    wp._state.magazineLoaded = wp.state.mag > 0;
    wp.lateUpdate(1 / 120, ctx);
    assert(vm.armL.hand.position.toArray().every(Number.isFinite));
    assert(vm.armR.hand.position.toArray().every(Number.isFinite));
  }
}
wp.setWeaponImmediate('pistol'); step(.3);
assert(!vm.reticle.visible && !vm.scopeOverlay.visible);
const thumb = vm.armR.thumb.root.quaternion;
assert(thumb.angleTo(anim.hands.right.thumb[0].quaternion) < 1e-6, 'finger curves consumed, not runtime pose substitution');
messages.length = 0;
for (let i = 0; i < 6; i++) {
  assert(wp.tryFire()); step(16 / 120);
  assert(Math.abs(anim.slide.position.z - anim.slideRest.z) < .001, 'slide returns before next legal shot');
}
assert.equal(messages.filter(m => m.name === 'weapon:fire').length, 6);
assert.equal(messages.filter(m => m.name === 'weapon:shell').length, 6);
assert.equal(wp.state.mag, 9);
assert(wp.reload()); step(1.6); assert.equal(wp.state.mag, 9, 'no ammo before insertion');
step(.2); assert.equal(wp.state.mag, 15); assert.equal(wp.state.reserve, 54);
step(.7); assert(!wp.reloading); assert(anim.magazine.visible && !anim.spare.visible);
assert(messages.some(m => m.name === 'weapon:reload' && m.phase === 'magout' && m.retained));
wp.state.mag = 0; wp.state.chambered = false;
assert(wp.reload()); step(1.8); assert(anim.slide.position.z > .025);
step(1); assert.equal(wp.state.mag, 14); assert(wp.state.chambered); assert.equal(wp.state.reserve, 39);
assert.equal(messages.filter(m => m.name === 'weapon:reload' && m.phase === 'slide').length, 1, 'one synchronized slide-release audio beat');
assert(Math.abs(anim.slide.position.z - anim.slideRest.z) < .001);
wp.state.mag = 0; wp.state.chambered = true;
assert(wp.tryFire()); step(.4); assert(anim.slide.position.z > .025, 'last-shot persistent lockback');
assert(!anim.magazineRound.visible, 'empty magazine has no displayed cartridge');
assert(wp.inspect()); step(.5); assert(anim.slide.position.z > .025, 'inspect preserves empty state');
vm.stopClip(); assert(wp.reload()); step(.8);
const reserve = wp.state.reserve;
wp.setWeaponImmediate('rifle'); step(.1);
assert.equal(wp.states.get('pistol').reserve, reserve, 'cancel before mag-in does not grant ammunition');
assert(anim.magazine.visible && !anim.spare.visible);
wp.setWeaponImmediate('pistol'); wp.state.mag = 8; wp.state.chambered = true; step(.2);
assert(wp.inspect()); step(.7); assert(wp.tryFire(), 'fire cancels inspect'); step(.4);
assert(wp.setWeapon('rifle')); step(.45); assert.equal(wp.activeId, 'rifle'); assert.equal(vm.clipName, 'draw');
step(.7); assert(wp.setWeapon('pistol')); step(1.1); assert.equal(wp.activeId, 'pistol'); assert.equal(vm.clipName, null);
// Frame-by-frame reload visibility includes fractional samples around handoffs.
for (const name of ['Reload_Tactical', 'Reload_Empty']) {
  for (let i = 0; i < 144 * 3; i++) {
    const t = i / (144 * 3) * manifest.clips[name].duration;
    anim._sample(name, t);
    // glTF matrix decomposition can perturb unit scale by float32 epsilon.
    assert([anim.magazine.scale.x, anim.spare.scale.x].every(v => Math.min(Math.abs(v), Math.abs(v - 1)) < 1e-5));
    if (t > 1.8) assert(!anim.magazine.visible && anim.spare.visible, `${name}: exactly one seated magazine`);
    const frame = t * 60;
    const contact = frame >= 61 && frame <= 109 ? anim.spare : name === 'Reload_Tactical' && frame >= 19 && frame <= 58 ? anim.magazine : null;
    if (contact) {
      anim.root.updateMatrixWorld(true);
      const target = contact.localToWorld(new THREE.Vector3().fromArray(handReference.magazine.pos));
      const wrist = anim.hands.left.wrist.getWorldPosition(new THREE.Vector3());
      assert(wrist.distanceTo(target) < .002, `${name}/${frame.toFixed(1)}: magazine contact drifts ${(wrist.distanceTo(target) * 1000).toFixed(2)} mm`);
    }
  }
}
anim.reset(); wp.state.mag = 0; wp.state.chambered = false; assert(wp.reload()); step(.7);
const beforeDeath = wp.state.reserve; wp._onPlayerDeath(); step(1);
assert(wp.disabled && !wp.reloading); assert.equal(wp.state.reserve, beforeDeath);
wp.resetForNewGame(); assert.equal(wp.states.get('pistol').reserve, 60); assert.equal(wp.states.get('pistol').mag, 15);
vm.dispose(); assert.equal(model.materials.size, 0); assert.equal(model.textures.size, 0);
console.log(`P320: ${manifest.stats.triangles} triangles, ${manifest.stats.primitives} primitives; eight Blender clips, wrists/fingers, magazine visibility, ammo/events, cadence, interruption and cleanup passed`);
