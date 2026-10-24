/** Browser-only, deterministic native-audio mix benchmark. No runtime gain overrides. */
export function mixCases() {
  const cases = [];
  const add = (id, role, event, options = {}) => cases.push({ id, role, event, ...options });
  for (const weapon of ['rifle', 'mcx', 'pistol', 'lmg', 'smg', 'sniper', 'shotgun'])
    for (const distance of [0, 20, 70])
      add(`gun-${weapon}-${distance}`, 'anchor', 'gun', { weapon, distance });
  for (const surface of ['concrete', 'metal', 'wood', 'dirt', 'foliage', 'sand'])
    for (const gait of ['walk', 'run'])
      add(`own-step-${surface}-${gait}`, 'routine', 'own-step', { surface, gait });
  for (const gait of ['crouch', 'sprint'])
    add(`own-step-concrete-${gait}`, 'routine', 'own-step', { surface: 'concrete', gait });
  for (const surface of ['concrete', 'metal', 'sand'])
    for (const distance of [2, 8, 20])
      add(`enemy-step-${surface}-${distance}`, 'routine', 'enemy-step', {
        surface,
        distance,
      });
  for (const phase of ['start', 'magout', 'magin', 'end', 'pump', 'shellin'])
    add(`reload-${phase}`, 'routine', 'reload', { phase });
  for (const event of ['cloth', 'ads', 'shell']) add(event, 'routine', event);
  add('bodyfall', 'impact', 'bodyfall');
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
  ])
    for (const distance of [2, 10])
      add(`material-${surface}-${distance}`, 'impact', 'material', { surface, distance });
  for (const surface of ['wood', 'dirt', 'foliage', 'fabric', 'water'])
    add(`bodyfall-${surface}`, 'impact', 'fall-surface', { surface });
  for (const surface of ['glass', 'water', 'fabric', 'rubber'])
    for (const gait of ['walk', 'run'])
      add(`own-step-${surface}-${gait}`, 'routine', 'own-step', { surface, gait });
  for (const velocity of [4, 9, 14]) add(`land-${velocity}`, 'impact', 'land', { velocity });
  for (const kind of [
    'hitmarker',
    'headshot',
    'kill',
    'damage',
    'market_buy',
    'market_hover',
    'grenade_warn',
    'lowhealth',
    'intel_call',
    'intel_beep',
  ])
    add(
      `ui-${kind}`,
      ['damage', 'grenade_warn', 'lowhealth', 'intel_call'].includes(kind) ? 'warning' : 'routine',
      'ui',
      { kind }
    );
  for (const kind of ['radio_open', 'radio_strike', 'intel_call'])
    add(`recorded-radio-${kind}`, 'warning', 'ui', { kind });
  for (const kind of ['spot', 'reload', 'hurt', 'death'])
    add(`voice-${kind}`, 'speech', 'voice', { kind });
  add('radio-voice', 'speech', 'voice', { kind: 'spot', radio: true });
  add('voice-near', 'speech', 'voice', { kind: 'spot', distance: 2 });
  add('own-hurt', 'warning', 'own-hurt');
  for (const strength of [0.25, 0.6])
    add(`heartbeat-${strength}`, 'warning', 'heartbeat', { strength });
  for (const [id, amount, armourAbsorbed, plateBreak] of [
    ['health', 25, 0, false],
    ['armour', 0, 25, false],
    ['mixed', 15, 15, false],
    ['break', 15, 15, true],
    ['break-armour-only', 0, 25, true],
  ]) {
    add(`damage-${id}`, 'warning', 'damage', { amount, armourAbsorbed, plateBreak });
    add(`damage-${id}-combat`, 'context', 'damage', {
      amount,
      armourAbsorbed,
      plateBreak,
      combat: true,
    });
  }
  add('damage-concussed', 'context', 'damage', { amount: 25, armourAbsorbed: 0, concussed: true });
  add('damage-health-flight', 'threat', 'damage', { amount: 25, armourAbsorbed: 0, flight: true });
  for (const distance of [2, 10, 25]) add(`flesh-${distance}`, 'impact', 'flesh', { distance });
  for (const variant of [0, 1])
    add(`aircraft-flyby-${variant}`, 'aircraft', 'aircraft', { variant });
  add('aircraft-room', 'aircraft', 'aircraft', { variant: 0, space: 'room' });
  add('aircraft-cancel-before-arrival', 'silence', 'aircraft', { cancelEarly: true });
  add('near-impact', 'threat', 'near-impact');
  add('near-miss', 'threat', 'near-miss');
  add('own-step-room', 'routine', 'own-step', {
    surface: 'concrete',
    gait: 'run',
    space: 'room',
  });
  add('reload-room', 'routine', 'reload', { phase: 'magin', space: 'room' });
  add('voice-room', 'speech', 'voice', { kind: 'spot', space: 'room' });
  add('ambient-heli-room', 'background', 'ambient', {
    which: 'heli',
    distance: 120,
    space: 'room',
  });
  add('distant-boom-room', 'distant', 'distant-boom', { space: 'room' });
  add('ambience-idle', 'silence', 'ambience-idle');
  for (const [which, distance] of [
    ['creak', 14],
    ['birds', 24],
    ['heli', 120],
    ['siren', 120],
  ])
    add(`ambient-${which}`, 'background', 'ambient', { which, distance });
  for (const space of ['open', 'room'])
    add(`ambient-heli-nearest-${space}`, 'background', 'ambient', {
      which: 'heli',
      distance: 90,
      space,
    });
  add('distant-volley', 'distant', 'distant-volley');
  add('distant-boom', 'distant', 'distant-boom');
  add('shop-radio', 'music', 'music');
  add('intel-alarm', 'warning', 'intel');
  for (const distance of [3, 20]) add(`blast-${distance}`, 'threat', 'blast', { distance });
  add('walking-street', 'context', 'street');
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
      case 'cloth':
        at(t, () => emit('player:state', { stance: 'crouch' }));
        break;
      case 'ads':
        at(t, () => emit('player:state', { ads: true }));
        break;
      case 'shell':
        at(t, () => emit('weapon:shell', { position: point(0, 1.6) }));
        break;
      case 'land':
        at(t, () => emit('player:land', { velocity: s.velocity, surface: 'concrete' }));
        break;
      case 'bodyfall':
        at(t, () => audio._playAt('bodyfall', 2, 0, 0, { level: 1 }, 'foley', 0.6));
        break;
      case 'ui':
        at(t, () => audio.ui(s.kind, 1));
        break;
      case 'voice':
        at(t, () =>
          audio.bark(s.kind, s.radio ? null : point(s.distance ?? 5, 1.6), {
            radio: !!s.radio,
            force: true,
          })
        );
        break;
      case 'own-hurt':
        at(t, () => audio._playDry('bark', { bark: 'hit', level: 0.5, f0: 108 }, 'voice', 0.1));
        break;
      case 'heartbeat':
        at(t, () => emit('player:heartbeat', { strength: s.strength }));
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
      case 'material':
        at(t, () =>
          emit('bullet:impact', {
            point: point(s.distance, 1.4),
            surface: s.surface,
            damage: 30,
            actor: null,
            shooter: 'player',
            shot: 473,
            exit: false,
          })
        );
        break;
      case 'fall-surface':
        at(t, () =>
          audio._playAt('bodyfall', 2, 0.1, 0, { surface: s.surface, level: 1 }, 'foley', 0.6)
        );
        break;
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
      case 'flesh':
        at(t, () =>
          emit('bullet:impact', {
            point: point(s.distance, 1.6),
            surface: 'flesh',
            damage: 30,
            actor: { id: 1 },
            shooter: 'player',
            shot: 1,
            exit: false,
          })
        );
        break;
      case 'near-impact':
        at(t, () =>
          emit('bullet:impact', { point: point(2, 1.6), damage: 30, surface: 'concrete' })
        );
        break;
      case 'near-miss':
        at(t, () =>
          emit('bullet:segment', {
            from: { x: -10, y: 1.6, z: -0.5 },
            to: { x: 10, y: 1.6, z: -0.5 },
            shooter: 'enemy',
            shot: 1,
          })
        );
        break;
      case 'ambience-idle':
        startAmbience(t);
        break;
      case 'ambient':
        at(t, () =>
          audio._playAt(
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
          )
        );
        break;
      case 'music':
        at(t, () => radio.start());
        break;
      case 'intel':
        at(t, () => emit('intel:operation', { active: true }));
        break;
      case 'distant-volley':
        at(t, () => audio._distantVolley());
        break;
      case 'distant-boom':
        at(t, () => audio._distantBoom());
        break;
      case 'blast':
        at(t, () => emit('explosion', { position: point(s.distance, 1.6), radius: 6 }));
        break;
      case 'street':
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
