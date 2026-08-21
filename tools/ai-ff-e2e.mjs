#!/usr/bin/env node
/**
 * Friendly-fire refusal: they hold a shot / nade that would hit a teammate,
 * but still throw when the lane is clear. Damage stays on — we assert they
 * didn't need it.
 *
 *   node tools/ai-ff-e2e.mjs
 */
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

const PORT = Number(process.env.OW_E2E_PORT ?? 8093);
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

await page.goto(`http://127.0.0.1:${PORT}/?capture=1&lockstep=1&prewarm=0`, {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
const pump = (n) => page.evaluate((k) => window.__PUMP__(k), n);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const wipe = () => page.evaluate(() => {
  const ai = window.__ENGINE__.ctx.get('ai');
  for (const a of ai.agents.slice()) a.dispose?.();
  ai.agents.length = 0;
  ai.squads.length = 0;
  ai._grenades.length = 0;
  ai.stats.friendlyHolds = 0;
  ai.stats.grenadeHolds = 0;
  window.__FF__ = { shots: 0, nades: 0, friendlyDmg: 0, friendlyKills: 0, playerDmg: 0 };
});

await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ctx = E.ctx;
  const player = ctx.get('player');
  window.__FF__ = { shots: 0, nades: 0, friendlyDmg: 0, friendlyKills: 0, playerDmg: 0 };
  ctx.events.on('damage:dealt', (e) => {
    const t = e?.target;
    const src = e?.source;
    const onPlayer = t === 'player' || t === player || t?.isPlayer === true;
    if (onPlayer) {
      window.__FF__.playerDmg += e.amount ?? 0;
      return;
    }
    if (t && src && t !== src && t.team === src.team && t.alive !== undefined) {
      window.__FF__.friendlyDmg += e.amount ?? 0;
      if (e.killed || (t.health ?? 1) <= 0) window.__FF__.friendlyKills++;
    }
  });
  ctx.events.on('explosion', () => { window.__FF__.nades++; });
  ctx.events.on('weapon:fire', (e) => {
    if (e?.weapon === 'ai_rifle') window.__FF__.shots++;
  });
});

await wipe();
await pump(2);

/* ------------------------------------------------------------------ */
/* 1. Two men on a line: back one must not shoot the front one.         */
/* ------------------------------------------------------------------ */
console.log('\n-- stacked sightline --');
const line = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ctx = E.ctx;
  const ai = ctx.get('ai');
  const player = ctx.get('player');
  const world = ctx.get('world');
  const phys = ctx.get('physics');
  ai.pathsPerFrame = 8;
  player.health.value = 800;

  const mid = world.spawnPoints.find((s) => s.tag === 'mid street') ?? world.spawnPoints[3];
  const gy = phys.groundHeight(mid.position.x, mid.position.z, mid.position.y + 6);
  const feetY = Number.isFinite(gy) ? gy + 0.03 : mid.position.y;
  player.teleport({ x: mid.position.x, y: feetY + 1.6, z: mid.position.z }, mid.yaw);

  const px = player.position.x, pz = player.position.z, py = player.position.y;
  const fx = -Math.sin(player.movement.yaw);
  const fz = -Math.cos(player.movement.yaw);
  const place = (d) => {
    const x = px + fx * d, z = pz + fz * d;
    const i = ai.grid.nearest(x, z, py, 10, 1.6);
    if (i < 0) return { x, y: py, z };
    return {
      x: ai.grid.worldX(i % ai.grid.nx),
      y: ai.grid.floor[i],
      z: ai.grid.worldZ((i / ai.grid.nx) | 0),
    };
  };
  const frontP = place(8);
  const backP = place(12);
  const squad = ai.createSquad();
  squad.peekTokens = 2;
  const front = ai.spawn('vanguard', frontP, Math.atan2(px - frontP.x, pz - frontP.z));
  const back = ai.spawn('vanguard', backP, Math.atan2(px - backP.x, pz - backP.z));
  squad.add(front);
  squad.add(back);
  for (const a of [front, back]) {
    a.hasTarget = true;
    a.targetVisible = true;
    a.lastKnown.set(px, py + 1.2, pz);
    a.lastKnownAge = 0;
    a.awareness = 1;
    a.alertness = 1;
    a._setState('combat');
    a.peeking = true;
    a.wantFire = true;
    a.peekTimer = 8;
    a.repathTimer = 30;
    a.cover = { x: a.position.x, y: a.position.y, z: a.position.z, high: true, dx: fx, dz: fz };
    a.coverPos.copy(a.position);
    a.hasGrenade = false;
  }
  // Front man holds fire so he stays a shield; back man is the one we test.
  front.wantFire = false;
  front.peeking = false;
  return {
    front: [frontP.x, frontP.z],
    back: [backP.x, backP.z],
    player: [px, pz],
    sep: Math.hypot(backP.x - frontP.x, backP.z - frontP.z),
  };
});
console.log('layout', JSON.stringify(line));

