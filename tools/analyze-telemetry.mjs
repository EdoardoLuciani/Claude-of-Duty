#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { extractTar } from '../src/dev/telemetry.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/analyze-telemetry.mjs <run.json|run.tgz> [--out summary.json]');
  process.exit(1);
}

const outIndex = process.argv.indexOf('--out');
const outFile = outIndex >= 0 ? process.argv[outIndex + 1] : null;
const raw = readFileSync(file);
const jsonBuf = raw[0] === 0x1f && raw[1] === 0x8b
  ? extractTar(gunzipSync(raw))['telemetry.json']
  : raw;
if (!jsonBuf) throw new Error('archive has no telemetry.json');
const run = JSON.parse(Buffer.from(jsonBuf).toString('utf8'));
if (![3, 4].includes(run.schema) || !Array.isArray(run.events)) {
  throw new Error(`unsupported telemetry schema ${run.schema ?? '<missing>'}`);
}

const events = run.events;
const players = run.playerSamples ?? [];
const enemies = run.enemySamples ?? [];
const hitches = run.hitches ?? [];
const longTasks = run.longTasks ?? [];
const round1 = (n) => Math.round(n * 10) / 10;
const counts = {};
for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

/**
 * Freeze forensics. A hitch is booked against the frame that ENDED the gap, so
 * the events that caused or followed it are on that frame and the one before;
 * the long tasks that overlap the gap in wall time say which code ran, and a
 * jump in the renderer's resource counters says what was built.
 */
const tasksOverlapping = (h) => {
  const from = (h.wall ?? 0) - (h.wallMs ?? 0) / 1000;
  return longTasks
    .filter((t) => Number.isFinite(t.wall) && t.wall >= from - 0.05 && t.wall <= (h.wall ?? 0) + 0.05)
    .sort((a, b) => b.ms - a.ms);
};

/** Index of the sample closest to `t`, walking on from `i` so a caller looping
 *  over samples in order stays O(n) for the whole run. */
function nearest(rows, t, i = 0) {
  while (i + 1 < rows.length && Math.abs(rows[i + 1].t - t) <= Math.abs(rows[i].t - t)) i++;
  return i;
}

const nearestSample = (rows, t) => (rows.length && Number.isFinite(t) ? rows[nearest(rows, t)] : null);

const scriptLabel = (s, task) =>
  `${s.fn ? `${s.fn} @ ` : ''}${s.url ?? task.kind}${s.type ? ` (${s.type})` : ''}`;

const eventsNearFrame = (frame) => {
  if (!Number.isFinite(frame)) return [];
  const types = new Set();
  for (const e of events) {
    if (e.frame >= frame - 1 && e.frame <= frame && e.type !== 'player:footstep') types.add(e.type);
  }
  return [...types];
};

const classify = (h, tasks) => {
  const r = h.render ?? {};
  if ((r.dPrograms ?? 0) > 0) return 'shader-compile';
  if ((r.dTextures ?? 0) > 0) return 'texture-upload';
  if ((r.dGeometries ?? 0) > 0) return 'geometry-upload';
  if (tasks.length) return 'script';
  if (h.suspended) return 'tab-hidden';
  return 'unattributed';
};

const hitchCauses = {};
let worstHitchMs = 0;
let hitchBlockingMs = 0;
let suspendedHitches = 0;
for (const h of hitches) {
  const cause = classify(h, tasksOverlapping(h));
  hitchCauses[cause] = (hitchCauses[cause] ?? 0) + 1;
  worstHitchMs = Math.max(worstHitchMs, h.wallMs ?? 0);
  if (h.suspended) suspendedHitches++;
}
for (const t of longTasks) hitchBlockingMs += t.blockingMs ?? t.ms ?? 0;

