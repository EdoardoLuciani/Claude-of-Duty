import assert from 'node:assert/strict';

import { Container, Text } from 'pixi.js';

import type { AmmoState } from '../../src/ui/ammo.ts';
import { AmmoPanel } from '../../src/ui/ammo.ts';
import { Compass, STRIP_W } from '../../src/ui/compass.ts';
import { DamageArcs } from '../../src/ui/damage.ts';
import { Hitmarkers, KINDS } from '../../src/ui/hitmarkers.ts';
import type { HitmarkerKind } from '../../src/ui/hitmarkers.ts';
import { Killfeed } from '../../src/ui/killfeed.ts';
import { PixiAmmoView } from '../../src/ui/pixi-ammo-view.ts';
import { PixiCombat } from '../../src/ui/pixi-combat.ts';
import { poseHudNode, writeHudText } from '../../src/ui/pixi-type.ts';
import { Pool } from '../../src/ui/util.ts';

const pool = new Pool(3);
assert.deepEqual([pool.acquire().i, pool.acquire().i, pool.acquire().i], [0, 1, 2]);
for (const [i, t, life] of [
  [0, 2, 10],
  [1, 0.4, 1],
  [2, 1, 10],
] as const) {
  pool.items[i].t = t;
  pool.items[i].life = life;
}
assert.equal(pool.acquire(), pool.items[1], 'full pool reuses normalized age, not absolute age');
assert.equal(pool.items[1].t, 0);
assert.equal(pool.advance(pool.items[0], 0), true);
assert.equal(pool.items[0].t, 2, 'pause freezes pool age');
assert.equal(pool.advance(pool.items[0], 8), false, 'expiry includes the lifetime boundary');
assert.equal(pool.advance(pool.items[0], 1), false);
assert.equal(pool.items[0].t, 10, 'dead slots do not accumulate age');
assert.equal(pool.acquire(), pool.items[0], 'free slots take priority over occupied ones');
pool.releaseAll();
assert.equal(pool.acquire().i, 1, 'clearing preserves free-slot rotation');
pool.releaseAll();
for (let i = 0; i < 3; i++) pool.acquire();
assert.equal(pool.acquire().i, 2, 'equal-age reuse begins at the retained rotation cursor');
assert(pool.items.every((item): boolean => item.node === null));

const hit = new Hitmarkers(),
  arcs = new DamageArcs(),
  compass = new Compass(),
  feed = new Killfeed();
function isHitmarkerKind(value: string): value is HitmarkerKind {
  return Object.hasOwn(KINDS, value);
}
for (const kind of Object.keys(KINDS)) {
  assert(isHitmarkerKind(kind));
  const marker = hit.spawn(kind);
  assert.equal(marker.life, KINDS[kind].life);
  hit.update(0);
  assert.equal(hit.visuals[marker.i].kind, kind);
  assert.equal(hit.visuals[marker.i].alpha, 1);
  hit.update(marker.life);
  assert.equal(marker.alive, false);
}
const arc = arcs.spawn(1, 0, 1);
arcs.update(0.09, 1, 0, 0, -1);
assert.equal(arcs.visuals[arc.i].rotation, Math.PI / 2);
assert.equal(arcs.visuals[arc.i].scale, 1);
assert.equal(arcs.visuals[arc.i].alpha, 1);
const arcPose = { ...arcs.visuals[arc.i] };
arcs.update(0, 1, 0, 0, -1);
assert.deepEqual(arcs.visuals[arc.i], arcPose);
arcs.update(2, 1, 0, 0, -1);
assert.equal(arc.alive, false);
compass.ping(0);
compass.update(-90, 0);
assert.equal(compass.heading, 270);
assert.equal(compass.pings[0].x, STRIP_W / 2 - 8, 'off-strip heard cues remain edge-clamped');
assert.equal(compass.pings[0].alpha, 1);
compass.update(270, 1.25);
assert.equal(compass.pingPool.items[0].alive, false);

for (let i = 0; i < 20; i++) {
  hit.spawn('kill');
  arcs.spawn(0, -1);
  compass.ping(i * 20);
  feed.push({ attacker: `actor ${i}`, victim: 'enemy' });
}
for (const [retained, capacity] of [
  [hit.pool, 10],
  [arcs.pool, 6],
  [compass.pingPool, 8],
  [feed.pool, 6],
] as const) {
  assert.equal(retained.items.length, capacity);
  assert.equal(retained.items.filter((item): boolean => item.alive).length, capacity);
  assert(retained.items.every((item): boolean => item.node === null));
}
feed.update(0.16);
assert(feed.rows.some((row): boolean => row.attacker === 'ACTOR 19' && row.alpha === 1));
hit.clear();
arcs.clear();
feed.clear();
assert(
  [hit.pool, arcs.pool, feed.pool].every((retained): boolean =>
    retained.items.every((item): boolean => !item.alive)
  )
);

