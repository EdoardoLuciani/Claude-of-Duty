#!/usr/bin/env node
/**
 * Arch/gate nest: player camps the south gate, wave 4 must not all spawn in
 * the same optic and must leave the street after two unseen deaths + gunfire.
 *
 *   node tools/ai-gate-e2e.mjs
 */
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

const PORT = Number(process.env.OW_E2E_PORT ?? 8094);
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

const setup = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ctx = E.ctx;
  const ai = ctx.get('ai');
  const player = ctx.get('player');
  const world = ctx.get('world');
  const phys = ctx.get('physics');
  for (const a of ai.agents.slice()) a.dispose?.();
  ai.agents.length = 0;
  ai.squads.length = 0;
  ai.pathsPerFrame = 8;
  player.health.value = 800;

  const gate = world.spawnPoints.find((s) => s.tag === 'gate') ?? world.spawnPoints[5];
  const gy = phys.groundHeight(gate.position.x, gate.position.z, gate.position.y + 6);
  const feetY = Number.isFinite(gy) ? gy + 0.03 : gate.position.y;
  // Face up the street (toward north plaza), which is the sniper nest.
  const plaza = world.spawnPoints.find((s) => s.tag === 'north plaza');
  const yaw = plaza
    ? Math.atan2(-(plaza.position.x - gate.position.x), -(plaza.position.z - gate.position.z))
    : gate.yaw;
  player.teleport({ x: gate.position.x, y: feetY + 1.6, z: gate.position.z }, yaw);

  ai.startWave(4, { squads: 3, perSquad: 4 });
  const p = player.position;
  const agents = ai.agents.filter((a) => a.alive).map((a) => {
    const d = Math.hypot(a.position.x - p.x, a.position.z - p.z);
    const b = Math.atan2(a.position.x - p.x, a.position.z - p.z);
    return { id: a.id, d: +d.toFixed(1), b: +b.toFixed(2), x: a.position.x, z: a.position.z };
  });
  return { n: agents.length, agents, player: [p.x, p.z] };
});

console.log('spawn', JSON.stringify({
  n: setup.n,
  dists: setup.agents.map((a) => a.d),
  bearings: setup.agents.map((a) => a.b),
}));

const dists = setup.agents.map((a) => a.d);
const near = dists.filter((d) => d < 50).length;
const far = dists.filter((d) => d > 58).length;
const bearings = setup.agents.map((a) => a.b);
let maxAng = 0;
for (let i = 0; i < bearings.length; i++) {
  for (let j = i + 1; j < bearings.length; j++) {
    let d = Math.abs(bearings[i] - bearings[j]);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d > maxAng) maxAng = d;
  }
}
check('wave spawned', setup.n >= 8, `n=${setup.n}`);
check('not everyone in the 58 m optic', near >= 3 || far < setup.n, `near<50=${near} far>58=${far}`);
check('spawn bearings actually spread', maxAng > 0.25, `maxAng=${maxAng.toFixed(2)} rad`);

await pump(2);

// Two unseen deaths + a gunshot (the sniper opening up).
await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ai = E.ctx.get('ai');
  const p = E.ctx.get('player').position;
  const ranked = ai.agents.filter((a) => a.alive).sort((a, b) => {
    const da = Math.hypot(a.position.x - p.x, a.position.z - p.z);
    const db = Math.hypot(b.position.x - p.x, b.position.z - p.z);
    return db - da;
  });
  for (let i = 0; i < 2 && i < ranked.length; i++) {
    ranked[i].applyDamage(200, 'torso', ranked[i].position, { x: 0, y: 0, z: 1 });
  }
  const origin = E.camera.position.clone();
  const yaw = E.ctx.get('player').movement.yaw;
  E.events.emit('weapon:fire', {
    weapon: 'sniper',
    origin,
    dir: { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
    seed: 1, intensity: 1, light: 0.1, flashScale: 1,
  });
});

await pump(480); // 8 s

const after = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const ai = E.ctx.get('ai');
  const p = E.ctx.get('player').position;
  const intel = ai.squads.map((s) => ({ intent: s.intent, why: s.why, peekDeaths: s.peekDeaths.length }));
  const agents = ai.agents.filter((a) => a.alive).map((a) => {
    const dx = a.position.x - p.x, dz = a.position.z - p.z;
    const dist = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(E.ctx.get('player').movement.yaw);
    const fz = -Math.cos(E.ctx.get('player').movement.yaw);
    const along = (dx * fx + dz * fz) / dist;
    const cross = Math.abs(-fz * dx + fx * dz);
    return {
      id: a.id, state: a.state, role: a.role, speed: +a.desiredSpeed.toFixed(2),
      dist: +dist.toFixed(1), cross: +cross.toFixed(1), along: +along.toFixed(2),
      hasTarget: a.hasTarget, vis: a.targetVisible,
    };
  });
  return { intel, agents };
});
console.log('after', JSON.stringify(after, null, 2));

const wrapping = after.agents.filter((a) => a.role === 'wrap' || a.state === 'flank').length;
const sprinting = after.agents.filter((a) => a.speed >= 4).length;
const offAxis = after.agents.filter((a) => a.cross > 8).length;
const standingFar = after.agents.filter((a) => a.speed < 0.2 && a.dist > 52 && a.state !== 'combat').length;
const wrapped = after.intel.some((s) => s.intent === 'wrap');

check('deaths recorded', after.intel.some((s) => s.peekDeaths >= 2), JSON.stringify(after.intel));
check('squad wraps off the unseen nest', wrapped || wrapping >= 2, `wrap=${wrapped} wrapping=${wrapping}`);
check('someone actually left the barrel', wrapping >= 1 || sprinting >= 1 || offAxis >= 2,
  `wrapping=${wrapping} sprint=${sprinting} offAxis=${offAxis}`);
check('not a firing-line of statues at 58 m', standingFar <= 2, `standingFar=${standingFar}`);
check('page errors', errors.length === 0, errors[0] ?? '');

stopViteServer(server);
await browser.close();
if (failures) process.exit(1);
console.log('\nok  ai-gate-e2e');
