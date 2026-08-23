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
if (run.schema !== 3 || !Array.isArray(run.events)) {
  throw new Error(`unsupported telemetry schema ${run.schema ?? '<missing>'}`);
}

const events = run.events;
const players = run.playerSamples ?? [];
const enemies = run.enemySamples ?? [];
const round1 = (n) => Math.round(n * 10) / 10;
const counts = {};
for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

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

function nearestPlayer(t, i) {
  while (i + 1 < players.length && Math.abs(players[i + 1].t - t) <= Math.abs(players[i].t - t)) i++;
  return i;
}

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
  playerIndex = nearestPlayer(sample.t, playerIndex);
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
  markers.push({ ...marker, nearbyEvents: nearby });
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
