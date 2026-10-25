/** Real producers and the live audio graph; bank matrices belong to smoke/native audio tests. */
import assert from 'node:assert/strict';

import { openAudioGame } from '../lib/audio-game.mjs';

const { page, errors, close } = await openAudioGame(5533, 'weapon');
try {
  const result = await page.evaluate(async () => {
    const e = window.__ENGINE__,
      ctx = e.ctx,
      audio = ctx.get('audio'),
      weapons = ctx.get('weapons'),
      player = ctx.get('player'),
      ai = ctx.get('ai'),
      physics = ctx.get('physics'),
      radio = ctx.get('radio');
    await weapons._restTask;
    for (const actor of ai.agents) actor.dispose();
    ai.agents.length = ai.squads.length = 0;
    e.setGameplaySuspended(true);
    if (!(await audio.start())) throw Error('Actual game audio failed');
    audio.ambience.dispose();
    audio.update(0, ctx);
    const trace = [],
      recordings = [];
    for (const key of ['_playDry', '_playAt']) {
      const play = audio[key].bind(audio);
      audio[key] = (...args) => {
        trace.push(args[0]);
        return play(...args);
      };
    }
    for (const key of ['damage', 'reaction', 'reload', 'radio', 'environment']) {
      const play = audio.samples[key].bind(audio.samples);
      audio.samples[key] = (...args) => {
        recordings.push([key, args[0], args[1]]);
        return play(...args);
      };
    }
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const { HEALTH } = await import('/src/player/tuning.ts');
    const damage = [];
    for (const [health, armour, amount, type] of [
      [100, 0, 25, 'bullet'],
      [100, HEALTH.plateSize, HEALTH.plateSize / (1 - HEALTH.armourReduction), 'bullet'],
      [100, 0, 25, 'explosion'],
    ]) {
      player.health.reset(true);
      player.health.setDebugValue(health);
      player.health.armour = armour;
      trace.length = 0;
      player.applyDamage(amount, ctx.camera.position.clone().addScalar(2), { type });
      ctx.get('ui').lateUpdate(1 / 60, ctx);
      damage.push([player.health.value, player.health.armour, trace.slice()]);
    }
    const { combatLane } = await import('/tools/lib/combat-fixture.js');
    const { positions } = combatLane(ai, ctx.get('world'), physics, [[9, 0]]);
    const eye = positions[0].clone();
    eye.y += player.eyeHeight;
    player.health.reset(true);
    player.teleport(eye, 0);
    player.setControlEnabled(false);
    player._syncHitbox();
    ctx.camera.position.copy(eye);
    const incoming = positions[1].clone();
    incoming.y = eye.y - 0.3;
    audio.update(0, ctx);
    trace.length = 0;
    physics.fireBullet({
      origin: incoming,
      dir: eye.clone().sub(incoming).normalize(),
      shooter: 'enemy',
      damage: 25,
      penetration: 0,
      maxDist: 30,
      weapon: 'rifle',
    });
    const incomingTrace = trace.slice();
    const incomingHealth = player.health.value;
    const target = ai.spawn('vanguard', positions[1], 0);
    target._drive(1 / 60);
    target.syncHitboxes();
    const fire = (amount) =>
      physics.fireBullet({
        origin: eye,
        dir: target.position.clone().add({ x: 0, y: 1.35, z: 0 }).sub(eye).normalize(),
        shooter: player,
        damage: amount,
        penetration: 1,
        maxDist: 30,
        weapon: 'rifle',
      });
    trace.length = recordings.length = 0;
    const draw = audio.rng.float;
    audio.rng.float = () => 0;
    try {
      fire(1);
    } finally {
      audio.rng.float = draw;
    }
    const enemyTrace = trace.slice();
    const hurtHealth = target.health;
    await wait(900);
    audio.update(0, ctx);
    target.health = 1;
    fire(100);
    const reactions = recordings
      .filter(([key]) => key === 'reaction')
      .map(([, kind, voice]) => [kind, voice]);
    const dead = !target.alive;

    // Actual clip callbacks must reach recordings; stopping the clip cancels later cues.
    weapons.setWeaponImmediate('rifle');
    weapons.viewmodel.stopClip();
    weapons._fireTimer = 0;
    Object.assign(weapons.state, { mag: 0, chambered: false, reserve: 100 });
    Object.assign(weapons._state, { empty: true, magazineLoaded: false, remainingRounds: 0 });
    recordings.length = 0;
    if (!weapons.reload()) throw Error('Reload refused');
    const step = (seconds) => {
      for (let t = 0; t < seconds; t += 1 / 240) {
        ctx.time.elapsed += 1 / 240;
        weapons.lateUpdate(1 / 240, ctx);
      }
    };
    step(1);
    const reload = recordings.filter(([key]) => key === 'reload').length;
    weapons.viewmodel.stopClip();
    recordings.length = 0;
    step(5);
    const cancelled = recordings.length;

    radio.clearStrike();
    weapons._stowRadio();
    weapons.carpetBombs = 2;
    const acknowledgments = [];
    const playUi = audio.playUi.bind(audio);
    audio.playUi = (kind, level) => {
      acknowledgments.push(kind);
      return playUi(kind, level);
    };
    weapons._updateRadio({ actionPressed: (id) => id === 'radio' }, true);
    acknowledgments.length = 0;
    weapons._selectRequest(1);
    const accepted = [weapons.carpetBombs, radio.active.length, acknowledgments.slice()];
    weapons._updateRadio({ actionPressed: (id) => id === 'radio' }, true);
    acknowledgments.length = 0;
    weapons._selectRequest(1);
    const refused = [weapons.carpetBombs, acknowledgments.slice()];
    radio.clearStrike();
    weapons._stowRadio();
    ctx.events.emit('intel:available', { count: 1 });
    const received = recordings.filter(([key]) => key === 'radio').map(([, kind]) => kind);
    const pick = audio.rng.pick;
    audio.rng.pick = () => 'dog';
    try {
      audio.ambience.start();
      Object.assign(audio.ambience._timers, { oneshot: 0, volley: 999, boom: 999 });
      audio.update(0.01, ctx);
    } finally {
      audio.rng.pick = pick;
      audio.ambience.dispose();
    }
    const environment = recordings.filter(([key]) => key === 'environment').map(([, kind]) => kind);
    await wait(3000);
    audio.update(0, ctx);
    return {
      damage,
      incomingTrace,
      incomingHealth,
      enemyTrace,
      hurtHealth,
      reactions,
      actor: target.id,
      dead,
      reload,
      cancelled,
      accepted,
      refused,
      received,
      environment,
      active: audio.field.emitters.filter((emitter) => !emitter.free).length,
      loops: audio._aircraft.size,
      errors: audio.stats.errors,
      engineError: e.error,
    };
  });
  assert.deepEqual(result.damage, [
    [75, 0, ['damage']],
    [100, 0, ['damage']],
    [75, 0, ['damage']],
  ]);
  assert(result.incomingHealth < 100);
  assert.deepEqual(result.incomingTrace.sort(), ['damage', 'whizz']);
  assert(result.hurtHealth > 0 && result.hurtHealth < 100 && result.dead);
  assert.equal(result.enemyTrace.filter((kind) => kind === 'impact').length, 1);
  assert.equal(result.enemyTrace.filter((kind) => kind === 'hitmarker').length, 1);
  assert(!result.enemyTrace.includes('whizz'));
  assert.deepEqual(result.reactions, [
    ['hurt', result.actor],
    ['death', result.actor],
  ]);
  assert(result.reload > 0);
  assert.equal(result.cancelled, 0);
  assert.deepEqual(result.accepted, [1, 1, ['radio_strike']]);
  assert.deepEqual(result.refused, [1, ['radio_denied']]);
  assert.deepEqual(result.received, ['radio_open', 'radio_strike', 'radio_open', 'intel_call']);
  assert.deepEqual(result.environment, ['dog']);
  assert.equal(result.active, 0);
  assert.equal(result.loops, 0);
  assert.equal(result.errors, 0);
  assert.equal(result.engineError, null);
  assert.deepEqual(errors, []);
  console.log(
    'PASS live damage/flight, actor reactions, reload cancellation, radio ownership and environment routing'
  );
} finally {
  await close();
}
