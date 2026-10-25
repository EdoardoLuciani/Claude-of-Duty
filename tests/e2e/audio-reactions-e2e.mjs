#!/usr/bin/env node
/** Actual game/master graph: real bullet-caused hurt/death and actor identity. */
import assert from 'node:assert/strict';

import { openAudioGame } from '../lib/audio-game.mjs';

const { page, errors, close } = await openAudioGame(5545, 'hero');
try {
  const report = await page.evaluate(async () => {
    const engine = window.__ENGINE__,
      ctx = engine.ctx,
      audio = ctx.get('audio'),
      ai = ctx.get('ai'),
      physics = ctx.get('physics'),
      player = ctx.get('player');
    const { combatLane } = await import('/tools/lib/combat-fixture.js');
    for (const a of ai.agents) a.dispose();
    ai.agents.length = 0;
    ai.squads.length = 0;
    const { positions } = combatLane(ai, ctx.get('world'), physics, [[9, 0]]),
      V3 = ctx.camera.position.constructor;
    const eye = positions[0].clone().add(new V3(0, 1.6, 0));
    player.teleport(eye, 0);
    player.setControlEnabled(false);
    ctx.camera.position.copy(eye);
    ctx.camera.lookAt(positions[1].clone().add(new V3(0, 1.4, 0)));
    if (!(await audio.start())) throw Error('Audio failed');
    audio.ambience.dispose();
    audio.update(0, ctx);
    const records = [],
      original = audio.samples.reaction;
    if (original)
      audio.samples.reaction = function (kind, voice, rng, o) {
        const result = original.call(this, kind, voice, rng, o);
        records.push({
          kind,
          voice,
          key: `reaction-${Math.abs(voice | 0) % 2}-${kind}`,
          end: result.end,
        });
        return result;
      };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const target = ai.spawn('vanguard', positions[1], 0);
    target._drive(1 / 60);
    target.syncHitboxes();
    target.health = 100;
    const fire = (damage) =>
      physics.fireBullet({
        origin: eye,
        dir: target.position
          .clone()
          .add(new V3(0, 1.35, 0))
          .sub(eye)
          .normalize(),
        shooter: player,
        damage,
        penetration: 1,
        maxDist: 30,
        weapon: 'rifle',
      });
    const start = records.length,
      draw = audio.rng.float;
    // Deterministic contract probe only: force the existing 30% reaction draw, not levels or gameplay damage.
    audio.rng.float = () => 0;
    try {
      fire(1);
    } finally {
      audio.rng.float = draw;
    }
    const hurtHealth = target.health;
    await wait(900);
    audio.update(0, ctx);
    target.health = 1;
    fire(100);
    await wait(2200);
    audio.update(0, ctx);
    const actual = records.slice(start);
    window.reactionTarget = target;
    return {
      records,
      actual,
      hurtHealth,
      alive: target.alive,
      actor: target.id,
      audio: audio.report(),
      active: audio.field.emitters.filter((e) => !e.free).length,
      engineError: engine.error ?? null,
    };
  });
  assert(report.hurtHealth < 100 && report.hurtHealth > 0);
  assert.equal(report.alive, false);
  assert.equal(report.audio.errors, 0);
  assert.equal(report.engineError, null);
  assert.equal(report.active, 0);
  assert.equal(report.records.length, 2);
  assert.deepEqual(
    report.actual.map((r) => r.kind),
    ['hurt', 'death']
  );
  assert(report.actual.every((r) => r.voice === report.actor));
  assert.deepEqual(errors, []);
  console.log(
    'PASS real bullet hurt/death, recorded actor identity and finite cleanup',
    JSON.stringify({ actual: report.actual, actor: report.actor, active: report.active })
  );
} finally {
  await close();
}