await pump(180); // 3 s
const lineResult = await page.evaluate(() => {
  const ai = window.__ENGINE__.ctx.get('ai');
  const alive = ai.agents.filter((a) => a.alive).map((a) => ({
    id: a.id, hp: +a.health.toFixed(1), state: a.state, peeking: a.peeking, block: +a._friendlyBlock.toFixed(2),
  }));
  return { ...window.__FF__, holds: ai.stats.friendlyHolds, alive };
});
console.log(JSON.stringify(lineResult));
check('back man held fire (friendlyHolds > 0)', lineResult.holds > 0, `holds=${lineResult.holds}`);
check('no friendly bullet kills', lineResult.friendlyKills === 0, `kills=${lineResult.friendlyKills}`);
check('no meaningful friendly bullet damage', lineResult.friendlyDmg < 20, `dmg=${lineResult.friendlyDmg.toFixed(1)}`);
check('both still alive', lineResult.alive.length === 2, `n=${lineResult.alive.length}`);

/* ------------------------------------------------------------------ */
/* 2. Huddle nade: 3 men stacked, plant 16 m away — must NOT throw.     */
/* ------------------------------------------------------------------ */
console.log('\n-- huddle grenade --');
await wipe();
const huddle = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ctx = E.ctx;
  const ai = ctx.get('ai');
  const player = ctx.get('player');
  const world = ctx.get('world');
  const phys = ctx.get('physics');
  player.health.value = 800;
  const mid = world.spawnPoints.find((s) => s.tag === 'mid street') ?? world.spawnPoints[3];
  const gy = phys.groundHeight(mid.position.x, mid.position.z, mid.position.y + 6);
  const feetY = Number.isFinite(gy) ? gy + 0.03 : mid.position.y;
  player.teleport({ x: mid.position.x, y: feetY + 1.6, z: mid.position.z }, mid.yaw);
  const px = player.position.x, pz = player.position.z, py = player.position.y;
  const fx = -Math.sin(player.movement.yaw);
  const fz = -Math.cos(player.movement.yaw);
  const place = (d, lat) => {
    const rx = -fz, rz = fx;
    const x = px + fx * d + rx * lat, z = pz + fz * d + rz * lat;
    const i = ai.grid.nearest(x, z, py, 10, 1.6);
    if (i < 0) return { x, y: py, z };
    return {
      x: ai.grid.worldX(i % ai.grid.nx),
      y: ai.grid.floor[i],
      z: ai.grid.worldZ((i / ai.grid.nx) | 0),
    };
  };
  const squad = ai.createSquad();
  squad.wantFlush = true;
  squad.flushUsed = false;
  squad.planted = true;
  squad.grenadeCooldown = 0;
  const arm = (a, p) => {
    a.hasTarget = true;
    a.targetVisible = true;
    a.lastKnown.set(px, py + 1.2, pz);
    a.lastKnownAge = 0;
    a.awareness = 1;
    a.alertness = 1;
    a._setState('combat');
    a.repathTimer = 99;
    a.peeking = true;
    a.peekTimer = 12;
    a.cover = { x: a.position.x, y: a.position.y, z: a.position.z, high: true, dx: fx, dz: fz };
    a.coverPos.copy(a.position);
    squad.add(a);
    return { id: a.id, x: p.x, z: p.z };
  };
  // Two men on the plant (inside the blast if a nade lands on the player).
  const near = [];
  for (let i = 0; i < 2; i++) {
    const p = place(3.2, (i ? 1 : -1) * 0.8);
    const a = ai.spawn('vanguard', p, Math.atan2(px - p.x, pz - p.z));
    a.hasGrenade = false;
    a.grenadeCooldown = 99;
    near.push(arm(a, p));
  }
  // Thrower further back, legal flush range, nade would land on the plant.
  const tp = place(14, 0);
  const thrower = ai.spawn('breacher', tp, Math.atan2(px - tp.x, pz - tp.z));
  thrower.hasGrenade = true;
  thrower.grenadeCooldown = 0;
  const madeThrower = arm(thrower, tp);
  const land = { x: 0, y: 0, z: 0 };
  const from = { x: tp.x, y: tp.y + 1.5, z: tp.z };
  const landDist = ai.predictGrenadeLand(from, { x: px, y: py + 1.2, z: pz }, land);
  const nearToLand = near.map((n) => +Math.hypot(n.x - land.x, n.z - land.z).toFixed(2));
  return { near, thrower: madeThrower, land: { x: land.x, z: land.z, d: landDist }, nearToLand, player: [px, pz] };
});
console.log('huddle', JSON.stringify(huddle));

