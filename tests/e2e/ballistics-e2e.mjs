#!/usr/bin/env node
/** Actual AI/player fire, health, armour and resolved FX in the running game. */
import assert from 'node:assert/strict';
import { verifyNative, captureNative } from '../../tools/lib/native-render.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5218);
const out = resolve(args.out ?? '/tmp/cod-ballistics');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ webgpu: true, headless: true, args: [ '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await verifyNative(page);
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  await page.evaluate(() => window.__PUMP__(90));
  const cases = await page.evaluate(async () => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const engine = window.__ENGINE__, ctx = engine.ctx;
    const phys = ctx.get('physics'), player = ctx.get('player'), ai = ctx.get('ai');
    // Isolate fixtures above the authored city; still use the real subsystems.
    player.teleport(new T.Vector3(0, 81.6, 6), 0); player._syncHitbox();
    player.health.armour = 0;
    const enemy = { id: 999, position: new T.Vector3(0, 80, -2), weaponDamage: 17,
      animator: { ejectWorld: new T.Vector3(1, 81, -2) } };
    const origin = new T.Vector3(0, 81, -2), dir = new T.Vector3(0, 0, 1);
    const enemyHitbox = phys.addCollider({ owner: enemy, part: 'torso', radius: .2, surface: 'flesh' });
    enemyHitbox.setSegment(0, 80.3, -2, 0, 81.5, -2);
    const cover = new T.Mesh(new T.BoxGeometry(3, 3, .34), ctx.get('materials').get('plaster'));
    cover.position.set(0, 81, 3); engine.scene.add(cover); cover.updateMatrixWorld(true);
    const inner = cover.clone(); inner.scale.z = .1 / .34;
    engine.scene.add(inner); inner.updateMatrixWorld(true);
    const rows = [];
    for (const kind of ['masonry', 'wood', 'nested', 'uncovered', 'capture']) {
      player.health.heal(100); player.health.armour = 0;
      let handle = -1, innerHandle = -1;
      if (kind === 'masonry') handle = phys.addStatic(cover, 'plaster', { ballisticSurface: 'concrete' });
      if (kind === 'wood' || kind === 'nested') {
        cover.scale.z = (kind === 'nested' ? .2 : .05) / .34; cover.updateMatrixWorld(true);
        handle = phys.addStatic(cover, 'wood');
        if (kind === 'nested') innerHandle = phys.addStatic(inner, 'concrete');
      }
      phys.rebuildStatic();
      enemy.staged = kind === 'capture' ? { noDamage: true } : null;
      const impacts = [], damage = [], segments = [];
      const off = [ctx.events.on('bullet:impact', e => impacts.push({ exit: e.exit, actor: e.actor === player,
        surface: e.surface, z: e.point.z })),
      ctx.events.on('damage:dealt', e => damage.push({ player: e.target === player, amount: e.amount,
        source: e.source === enemy, from: e.from?.toArray() })),
      ctx.events.on('bullet:segment', e => segments.push({ from: e.from.toArray(), to: e.to.toArray() }))];
      ai.onAgentFire(enemy, origin, dir);
      off.forEach(fn => fn());
      rows.push({ kind, health: player.health.value, impacts, damage, segments });
      if (handle >= 0) phys.removeStatic(handle);
      if (innerHandle >= 0) phys.removeStatic(innerHandle);
    }
    // Health receivers still own armour; the resolver supplies incoming damage.
    player.health.heal(100); player.health.armour = 50; phys.rebuildStatic();
    enemy.staged = null; ai.onAgentFire(enemy, origin, dir);
    rows.push({ kind: 'armour', health: player.health.value, armour: player.health.armour });
    // No shooter self-hit when a player projectile starts inside their capsule.
    player.health.heal(100); player.health.armour = 0;
    const hits = [];
    const off = ctx.events.on('damage:dealt', e => hits.push({ own: e.target === player, enemy: e.target === enemy }));
    ctx.get('weapons').sim.spawn({ origin: new T.Vector3(0, 81, 6), dir: new T.Vector3(0, 0, -1),
      speed: 300, damage: 33, penetration: 1, dragK: 0, maxRange: 20,
      dropoff: 1, shooter: player, weapon: 'rifle' });
    await window.__PUMP__(5);
    off(); rows.push({ kind: 'projectile', health: player.health.value, hits });
    // Actual AI receiver and projectile flight: concurrent pellet segments
    // suppress once per round, not once per segment/interleaving.
    const { WEAPON_DEFS } = await import('/src/weapons/defs.js');
    const observer = ai.spawn('vanguard', new T.Vector3(5, 80, 1));
    const suppress = observer.suppress;
    let suppressionCalls = 0;
    observer.suppress = function (amount) { suppressionCalls++; suppress.call(this, amount); };
    const sim = ctx.get('weapons').sim, def = WEAPON_DEFS.shotgun;
    for (let i = 0; i < def.pellets; i++) sim.spawn({ origin: new T.Vector3(0, 81, 0),
      dir: new T.Vector3(1, 0, 0), shooter: player, weapon: def.id,
      speed: def.muzzleVelocity, dragK: def.dragK, maxRange: def.maxRange });
    for (let i = 0; i < 5; i++) sim.fixedUpdate(1 / 120);
    rows.push({ kind: 'suppression', calls: suppressionCalls, pellets: def.pellets });
    sim.clear(); observer.dispose(); observer.skeleton.dispose();
    ai.agents.splice(ai.agents.indexOf(observer), 1);
    // An exit effect produces spall, not another entry-hole decal.
    const fx = ctx.get('fx'), decals = fx.stats.decals;
    fx.onImpact({ point: new T.Vector3(0, 81, 3.1), normal: dir, incident: dir,
      surface: 'plaster', damage: 20, exit: true });
    rows.push({ kind: 'exit', newDecals: fx.stats.decals - decals });
    phys.removeCollider(enemyHitbox); inner.removeFromParent(); cover.removeFromParent(); cover.geometry.dispose();
    phys.rebuildStatic(); player.health.heal(100);
    return rows;
  });
  const by = kind => cases.find(c => c.kind === kind);
  assert.equal(by('masonry').health, 100);
  assert.equal(by('masonry').impacts.length, 1);
  assert.equal(by('masonry').impacts[0].surface, 'plaster');
  assert.equal(by('masonry').damage.length, 0);
  assert.ok(by('wood').health < 100 && by('wood').health > by('uncovered').health,
    'penetrable cover actually attenuates player damage');
  assert.equal(by('wood').damage.length, 1);
  assert.equal(by('wood').damage[0].player, true);
  assert.equal(by('wood').damage[0].source, true);
  assert.deepEqual(by('wood').damage[0].from, [0, 81, -2]);
  assert.ok(by('wood').impacts.some(i => i.exit && i.surface === 'wood'));
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
  assert.equal(by('exit').newDecals, 0);
  await page.evaluate(() => window.__APPLY_SHOT__('impacts', { grabFrame: 90 }));
  await page.evaluate(() => window.__PUMP__(90));
  await page.evaluate(() => window.__PRESENT__());
  await captureNative(page, `${out}/after.png`);
  assert.equal(await page.evaluate(() => window.__ENGINE__.error), null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, cases, screenshot: `${out}/after.png` }, null, 2));
} finally {
  await browser.close(); stopViteServer(server);
}