const node = new Container();
assert.equal(poseHudNode(node, true, 0.6, 12, 24, 1.2, 0.5), true);
assert.equal(
  poseHudNode(node, true, 0.6, 12, 24, 1.2, 0.5),
  false,
  'settled poses do not invalidate'
);
assert.equal(poseHudNode(node, false, 0, 99, 99, 3, 2), true);
assert.deepEqual(
  [node.alpha, node.x, node.y, node.scale.x, node.rotation],
  [0.6, 12, 24, 1.2, 0.5],
  'hidden nodes keep their last visible pose'
);
assert.equal(poseHudNode(node, false, 0, 99, 99, 3, 2), false);
node.destroy();

// Model text measurement without a browser canvas; fitting must reset the old scale first.
let measurements = 0;
const label = new Text({ text: '' });
Object.defineProperty(label, 'width', {
  get: (): number => {
    measurements++;
    return label.text.length * 10 * label.scale.x;
  },
});
assert.equal(writeHudText(label, 'long weapon name', 40), true);
assert.equal(label.scale.x, 0.25);
const measured = measurements;
assert.equal(writeHudText(label, 'long weapon name', 40), false);
assert.equal(measurements, measured, 'unchanged text is not remeasured');
assert.equal(writeHudText(label, 'short', 40), true);
assert.equal(label.scale.x, 0.8, 'shorter replacement is fitted independently of the old scale');

const ammoView = new PixiAmmoView();
const ammoState: AmmoState = { ammo: 30, magSize: 30, reserve: 210, fireMode: 'auto' };
ammoView.update(0, ammoState);
ammoView.dirty = false;
ammoView.update(0, ammoState);
assert.equal(ammoView.dirty, false, 'unchanged ammo text and bars settle');
ammoView.update(0, { ...ammoState, ammo: 29, reserve: 209, fireMode: 'semi' });
assert.equal(ammoView.dirty, true);
assert.deepEqual(
  [ammoView['current'].text, ammoView['reserve'].text, ammoView['mode'].text],
  ['29', '/ 209', 'SEMI']
);
ammoView.dirty = false;
ammoView.update(0, { ...ammoState, ammo: 29, reserve: 209, fireMode: 'semi' });
assert.equal(ammoView.dirty, false);
ammoView.stage.destroy({ children: true });

const combat = new PixiCombat(),
  ammo = new AmmoPanel();
// Equipment layout is independent of glyph rasterization, which needs a browser canvas.
for (const slot of combat.slots)
  Object.defineProperty(slot.node, 'width', { get: (): number => 20 });
const models = { hit, arcs, compass, ammo, fpsText: '60 FPS' };
assert.equal(combat.update(models), true);
assert.equal(combat.update(models), false);
const marker = hit.spawn('head');
arcs.spawn(1, 0);
hit.update(0.05);
arcs.update(0.05, 1, 0, 0, -1);
assert.equal(combat.update(models), true);
assert.equal(combat.hitSlots[marker.i].node.visible, true);
assert.equal(combat.hitSlots[marker.i].mark.tint, Number.parseInt(KINDS.head.c.slice(1), 16));
assert.equal(combat.update(models), false, 'paused combat poses settle');
hit.update(1);
arcs.update(2, 1, 0, 0, -1);
assert.equal(combat.update(models), true, 'expiry invalidates once');
assert.equal(combat.update(models), false);
assert(combat.hitSlots.every((slot): boolean => !slot.node.visible));
assert(combat.arcSlots.every((slot): boolean => !slot.visible));
assert.equal(
  combat.update({ ...models, fpsText: '61 FPS' }),
  true,
  'wall-clock FPS still invalidates a paused presenter'
);
assert.equal(combat.update({ ...models, fpsText: '61 FPS' }), false);
for (const stage of [combat.hits, combat.arcs, combat.equipment, combat.fps])
  stage.destroy({ children: true });
console.log(
  'smoke-pixi-state: ok (bounded null pools, normalized reuse, frozen lifetimes, pose/text invalidation and retained combat)'
);