await pump(360); // 6 s: plant (3 s) + flush arm + several refuse ticks
const huddleResult = await page.evaluate(() => {
  const ai = window.__ENGINE__.ctx.get('ai');
  const sq = ai.squads[0];
  return {
    ...window.__FF__,
    grenadeHolds: ai.stats.grenadeHolds,
    inFlight: ai._grenades.length,
    alive: ai.agents.filter((a) => a.alive).length,
    hasGrenade: ai.agents.filter((a) => a.alive && a.hasGrenade).length,
    intent: sq?.intent,
    wantFlush: sq?.wantFlush,
    throwerCd: ai.agents.find((a) => a.hasGrenade || a.role === 'flush')?.grenadeCooldown,
  };
});
console.log(JSON.stringify(huddleResult));
check('huddle refused the nade (holds > 0)', huddleResult.grenadeHolds > 0, `holds=${huddleResult.grenadeHolds}`);
check('huddle did not throw', huddleResult.nades === 0 && huddleResult.inFlight === 0, `nades=${huddleResult.nades} flight=${huddleResult.inFlight}`);
check('no friendly explosion kills', huddleResult.friendlyKills === 0, `kills=${huddleResult.friendlyKills}`);
check('huddle still alive', huddleResult.alive === 3, `alive=${huddleResult.alive}`);

/* ------------------------------------------------------------------ */
/* 3. Clear lane: one man, 16 m — MUST still throw.                     */
/* ------------------------------------------------------------------ */
console.log('\n-- clear grenade --');
await wipe();
await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ctx = E.ctx;
  const ai = ctx.get('ai');
  const player = ctx.get('player');
  const world = ctx.get('world');
  const phys = ctx.get('physics');
  player.health.value = 800;
  const mid = world.spawnPoints.find((s) => s.tag === 'mid street') ?? world.spawnPoints[3];
  const gy = phys.groundHeight(mid.position.x, mid.position.z, mid.position.y + 6);
  const feetY = Number.isFinite(gy) ? gy + 0.03 : mid.position.y;
  player.teleport({ x: mid.position.x, y: feetY + 1.6, z: mid.position.z }, mid.yaw);
  const px = player.position.x, pz = player.position.z, py = player.position.y;
  const fx = -Math.sin(player.movement.yaw);
  const fz = -Math.cos(player.movement.yaw);
  const x = px + fx * 16, z = pz + fz * 16;
  const i = ai.grid.nearest(x, z, py, 10, 1.6);
  const p = i < 0 ? { x, y: py, z } : {
    x: ai.grid.worldX(i % ai.grid.nx),
    y: ai.grid.floor[i],
    z: ai.grid.worldZ((i / ai.grid.nx) | 0),
  };
  const squad = ai.createSquad();
  squad.wantFlush = true;
  squad.flushUsed = false;
  squad.planted = true;
  const a = ai.spawn('vanguard', p, Math.atan2(px - p.x, pz - p.z));
  squad.add(a);
  a.hasTarget = true;
  a.targetVisible = true;
  a.lastKnown.set(px, py + 1.2, pz);
  a.lastKnownAge = 0;
  a.awareness = 1;
  a.alertness = 1;
  a._setState('combat');
  a.grenadeCooldown = 0;
  a.hasGrenade = true;
  a.repathTimer = 30;
  a.peeking = true;
  a.peekTimer = 8;
  a.cover = { x: a.position.x, y: a.position.y, z: a.position.z, high: true, dx: fx, dz: fz };
  a.coverPos.copy(a.position);
});

await pump(90); // 1.5 s to throw
// fuse 2.35 s
await pump(160);
const clearResult = await page.evaluate(() => {
  const ai = window.__ENGINE__.ctx.get('ai');
  return {
    ...window.__FF__,
    grenadeHolds: ai.stats.grenadeHolds,
    inFlight: ai._grenades.length,
    hasGrenade: ai.agents[0]?.hasGrenade,
    alive: ai.agents[0]?.alive,
  };
});
console.log(JSON.stringify(clearResult));
check('clear lane still throws', clearResult.nades >= 1 || clearResult.inFlight >= 1 || clearResult.hasGrenade === false,
  `nades=${clearResult.nades} flight=${clearResult.inFlight} has=${clearResult.hasGrenade}`);
check('thrower did not suicide', clearResult.alive === true);
check('page errors', errors.length === 0, errors[0] ?? '');

stopViteServer(server);
await browser.close();
if (failures) process.exit(1);
console.log('\nok  ai-ff-e2e');
