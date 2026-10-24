#!/usr/bin/env node
/** Actual game graph/HUD integration: contact/flight, health and physical foley. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const root = resolve(args.root ?? fileURLToPath(new URL('../../', import.meta.url)));
const server = await ensureViteServer({ root, port: Number(args.port ?? 5533) });
assert(server, 'Refusing an occupied server port');
let browser;
const errors = [];
try {
  browser = await launchChromium({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${Number(args.port ?? 5533)}/?capture=1&lockstep=1&shot=weapon`
  );
  await waitForGame(page, { timeout: 180000 });
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  await page.evaluate(() => window.__PUMP__(3));
  await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx;
    const audio = ctx.get('audio');
    if (!(await audio.start())) throw Error('Actual game audio failed to start');
    audio.ambience.dispose();
    audio.update(0, ctx);
    window.hitTrace = [];
    for (const method of ['_playDry', '_playAt']) {
      const original = audio[method].bind(audio);
      audio[method] = (...args) => {
        window.hitTrace.push({
          method,
          kind: args[0],
          options: method === '_playDry' ? args[1] : args[4],
        });
        return original(...args);
      };
    }
    const { combatLane } = await import('/tools/lib/combat-fixture.js');
    const ai = ctx.get('ai');
    for (const agent of ai.agents) agent.dispose();
    ai.agents.length = 0;
    window.incomingLane = combatLane(ai, ctx.get('world'), ctx.get('physics'), [[9, 0]]).positions;
  });
  for (const [id, amount, armourAbsorbed, plateBreak, trajectory] of [
    ['health', 25, 0, false],
    ['armour', 0, 25, false],
    ['mixed', 15, 15, false],
    ['break-mixed', 15, 15, true],
    ['break-armour-only', 0, 25, true],
    ['empty', 0, 0, false],
    ['incoming-health', 25, 0, false, 'hit'],
    ['incoming-armour', 0, 25, false, 'hit'],
    ['incoming-break', 0, 25, true, 'hit'],
    ['incoming-near-miss', 0, 0, false, 'miss'],
  ]) {
    const row = await page.evaluate(
      async ({ id, amount, armourAbsorbed, plateBreak, trajectory }) => {
        const engine = window.__ENGINE__,
          ctx = engine.ctx;
        const audio = ctx.get('audio'),
          player = ctx.get('player'),
          ui = ctx.get('ui');
        let origin, aim, damage;
        if (trajectory) {
          const { HEALTH, STANCE } = await import('/src/player/tuning.ts');
          const V3 = engine.camera.position.constructor;
          const eye = window.incomingLane[0].clone().add(new V3(0, STANCE.stand.eye, 0));
          origin = window.incomingLane[1].clone().add(new V3(0, STANCE.stand.eye, 0));
          player.health.reset(true);
          player.health.armour = armourAbsorbed ? (plateBreak ? armourAbsorbed : 100) : 0;
          player.teleport(eye, engine.camera.rotation);
          player._syncHitbox();
          engine.camera.position.copy(eye);
          engine.camera.lookAt(origin);
          audio.update(0, ctx);
          aim = eye.clone();
          if (trajectory === 'miss') {
            const right = eye.clone().sub(origin).normalize();
            right.set(right.z, 0, -right.x).normalize();
            aim.addScaledVector(right, 1.2);
          } else aim.y -= 0.3;
          damage = armourAbsorbed ? armourAbsorbed / (1 - HEALTH.armourReduction) : amount;
        }
        window.hitTrace.length = 0;
        if (trajectory) {
          // Real free-flight -> collider -> damage publication, not a synthetic
          // impact-only fixture. A direct hit must retain its flight whizz too.
          const dir = aim.clone().sub(origin);
          const distance = dir.length();
          ctx.get('physics').fireBullet({
            origin,
            dir: dir.normalize(),
            shooter: 'enemy',
            damage,
            penetration: 0,
            maxDist: distance + 0.5,
            maxRange: distance + 0.5,
            dropoff: 1,
            weapon: 'rifle',
          });
        } else {
          player.health.setDebugValue(100 - amount);
          player.health.armour = plateBreak ? 0 : 50;
          const from = engine.camera.position.clone();
          from.x += 5;
          // Contact-only contract fixture, intentionally without bullet flight.
          ctx.events.emit('bullet:impact', {
            point: engine.camera.position,
            surface: 'flesh',
            damage: 30,
            actor: player,
            shooter: 'enemy',
            exit: false,
            shot: 900,
          });
          ctx.events.emit('damage:taken', {
            amount,
            armourAbsorbed,
            plateBreak,
            from,
            health: player.health.value,
            armour: player.health.armour,
          });
        }
        ui.lateUpdate(1 / 60, ctx);
        const trace = window.hitTrace.slice();
        const health = ui.state.health;
        await new Promise((r) => setTimeout(r, 450));
        audio.update(0, ctx);
        return {
          id,
          amount,
          armourAbsorbed,
          plateBreak,
          trace,
          health,
          report: audio.report(),
        };
      },
      { id, amount, armourAbsorbed, plateBreak, trajectory }
    );
    assert.equal(row.report.errors, 0, id + ': actual graph errors');
    assert.equal(row.health, 100 - amount, id + ': HUD retains health');
    const feedback = row.trace.filter((v) => v.kind === 'damage');
    assert.equal(feedback.length, amount || armourAbsorbed ? 1 : 0, id + ': one incoming contact');
    if (feedback.length) assert.equal(feedback[0].method, '_playDry');
    if (trajectory) {
      assert.equal(
        row.trace.filter((v) => v.kind === 'whizz').length,
        1,
        id + ': real incoming flight retains exactly one whizz'
      );
      assert.equal(
        row.trace.length,
        feedback.length + 1,
        id + ': no phantom impact/confirmation layers'
      );
    } else
      assert.equal(row.trace.length, feedback.length, id + ': contact-only fixture has no flight');
  }
  // Exercise the real bullet resolver against an actual soldier, not a second
  // fabricated damage path. Physics already deduplicates overlapping regions.
  const enemy = await page.evaluate(async () => {
    const { combatLane } = await import('/tools/lib/combat-fixture.js');
    const engine = window.__ENGINE__,
      ctx = engine.ctx;
    const ai = ctx.get('ai'),
      physics = ctx.get('physics'),
      player = ctx.get('player');
    for (const agent of ai.agents) agent.dispose();
    ai.agents.length = 0;
    const { positions } = combatLane(ai, ctx.get('world'), physics, [[9, 0]]);
    window.physicalBase = positions[0].clone();
    const V3 = engine.camera.position.constructor;
    const eye = positions[0].clone().add(new V3(0, 1.6, 0));
    const target = ai.spawn('vanguard', positions[1], 0);
    target._drive(1 / 60);
    target.syncHitboxes();
    const aim = target.position.clone().add(new V3(0, 1.35, 0));
    player.teleport(eye, engine.camera.rotation);
    engine.camera.position.copy(eye);
    const audio = ctx.get('audio');
    audio.update(0, ctx);
    window.hitTrace.length = 0;
    physics.fireBullet({
      origin: eye,
      dir: aim.sub(eye).normalize(),
      shooter: player,
      damage: 20,
      penetration: 1,
      maxDist: 30,
      weapon: 'rifle',
    });
    return {
      trace: window.hitTrace.slice(),
      health: target.health,
      errors: audio.report().errors,
      engineError: engine.error ?? null,
    };
  });
  assert(enemy.health < 100, 'actual soldier takes damage');
  assert.equal(enemy.errors, 0);
  assert.equal(enemy.engineError, null);
  assert.equal(
    enemy.trace.filter((v) => v.kind === 'impact' && v.options?.surface === 'flesh').length,
    1,
    'one real enemy body contact'
  );
  assert.equal(
    enemy.trace.filter((v) => v.kind === 'whizz').length,
    0,
    'own body hit is not a near-miss'
  );
  assert.equal(
    enemy.trace.filter((v) => v.kind === 'hitmarker').length,
    1,
    'one confirmation UI tick, not a second copy from the HUD'
  );
  // Additional physical-foley paths: real world-layer contacts, actual actor
  // death, and controller-produced landing/stride plants (not emitted fixtures).
  const physical = await page.evaluate(async () => {
    const engine = window.__ENGINE__,
      ctx = engine.ctx;
    const physics = ctx.get('physics'),
      player = ctx.get('player'),
      audio = ctx.get('audio');
    const Matrix4 = engine.camera.matrixWorld.constructor,
      Vector3 = engine.camera.position.constructor;
    const origin = player.eyePosition.clone();
    const target = ctx.get('ai').agents[0];
    target.health = 1;
    target.syncHitboxes();
    window.hitTrace.length = 0;
    physics.fireBullet({
      origin,
      dir: target.position
        .clone()
        .add(new Vector3(0, 1.35, 0))
        .sub(origin)
        .normalize(),
      shooter: player,
      damage: 100,
      penetration: 0,
      maxDist: 30,
      weapon: 'rifle',
    });
    const death = { alive: target.alive, trace: window.hitTrace.slice() };
    const toward = target.position.clone().sub(origin);
    toward.y = 0;
    toward.normalize();
    const at = origin.clone().addScaledVector(toward, 2);
    const materials = [];
    for (const surface of [
      'concrete',
      'plaster',
      'metal',
      'wood',
      'dirt',
      'sand',
      'glass',
      'water',
      'foliage',
      'fabric',
      'rubber',
    ]) {
      const collider = physics.addCollider({
        shape: 'box',
        hx: 0.3,
        hy: 0.3,
        hz: 0.3,
        layer: physics.LAYER.STATIC,
        surface,
      });
      collider.setMatrix(new Matrix4().makeTranslation(at.x, at.y, at.z));
      try {
        if (!(collider.layer & physics.MASK.WORLD))
          throw Error(surface + ': material fixture must belong to the world mask');
        audio.update(0, ctx);
        window.hitTrace.length = 0;
        const result = physics.fireBullet({
          origin,
          dir: toward,
          shooter: player,
          damage: 30,
          penetration: 0,
          maxDist: 3,
          weapon: 'rifle',
        });
        materials.push({
          surface,
          resolved: result.impacts.map((p) => p.surface),
          trace: window.hitTrace.slice(),
        });
      } finally {
        physics.removeCollider(collider);
      }
    }
    player.health.reset(true);
    engine.input.enabled = true;
    engine.input.frozen = false;
    engine.input.clear();
    player.setControlEnabled(true);
    const weapons = ctx.get('weapons');
    weapons.debugMode = null;
    weapons.viewmodel.debugFrozen = false;
    const eye = window.physicalBase.clone();
    eye.y += player.eyeHeight + 2;
    player.teleport(eye, 0);
    window.hitTrace.length = 0;
    await window.__PUMP__(100);
    const landing = window.hitTrace.filter((p) => p.kind === 'step' && p.options?.gait === 'land');
    window.hitTrace.length = 0;
    engine.input._pendingDown.add('KeyW');
    await window.__PUMP__(55);
    engine.input._pendingUp.add('KeyW');
    await window.__PUMP__(1);
    const walking = window.hitTrace.filter((p) => p.kind === 'step' && p.options?.gait !== 'land');
    engine.input.enabled = false;
    engine.input.frozen = true;
    player.setControlEnabled(false);
    return {
      id: 'real-physical-foley',
      death,
      materials,
      landing,
      walking,
      report: audio.report(),
      engineError: engine.error ?? null,
    };
  });
  assert.equal(physical.death.alive, false, 'actual bullet causes actor death');
  assert.equal(physical.death.trace.filter((p) => p.kind === 'bodyfall').length, 1);
  for (const material of physical.materials) {
    assert(
      material.resolved.includes(material.surface),
      material.surface + ': physical collider surface'
    );
    assert.equal(
      material.trace.filter((p) => p.kind === 'impact' && p.options.surface === material.surface)
        .length,
      1
    );
    assert.equal(
      material.trace.filter((p) => p.kind === 'whizz').length,
      0,
      'own world contact is not a flight pass'
    );
  }
  assert.equal(physical.landing.length, 1, 'one actual controller landing');
  assert(physical.walking.length > 0, 'actual controller stride plants');
  assert.equal(physical.report.errors, 0);
  assert.equal(physical.engineError, null);
  const healthPaths = await page.evaluate(async () => {
    const { HEALTH } = await import('/src/player/tuning.ts');
    const ctx = window.__ENGINE__.ctx,
      player = ctx.get('player');
    const from = ctx.camera.position.clone();
    from.x += 2;
    return [
      [
        'real-armour-break',
        100,
        HEALTH.plateSize,
        HEALTH.plateSize / (1 - HEALTH.armourReduction),
        'bullet',
      ],
      ['real-explosion-damage', 100, 0, 25, 'explosion'],
      ['real-lethal-damage', 10, 0, 25, 'bullet'],
    ].map(([id, health, armour, damage, type]) => {
      player.health.reset(true);
      player.health.setDebugValue(health);
      player.health.armour = armour;
      window.hitTrace.length = 0;
      player.applyDamage(damage, from, { type });
      return {
        id,
        trace: window.hitTrace.slice(),
        health: player.health.value,
        armour: player.health.armour,
      };
    });
  });
  for (const row of healthPaths) {
    assert.equal(
      row.trace.filter((v) => v.kind === 'damage').length,
      1,
      row.id + ': real health path has one incoming voice'
    );
    assert.equal(
      row.trace.filter((v) => v.kind === 'armour_hit' || v.kind === 'armour_break').length,
      0,
      row.id + ': no extra HUD armour sound'
    );
  }
  assert.equal(healthPaths[0].armour, 0);
  assert.equal(healthPaths[0].health, 100, 'real armour-only break leaves health intact');
  assert.equal(healthPaths[1].health, 75, 'explosion-derived health damage retains its route');
  assert.equal(healthPaths[2].health, 0, 'lethal damage still applies');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: actual game HUD/audio, incoming trajectories, health/explosion/death, enemy/material bullet contacts, controller steps/landing and body fall'
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
