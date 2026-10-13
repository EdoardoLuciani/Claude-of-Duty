#!/usr/bin/env node
/** Native gameplay HUD regression: real bullet damage retains non-numeric cues. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
import { waitForGame, captureNative } from '../../tools/lib/native-render.mjs';

const args = parseArgs(), port = Number(args.port ?? 5187);
const baseline = !!args.baseline;
const out = resolve(args.out ?? '/tmp/issue417-after');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ webgpu: true, headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon&telemetry=1`);
  await waitForGame(page, { timeout: 180000 });
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  await page.evaluate(() => window.__PUMP__(90));
  await page.evaluate(async () => {
    const { combatLane } = await import('/tools/lib/combat-fixture.js');
    const e = window.__ENGINE__, ctx = e.ctx;
    const ai = ctx.get('ai'), phys = ctx.get('physics'), player = ctx.get('player'), ui = ctx.get('ui');
    for (const a of ai.agents) a.dispose();
    ai.agents.length = 0;
    const { positions } = combatLane(ai, ctx.get('world'), phys, [[9, 0]]);
    const V3 = e.camera.position.constructor;
    const eye = positions[0].clone().add(new V3(0, 1.6, 0));
    e.camera.position.copy(eye);
    const target = ai.spawn('vanguard', positions[1], Math.atan2(eye.x - positions[1].x, eye.z - positions[1].z));
    target._drive(1 / 60); target.syncHitboxes();
    e.camera.lookAt(target.position.clone().add(new V3(0, 1.35, 0)));
    player.teleport(eye, e.camera.rotation);
    e.camera.updateMatrixWorld(true);
    ui.debugState('clean');
    ui.hit.clear(); ui.killfeed.clear(); ui.markers.clear();
    const report = { damage: [], resolved: [], scoreBefore: ctx.get('game').score };
    ctx.events.on('damage:dealt', p => { if (p.target === target) report.damage.push({ amount: p.amount, headshot: !!p.headshot, killed: !!p.killed }); });
    ctx.events.on('shot:resolved', p => report.resolved.push({ damage: p.damage, result: p.result }));
    window.__HUD_FIXTURE__ = { target, report };
  });
  async function shoot(height, damage) {
    return page.evaluate(({ height, damage }) => {
      const e = window.__ENGINE__, ctx = e.ctx, ui = ctx.get('ui');
      const { target, report } = window.__HUD_FIXTURE__;
      const aim = target.position.clone(); aim.y += height;
      const dir = aim.clone().sub(e.camera.position).normalize();
      ctx.get('weapons').sim.spawn({ origin: e.camera.position.clone(), dir, speed: 800,
        damage, penetration: 1, dragK: 0, maxRange: 30, dropoff: 1,
        shooter: ctx.get('player'), weapon: 'rifle' });
      for (let i = 0; i < 8; i++) ctx.get('weapons').sim.fixedUpdate(1 / 120);
      ctx.get('weapons').sim.clear();
      ui.lateUpdate(1 / 60, ctx);
      return { ...report, health: target.health, alive: target.alive, score: ctx.get('game').score,
        markers: ui.hit.pool.items.filter(it => it.alive).map(it => it.node._main.getAttribute('stroke')),
        numbers: [...document.querySelectorAll('.ow-dn')].filter(n => n.style.display !== 'none').map(n => n.textContent),
        feed: ui.killfeed.pool.items.filter(it => it.alive).map(it => it.node.textContent),
        banner: ui.banner.root.textContent };
    }, { height, damage });
  }
  const body = await shoot(1.35, 20);
  assert.equal(body.damage.length, 1, 'body round still delivers damage once');
  assert.ok(body.health < 100 && body.alive, 'nonlethal body damage applied');
  assert.ok(body.markers.includes('#f6fafc'), 'body hitmarker retained');
  assert.equal(body.numbers.length, baseline ? 1 : 0, 'body hit numeric popups');
  assert.equal(body.resolved.length, 1, 'resolved-shot telemetry retained');
  await page.evaluate(() => window.__PRESENT__(2));
  await captureNative(page, `${out}/body-hit.png`);

  const kill = await shoot(1.7, 200);
  assert.equal(kill.damage.length, 2, 'head round still delivers damage once');
  assert.ok(kill.damage[1].headshot && kill.damage[1].killed && !kill.alive, 'real headshot kill retained');
  assert.ok(kill.markers.includes('#ff4433'), 'kill hitmarker retained');
  assert.equal(kill.numbers.length, baseline ? 2 : 0, 'kill numeric popups');
  assert.ok(kill.feed.some(text => text.includes('YOU')), 'killfeed retained');
  assert.match(kill.banner, /ENEMY ELIMINATED.*HEADSHOT/, 'headshot elimination banner retained');
  assert.equal(kill.score - kill.scoreBefore, 150, 'headshot score unchanged');
  assert.equal(kill.resolved.length, 2, 'both shots still resolve telemetry');
  await page.evaluate(() => window.__PRESENT__(2));
  await captureNative(page, `${out}/headshot-kill.png`);

  const retained = await page.evaluate(() => {
    const e = window.__ENGINE__, ctx = e.ctx, ui = ctx.get('ui'), player = ctx.get('player');
    const V3 = e.camera.position.constructor;
    ui.hit.clear();
    const point = e.camera.position.clone().add(new V3(0, 0, -2));
    for (const target of ['player', player, { isPlayer: true }]) ctx.events.emit('damage:dealt', { target, amount: 0, point });
    const incomingMarkers = ui.hit.pool.items.filter(it => it.alive).length;
    ctx.events.emit('damage:dealt', { target: { name: 'armoured fixture' }, amount: 18, point, part: 'armour' });
    ctx.events.emit('damage:dealt', { target: { name: 'head fixture' }, amount: 74, point, headshot: true });
    player.health.value = 62; player.health.armour = 78;
    ctx.events.emit('damage:taken', { amount: 11, health: 62, from: point, armourAbsorbed: 8, armour: 78, plateBreak: false });
    ui.spawnGrenade(point, 2.4);
    ui.lateUpdate(1 / 60, ctx);
    return { incomingMarkers,
      markers: ui.hit.pool.items.filter(it => it.alive).map(it => it.node._main.getAttribute('stroke')),
      grenades: ui.markers.nadePool.items.filter(it => it.alive).length,
      arcs: ui.arcs.pool.items.filter(it => it.alive).length,
      health: ui.state.health, armour: ui.state.armour,
      numberNodes: document.querySelectorAll('.ow-dn').length };
  });
  assert.equal(retained.incomingMarkers, 0, 'incoming hits never produce outgoing feedback');
  assert.ok(retained.markers.includes('#8fdcff'), 'armour hitmarker retained');
  assert.ok(retained.markers.includes('#ffc247'), 'nonlethal headshot hitmarker retained');
  assert.equal(retained.grenades, 1, 'grenade warning retained');
  assert.ok(retained.arcs > 0, 'directional incoming damage retained');
  assert.equal(retained.health, 62, 'health HUD retained');
  assert.equal(retained.armour, 78, 'armour HUD retained');
  assert.equal(retained.numberNodes, baseline ? 16 : 0, 'numeric popup pool removed entirely');
  await page.evaluate(() => window.__PRESENT__(2));
  await captureNative(page, `${out}/retained-feedback.png`);
  assert.deepEqual(errors, [], 'no browser errors');
  console.log(JSON.stringify({ ok: true, baseline, out, body, kill, retained }, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
