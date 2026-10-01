import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.js';
import { buildRifle } from '../../src/weapons/models/rifle.js';
import { buildClips } from '../../src/weapons/clips.js';
import { WEAPON_DEFS, WEAPON_IDS, buildRecoilPattern } from '../../src/weapons/defs.js';
import { Viewmodel } from '../../src/weapons/viewmodel.js';
import { WeaponSystem } from '../../src/weapons/index.js';
import { Rng } from '../../src/core/rng.js';

const dir = new URL('../../assets/weapons/m4a1-block-ii/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
const hands = JSON.parse(readFileSync(new URL('hand-reference.json', dir)));
const blend = readFileSync(new URL('m4a1-block-ii.blend', dir));
assert(blend.subarray(0, 7).equals(Buffer.from('BLENDER')) || blend.readUInt32LE(0) === 0xfd2fb528, 'editable packed Blender source');
const bytes = readFileSync(new URL(M4_URL));
const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
const primitives = json.nodes.filter(n => n.mesh !== undefined).flatMap(n => json.meshes[n.mesh].primitives);
const triangles = primitives.reduce((n, p) => n + json.accessors[p.indices].count / 3, 0);
assert.equal(triangles, manifest.stats.triangles, 'count both spare/primary instances, not just unique buffers');
assert.equal(primitives.length, manifest.stats.primitives);
assert(triangles < 110000 && primitives.length <= 40 && json.materials.length <= 16 && bytes.length <= 10 * 1024 * 1024);
assert.equal(json.images.length, 3);
assert(json.buffers.every(b => !b.uri) && json.images.every(i => i.bufferView !== undefined), 'local self-contained GLB');
assert(!json.skins, 'reuse existing runtime arm skins, do not export duplicate arms');
const binaryStart = 28 + bytes.readUInt32LE(12);
for (const image of json.images) {
  const view = json.bufferViews[image.bufferView];
  const offset = binaryStart + (view.byteOffset ?? 0);
  assert.equal(bytes.readUInt32BE(offset + 16), 1024);
  assert.equal(bytes.readUInt32BE(offset + 20), 1024);
}
assert.equal(json.animations.length, 8);
for (const clip of json.animations) {
  const names = clip.channels.map(c => json.nodes[c.target.node].name);
  for (const name of ['M4_RIG', 'bolt', 'bolt_head', 'charging_handle', 'hand_L', 'hand_R', 'L_thumb_base', 'R_finger_0_0']) assert(names.includes(name), `${clip.name}: authored ${name}`);
  const end = Math.max(...clip.samplers.map(s => json.accessors[s.input].max[0]));
  assert(Math.abs(end - manifest.clips[clip.name].duration) < 1e-6, `${clip.name}: exact duration, including fractional draw endpoint`);
  for (const channel of clip.channels) if (channel.target.path === 'scale') assert.equal(clip.samplers[channel.sampler].interpolation, 'STEP');
}
const loader = new GLTFLoader().register(() => ({ name: 'NODE_TEXTURE_STUB', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const model = makeM4Model(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));
assert.equal(model.id, 'rifle'); assert.equal(model.label, 'M4A1'); assert.equal(model.nodes.opticGlass, undefined);
assert(!json.nodes.some(n => /optic|red.dot|reticle|glass/i.test(n.name)), 'bare iron-only rifle');
const close = (a, b, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const point = name => model.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
close(point('SOCKET_barrel_crown').distanceTo(point('SOCKET_bolt_face')), .3683);
close(model.nodes.sight[1], .1395); close(model.nodes.muzzle[2], -.52634);
const front = point('SOCKET_front_post'); close(front.x, model.nodes.sight[0]); close(front.y, model.nodes.sight[1]);
function firstHit(name, origin, direction) {
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, 1);
  const hits = ray.intersectObject(model.root.getObjectByName(name), true);
  assert(hits.length, `${name}: expected rendered indexed surface`);
  return hits[0].point;
}
close(firstHit('bolt_head', [.002, .075, -.108], [0, 0, 1]).z, -.105, .00001);
close(firstHit('receiver_mesh', [.004, .075, -.4738], [0, 0, 1]).z, -.4733, .00001);
// Open rear cup: first rendered surface is the 1.3 mm-radius front post,
// not its axis/socket. Allow 30 µm for the 16-sided polygon chord.
close(firstHit('receiver_mesh', [0, .1394, .060], [0, 0, -1]).z, -.3027, .00003);
const guard = new THREE.Box3().setFromObject(model.root.getObjectByName('handguard'));
close(guard.max.z - guard.min.z, .31115, .001);
close(guard.max.x - guard.min.x, .056642, .001);
close(guard.max.y - guard.min.y, .05715, .001);

const camera = new THREE.PerspectiveCamera(80, 16 / 9, .004, 60);
const messages = [];
const ctx = { scene: new THREE.Scene(), viewScene: new THREE.Scene(), camera, viewCamera: camera, rng: new Rng(0x4a1),
  time: { elapsed: 0, scale: 1 }, peek: () => null, events: { emit: (name, data) => messages.push({ name, ...data }) } };
const vm = new Viewmodel(ctx, { get: () => new THREE.MeshStandardMaterial(), reticle: () => new THREE.MeshBasicMaterial(), reticleOutline: () => new THREE.MeshBasicMaterial() });
const entry = vm.addWeapon(model, { ...WEAPON_DEFS.rifle, cycleTime: 60 / 800 });
const anim = entry.animation;
assert.equal(entry.parts.magazine, anim.magazineBody, 'existing physical magazine-drop interface retained');
const oldClips = buildClips(buildRifle().nodes, WEAPON_DEFS.rifle);
for (const name of ['reloadTac', 'reloadEmpty', 'inspect', 'draw', 'holster']) {
  assert.equal(entry.clips[name].duration, oldClips[name].duration);
  assert.deepEqual(entry.clips[name].events, oldClips[name].events, `${name}: original gameplay milestones`);
}
anim._sample('Last_Shot', .075); close(anim.bolt.position.z - anim.boltRest.z, .062);
assert(anim.boltHead.quaternion.angleTo(new THREE.Quaternion()) > .38, 'authored unlocked bolt-head endpoint');
anim.reset();
for (const [name, out, drop, insert] of [['Reload_Tactical', .20, .34, .81], ['Reload_Empty', .16, .30, .71]]) {
  const d = manifest.clips[name].duration;
  for (let frame = 0; frame <= d * 240; frame++) {
    const t = frame / 240; anim._sample(name, t);
    assert([anim.magazine.scale.x, anim.spare.scale.x].every(s => Math.min(Math.abs(s), Math.abs(s - 1)) < 1e-5), 'no shrinking magazines between keys');
    const held = t >= (out - .035) * d && t <= (drop - .025) * d ? anim.magazine
      : t >= (drop + .05) * d && t <= (insert + .025) * d ? anim.spare : null;
    if (held) {
      anim.root.updateMatrixWorld(true);
      const target = held.localToWorld(new THREE.Vector3().fromArray(hands.magazine.pos));
      const wrist = anim.hands.left.wrist.getWorldPosition(new THREE.Vector3());
      assert(wrist.distanceTo(target) < .002, `${name}/${t.toFixed(4)}: wrist drifts off held magazine`);
    }
  }
}
anim.reset();
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
    wp._state.empty = !wp.state.mag && !wp.state.chambered; wp._state.magazineLoaded = wp.state.mag > 0;
    wp.lateUpdate(1 / 120, ctx);
    assert(vm.armR.hand.position.toArray().every(Number.isFinite) && vm.armL.hand.position.toArray().every(Number.isFinite));
  }
}
wp.setWeaponImmediate('rifle'); step(.2);
assert(!vm.reticle.visible && !vm.scopeOverlay.visible);
assert(wp.tryFire()); assert(vm.recPos.c.v > 0, 'keep original reactive recoil instead of authored-model early return');
close(anim.root.position.length(), 0, 1e-6);
step(.1);
for (let i = 0; i < 5; i++) { assert(wp.tryFire()); step(.1); }
assert.equal(messages.filter(m => m.name === 'weapon:fire').length, 6);
assert.equal(messages.filter(m => m.name === 'weapon:shell').length, 6);
assert.equal(wp.state.mag, 24);
assert(!anim.reviewCase.visible, 'no duplicate viewmodel casing alongside the physical shell');
assert(wp.reload()); step(1.6); assert.equal(wp.state.mag, 24);
step(.2); assert.equal(wp.state.mag, 30); assert.equal(wp.state.reserve, 204);
step(.5); assert(!wp.reloading && anim.magazine.visible && !anim.spare.visible);
assert.equal(wp._magPools.get('rifle').length, 2, 'pooled physical discarded magazines survive migration');
for (const proxy of wp._magPools.get('rifle')) {
  assert(proxy.group.position.toArray().every(Number.isFinite));
  let parts = 0; proxy.group.traverse(o => { if (o.isMesh) parts++; });
  assert.equal(parts, 2, 'discarded shell/follower, not dummy loaded cartridges');
}
wp.state.mag = 0; wp.state.chambered = false;
assert(wp.reload()); step(1.9); assert(anim.bolt.position.z > .06);
step(.8); assert.equal(wp.state.mag, 29); assert(wp.state.chambered); close(anim.bolt.position.z, anim.boltRest.z);
step(.4); assert(!wp.reloading);
wp.state.mag = 0; wp.state.chambered = true;
assert(wp.tryFire()); step(.2); assert(anim.bolt.position.z > .06 && !anim.magazineRound.visible);
assert(wp.inspect()); step(.4); assert(anim.bolt.position.z > .06, 'inspect retains empty lockback');
vm.stopClip(); assert(wp.reload()); step(.5);
const reserve = wp.state.reserve; wp._onPlayerDeath(); step(.1);
assert.equal(wp.state.reserve, reserve, 'interrupt before insertion grants no ammo');
assert(!anim.spare.visible && anim.magazine.visible);
vm.dispose(); assert.equal(model.materials.size, 0); assert.equal(model.textures.size, 0);
console.log(`M4: ${triangles} triangles / ${primitives.length} primitive instances; eight Blender clips, exact milestones, iron geometry, magazine contacts/drops, ammunition, recoil, shells, lockback and cleanup passed`);
