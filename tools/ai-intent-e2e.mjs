#!/usr/bin/env node
/**
 * Slice-1 intent rubric against a planted LMG.
 *
 * Boots the real game in lockstep, stands the player still, drops a squad in
 * front of them, farms two peekers, then asserts the squad wraps / flushes
 * within 8 s without cheating (no damage from a cold last-known).
 *
 *   node tools/ai-intent-e2e.mjs
 */
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

const PORT = Number(process.env.OW_E2E_PORT ?? 8091);
const server = await ensureViteServer({ port: PORT });
const browser = await launchChromium({
  headless: true,
  args: [
    '--ignore-gpu-blocklist', '--force-color-profile=srgb',
    '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio',
    '--disable-frame-rate-limit',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const fail = async (msg, extra) => {
  console.error('FAIL', msg);
  if (extra) console.error(JSON.stringify(extra, null, 2));
  if (errors.length) console.error('page errors', errors.slice(0, 8));
  stopViteServer(server);
  await browser.close().catch(() => {});
  process.exit(1);
};

console.log('boot...');
await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&prewarm=0`, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
const pump = (n) => page.evaluate((k) => window.__PUMP__(k), n);

const setup = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ctx = E.ctx;
  const ai = ctx.get('ai');
  const player = ctx.get('player');
  const world = ctx.get('world');
  const weapons = ctx.get('weapons');
  if (!ai.grid) return { error: 'no nav grid' };

  // Capture mode skips the wave director; start from an empty field.
  for (const a of ai.agents.slice()) a.dispose?.();
  ai.agents.length = 0;
  ai.squads.length = 0;

  player.health.value = 800;
  player.health.armour = 150;
  player.health.dead = false;
  try { weapons.equipPrimary('lmg'); } catch { /* already owned in some boots */ }

  ai.pathsPerFrame = 8;

  const cam = E.camera;
  const px = player.position.x, pz = player.position.z, py = player.position.y;
  const spawns = (world.spawnPoints ?? []).map((s) => ({
    x: s.position.x, y: s.position.y, z: s.position.z,
    d: Math.hypot(s.position.x - px, s.position.z - pz),
  }));
  spawns.sort((a, b) => a.d - b.d);
  const anchor = spawns.find((s) => s.d > 16 && s.d < 36) ?? spawns[spawns.length - 1];
  if (!anchor) return { error: 'no spawn anchor', spawns };

  const dx = anchor.x - px, dz = anchor.z - pz;
  const yaw = Math.atan2(-dx, -dz);
  player.teleport({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, yaw);

  const place = (x, z) => {
    const i = ai.grid.nearest(x, z, py, 12, 1.8);
    if (i < 0) return null;
    return {
      x: ai.grid.worldX(i % ai.grid.nx),
      y: ai.grid.floor[i],
      z: ai.grid.worldZ((i / ai.grid.nx) | 0),
    };
  };

  const squad = ai.createSquad();
  const variants = ['vanguard', 'irregular', 'breacher'];
  const made = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const d = 16 + t * 6;
    const lat = (i % 2 === 0 ? 1 : -1) * (2.2 + i * 0.7);
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len, fz = dz / len;
    const rx = -fz, rz = fx;
    const p = place(px + fx * d + rx * lat, pz + fz * d + rz * lat);
    if (!p) continue;
    const ayaw = Math.atan2(px - p.x, pz - p.z);
    const a = ai.spawn(variants[i % 3], p, ayaw);
    squad.add(a);
    made.push({ id: a.id, x: p.x, y: p.y, z: p.z });
  }
  if (made.length < 4) return { error: 'spawned too few', made, anchor };

  const shots = [];
  ctx.events.on('damage:dealt', (e) => {
    const t = e?.target;
    const onPlayer = t === 'player' || t === player || t?.isPlayer === true;
    if (!onPlayer) return;
    const src = e.source;
    shots.push({
      t: E.time.elapsed,
      amount: e.amount,
      lastKnownAge: src?.lastKnownAge ?? null,
      hasTarget: !!src?.hasTarget,
      targetVisible: !!src?.targetVisible,
      id: src?.id ?? null,
    });
  });
  window.__INTENT_SHOTS__ = shots;

  const nades = [];
  ctx.events.on('explosion', (e) => {
    nades.push({ t: E.time.elapsed, x: e.position?.x, z: e.position?.z });
  });
  window.__INTENT_NADES__ = nades;

  return {
    player: [px, py, pz],
    yaw,
    anchor,
    made,
    coverPts: ai.cover?.points?.length ?? 0,
  };
});

if (setup?.error) await fail('setup', setup);
console.log('setup', JSON.stringify({
  player: setup.player, n: setup.made.length, coverPts: setup.coverPts, anchorD: setup.anchor?.d,
}));

await pump(2);

const intel = () => page.evaluate(() => {
  const E = window.__ENGINE__;
  const ai = E.ctx.get('ai');
  const snap = (s) => ({
    intent: s.intent, why: s.why, planted: s.planted, wantFlush: s.wantFlush,
    banned: s.banned, peekDeaths: s.peekDeaths.length, hasWrapDest: s.hasWrapDest,
    wrapperId: s.wrapper?.id ?? null,
    members: s.members.map((m) => ({
      id: m.id, alive: m.alive, state: m.state, role: m.role, peeking: !!m.peeking,
      hp: m.health, hasTarget: m.hasTarget, targetVisible: m.targetVisible,
      lastKnownAge: m.lastKnownAge, wrapDone: !!m._wrapDone,
      x: m.position.x, z: m.position.z,
      cover: m.cover ? { x: m.cover.x, z: m.cover.z } : null,
    })),
  });
  return {
    elapsed: E.time.elapsed,
    intel: { squads: ai.squads.map(snap) },
    shots: window.__INTENT_SHOTS__.slice(),
    nades: window.__INTENT_NADES__.slice(),
    grenadesInFlight: ai._grenades?.length ?? 0,
    grenadeHolds: ai.stats?.grenadeHolds ?? 0,
  };
});

const killPeekers = (n) => page.evaluate((want) => {
  const ai = window.__ENGINE__.ctx.get('ai');
  const killed = [];
  const ranked = ai.agents.filter((a) => a.alive && !a.silentDeath && a.team !== 0);
  ranked.sort((a, b) => {
    const sa = (a.peeking ? 2 : 0) + (a.cover ? 1 : 0) + (a.state === 'combat' ? 1 : 0);
    const sb = (b.peeking ? 2 : 0) + (b.cover ? 1 : 0) + (b.state === 'combat' ? 1 : 0);
    return sb - sa;
  });
  for (const a of ranked) {
    if (killed.length >= want) break;
    if (!a.cover && !a.peeking && a.state !== 'combat') continue;
    a.applyDamage(200, 'torso', a.position, { x: 0, y: 0, z: 1 });
    killed.push({ id: a.id, peeking: a.peeking, state: a.state, cover: !!a.cover });
  }
  return killed;
}, n);

// Wait until the squad has contact and at least two men in the fight.
let snap = await intel();
const WAIT = 20;
while (snap.elapsed < WAIT) {
  await pump(30);
  snap = await intel();
  const sq = snap.intel.squads[0];
  const fighting = sq?.members.filter((m) => m.alive && (m.hasTarget || m.state === 'combat' || m.peeking)) ?? [];
  const peeking = sq?.members.filter((m) => m.alive && (m.peeking || m.cover)) ?? [];
  if (fighting.length >= 2 && peeking.length >= 2) break;
}

const pre = snap.intel.squads[0];
if (!pre) await fail('no squad after wait', snap);
console.log('pre-kill', JSON.stringify({
  t: +snap.elapsed.toFixed(2), intent: pre.intent, why: pre.why, planted: pre.planted,
  fighting: pre.members.filter((m) => m.alive).map((m) => ({
    id: m.id, state: m.state, role: m.role, peeking: m.peeking, cover: !!m.cover,
  })),
}));

const peekReady = pre.members.filter((m) => m.alive && (m.peeking || m.cover || m.state === 'combat'));
if (peekReady.length < 2) await fail('never reached cover/peek', { pre, elapsed: snap.elapsed });

const killed = await killPeekers(2);
if (killed.length < 2) await fail('could not kill two peekers', { killed, pre });
console.log('killed', killed);

const t0 = (await intel()).elapsed;
let wrapAt = null;
let nadeAt = null;
let bannedPeek = false;
let last = null;

while (true) {
  last = await intel();
  const dt = last.elapsed - t0;
  const sq = last.intel.squads[0];
  if (sq?.intent === 'wrap' && wrapAt == null) wrapAt = dt;
  if ((last.nades.length || last.grenadesInFlight) && nadeAt == null) nadeAt = dt;
  if (sq?.banned) {
    for (const m of sq.members) {
      if (!m.alive || !m.peeking || !m.cover) continue;
      const d = Math.hypot(m.cover.x - sq.banned.x, m.cover.z - sq.banned.z);
      if (d <= (sq.banned.r ?? 4)) bannedPeek = true;
    }
  }
  if (dt >= 8.2) break;
  await pump(20);
}

const sq = last.intel.squads[0];
const wrapper = sq.members.find((m) => m.id === sq.wrapperId)
  ?? sq.members.find((m) => m.role === 'wrap' || m.wrapDone || m.state === 'flank');
const cheatShots = last.shots.filter((s) => s.lastKnownAge != null && s.lastKnownAge > 6 && !s.targetVisible && !s.hasTarget);
const friendlyDeaths = sq.members.filter((m) => !m.alive && !killed.some((k) => k.id === m.id));
console.log('post', JSON.stringify({
  t0: +t0.toFixed(2), elapsed: +last.elapsed.toFixed(2),
  intent: sq.intent, why: sq.why, peekDeaths: sq.peekDeaths,
  wrapAt, nadeAt, nades: last.nades.length, bannedPeek,
  wrapper: wrapper && { id: wrapper.id, role: wrapper.role, state: wrapper.state },
  hasWrapDest: sq.hasWrapDest, cheatShots: cheatShots.length,
}));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

check('peek-deaths recorded', sq.peekDeaths >= 2, `n=${sq.peekDeaths}`);
check(
  'wrap or flush within 8s',
  (wrapAt != null && wrapAt <= 8) || (nadeAt != null && nadeAt <= 8) || sq.intent === 'wrap' || sq.intent === 'flush',
  `wrapAt=${wrapAt} nadeAt=${nadeAt} intent=${sq.intent}`,
);
check('intent is wrap after peek-deaths', sq.intent === 'wrap', `intent=${sq.intent} why=${sq.why}`);
check(
  'flush nade or refused a friendly blast',
  (nadeAt != null && nadeAt <= 8) || last.grenadeHolds > 0,
  `nadeAt=${nadeAt} holds=${last.grenadeHolds}`,
);
check('someone wrapping or wrap dest set', !!(wrapper || sq.hasWrapDest || sq.members.some((m) => m.state === 'flank' || m.wrapDone)),
  `wrapper=${wrapper?.id} dest=${sq.hasWrapDest}`);
check('no peek on banned rock', bannedPeek === false);
check('no friendly deaths', friendlyDeaths.length === 0, `ids=${friendlyDeaths.map((m) => m.id)}`);
check('no cheat shots (cold last-known)', cheatShots.length === 0, `n=${cheatShots.length}`);
check('page errors', errors.length === 0, errors[0] ?? '');

if (failures) {
  stopViteServer(server);
  await browser.close();
  process.exit(1);
}

console.log('ok  ai-intent-e2e');
stopViteServer(server);
await browser.close();
