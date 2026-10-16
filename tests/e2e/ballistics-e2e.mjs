#!/usr/bin/env node
/** Actual AI/player fire, health, armour and resolved FX in the running game. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { verifyNative, captureNative } from '../../tools/lib/native-render.mjs';
const args = parseArgs(),
  port = Number(args.port ?? 5218);
const out = resolve(args.out ?? '/tmp/cod-ballistics');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({
  webgpu: true,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await verifyNative(page);
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  await page.evaluate(() => window.__PUMP__(90));
  const cases = await page.evaluate(async () => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const engine = window.__ENGINE__,
      ctx = engine.ctx;
    const phys = ctx.get('physics'),
      player = ctx.get('player'),
      ai = ctx.get('ai');
    // Isolate fixtures above the authored city; still use the real subsystems.
    player.teleport(new T.Vector3(0, 81.6, 6), 0);
    player._syncHitbox();
    player.health.armour = 0;
    const enemy = {
      id: 999,
      position: new T.Vector3(0, 80, -2),
      weaponDamage: 17,
      animator: { ejectWorld: new T.Vector3(1, 81, -2) },
    };
    const origin = new T.Vector3(0, 81, -2),
      dir = new T.Vector3(0, 0, 1);
    const enemyHitbox = phys.addCollider({
      owner: enemy,
      part: 'torso',
      radius: 0.2,
      surface: 'flesh',
    });
    enemyHitbox.setSegment(0, 80.3, -2, 0, 81.5, -2);
    const cover = new T.Mesh(new T.BoxGeometry(3, 3, 0.34), ctx.get('materials').get('plaster'));
    cover.position.set(0, 81, 3);
    engine.scene.add(cover);
    cover.updateMatrixWorld(true);
    const inner = cover.clone();
    inner.scale.z = 0.1 / 0.34;
    engine.scene.add(inner);
    inner.updateMatrixWorld(true);
    const rows = [];
    for (const kind of ['masonry', 'wood', 'nested', 'uncovered', 'capture']) {
      player.health.heal(100);
      player.health.armour = 0;
      let handle = -1,
        innerHandle = -1;
      if (kind === 'masonry')
        handle = phys.addStatic(cover, 'plaster', { ballisticSurface: 'concrete' });
      if (kind === 'wood' || kind === 'nested') {
        cover.scale.z = (kind === 'nested' ? 0.2 : 0.05) / 0.34;
        cover.updateMatrixWorld(true);
        handle = phys.addStatic(cover, 'wood');
        if (kind === 'nested') innerHandle = phys.addStatic(inner, 'concrete');
      }
      phys.rebuildStatic();
      enemy.staged = kind === 'capture' ? { noDamage: true } : null;
      const impacts = [],
        damage = [],
        segments = [];
      const off = [
        ctx.events.on('bullet:impact', (e) =>
          impacts.push({
            exit: e.exit,
            actor: e.actor === player,
            surface: e.surface,
            z: e.point.z,
          })
        ),
        ctx.events.on('damage:dealt', (e) =>
          damage.push({
            player: e.target === player,
            amount: e.amount,
            source: e.source === enemy,
            from: e.from?.toArray(),
          })
        ),
        ctx.events.on('bullet:segment', (e) =>
          segments.push({ from: e.from.toArray(), to: e.to.toArray() })
        ),
      ];
      ai.onAgentFire(enemy, origin, dir);
      off.forEach((fn) => fn());
      rows.push({ kind, health: player.health.value, impacts, damage, segments });
      if (handle >= 0) phys.removeStatic(handle);
      if (innerHandle >= 0) phys.removeStatic(innerHandle);
    }
    // Health receivers still own armour; the resolver supplies incoming damage.
    player.health.heal(100);
    player.health.armour = 50;
    phys.rebuildStatic();
    enemy.staged = null;
    ai.onAgentFire(enemy, origin, dir);
    rows.push({ kind: 'armour', health: player.health.value, armour: player.health.armour });
    // No shooter self-hit when a player projectile starts inside their capsule.
    player.health.heal(100);
    player.health.armour = 0;
    const hits = [];
    const off = ctx.events.on('damage:dealt', (e) =>
      hits.push({ own: e.target === player, enemy: e.target === enemy })
    );
    ctx.get('weapons').sim.spawn({
      origin: new T.Vector3(0, 81, 6),
      dir: new T.Vector3(0, 0, -1),
      speed: 300,
      damage: 33,
      penetration: 1,
      dragK: 0,
      maxRange: 20,
      dropoff: 1,
      shooter: player,
      weapon: 'rifle',
    });
    await window.__PUMP__(5);
    off();
    rows.push({ kind: 'projectile', health: player.health.value, hits });
    // Actual AI receiver and projectile flight: concurrent pellet segments
    // suppress once per round, not once per segment/interleaving.
    const { WEAPON_DEFS } = await import('/src/weapons/defs.ts');
    const observer = ai.spawn('vanguard', new T.Vector3(5, 80, 1));
    const suppress = observer.suppress;
    let suppressionCalls = 0;
    observer.suppress = function (amount) {
      suppressionCalls++;
      suppress.call(this, amount);
    };
    const sim = ctx.get('weapons').sim,
      def = WEAPON_DEFS.shotgun;
    for (let i = 0; i < def.pellets; i++)
      sim.spawn({
        origin: new T.Vector3(0, 81, 0),
        dir: new T.Vector3(1, 0, 0),
        shooter: player,
        weapon: def.id,
        speed: def.muzzleVelocity,
        dragK: def.dragK,
        maxRange: def.maxRange,
      });
    for (let i = 0; i < 5; i++) sim.fixedUpdate(1 / 120);
    rows.push({ kind: 'suppression', calls: suppressionCalls, pellets: def.pellets });
    sim.clear();
    observer.dispose();
    observer.skeleton.dispose();
    ai.agents.splice(ai.agents.indexOf(observer), 1);
    // A distant target behind thin wood retains player time-of-flight and drop.
    const distant = { id: 'flight-target' };
    const distantBox = phys.addCollider({
      owner: distant,
      layer: phys.LAYER.ACTOR,
      part: 'torso',
      surface: 'flesh',
      radius: 0.3,
    });
    distantBox.setSegment(100, 80.3, 20, 100, 81.5, 20, 0.3);
    const sheet = new T.Mesh(new T.BoxGeometry(0.02, 4, 4));
    sheet.position.set(2, 81, 20);
    sheet.updateMatrixWorld(true);
    const oldRng = phys.ballistics.rng;
    phys.ballistics.rng = { gauss: () => 0 };
    for (const covered of [false, true]) {
      const handle = covered ? phys.addStatic(sheet, 'wood') : -1;
      phys.rebuildStatic();
      let hit = null,
        tick = 0,
        damageTick = 0;
      const offFlight = ctx.events.on('damage:dealt', (e) => {
        if (e.target === distant) {
          hit = { amount: e.amount, y: e.point.y };
          damageTick = tick;
        }
      });
      sim.spawn({
        origin: new T.Vector3(0, 81, 20),
        dir: new T.Vector3(1, 0, 0),
        speed: 800,
        dragK: 0,
        maxRange: 200,
        damage: 40,
        penetration: 0.9,
        dropoff: 1,
        shooter: player,
        weapon: 'rifle',
      });
      while (!hit && tick < 120) {
        tick++;
        sim.fixedUpdate(1 / 120);
      }
      offFlight();
      sim.clear();
      rows.push({ kind: covered ? 'flight-wood' : 'flight-clear', damageTick, hit });
      if (handle >= 0) phys.removeStatic(handle);
    }
    // Timed disjoint regions, including arm/B/head and intervening cover.
    // Use the actual running game's simulator and event bus above the city.
    for (const kind of ['clear', 'wood', 'concrete', 'interleaved']) {
      const regionOwner = { id: `regions-${kind}` },
        other = { id: 'interleaved' };
      const boxes = [];
      function region(x, owner, part, scale) {
        const c = phys.addCollider({
          owner,
          layer: phys.LAYER.ACTOR,
          part,
          damageScale: scale,
          surface: 'flesh',
          radius: 0.08,
        });
        c.setSegment(x, 80.5, 30, x, 81.5, 30, 0.08);
        boxes.push(c);
      }
      region(2, regionOwner, 'arm', 0.65);
      region(4, regionOwner, 'head', 4);
      if (kind === 'interleaved') region(3, other, 'torso', 1);
      const mesh = new T.Mesh(new T.BoxGeometry(kind === 'concrete' ? 0.2 : 0.02, 4, 4));
      mesh.position.set(3, 81, 30);
      mesh.updateMatrixWorld(true);
      const handle = kind === 'wood' || kind === 'concrete' ? phys.addStatic(mesh, kind) : -1;
      phys.rebuildStatic();
      let tick = 0;
      const damage = [];
      const offRegions = ctx.events.on('damage:dealt', (e) => {
        if (e.target === regionOwner || e.target === other)
          damage.push({
            owner: e.target === regionOwner,
            part: e.part,
            amount: e.amount,
            tick,
            from: e.from.toArray(),
          });
      });
      const p = sim.spawn({
        origin: new T.Vector3(0, 81, 30),
        dir: new T.Vector3(1, 0, 0),
        speed: 100,
        dragK: 0,
        maxRange: 20,
        damage: 40,
        penetration: 2,
        dropoff: 1,
        shooter: player,
        weapon: 'rifle',
      });
      while (p.alive && tick < 120) {
        tick++;
        sim.fixedUpdate(1 / 120);
      }
      offRegions();
      sim.clear();
      rows.push({ kind: `regions-${kind}`, damage });
      boxes.forEach((c) => phys.removeCollider(c));
      if (handle >= 0) phys.removeStatic(handle);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    phys.ballistics.rng = oldRng;
    phys.removeCollider(distantBox);
    sheet.geometry.dispose();
    sheet.material.dispose();
    // An exit effect produces spall, not another entry-hole decal.
    const fx = ctx.get('fx'),
      decals = fx.stats.decals;
    fx.onImpact({
      point: new T.Vector3(0, 81, 3.1),
      normal: dir,
      incident: dir,
      surface: 'plaster',
      damage: 20,
      exit: true,
    });
    rows.push({ kind: 'exit', newDecals: fx.stats.decals - decals });
    phys.removeCollider(enemyHitbox);
    inner.removeFromParent();
    cover.removeFromParent();
    cover.geometry.dispose();
    phys.rebuildStatic();
    player.health.heal(100);
    return rows;
  });
  const by = (kind) => cases.find((c) => c.kind === kind);
  assert.equal(by('masonry').health, 100);
  assert.equal(by('masonry').impacts.length, 1);
  assert.equal(by('masonry').impacts[0].surface, 'plaster');
  assert.equal(by('masonry').damage.length, 0);
  assert.ok(
    by('wood').health < 100 && by('wood').health > by('uncovered').health,
    'penetrable cover actually attenuates player damage'
  );
  assert.equal(by('wood').damage.length, 1);
  assert.equal(by('wood').damage[0].player, true);
  assert.equal(by('wood').damage[0].source, true);
  assert.deepEqual(by('wood').damage[0].from, [0, 81, -2]);
  assert.ok(by('wood').impacts.some((i) => i.exit && i.surface === 'wood'));
  assert.equal(by('nested').health, 100, 'wood around masonry cannot make it transparent');
  assert.equal(by('nested').damage.length, 0);
  assert.equal(by('nested').impacts.length, 1);
  assert.equal(by('nested').impacts[0].surface, 'wood');
  assert.equal(by('nested').segments.length, 1);
  assert.equal(by('suppression').calls, by('suppression').pellets);
  assert.equal(by('capture').health, 100);
  assert.equal(by('capture').damage.length, 0);
  assert.equal(by('armour').health, 100);
  assert.ok(by('armour').armour < 50);
  assert.equal(by('projectile').health, 100);
  assert.deepEqual(by('projectile').hits, [{ own: false, enemy: true }]);
  assert.equal(by('flight-clear').damageTick, 15);
  assert.ok(
    by('flight-wood').damageTick >= by('flight-clear').damageTick,
    'penetration cannot apply distant damage on the first tick'
  );
  assert.ok(
    by('flight-wood').hit.y <= by('flight-clear').hit.y + 0.005,
    'gravity continues after penetration'
  );
  assert.ok(by('flight-wood').hit.amount < by('flight-clear').hit.amount);
  for (const kind of ['clear', 'wood', 'concrete', 'interleaved']) {
    const hits = by(`regions-${kind}`).damage.filter((e) => e.owner);
    assert.equal(hits.length, 1, `${kind}: one actor event per round`);
    assert.equal(hits[0].part, kind === 'concrete' ? 'arm' : 'head');
    assert.ok(hits[0].tick >= 4 && hits[0].tick < 10, `${kind}: bounded actual regional traversal`);
    assert.deepEqual(hits[0].from, [0, 81, 30]);
    if (kind === 'interleaved') {
      const other = by('regions-interleaved').damage.filter((e) => !e.owner);
      assert.equal(other.length, 1);
      assert.ok(other[0].tick >= 4, 'unrelated actor inside extent stays timed');
    }
  }
  assert.equal(by('exit').newDecals, 0);
  await page.evaluate(() => window.__APPLY_SHOT__('impacts', { grabFrame: 90 }));
  await page.evaluate(() => window.__PUMP__(90));
  await page.evaluate(() => window.__PRESENT__());
  await captureNative(page, `${out}/after.png`);
  assert.equal(await page.evaluate(() => window.__ENGINE__.error), null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, cases, screenshot: `${out}/after.png` }, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
