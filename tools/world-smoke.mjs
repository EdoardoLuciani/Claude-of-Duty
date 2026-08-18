#!/usr/bin/env node
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

const port = Number(process.env.PORT ?? 5173);
const server = await ensureViteServer({ port, attempts: 120 });
const browser = await launchChromium({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, {
    waitUntil: 'domcontentloaded', timeout: 90000,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  const result = await page.evaluate(() => {
    const engine = window.__ENGINE__;
    const world = engine.ctx.get('world');
    const physics = engine.ctx.get('physics');
    const spawns = world.spawnPoints.map((spawn) => {
      const ground = physics.groundHeight(spawn.position.x, spawn.position.z, spawn.position.y + 0.5);
      return {
        tag: spawn.tag,
        ground,
        delta: Math.abs(ground - spawn.position.y),
      };
    });
    const level = world.worldToLevel(12.5, 3.25, -8.75);
    const roundTrip = world.levelToWorld(level.x, level.y, level.z);

    // Enemy wave placement: jitter + nav snap used to drop soldiers inside the
    // gate / stalls, after which depenetrate shoved them under the street.
    const ai = engine.ctx.get('ai');
    const picks = [];
    let pickFail = 0;
    let pickUnder = 0;
    let pickUnstandable = 0;
    let fell = 0;
    const c = physics.createCharacter({
      radius: 0.34, height: 1.78, position: { x: 0, y: 0, z: 0 }, stepHeight: 0.42, slopeLimit: 48,
    });
    for (const spawn of world.spawnPoints) {
      for (let i = 0; i < 24; i++) {
        const p = ai._pickSpawnNear(spawn);
        if (!p) { pickFail++; continue; }
        if (p.y < -0.5) pickUnder++;
        if (!ai._canStandAt(p.x, p.y, p.z, spawn.position.y)) pickUnstandable++;
        if (picks.length < 8) picks.push({ tag: spawn.tag, y: +p.y.toFixed(3) });
        c.teleport(p.x, p.y, p.z);
        let vy = 0;
        for (let s = 0; s < 90; s++) {
          vy += physics.gravity / 60;
          if (c.grounded) vy = 0;
          c.move(0, vy / 60, 0);
        }
        if (c.position.y < -0.6) fell++;
      }
    }
    physics.removeCharacter(c);

    return {
      stats: world.stats,
      physicsTris: physics.triangleCount,
      buildings: world.buildings.length,
      bulbs: world.bulbs.length,
      lamps: world.lamps.length,
      spawns,
      roundTripError: Math.hypot(roundTrip.x - 12.5, roundTrip.y - 3.25, roundTrip.z + 8.75),
      enemySpawns: { pickFail, pickUnder, pickUnstandable, fell, picks },
    };
  });

  const failures = [...errors];
  if (result.stats.drawCalls !== 220 || result.stats.instances !== 8008) failures.push('world draw/instance budget changed');
  if (result.physicsTris < 200000 || result.physicsTris > 300000) {
    failures.push(`physics triangle budget changed: ${result.physicsTris}`);
  }
  if (result.buildings !== 20 || result.bulbs !== 12 || result.lamps !== 5) failures.push('manifest marker counts changed');
  if (result.roundTripError > 1e-5) failures.push(`level transform round-trip error ${result.roundTripError}`);
  for (const spawn of result.spawns) {
    if (!Number.isFinite(spawn.ground) || spawn.delta > 0.5) {
      failures.push(`spawn ${spawn.tag} has invalid ground/collision`);
    }
  }
  const es = result.enemySpawns;
  if (es.pickFail > 8) failures.push(`enemy spawn picker failed ${es.pickFail} times`);
  if (es.pickUnder) failures.push(`enemy spawn picker returned ${es.pickUnder} underground points`);
  if (es.pickUnstandable) failures.push(`enemy spawn picker returned ${es.pickUnstandable} blocked points`);
  if (es.fell) failures.push(`enemy spawn still falls through the floor (${es.fell})`);
  console.log(JSON.stringify({ ok: failures.length === 0, ...result, errors: failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
  stopViteServer(server);
}
