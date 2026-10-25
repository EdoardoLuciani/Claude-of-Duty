/** Native whole-mix regression; per-bank assets/routing are covered separately. */
export function mixCases() {
  const cases = [];
  const add = (id, role, event, options = {}) => cases.push({ id, role, event, ...options });
  add('gun-rifle-0', 'anchor', 'gun', { weapon: 'rifle', distance: 0 });
  add('gun-rifle-70', 'anchor', 'gun', { weapon: 'rifle', distance: 70 });
  add('own-step-concrete-walk', 'routine', 'own-step', { surface: 'concrete', gait: 'walk' });
  for (const distance of [2, 8])
    add(`enemy-step-concrete-${distance}`, 'routine', 'enemy-step', {
      surface: 'concrete',
      distance,
    });
  add('reload-room', 'routine', 'reload', { phase: 'magin', space: 'room' });
  add('ui-hitmarker', 'routine', 'ui', { kind: 'hitmarker' });
  for (const kind of ['radio_open', 'radio_strike', 'intel_call'])
    add(`recorded-radio-${kind}`, 'warning', 'ui', { kind });
  add('voice-near', 'speech', 'voice', { kind: 'spot', distance: 2 });
  add('voice-room', 'speech', 'voice', { kind: 'spot', space: 'room' });
  for (const [id, amount, armourAbsorbed, plateBreak] of [
    ['health', 25, 0, false],
    ['armour', 0, 25, false],
    ['mixed', 15, 15, false],
    ['break', 15, 15, true],
    ['break-armour-only', 0, 25, true],
  ])
    for (const combat of [false, true])
      add(`damage-${id}${combat ? '-combat' : ''}`, combat ? 'context' : 'warning', 'damage', {
        amount,
        armourAbsorbed,
        plateBreak,
        combat,
      });
  add('damage-concussed', 'context', 'damage', { amount: 25, armourAbsorbed: 0, concussed: true });
  add('damage-health-flight', 'threat', 'damage', { amount: 25, armourAbsorbed: 0, flight: true });
  for (const variant of [0, 1])
    add(`aircraft-flyby-${variant}`, 'aircraft', 'aircraft', { variant });
  add('aircraft-room', 'aircraft', 'aircraft', { variant: 0, space: 'room' });
  add('aircraft-cancel-before-arrival', 'silence', 'aircraft', { cancelEarly: true });
  add('ambience-idle', 'silence', 'ambience-idle');
  for (const space of ['open', 'room'])
    add(`ambient-heli-nearest-${space}`, 'background', 'ambient', {
      which: 'heli',
      distance: 90,
      space,
    });
  add('shop-radio', 'music', 'music');
  add('intel-alarm', 'warning', 'intel');
  add('blast-3', 'threat', 'blast', { distance: 3 });
  add('mixed-firefight', 'context', 'combat');
  add('mixed-room', 'context', 'combat', { space: 'room' });
  add('mixed-far', 'context', 'combat', { far: true });
  return cases;
}

