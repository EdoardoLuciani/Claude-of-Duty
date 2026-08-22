import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AiSystem } from '../src/ai/index.js';
import { Squad } from '../src/ai/squad.js';
import {
  INTENT,
  PLANT_HOLD,
  PLANT_WRAP_AGE,
  FLUSH_KNOWN,
  PEEK_DEATHS_NEEDED,
  clusterPeekDeaths,
  decideIntent,
  isBannedCover,
  pickSquadAnchors,
} from '../src/ai/intent.js';

assert.equal(PEEK_DEATHS_NEEDED, 2);
assert.equal(PLANT_HOLD, 3);
assert.equal(FLUSH_KNOWN, 1.5);

// ---- clustering -----------------------------------------------------------
assert.equal(clusterPeekDeaths([], 10), null);
assert.equal(clusterPeekDeaths([{ x: 0, z: 0, t: 1 }], 2), null);

const two = clusterPeekDeaths(
  [{ x: 0, z: 0, t: 1 }, { x: 1.2, z: 0.4, t: 2 }],
  3,
);
assert.ok(two);
assert.equal(two.count, 2);
assert.ok(Math.hypot(two.x - 0.6, two.z - 0.2) < 0.2);

const stale = clusterPeekDeaths(
  [{ x: 0, z: 0, t: 1 }, { x: 0.5, z: 0, t: 1.2 }],
  30,
);
assert.equal(stale, null, 'deaths older than CLUSTER_MAX_AGE must not cluster');

const far = clusterPeekDeaths(
  [{ x: 0, z: 0, t: 1 }, { x: 20, z: 0, t: 1.2 }],
  3,
);
assert.equal(far, null, 'deaths on different rocks must not cluster');

const lane = decideIntent({
  planted: true, plantAge: 0.2, lastKnownAge: 0.3, cluster: null,
  peekDeathCount: 2, hasGrenade: true,
});
assert.equal(lane.intent, INTENT.WRAP, 'planted + two deaths on different rocks still wraps');
assert.equal(lane.why, 'peek-deaths');
assert.equal(lane.wantFlush, true);

assert.equal(isBannedCover(null, two), false);
assert.equal(isBannedCover({ x: two.x, z: two.z }, two), true);
assert.equal(isBannedCover({ x: two.x + 10, z: two.z }, two), false);

// ---- decideIntent ---------------------------------------------------------
const pin = decideIntent({
  planted: false, plantAge: 0, lastKnownAge: 10, cluster: null, hasGrenade: true,
});
assert.equal(pin.intent, INTENT.PIN);
assert.equal(pin.wantFlush, false);

const flush = decideIntent({
  planted: true, plantAge: 0.5, lastKnownAge: 0.2, cluster: null, hasGrenade: true,
});
assert.equal(flush.intent, INTENT.FLUSH);
assert.equal(flush.why, 'planted');
assert.equal(flush.wantFlush, true);

const noNade = decideIntent({
  planted: true, plantAge: 0.5, lastKnownAge: 0.2, cluster: null, hasGrenade: false,
});
assert.equal(noNade.intent, INTENT.PIN, 'no grenade and no wrap-age yet → still pin');

const staleKnown = decideIntent({
  planted: true, plantAge: 0.5, lastKnownAge: 4, cluster: null, hasGrenade: true,
});
assert.equal(staleKnown.intent, INTENT.PIN, 'stale last-known must not flush (that would cheat)');

const plantWrap = decideIntent({
  planted: true, plantAge: PLANT_WRAP_AGE, lastKnownAge: 4, cluster: null, hasGrenade: false,
});
assert.equal(plantWrap.intent, INTENT.WRAP);
assert.equal(plantWrap.why, 'planted');

const deaths = decideIntent({
  planted: true, plantAge: 0, lastKnownAge: 0.4, cluster: two, hasGrenade: true,
});
assert.equal(deaths.intent, INTENT.WRAP);
assert.equal(deaths.why, 'peek-deaths');
assert.equal(deaths.wantFlush, true);
assert.equal(deaths.banned, two);

const deathsNoNade = decideIntent({
  planted: false, plantAge: 0, lastKnownAge: 0.4, cluster: two, hasGrenade: false,
});
assert.equal(deathsNoNade.intent, INTENT.WRAP);
assert.equal(deathsNoNade.wantFlush, false);

const deathsStale = decideIntent({
  planted: true, plantAge: 1, lastKnownAge: 8, cluster: two, hasGrenade: true,
});
assert.equal(deathsStale.intent, INTENT.WRAP);
assert.equal(deathsStale.wantFlush, false, 'must not nade a last-known that went cold');

const unseen = decideIntent({
  planted: false, plantAge: 0, lastKnownAge: 8, cluster: null,
  peekDeathCount: 2, hasGrenade: true, anyVisual: false,
});
assert.equal(unseen.intent, INTENT.WRAP, 'unseen deaths on a bearing wrap');
assert.equal(unseen.why, 'unseen-deaths');
assert.equal(unseen.wantFlush, false, 'no nade without eyes');

const seen = decideIntent({
  planted: false, plantAge: 0, lastKnownAge: 8, cluster: null,
  peekDeathCount: 2, hasGrenade: true, anyVisual: true,
});
assert.equal(seen.intent, INTENT.PIN, 'eyes on the shooter: deaths alone do not wrap');

const ranked = [
  { s: { position: { x: 0, z: 80 } }, d: 80 },
  { s: { position: { x: 0, z: 50 } }, d: 50 },
  { s: { position: { x: 40, z: 20 } }, d: 45 },
];
const anchors = pickSquadAnchors(ranked, { x: 0, z: 0 }, 2);
assert.equal(anchors[0].d, 80, 'first squad is the farthest');
assert.equal(anchors[1].d, 45, 'second squad takes the off-axis spawn, not the next-farthest on the same line');

const squadRng = { float: () => 0.5, range: (a, b) => (a + b) * 0.5 };
const member = (id) => ({
  id, alive: true, position: new THREE.Vector3(id, 0, 0),
  lastKnown: new THREE.Vector3(0, 0, 10), _wrapDone: false,
  peeking: false, state: 'combat', cover: null, repathTimer: 0,
});
const squad = new Squad(squadRng);
squad.ai = { grid: null, cover: null };
squad.intent = INTENT.WRAP;
squad.why = 'unseen-deaths';
squad.members = [member(1), member(2)];
squad._assignRoles(squad.members);
assert.equal(squad.peekTokens, 1, 'wrapping squad keeps one firing token');

squad.why = 'peek-deaths';
squad.members = [member(3)];
squad._assignRoles(squad.members);
assert.equal(squad.peekTokens, 1, 'last wrapper can still peek');

const emptySpawn = {
  ctx: { peek: () => ({ spawnPoints: [{ position: new THREE.Vector3(0, 0, 30), yaw: 0 }] }) },
  grid: {}, _v3: new THREE.Vector3(),
  playerPosition(out) { return out.set(0, 0, 0); },
  _pickSpawnNear() { return null; },
  createSquad() { assert.fail('failed anchor created a squad'); },
};
assert.equal(AiSystem.prototype.populate.call(emptySpawn, { squads: 1, perSquad: 2 }), 0);

console.log('ok  smoke-ai-intent');
