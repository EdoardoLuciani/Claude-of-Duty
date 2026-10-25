/** Representative native mixes: hierarchy, incoming readability, silence and output safety. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const server = await ensureViteServer({ port: 5494 });
assert(server, 'use an unused port');
let browser;
try {
  browser = await launchChromium({
    webgpu: false,
    headless: true,
    args: ['--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/mix-regression', (route) =>
    route.fulfill({ contentType: 'text/html', body: 'Native mix regression' })
  );
  await page.goto('http://127.0.0.1:5494/mix-regression');
  const rows = [];
  for (const kind of [
    'gun',
    'step',
    'reload',
    'voice',
    'radio',
    'damage',
    'damage-combat',
    'damage-concussed',
    'aircraft',
    'ambient-room',
    'music',
    'intel',
    'idle',
  ]) {
    const row = await page.evaluate(async (kind) => {
      const [
        { AudioSystem },
        { Mixer },
        { WeaponSampleBank },
        { NoiseBank },
        { Rng },
        { SpatialField },
        { EventBus },
        { WEAPON_DEFS },
        { TentRadio },
        { Ambience, AMBIENT_EVENT_GAIN },
      ] = await Promise.all([
        import('/src/audio/index.ts'),
        import('/src/audio/mixer.ts'),
        import('/src/audio/samples.ts'),
        import('/src/audio/dsp.ts'),
        import('/src/core/rng.ts'),
        import('/src/audio/spatial.ts'),
        import('/src/core/registry.ts'),
        import('/src/weapons/defs.ts'),
        import('/src/audio/music.ts'),
        import('/src/audio/ambience.ts'),
      ]);
      const rate = 48000,
        seconds = 14;
      const ctx = new OfflineAudioContext(4, rate * seconds, rate);
      await Mixer.prepare(ctx);
      const clock = new Proxy(ctx, {
        get(target, key) {
          if (key === 'state') return 'running';
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const rng = new Rng(1907),
        bank = new NoiseBank(clock, rng.fork(), 9.6);
      const mixer = new Mixer(ctx, rng.fork());
      mixer.actx = clock;
      mixer.buildReverbs();
      const space = {
        open: kind === 'ambient-room' ? 0 : 1,
        room: kind === 'ambient-room' ? 1 : 0,
        street: 0,
        tunnel: 0,
        tight: 0,
      };
      mixer.setSpace(space, 0.001);
      const field = new SpatialField(clock, mixer, null);
      field.setListener(0, 1.6, 0, 0, 0, -1, 0, 1, 0);
      const samples = new WeaponSampleBank(clock);
      // Decode once; each scenario still owns fresh selection/playback state.
      if (!window.__MIX_BUFFERS__) {
        await samples.load();
        window.__MIX_BUFFERS__ = Object.fromEntries(
          [
            'buffers',
            'actionBuffer',
            'explosionBuffer',
            'heartbeatBuffer',
            'hitBuffers',
            'aircraftBuffers',
            'reloadBuffers',
          ].map((key) => [key, samples[key]])
        );
      } else Object.assign(samples, window.__MIX_BUFFERS__);
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
      const point = { x: 0, y: 1.6, z: 0 };
      const scheduled = [];
      const at = (time, action) => scheduled.push({ time, action });
      const emit = (name, payload) => events.emit(name, payload);
      const fire = (time) =>
        at(time, () =>
          emit('weapon:fire', {
            actor: 'player',
            weapon: WEAPON_DEFS.lmg,
            origin: point,
            firstPerson: true,
          })
        );
      let aircraft, music, ambience;
      try {
        if (kind.startsWith('damage')) {
          if (kind === 'damage-combat') for (let i = 0; i < 20; i++) fire(2 + i * 0.09);
          if (kind === 'damage-concussed') at(1.9, () => mixer.concuss(0.8));
          at(2.1, () =>
            emit('damage:taken', {
              amount: 15,
              armourAbsorbed: 15,
              plateBreak: true,
              health: 60,
              armour: 25,
              from: point,
            })
          );
        } else
          switch (kind) {
            case 'gun':
              at(2.1, () =>
                emit('weapon:fire', {
                  actor: 'player',
                  weapon: WEAPON_DEFS.rifle,
                  origin: point,
                  firstPerson: true,
                })
              );
              break;
            case 'step':
              at(2.1, () =>
                emit('player:footstep', { position: point, surface: 'concrete', gait: 'walk' })
              );
              break;
            case 'reload':
              at(2.1, () => emit('weapon:reload', { weapon: WEAPON_DEFS.rifle, phase: 'magin' }));
              break;
            case 'voice':
              at(2.1, () => audio.bark('spot', { x: 2, y: 1.6, z: 0 }, { force: true }));
              break;
            case 'radio':
              at(2.1, () => audio.ui('radio_strike', 1));
              break;
            case 'aircraft':
              at(2.1, () => {
                aircraft = audio.startAircraft({ x: -180, y: 55, z: 0 });
              });
              for (let i = 1; i <= 450; i++)
                at(2.1 + i * 0.02, () => aircraft.move({ x: -180 + i * 0.8, y: 55, z: 0 }));
              at(11.1, () => aircraft.stop());
              break;
            case 'ambient-room':
              at(2.1, () =>
                audio._playAt(
                  'ambient',
                  90,
                  1.6,
                  0,
                  { which: 'heli', level: 1, gain: AMBIENT_EVENT_GAIN.heli, occlusion: 0 },
                  'ambience',
                  0.15
                )
              );
              break;
            case 'music':
              music = new TentRadio(clock, mixer, rng.fork());
              await music.warm();
              if (!music._buf) throw Error('Shop radio render failed');
              at(2.1, () => music.start());
              at(7.5, () => music.stop());
              break;
            case 'intel':
              at(2.1, () => emit('intel:operation', { active: true }));
              at(7.5, () => emit('intel:operation', { active: false }));
              break;
            case 'idle':
              ambience = new Ambience(rng.fork());
              ambience.start();
              break;
            default:
              throw Error('Unknown fixture ' + kind);
          }
        const merge = ctx.createChannelMerger(4);
        mixer.masterGain.disconnect(ctx.destination);
        for (const [node, offset] of [
          [mixer.masterGain, 0],
          [mixer.buses.ui.level, 2],
        ]) {
          const split = ctx.createChannelSplitter(2);
          node.connect(split);
          split.connect(merge, 0, offset);
          split.connect(merge, 1, offset + 1);
        }
        merge.connect(ctx.destination);
        scheduled.sort((a, b) => a.time - b.time);
        let next = 0,
          previous = 0;
        const callbacks = [];
        for (let time = 0.02; time < seconds - 0.01; time += 0.02) {
          const q = Math.floor((time * rate) / 128);
          callbacks.push(
            ctx.suspend((q * 128 + 0.5) / rate).then(async () => {
              const now = ctx.currentTime;
              mixer.update(now - previous);
              previous = now;
              field.update();
              for (const key of Object.keys(audio._budget)) audio._budget[key] = 0;
              while (next < scheduled.length && scheduled[next].time <= now)
                scheduled[next++].action();
              await ctx.resume();
            })
          );
        }
        const output = await ctx.startRendering();
        await Promise.all(callbacks);
        const measure = (offset) => {
          let peak = 0,
            tailPeak = 0;
          const widths = [960, 9600],
            maxima = [0, 0];
          for (let ch = 0; ch < 2; ch++) {
            const data = output.getChannelData(offset + ch),
              sums = [0, 0];
            for (let i = 0; i < data.length; i++) {
              const x = data[i];
              if (!Number.isFinite(x)) throw Error('Nonfinite native mix');
              peak = Math.max(peak, Math.abs(x));
              if (i >= data.length - rate * 0.1) tailPeak = Math.max(tailPeak, Math.abs(x));
              for (let j = 0; j < 2; j++) {
                sums[j] += x * x;
                if (i >= widths[j]) sums[j] -= data[i - widths[j]] ** 2;
                maxima[j] = Math.max(maxima[j], sums[j] / widths[j]);
              }
            }
          }
          return {
            peak,
            tailPeak,
            db: maxima.map((power) => 10 * Math.log10(Math.max(power, 1e-16))),
          };
        };
        const pcm = new Float32Array(output.length * 2);
        for (let i = 0; i < output.length; i++)
          for (let ch = 0; ch < 2; ch++) pcm[i * 2 + ch] = output.getChannelData(ch)[i];
        const bytes = new Uint8Array(pcm.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return {
          kind,
          final: measure(0),
          feedback: measure(2),
          pcm: btoa(binary),
          nativeWorklet: mixer.energyMix instanceof AudioWorkletNode,
          errors: audio.stats.errors,
          dropped: field.stats.dropped,
          stolen: field.stats.stolen,
        };
      } finally {
        ambience?.dispose();
        music?.stop();
        audio._stopAircraft(true);
        field.dispose();
        mixer.dispose();
        bank.dispose();
      }
    }, kind);
    const meter = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-f',
        'f32le',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-i',
        'pipe:0',
        '-af',
        'ebur128=peak=true',
        '-f',
        'null',
        '-',
      ],
      { input: Buffer.from(row.pcm, 'base64'), encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
    delete row.pcm;
    assert.equal(meter.status, 0, meter.error?.message ?? meter.stderr);
    const momentary = [...meter.stderr.matchAll(/\bM:\s*(-?[\d.]+)/g)].map((match) =>
      Number(match[1])
    );
    assert(momentary.length);
    row.lufs = Math.max(...momentary);
    assert(row.nativeWorklet);
    assert.equal(row.errors + row.dropped + row.stolen, 0);
    assert(row.final.peak <= 0.9900001);
    assert(row.final.tailPeak < 1e-5);
    if (kind === 'idle') assert.equal(row.final.peak, 0);
    else assert(row.final.peak > 1e-7, kind + ': silent fixture');
    rows.push(row);
    console.log('PASS', kind);
  }
  const gun = rows.find((row) => row.kind === 'gun');
  for (const row of rows) {
    const target = {
      step: [12, 8, 8],
      reload: [12, 8, 8],
      voice: [8, 6, 6],
      radio: [6, 3, 6],
      damage: [6, 3, 6],
      aircraft: [18, 12, 10],
      'ambient-room': [24, 18, 18],
      music: [15, 12, 10],
      intel: [6, 3, 6],
    }[row.kind];
    if (target)
      assert(
        [
          gun.final.db[0] - row.final.db[0],
          gun.final.db[1] - row.final.db[1],
          gun.lufs - row.lufs,
        ].every((gap, i) => gap >= target[i]),
        row.kind + ': hierarchy'
      );
    if (row.kind.startsWith('damage')) {
      assert(row.feedback.db[0] > -31 && row.feedback.db[0] < -15, 'incoming readability');
      assert(row.feedback.peak < 0.65, 'incoming source headroom');
      const quiet = rows.find((candidate) => candidate.kind === 'damage');
      assert(
        Math.abs(row.feedback.db[0] - quiet.feedback.db[0]) <
          (row.kind === 'damage-concussed' ? 0.01 : 3),
        'duck/concussion must not bury incoming feedback'
      );
    }
    if (row.kind === 'step' || row.kind === 'voice')
      assert(row.lufs >= -38, 'quiet-scene readability');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  stopViteServer(server);
}
