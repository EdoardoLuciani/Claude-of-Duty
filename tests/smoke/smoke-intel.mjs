/** Authored sites, distance-gated random selection, run limits and interaction. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { IntelSystem } from '../../src/intel/index.js';
import { shuffleDeck, drawCard, CARDS } from '../../src/intel/cards.js';
import { randomMarker, rollBudget } from '../../src/intel/spawn.js';
import { INTEL, lureInterval } from '../../src/intel/tuning.js';
import { INTEL_POINTS } from '../../tools/worldgen/intel.js';
import { Rng } from '../../src/core/rng.js';
import { EventBus } from '../../src/core/registry.js';
import { AmmoPickups } from '../../src/weapons/ammo-pickups.js';
import { UiSystem } from '../../src/ui/index.js';
import { MarketSystem } from '../../src/market/index.js';

const market = Object.create(MarketSystem.prototype);
market.credits = 20;
for (const invalid of [NaN, Infinity, -Infinity, 'invalid', -150, 0]) {
  assert.equal(market.addCredits(invalid), 20, 'invalid payouts never corrupt credits');
}
assert.equal(market.addCredits(150), 170);

const manifest = JSON.parse(readFileSync(new URL('../../public/models/world/level.json', import.meta.url)));
const exported = manifest.WORLD.MARKERS.INTEL;
assert.equal(INTEL_POINTS.length, 14);
assert.equal(new Set(INTEL_POINTS.map((p) => p.id)).size, 14);
assert.deepEqual(exported.map((p) => p.id), INTEL_POINTS.map((p) => p.id));
const transform = new THREE.Matrix4().fromArray(manifest.transform);
for (let i = 0; i < exported.length; i++) {
  const p = INTEL_POINTS[i];
  assert.deepEqual(new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(transform).toArray(), exported[i].position);
}
assert(INTEL_POINTS.some((p) => p.y > 2));
assert(INTEL_POINTS.some((p) => p.id.endsWith('roof')));
const budgets = new Set(Array.from({ length: 100 }, (_, i) => rollBudget(new Rng(i + 1))));
assert.deepEqual([...budgets].sort(), [3, 4, 5]);
assert(lureInterval(18) > lureInterval(4));
const markers = [
  { id: 'near', x: 1, y: 0, z: 0 },
  { id: 'far', x: 40, y: 0, z: -10 },
  { id: 'upper', x: 20, y: 6, z: 2 },
];
const zero = new THREE.Vector3();
const firstRng = { float: () => 0.99 };
const lastRng = { float: () => 0 };
assert.equal(randomMarker(markers, new Set(), zero, [], firstRng).id, 'far');
assert.equal(randomMarker(markers, new Set(), zero, [], lastRng).id, 'upper', 'not always the farthest site');
assert.equal(randomMarker(markers, new Set(['far']), zero, [], firstRng).id, 'upper');
const noDraw = { float() { throw new Error('empty candidate pool consumed RNG'); } };
assert.equal(randomMarker(markers, new Set(markers.map((m) => m.id)), zero, [], noDraw), null);
assert.equal(randomMarker([], new Set(), zero, [], noDraw), null);
const site = (id, x, y = 0, z = 0) => ({ id, x, y, z });
assert.equal(randomMarker([site('upstairs', 0, 100), site('away', 20)], new Set(), zero, [], lastRng).id,
  'away', 'vertical separation cannot bypass the player distance gate');
assert.equal(randomMarker([site('full', 40), site('half', 10)], new Set(), zero, [], lastRng).id,
  'full', 'full-distance candidates take precedence over fallback candidates');
assert.equal(randomMarker([site('near', 1), site('half', 10)], new Set(), zero, [], firstRng).id,
  'half', 'halve spacing before accepting a site at the player');
assert.equal(randomMarker([site('near', 1)], new Set(), zero, [site('live', 1)], firstRng).id,
  'near', 'waive spacing rather than withholding a drop when only close sites remain');
const live = [site('live', 20, 100)];
assert.equal(randomMarker([site('stacked', 20), site('spread', 70)], new Set(), zero, live, firstRng).id,
  'spread', 'live-cache separation is horizontal too, and does not depend on used IDs');
assert.equal(randomMarker([site('too-close', 22), site('half-separated', 33)], new Set(), zero, live, firstRng).id,
  'half-separated', 'relax live-cache spacing to half before waiving it');
assert.equal(randomMarker([site('boundary', INTEL.spawnPlayerDistance)], new Set(), zero,
  [site('live', INTEL.spawnPlayerDistance + INTEL.spawnCacheDistance)], firstRng).id,
  'boundary', 'distance boundaries are inclusive');
const spent = new Set(['spent-far', 'spent-half']);
const sparse = [site('spent-far', 40), site('spent-half', 10), site('unused-near', 1)];
assert.equal(randomMarker(sparse, spent, zero, [], lastRng).id, 'unused-near', 'fallback never reuses spent sites');
assert.deepEqual([...spent], ['spent-far', 'spent-half']);
assert.deepEqual(live, [site('live', 20, 100)], 'selection does not mutate live caches');

const candidates = [site('a', 20), site('b', 40), site('c', 60)];
const samples = new Rng(132);
const counts = { a: 0, b: 0, c: 0 };
for (let i = 0; i < 6000; i++) counts[randomMarker(candidates, new Set(), zero, [], samples).id]++;
for (const count of Object.values(counts)) assert(Math.abs(count - 2000) < 240, 'eligible sites are sampled uniformly');
const rngA = new Rng(44), rngB = new Rng(44);
for (let i = 0; i < 100; i++) {
  assert.equal(randomMarker(candidates, new Set(), zero, [], rngA).id,
    randomMarker(candidates, new Set(), zero, [], rngB).id, 'same seed and state reproduce selection');
}
const deck = [];
shuffleDeck(new Rng(1), deck);
assert.equal(deck.length, 6);
assert.equal(new Set(deck).size, 6);
assert.equal(CARDS.length, 6);
while (deck.length) assert(drawCard(deck));
assert.equal(drawCard(deck), null);

async function harness(deterministic = false) {
  const player = {
    dead: false, controlEnabled: true, horizontalSpeed: 0, airborne: false,
    feetPosition: new THREE.Vector3(), eyePosition: new THREE.Vector3(0, 1.65, 0),
    healCtrl: { active: false },
  };
  const sounds = [];
  const emitted = [];
  const ui = Object.create(UiSystem.prototype);
  ui.prompt = { active: false, set(p) { this.active = true; this.value = { ...p }; }, clear() { this.active = false; } };
  const ctx = {
    config: { deterministic }, time: { elapsed: 10, scale: 1, frame: 0 }, rng: new Rng(7),
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), events: new EventBus(),
    input: { enabled: true, frozen: false, use: false, action(name) { return name === 'use' && this.use; } },
    player, ui,
    materials: null,
    audio: { play(kind) { sounds.push(kind); } },
    market: { open: false, credits: 0, addCredits(n) { this.credits += n; } },
    physics: { lineOfSight: () => true },
    world: { intelMarkers: markers, levelToWorld: (x, y, z) => new THREE.Vector3(x, y, z) },
    get(id) { return this[id]; }, peek(id) { return this[id]; },
  };
  for (const type of ['intel:spawn', 'intel:secured', 'intel:noise', 'intel:available']) {
    ctx.events.on(type, (e) => emitted.push({ type, ...e, position: e.position?.clone() }));
  }
  const intel = new IntelSystem();
  ctx.intel = intel;
  await intel.init(ctx);
  const aimAt = (cache) => {
    player.feetPosition.set(cache.x, cache.y, cache.z + 1.2);
    player.eyePosition.copy(player.feetPosition).add(new THREE.Vector3(0, 1.65, 0));
    ctx.camera.position.copy(player.eyePosition);
    ctx.camera.lookAt(cache.x, cache.y + INTEL.targetHeight, cache.z);
    ctx.camera.updateMatrixWorld();
  };
  const step = (dt, before) => {
    ctx.time.frame++;
    ctx.time.elapsed += dt * ctx.time.scale;
    before?.();
    intel.update(dt, ctx);
  };
  return { ctx, intel, player, sounds, emitted, aimAt, step };
}

const run = await harness();
run.intel.rng.float = () => 0.99;
run.ctx.events.emit('wave:complete', { wave: 1 });
assert.equal(run.intel._alive[0].id, 'far');
run.ctx.events.emit('wave:complete', { wave: 1 });
assert.equal(run.intel._alive.length, 1, 'duplicate wave events cannot spawn twice');
run.ctx.events.emit('wave:complete', { wave: 2 });
assert.equal(run.intel._alive[1].id, 'upper', 'wave spawning uses the half-spacing fallback when necessary');
run.ctx.events.emit('wave:complete', { wave: 3 });
assert.equal(run.intel._alive.length, 2);
assert.equal(run.intel._spawn(markers[0]), null, 'no unpooled third prop');
run.intel._despawn(run.intel._alive[0]);
run.ctx.events.emit('wave:complete', { wave: 4 });
assert.equal(run.intel._alive[1].id, 'near');
assert.equal(run.intel._used.size, 3);
run.intel._despawn(run.intel._alive[0]);
run.ctx.events.emit('wave:complete', { wave: 5 });
assert.equal(run.intel._used.size, 3, 'spent sites never repeat');
run.intel.reset();
run.intel.budget = 1;
run.ctx.events.emit('wave:complete', { wave: 1 });
run.intel._secure(run.intel._alive[0]);
run.ctx.events.emit('wave:complete', { wave: 2 });
assert.equal(run.intel._used.size, 1, 'run budget caps spawns');
run.intel.dispose();

const det = await harness(true);
for (let wave = 1; wave <= 20; wave++) det.ctx.events.emit('wave:complete', { wave });
assert.equal(det.intel.budget, 0);
assert.equal(det.intel._alive.length, 0);
assert.equal(det.emitted.length, 0);
det.intel.dispose();

const h = await harness();
const { intel, ctx, player, step, aimAt, sounds, emitted } = h;
const cache = intel._spawn(markers[0]);
aimAt(cache);
ctx.input.use = true;
step(1);
assert.equal(intel.getHudState().progress, 0.4);
assert.equal(emitted.filter((e) => e.type === 'intel:noise').length, 1);
assert(sounds.includes('intel_pry'));
step(0.1);
assert.equal(emitted.filter((e) => e.type === 'intel:noise').length, 1, 'noise has its own cadence');
ctx.input.use = false;
step(0.1);
assert.equal(intel._hold, 0, 'release wipes progress');
ctx.input.use = true;
step(1);
player.horizontalSpeed = 1;
step(0.1);
assert.equal(intel._hold, 0, 'walking cancels');
player.horizontalSpeed = 0;
step(1);
player.feetPosition.x += 0.2;
step(0.1);
assert.equal(intel._hold, 0, 'displacement cancels even with zero reported speed');
aimAt(cache);
step(1);
step(0.1, () => ctx.events.emit('damage:taken', { amount: 0, armourAbsorbed: 12 }));
assert.equal(intel._hold, 0, 'a plate hit also blocks progress in the damage frame');
step(1);
ctx.camera.rotateY(Math.PI);
step(0.1);
assert.equal(intel._hold, 0, 'looking away cancels');
assert(!ctx.ui.prompt.active, 'no prompt behind the player');
aimAt(cache);
step(1);
ctx.physics.lineOfSight = () => false;
step(3);
assert.equal(intel.secured, 0, 'LOS obstruction prevents securing');
ctx.physics.lineOfSight = () => true;
// A hidden closer crate must not mask the visible aimed target.
const second = intel._spawn({ id: 'blocked', x: cache.x, y: cache.y, z: cache.z + 1 });
ctx.physics.lineOfSight = (_eye, target) => target.z !== second.z;
assert.equal(intel._target(), cache);
intel._despawn(second);
ctx.physics.lineOfSight = () => true;

for (const setBlock of [
  () => { ctx.time.scale = 0; },
  () => { ctx.market.open = true; },
  () => { ctx.input.frozen = true; },
  () => { ctx.input.enabled = false; },
  () => { player.controlEnabled = false; },
  () => { player.dead = true; },
  () => { player.healCtrl.active = true; },
  () => { ctx.input.fire = true; },
  () => { ctx.input.ads = true; },
  () => { ctx.weapons = { reloading: true }; },
  () => { ctx.weapons = { switching: true }; },
  () => { ctx.weapons = { grenadeEquipped: true }; },
  () => { ctx.weapons = { radioEquipped: true }; },
]) {
  step(1);
  const before = emitted.length;
  setBlock();
  step(2.5);
  assert.equal(intel._hold, 0);
  assert.equal(intel.secured, 0);
  assert.equal(emitted.length, before, 'inactive gameplay never beeps, announces or alerts');
  ctx.time.scale = 1; ctx.market.open = false; ctx.input.frozen = false; ctx.input.enabled = true;
  player.controlEnabled = true; player.dead = false; player.healCtrl.active = false;
  ctx.input.fire = ctx.input.ads = false; ctx.weapons = null;
}
step(1);
step(0);
assert.equal(intel._hold, 0, 'zero-dt frame resets, never advances');
step(INTEL.hold);
assert.equal(intel.secured, 1);
assert.equal(ctx.market.credits, 150);
assert.equal(intel._drawn.length, 1);
assert(emitted.some((e) => e.type === 'intel:secured' && e.cardLabel && e.credits === 150));
assert(intel.blocksUse(), 'held F after completion cannot spill into ammunition');
intel._secure(cache);
assert.equal(ctx.market.credits, 150, 'securing twice is harmless');
ctx.input.use = false;
step(0.1);
assert(!intel.blocksUse());

// Both interaction owners use the same real prompt adapter.
ctx.ui.setPrompt({ text: 'replacement' }, 'ammo');
intel._prompting = true;
intel._clearPrompt();
assert(ctx.ui.prompt.active, 'intel cleanup cannot clear an ammo prompt');
ctx.ui.clearPrompt('ammo');
assert(!ctx.ui.prompt.active);
const owner = {
  ctx, rng: new Rng(1), player, state: { reserve: 0, def: { reserve: 90, magSize: 30 } },
  addReserve(n) { this.state.reserve += n; return n; }, current: 'rifle',
};
const pickups = new AmmoPickups(owner);
const again = intel._spawn({ id: 'again', x: 0, y: 0, z: 0 });
aimAt(again);
pickups.spawn(player.feetPosition);
ctx.input.use = true;
pickups.update(0.5);
step(0.5);
assert.equal(owner.state.reserve, 0, 'ammo yields to an aimed cache before intel.update');
assert.equal(intel._hold, 0.5);
ctx.camera.rotateY(Math.PI);
pickups.update(0.1);
step(0.1);
assert.equal(ctx.ui._promptOwner, 'ammo', 'leaving intel preserves replacement ammo prompt');
pickups.dispose();

// One detector for overlapping caches; it never generates hearing evidence.
intel._spawn({ id: 'close', x: 0.5, y: 0, z: 0 });
ctx.input.use = false;
intel._beepAt = 0;
const beeps = sounds.filter((s) => s === 'intel_beep').length;
const noise = emitted.filter((e) => e.type === 'intel:noise').length;
step(0.05);
assert.equal(sounds.filter((s) => s === 'intel_beep').length, beeps + 1);
assert.equal(emitted.filter((e) => e.type === 'intel:noise').length, noise);
assert.equal(intel.getHudState().pulses.length, 2);
assert.equal(intel.getHudState().pulses[0].y, again.y);
intel.reset();
assert.equal(intel._drawn.length, 0);
assert.equal(intel._used.size, 0);
assert.equal(intel.secured, 0);
assert.equal(intel._alive.length, 0);
assert.equal(intel._lastWave, 0);
assert.equal(intel._announceAt, 0);
assert(intel._pool.every((p) => !p.active && !p.group.parent));
const cards = new Set();
for (let i = 0; i < 6; i++) {
  const spawned = intel._spawn({ id: `card-${i}`, x: i * 2, y: 0, z: 0 });
  intel._secure(spawned);
  cards.add(intel.getHudState().card);
}
assert.equal(cards.size, 6, 'six names drawn without repetition');
assert.equal(intel.getHudState().secured, 6);
intel.dispose();
ctx.events.emit('wave:complete', { wave: 20 });
assert.equal(intel._alive.length, 0, 'dispose unsubscribes');
// Boot prewarm is simulation-transparent and restores GPU/scene state on failure.
const warm = await harness();
const lights = [
  { light: new THREE.PointLight(), range: 2 },
  { light: new THREE.PointLight(), range: 2 },
];
lights[0].light.visible = false;
lights[1].light.position.set(100, 0, 0);
const target = {};
let currentTarget = target;
let calls = 0;
let failCompile = false;
let freed = 0;
const renderer = {
  getRenderTarget: () => currentTarget,
  getActiveCubeFace: () => 3,
  getActiveMipmapLevel: () => 2,
  setRenderTarget(rt, face, mip) {
    currentTarget = rt;
    if (rt !== target) rt.addEventListener('dispose', () => freed++);
    else { assert.equal(face, 3); assert.equal(mip, 2); }
  },
  async compileAsync(scene) {
    assert.notEqual(currentTarget, target);
    assert.equal(lights[0].light.visible, true);
    assert.equal(lights[1].light.visible, false);
    assert(scene.children.includes(warm.intel._pool[0].group));
    calls++;
    if (failCompile) throw new Error('compile failure');
  },
};
warm.ctx.render = { renderer, lights, patchMaterials() {}, csm: { depthMaterial: {} }, gbuffer: { material: {} } };
const clock = { ...warm.ctx.time };
warm.intel.rng.u32 = () => { throw new Error('prewarm consumed gameplay RNG'); };
await warm.intel.prewarmMaterials();
assert.equal(calls, 3);
failCompile = true;
await assert.rejects(warm.intel.prewarmMaterials(), /compile failure/);
assert.equal(freed, 2);
assert.equal(currentTarget, target);
assert.equal(warm.ctx.scene.overrideMaterial, null);
assert.equal(lights[0].light.visible, false);
assert.equal(lights[1].light.visible, true);
assert.deepEqual(warm.ctx.time, clock);
assert.equal(warm.intel._used.size, 0);
assert.equal(warm.intel._alive.length, 0);
assert(!warm.intel._pool[0].group.visible && !warm.intel._pool[0].group.parent);
warm.intel.dispose();
console.log('ok  smoke-intel: random spacing/fallbacks, sites, limits, aim/LOS, cancellation, F ownership, cards, lifecycle, prewarm');