export async function renderMixCase(scenario, { rate = 48000, seed = 1907 } = {}) {
  const [
    { AudioSystem },
    { Mixer },
    { WeaponSampleBank },
    { NoiseBank },
    { Rng },
    { SpatialField },
    { EventBus },
    { WEAPON_DEFS },
    { Ambience, AMBIENT_EVENT_GAIN },
    { TentRadio },
  ] = await Promise.all([
    import('/src/audio/index.ts'),
    import('/src/audio/mixer.ts'),
    import('/src/audio/samples.ts'),
    import('/src/audio/dsp.ts'),
    import('/src/core/rng.ts'),
    import('/src/audio/spatial.ts'),
    import('/src/core/registry.ts'),
    import('/src/weapons/defs.ts'),
    import('/src/audio/ambience.ts'),
    import('/src/audio/music.ts'),
  ]);
  if (!window.mixBuffers) {
    const load = new WeaponSampleBank(new OfflineAudioContext(2, rate, rate));
    await load.load();
    window.mixBuffers = {
      buffers: load.buffers,
      actionBuffer: load.actionBuffer,
      explosionBuffer: load.explosionBuffer,
      heartbeatBuffer: load.heartbeatBuffer,
      hitBuffers: load.hitBuffers,
      aircraftBuffers: load.aircraftBuffers,
      reloadBuffers: load.reloadBuffers,
    };
  }
  const seconds = 14,
    ctx = new OfflineAudioContext(10, seconds * rate, rate);
  await Mixer.prepare(ctx);
  const clock = new Proxy(ctx, {
    get(target, key) {
      if (key === 'state') return 'running';
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const rng = new Rng(seed),
    bank = new NoiseBank(clock, rng.fork(), 9.6);
  const mixer = new Mixer(ctx, rng.fork(), {});
  mixer.actx = clock;
  mixer.buildReverbs();
  const space = { open: 0, room: 0, street: 0, tunnel: 0, tight: 0, [scenario.space ?? 'open']: 1 };
  mixer.setSpace(space, 0.001);
  const field = new SpatialField(clock, mixer, null);
  field.setListener(0, 1.6, 0, 0, 0, -1, 0, 1, 0);
  const samples = new WeaponSampleBank(clock);
  Object.assign(samples, window.mixBuffers);
  const events = new EventBus(),
    runtime = { events, peek: () => null };
  const audio = new AudioSystem();
  Object.assign(audio, {
    running: true,
    actx: clock,
    rng,
    bank,
    samples,
    mixer,
    field,
    ctx: runtime,
    _space: space,
    _lastEnemyFire: 1000,
  });
  audio._wireEvents(runtime);
  let ambience, radio;
  try {
    if (scenario.event === 'music') {
      radio = new TentRadio(clock, mixer, rng.fork());
      const key = `${rate}:${seed}`;
      window.mixRadioBuffers ??= {};
      if (window.mixRadioBuffers[key]) radio._buf = window.mixRadioBuffers[key];
      else {
        await radio.warm();
        window.mixRadioBuffers[key] = radio._buf;
      }
      if (!radio._buf) throw Error('Actual shop-radio render failed');
    }
    const scheduled = [];
    const at = (time, action) => scheduled.push({ time, action });
    const point = (x = 0, y = 0) => ({ x, y, z: 0 });
    const emit = (type, payload) => events.emit(type, payload);
    const fire = (time, id = 'rifle', distance = 0) =>
      at(time, () =>
        emit('weapon:fire', {
          actor: distance ? 'enemy' : 'player',
          weapon: WEAPON_DEFS[id],
          origin: point(distance, 1.6),
          firstPerson: distance === 0,
        })
      );
    const step = (time, enemy = false, distance = 2, surface = 'concrete', gait = 'walk') =>
      at(time, () =>
        emit(enemy ? 'ai:footstep' : 'player:footstep', {
          position: point(enemy ? distance : 0),
          surface,
          gait,
        })
      );
    const startAmbience = (time) =>
      at(time, () => {
        ambience = new Ambience(rng.fork());
        ambience.start();
      });
    const s = scenario,
      t = 2.1;
    switch (s.event) {
      case 'gun':
        fire(t, s.weapon, s.distance);
        break;
      case 'own-step':
        step(t, false, 0, s.surface, s.gait);
        break;
      case 'enemy-step':
        step(t, true, s.distance, s.surface);
        break;
      case 'reload':
        at(t, () =>
          emit('weapon:reload', {
            weapon: WEAPON_DEFS[s.phase === 'pump' || s.phase === 'shellin' ? 'shotgun' : 'rifle'],
            phase: s.phase,
          })
        );
        break;
      case 'ui':
        at(t, () => audio.ui(s.kind, 1));
        break;
      case 'voice':
        at(t, () =>
          audio.bark(s.kind, s.radio ? null : point(s.distance ?? 5, 1.6), {
            radio: !!s.radio,
            voice: s.voice ?? 0,
            force: true,
          })
        );
        break;
      case 'aircraft': {
        let voice;
        samples.aircraftIndex = s.variant === 1 ? 0 : 1;
        at(t, () => {
          voice = audio.startAircraft({ x: -180, y: 55, z: 0 });
        });
        if (s.cancelEarly) at(t + 0.05, () => voice?.stop());
        else {
          for (let i = 1; i <= 450; i++)
            at(t + i * 0.02, () => voice?.move({ x: -180 + i * 0.8, y: 55, z: 0 }));
          at(t + 9, () => voice?.stop());
        }
        break;
      }
      case 'damage':
        if (s.flight)
          at(t, () =>
            emit('bullet:segment', {
              from: { x: -9, y: 1.35, z: 0 },
              to: { x: -0.3, y: 1.35, z: 0 },
              shooter: 'enemy',
              shot: 473,
            })
          );
        if (s.concussed) at(t - 0.2, () => mixer.concuss(0.8));
        if (s.combat) {
          for (let i = 0; i < 20; i++) fire(t - 0.1 + i * 0.09, 'lmg');
          for (let i = 0; i < 12; i++) fire(t + i * 0.13, 'rifle', 10);
        }
        for (const offset of s.combat ? [0, 0.36, 0.72, 1.08] : [0])
          at(t + offset, () =>
            emit('damage:taken', {
              amount: s.amount,
              armourAbsorbed: s.armourAbsorbed,
              plateBreak: !!s.plateBreak,
              health: 60,
              armour: 25,
              from: point(10, 1.6),
            })
          );
        break;
      case 'ambience-idle':
        startAmbience(t);
        break;
      case 'ambient':
        at(t, () => {
          if (s.variant !== undefined)
            samples.hitIndices[`environment-${s.which}`] = s.variant === 0 ? 1 : 0;
          return audio._playAt(
            'ambient',
            s.distance,
            1.6,
            0,
            {
              which: s.which,
              level: 1,
              gain: AMBIENT_EVENT_GAIN[s.which] ?? AMBIENT_EVENT_GAIN.near,
              occlusion: 0,
            },
            'ambience',
            0.15
          );
        });
        break;
      case 'music':
        at(t, () => radio.start());
        break;
      case 'intel':
        at(t, () => emit('intel:operation', { active: true }));
        break;
      case 'blast':
        at(t, () => emit('explosion', { position: point(s.distance, 1.6), radius: 6 }));
        break;
      case 'combat': {
        startAmbience(t);
        for (let i = 0; i < 10; i++)
          step(t + i * 0.42, false, 0, i % 2 ? 'metal' : 'concrete', 'run');
        for (let i = 0; i < 8; i++) step(t + 0.18 + i * 0.5, true, 5, 'dirt');
        at(2.7, () => emit('player:state', { ads: true }));
        at(3.4, () => emit('weapon:reload', { weapon: WEAPON_DEFS.rifle, phase: 'magin' }));
        at(4.2, () => audio.bark('spot', point(5, 1.6), { force: true }));
        if (s.event === 'combat') {
          for (let i = 0; i < 12; i++) fire(2.5 + i * 0.09);
          for (let enemy = 0; enemy < 3; enemy++)
            for (let i = 0; i < 4; i++)
              fire(2.6 + i * 0.14, ['rifle', 'lmg', 'smg'][enemy], (s.far ? 50 : 10) + enemy * 10);
          at(2.8, () => audio.ui('hitmarker', 1));
          at(3.1, () =>
            emit('bullet:impact', { point: point(4, 1.6), damage: 30, surface: 'concrete' })
          );
          at(3.3, () => emit('player:heartbeat', { strength: 0.6 }));
        }
        break;
      }
      default:
        throw Error('Unknown mix scenario: ' + s.event);
    }
    at(7.5, () => {
      ambience?.dispose();
      radio?.stop();
      emit('intel:operation', { active: false });
    });
    const merge = ctx.createChannelMerger(10);
    mixer.masterGain.disconnect(ctx.destination);
    for (const [node, offset] of [
      [mixer.masterGain, 0],
      [mixer.masterSum, 2],
      [mixer.reverbReturn, 4],
      [mixer.worldSum, 6],
      [mixer.buses.ui.level, 8],
    ]) {
      const split = ctx.createChannelSplitter(2);
      node.connect(split);
      split.connect(merge, 0, offset);
      split.connect(merge, 1, offset + 1);
    }
    merge.connect(ctx.destination);
    const ticks = new Map();
    for (let time = 0.02; time < seconds - 0.01; time += 0.02)
      ticks.set(Math.floor((time * rate) / 128), []);
    for (const item of scheduled) {
      const q = Math.floor((item.time * rate) / 128);
      if (!ticks.has(q)) ticks.set(q, []);
      ticks.get(q).push(item.action);
    }
    let previous = 0;
    const callbacks = [...ticks]
      .sort(([a], [b]) => a - b)
      .map(([q, actions]) =>
        ctx.suspend((q * 128 + 0.5) / rate).then(async () => {
          const now = ctx.currentTime;
          mixer.update(now - previous);
          previous = now;
          field.update();
          for (const key of Object.keys(audio._budget)) audio._budget[key] = 0;
          for (const slot of audio._dry)
            if (slot.node && now >= slot.end) {
              slot.node.disconnect();
              slot.send?.disconnect();
              slot.node = null;
              slot.send = null;
            }
          for (const action of actions) await action();
          await ctx.resume();
        })
      );
    const output = await ctx.startRendering();
    await Promise.all(callbacks);
    const measure = (offset) => {
      let peak = 0,
        energy = 0,
        tailPeak = 0;
      const windows = [20, 200].map((ms) => Math.round((rate * ms) / 1000)),
        maxima = [0, 0];
      for (let ch = 0; ch < 2; ch++) {
        const data = output.getChannelData(offset + ch),
          sums = [0, 0];
        for (let i = 0; i < data.length; i++) {
          const x = data[i];
          if (!Number.isFinite(x)) throw Error('Nonfinite native audio');
          peak = Math.max(peak, Math.abs(x));
          energy += x * x;
          if (i >= data.length - 0.1 * rate) tailPeak = Math.max(tailPeak, Math.abs(x));
          for (let j = 0; j < windows.length; j++) {
            sums[j] += x * x;
            if (i >= windows[j]) sums[j] -= data[i - windows[j]] ** 2;
            maxima[j] = Math.max(maxima[j], sums[j] / windows[j]);
          }
        }
      }
      return {
        peak,
        peakDb: 20 * Math.log10(Math.max(peak, 1e-8)),
        rms: Math.sqrt(energy / (output.length * 2)),
        max20Db: 10 * Math.log10(Math.max(maxima[0], 1e-16)),
        max200Db: 10 * Math.log10(Math.max(maxima[1], 1e-16)),
        tailPeak,
      };
    };
    const stages = Object.fromEntries(
      [
        ['final', 0],
        ['masterInput', 2],
        ['wetReturn', 4],
        ['worldInput', 6],
        ['uiFeedback', 8],
      ].map(([name, offset]) => [name, measure(offset)])
    );
    const pcm = new Float32Array(output.length * 2);
    for (let i = 0; i < output.length; i++)
      for (let ch = 0; ch < 2; ch++) pcm[i * 2 + ch] = output.getChannelData(ch)[i];
    const bytes = new Uint8Array(pcm.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return {
      scenario,
      rate,
      seed,
      seconds,
      stages,
      nativeWorklet: mixer.energyMix instanceof AudioWorkletNode,
      errors: audio.stats.errors,
      dropped: field.stats.dropped,
      stolen: field.stats.stolen,
      pcm: btoa(binary),
    };
  } finally {
    ambience?.dispose();
    radio?.stop();
    audio._stopAircraft(true);
    field.dispose();
    mixer.dispose();
  }
}