const worstHitches = [...hitches]
  .sort((a, b) => b.wallMs - a.wallMs)
  .slice(0, 20)
  .map((h) => {
    const tasks = tasksOverlapping(h);
    const r = h.render ?? {};
    const sample = nearestSample(players, h.t);
    const near = nearestSample(enemies, h.t);
    const scripts = new Set();
    for (const t of tasks) {
      for (const s of t.scripts ?? []) scripts.add(scriptLabel(s, t));
    }
    return {
      wall: h.wall, wallMs: h.wallMs, gameDtMs: h.gameDtMs, frame: h.frame,
      cause: classify(h, tasks),
      suspended: !!h.suspended,
      dPrograms: r.dPrograms ?? null, dTextures: r.dTextures ?? null,
      dGeometries: r.dGeometries ?? null, dHeapMb: h.dHeapMb ?? null,
      blockingMs: round1(tasks.reduce((sum, t) => sum + (t.blockingMs ?? t.ms ?? 0), 0)),
      scripts: [...scripts].slice(0, 4),
      // A hitch stores only what changed inside the gap, so everything about the
      // frame comes from the sample the recorder was already taking. `sampleDt`
      // is how far that sample is from the freeze on the game's clock.
      sampleDt: sample ? Math.round((sample.t - h.t) * 1000) : null,
      player: sample ? {
        state: sample.state, stance: sample.stance, weapon: sample.weapon,
        health: sample.health, actions: sample.actions,
      } : null,
      calls: sample?.renderCalls ?? null,
      triangles: sample?.triangles ?? null,
      wave: sample?.wave ?? null,
      marketOpen: !!sample?.marketOpen,
      alive: near ? near.alive : null,
      events: eventsNearFrame(h.frame),
    };
  });

const scriptTotals = new Map();
for (const t of longTasks) {
  for (const s of t.scripts ?? []) {
    const key = scriptLabel(s, t);
    const row = scriptTotals.get(key) ?? { script: key, tasks: 0, ms: 0, forcedMs: 0 };
    row.tasks++;
    row.ms += s.ms ?? 0;
    row.forcedMs += s.forcedMs ?? 0;
    scriptTotals.set(key, row);
  }
}
const worstScripts = [...scriptTotals.values()]
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 10)
  .map((row) => ({ ...row, ms: round1(row.ms), forcedMs: round1(row.forcedMs) }));

const impactsByFrame = new Map();
for (const e of events) {
  if (e.type !== 'bullet:impact' || e.exit) continue;
  const rows = impactsByFrame.get(e.frame) ?? [];
  rows.push(e);
  impactsByFrame.set(e.frame, rows);
}

const weapons = {};
for (const e of events) {
  if (e.type !== 'shot:resolved') continue;
  const side = e.shooter === 'player' ? 'player' : 'enemy';
  const key = `${side}:${e.weapon ?? 'unknown'}`;
  const row = weapons[key] ?? (weapons[key] = {
    shooter: side, weapon: e.weapon ?? 'unknown', shots: 0,
    actorHits: 0, worldHits: 0, misses: 0, damage: 0,
  });
  row.shots++;
  let target = e.target;
  if (!target && e.to) {
    let best = null;
    let bestDistance = 0.12;
    for (const impact of impactsByFrame.get(e.frame) ?? []) {
      if (!impact.target || !impact.point) continue;
      const d = Math.hypot(
        impact.point[0] - e.to[0], impact.point[1] - e.to[1], impact.point[2] - e.to[2]
      );
      if (d < bestDistance) { best = impact; bestDistance = d; }
    }
    target = best?.target ?? null;
  }
  if (target) row.actorHits++;
  else if (e.result === 'impact') row.worldHits++;
  else row.misses++;
  row.damage += Number(e.damage) || 0;
}
for (const row of Object.values(weapons)) {
  row.damage = round1(row.damage);
  row.actorHitRate = round1((row.actorHits / row.shots) * 100);
}

const duration = run.summary?.duration ?? players.at(-1)?.t ?? enemies.at(-1)?.t ?? 0;
const contactBySource = {};
let previousContacts = new Set();
for (let i = 0; i < enemies.length; i++) {
  const sample = enemies[i];
  const next = enemies[i + 1];
  const dt = Math.max(0, Math.min(0.5, (next?.t ?? sample.t + 0.2) - sample.t));
  const contacts = new Set();
  for (const a of sample.enemies) {
    if (!a.hudContact) continue;
    const source = Number.isFinite(a.lastFiredAge) && (
      !Number.isFinite(a.lastSeenAge) || a.lastFiredAge < a.lastSeenAge
    ) ? 'fire' : 'los';
    const key = `${a.id}:${source}`;
    contacts.add(key);
    const row = contactBySource[source] ?? (
      contactBySource[source] = { episodes: 0, actorSeconds: 0 }
    );
    if (!previousContacts.has(key)) row.episodes++;
    row.actorSeconds += dt;
  }
  previousContacts = contacts;
}
for (const row of Object.values(contactBySource)) row.actorSeconds = round1(row.actorSeconds);

