/**
 * Al-Maktaba: authored points, random spawn, hold, credits.
 *
 *   node tests/smoke/smoke-intel.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntelSystem } from '../../src/intel/index.js';
import { shuffleDeck, drawCard, CARDS } from '../../src/intel/cards.js';
import { randomMarker, rollBudget, rollSpawn } from '../../src/intel/spawn.js';
import { INTEL, lureInterval } from '../../src/intel/tuning.js';
import { INTEL_POINTS } from '../../tools/worldgen/intel.js';
import { Rng } from '../../src/core/rng.js';

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
};

const ids = new Set(INTEL_POINTS.map((p) => p.id));
check('14 authored points', INTEL_POINTS.length === 14 && ids.size === 14);
check('sites leave the ground floor', INTEL_POINTS.some((p) => p.y > 2));
check('a roof is in the set', INTEL_POINTS.some((p) => p.id.endsWith('roof')));

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(root, 'public/models/world/level.json'), 'utf8'));
const exported = manifest.WORLD?.MARKERS?.INTEL ?? [];
check('level.json exports 14 intel markers', exported.length === 14);
check('exported ids match the authoring source',
  exported.every((marker) => ids.has(marker.id)) && exported.length === ids.size);

const budgets = new Set();
for (let i = 0; i < 40; i++) budgets.add(rollBudget(new Rng(i + 3)));
check('budget stays inside 3-5', [...budgets].every((n) => n >= 3 && n <= 5));
check('budget can hit both ends', budgets.has(3) && budgets.has(5));

const markers = [
  { id: 'near', x: 1, y: 0, z: 0, tag: 'near' },
  { id: 'far', x: 40, y: 0, z: -10, tag: 'far' },
  { id: 'mid', x: 8, y: 3, z: 2, tag: 'mid' },
];
const pickRng = { u32: () => 0 };
check('random pick is an unused site', randomMarker(markers, new Set(), pickRng)?.id === 'near');
check('random pick skips a spent site', randomMarker(markers, new Set(['near']), { u32: () => 0 })?.id === 'far');
check('spawn roll is 60%', rollSpawn({ float: () => 0.59 }) && !rollSpawn({ float: () => 0.6 }));
check('geiger tightens as you close', lureInterval(18) > lureInterval(4));

const deck = [];
shuffleDeck(new Rng(1), deck);
check('deck is the six cards once', deck.length === 6 && new Set(deck).size === 6);
check('draw empties the deck', drawCard(deck) && deck.length === 5);
check('card catalog matches the issue', CARDS.length === 6);

function harness() {
  const listeners = {};
  const emitted = [];
  const credits = { n: 0 };
  const health = { maxArmour: 150, armour: 50 };
  const player = {
    dead: false,
    controlEnabled: true,
    sprinting: false,
    tacticalSprint: false,
    sliding: false,
    mantling: false,
    airborne: false,
    horizontalSpeed: 0,
    feetPosition: { x: 0, y: 0, z: 0 },
    eyePosition: { x: 0, y: 1.65, z: 0 },
    position: { x: 0, y: 1.65, z: 0 },
    health,
    healCtrl: { active: false },
  };
  const prompts = [];
  const ctx = {
    config: { deterministic: false },
    time: { elapsed: 10, scale: 1 },
    rng: new Rng(7),
    camera: { position: { x: 0, y: 1.65, z: 0 } },
    scene: { add() {}, remove() {} },
    input: {
      frozen: false,
      enabled: true,
      held: false,
      action(name) { return name === 'use' && this.held; },
    },
    events: {
      on(type, fn) {
        (listeners[type] ??= []).push(fn);
        return () => {};
      },
      emit(type, payload) {
        emitted.push({
          type,
          payload: {
            ...payload,
            position: payload.position ? { x: payload.position.x, y: payload.position.y, z: payload.position.z } : undefined,
          },
        });
        for (const fn of listeners[type] ?? []) fn(payload);
      },
    },
    world: { intelMarkers: markers.map((m) => ({ ...m })) },
    player,
    market: { addCredits(n) { credits.n += n; } },
    physics: { lineOfSight: () => true },
    ui: {
      setPrompt(p) { prompts.push(p); },
      clearPrompt() { prompts.push(null); },
      setObjectives() {},
    },
    ai: {},
    get(id) { return ctx[id]; },
    peek(id) { return ctx[id]; },
  };
  return { ctx, listeners, emitted, credits, player, prompts };
}

function forceSpawn(intel) {
  intel.rng.float = () => 0;
  intel.rng.u32 = () => 0;
}

const live = harness();
const intel = new IntelSystem();
await intel.init(live.ctx);
check('run budget is 3-5', intel.budget >= 3 && intel.budget <= 5);
forceSpawn(intel);
live.listeners['wave:complete'][0]({});
check('a successful roll places one unused site', intel._alive.length === 1 && intel._used.size === 1);
const firstId = intel._alive[0].id;
live.listeners['wave:complete'][0]({});
check('second spawn is a different site',
  intel._alive.length === 2 && intel._alive.every((c, i) => i === 0 || c.id !== firstId) && intel._alive[1].id !== firstId);
check('two alive blocks a third', (() => {
  live.listeners['wave:complete'][0]({});
  return intel._alive.length === 2;
})());

intel.rng.float = () => 0.99;
const before = intel._used.size;
live.ctx.player.dead = false;
// slots are full, so also prove a miss does not place when a slot frees
intel._despawn(intel._alive[0]);
live.listeners['wave:complete'][0]({});
check('a failed 60% roll places nothing', intel._used.size === before);

const det = harness();
det.ctx.config.deterministic = true;
const quiet = new IntelSystem();
await quiet.init(det.ctx);
forceSpawn(quiet);
det.listeners['wave:complete'][0]({});
check('deterministic capture spawns nothing', quiet._alive.length === 0 && det.emitted.length === 0);

const hold = harness();
const opener = new IntelSystem();
await opener.init(hold.ctx);
forceSpawn(opener);
hold.listeners['wave:complete'][0]({});
const cache = opener._alive[0];
hold.player.feetPosition.x = cache.x;
hold.player.feetPosition.y = cache.y;
hold.player.feetPosition.z = cache.z;
hold.player.eyePosition.x = cache.x;
hold.player.eyePosition.y = cache.y + 1.65;
hold.player.eyePosition.z = cache.z + 0.4;
hold.ctx.input.held = true;
opener.update(1, hold.ctx);
check('hold is partial at 1s', opener.getHudState().progress > 0.3 && opener.getHudState().progress < 0.5);
check('the pry is rifle-loud', hold.emitted.some((e) => e.type === 'intel:noise' && e.payload.loudness === 90));
hold.player.horizontalSpeed = 1.2;
opener.update(0.1, hold.ctx);
check('walking wipes the hold', opener.getHudState().progress === 0);
hold.player.horizontalSpeed = 0;
hold.ctx.input.held = true;
opener.update(0.4, hold.ctx);
hold.listeners['damage:taken'][0]({ amount: 0, armourAbsorbed: 12 });
check('a plate hit wipes the hold', opener.getHudState().progress === 0);

hold.ctx.physics.lineOfSight = () => false;
opener.update(3, hold.ctx);
check('lost line of sight does not secure', opener.secured === 0);
hold.ctx.physics.lineOfSight = () => true;
opener.update(INTEL.hold, hold.ctx);
check('a full hold secures the cache', opener.secured === 1);
check('payout is credits and one card name', hold.credits.n === INTEL.credits && opener._drawn.length === 1);
check('secured event names the card', hold.emitted.some((e) => e.type === 'intel:secured' && e.payload.card && e.payload.credits === 150));
check('minimap pulse tracks the live cache', opener.getHudState().pulses.length === opener._alive.length);

const noises = hold.emitted.filter((e) => e.type === 'intel:noise').length;
hold.ctx.input.held = false;
opener.update(0.05, hold.ctx);
check('the lure does not alert AI', hold.emitted.filter((e) => e.type === 'intel:noise').length === noises);

opener.reset();
check('restart clears the card and the caches', opener.secured === 0 && opener._drawn.length === 0 && opener._alive.length === 0);

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('ok  smoke-intel');
