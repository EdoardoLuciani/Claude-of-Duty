#!/usr/bin/env node
/** Actual game environmental scheduler, recorded routing and finite cleanup. */
import assert from 'node:assert/strict';

import { openAudioGame } from '../lib/audio-game.mjs';

const { page, errors, close } = await openAudioGame(5547, 'hero');
try {
  const report = await page.evaluate(async () => {
    const engine = window.__ENGINE__,
      ctx = engine.ctx,
      audio = ctx.get('audio'),
      ai = ctx.get('ai'),
      world = ctx.get('world'),
      physics = ctx.get('physics'),
      player = ctx.get('player');
    for (const a of ai.agents) a.dispose();
    ai.agents.length = 0;
    ai.squads.length = 0;
    const x = (world.bounds.min.x + world.bounds.max.x) / 2,
      z = (world.bounds.min.z + world.bounds.max.z) / 2,
      y = physics.groundHeight(x, z, 30) + 1.7,
      V3 = ctx.camera.position.constructor;
    player.teleport(new V3(x, y, z), 0);
    player.setControlEnabled(false);
    ctx.camera.position.set(x, y, z);
    ctx.camera.lookAt(new V3(x, y, z - 10));
    if (!(await audio.start())) throw Error('Audio failed');
    audio.ambience.dispose();
    audio.update(0, ctx);
    const records = [],
      method = audio.samples.environment;
    if (method)
      audio.samples.environment = function (kind, rng, o) {
        const voice = method.call(this, kind, rng, o);
        records.push({ kind, end: voice.end });
        return voice;
      };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const before = records.length,
      choose = audio.rng.pick;
    audio.rng.pick = () => 'dog';
    try {
      audio.ambience.start();
      audio.ambience._timers.oneshot = 0;
      audio.ambience._timers.volley = 999;
      audio.ambience._timers.boom = 999;
      audio.update(0.01, ctx);
    } finally {
      audio.rng.pick = choose;
      audio.ambience.dispose();
    }
    await wait(2500);
    audio.update(0, ctx);
    return {
      records,
      scheduler: records.slice(before),
      noPhantom: typeof audio._distantChatter === 'undefined',
      audio: audio.report(),
      active: audio.field.emitters.filter((e) => !e.free).length,
      engineError: engine.error ?? null,
    };
  });
  assert.equal(report.audio.errors, 0);
  assert.equal(report.engineError, null);
  assert.equal(report.active, 0);
  assert.equal(report.records.length, 1);
  assert.deepEqual(
    report.scheduler.map((r) => r.kind),
    ['dog']
  );
  assert(report.noPhantom);
  assert.deepEqual(errors, []);
  console.log(
    'PASS real environmental scheduler, no phantom voices and finite cleanup',
    JSON.stringify({ events: report.records.length, active: report.active })
  );
} finally {
  await close();
}