let playerIndex = 0;
const finalEnemyEpisodes = [];
let episode = null;
for (const sample of enemies) {
  if (sample.alive !== 1 || sample.enemies.length !== 1) {
    episode = null;
    continue;
  }
  const a = sample.enemies[0];
  if (!episode || episode.actor !== `ai:${a.id}`) {
    episode = {
      actor: `ai:${a.id}`, start: sample.t, end: sample.t, samples: 0,
      states: {}, stationaryRows: 0, pathPendingRows: 0, maxStuck: 0,
      minDistance: Infinity, maxDistance: 0, previousPos: null,
    };
    finalEnemyEpisodes.push(episode);
  }
  episode.end = sample.t;
  episode.samples++;
  episode.states[a.state] = (episode.states[a.state] ?? 0) + 1;
  if (a.pathPending) episode.pathPendingRows++;
  episode.maxStuck = Math.max(episode.maxStuck, Number(a.stuckTime) || 0);
  if (episode.previousPos) {
    const moved = Math.hypot(
      a.position[0] - episode.previousPos[0],
      a.position[1] - episode.previousPos[1],
      a.position[2] - episode.previousPos[2]
    );
    if (moved < 0.08) episode.stationaryRows++;
  }
  episode.previousPos = a.position;
  playerIndex = nearest(players, sample.t, playerIndex);
  const p = players[playerIndex]?.position;
  if (p) {
    const d = Math.hypot(a.position[0] - p[0], a.position[1] - p[1], a.position[2] - p[2]);
    episode.minDistance = Math.min(episode.minDistance, d);
    episode.maxDistance = Math.max(episode.maxDistance, d);
  }
}

for (const e of finalEnemyEpisodes) {
  e.duration = Math.max(0, e.end - e.start);
  e.stationaryPercent = e.samples > 1 ? round1((e.stationaryRows / (e.samples - 1)) * 100) : 0;
  e.pathPendingPercent = round1((e.pathPendingRows / e.samples) * 100);
  e.minPlayerDistance = Number.isFinite(e.minDistance) ? round1(e.minDistance) : null;
  e.maxPlayerDistance = e.maxDistance ? round1(e.maxDistance) : null;
  delete e.stationaryRows;
  delete e.pathPendingRows;
  delete e.minDistance;
  delete e.maxDistance;
  delete e.previousPos;
  delete e.end;
}
const finalEnemy = finalEnemyEpisodes.at(-1) ?? null;

const markers = [];
for (const marker of run.markers ?? []) {
  const nearby = events
    .filter((e) => Math.abs(e.t - marker.t) <= 3 && e.type !== 'player:footstep')
    .map((e) => ({ dt: Math.round((e.t - marker.t) * 1000) / 1000, ...e }));
  // F7 is pressed *after* the freeze, so look backwards further than forwards.
  const nearbyHitches = Number.isFinite(marker.wall) ? hitches
    .filter((h) => Number.isFinite(h.wall)
      && h.wall <= marker.wall + 0.5 && h.wall >= marker.wall - 6)
    .sort((a, b) => b.wall - a.wall)
    .map((h) => ({
      dt: Math.round((h.wall - marker.wall) * 1000) / 1000,
      wallMs: h.wallMs,
      cause: classify(h, tasksOverlapping(h)),
    })) : [];
  markers.push({ ...marker, nearbyEvents: nearby, nearbyHitches });
}

const summary = {
  file: basename(file),
  schema: run.schema,
  startedAt: run.meta?.startedAt ?? null,
  quality: run.meta?.quality ?? null,
  duration,
  rawDuration: run.summary?.rawDuration ?? null,
  samples: { player: players.length, enemy: enemies.length },
  maxAlive: run.summary?.maxAlive ?? null,
  observers: run.meta?.observers ?? null,
  freezes: hitches.length ? {
    hitches: hitches.length,
    dropped: run.summary?.hitchDropped ?? 0,
    worstMs: round1(worstHitchMs),
    suspended: suspendedHitches,
    causes: hitchCauses,
    worst: worstHitches,
    longTasks: longTasks.length,
    longTaskMs: round1(hitchBlockingMs),
    longTaskDropped: run.summary?.longTaskDropped ?? 0,
    worstScripts,
  } : null,
  wavesStarted: counts['wave:start'] ?? 0,
  kills: counts['actor:death'] ?? 0,
  damageTakenEvents: counts['damage:taken'] ?? 0,
  compassPings: counts['hud:heard'] ?? 0,
  eventCounts: counts,
  weapons: Object.values(weapons),
  minimapContacts: contactBySource,
  finalEnemy,
  finalEnemyEpisodes,
  markers,
};

console.log(JSON.stringify(summary, null, 2));
if (outFile) writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n');
