/**
 * AUDIO / SELF TEST
 *
 * Renders every voice through the real mixer graph in an OfflineAudioContext
 * and measures what came out. This is how the audio subsystem is verified:
 * screenshots prove nothing about sound, and OfflineAudioContext needs no user
 * gesture, so recordings and remaining synthesis can run headlessly.
 *
 * For each case we report:
 *   peak     absolute sample peak — >= 1.0 means the limiter failed
 *   rms      loudness; 0 means the voice is silent (a bug)
 *   dc       mean sample value; a large offset means an envelope never closed
 *   nan      any non-finite samples (bad exponentialRamp targets, /0, ...)
 *   centroid rough spectral centre of mass in Hz (via zero-crossing rate),
 *            enough to prove a "distant" shot is darker than a near one
 *
 * Usage from a served page:
 *   const { runAudioSelfTest } = await import('/src/audio/selftest.ts');
 *   const report = await runAudioSelfTest();
 */

import type { ReloadPhase } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import { AIRCRAFT_MIX } from './aircraft.ts';
import { ambientOneShot, ONE_SHOTS } from './ambience.ts';
import { NoiseBank } from './dsp.ts';
import { shellCasing, explosion, uiSound, heartbeat } from './foley.ts';
import { IR_SPECS, generateIR, classifySpace } from './ir.ts';
import { Mixer } from './mixer.ts';
import { RELOAD_CUES, reloadKind, type ReloadKind } from './reloads.ts';
import { WeaponSampleBank } from './samples.ts';
import { bark, BARKS } from './vox.ts';
import { WEAPON_PROFILES, weaponShot, weaponPunch, bulletWhizz, dryFire } from './weapons.ts';

interface AudioMetrics {
  peak: number;
  rms: number;
  dc: number;
  nan: number;
  centroid: number;
}
interface SelfTestResult {
  name: string;
  ms?: number;
  seconds?: number;
  error?: string;
  peak?: number;
  rms?: number;
  dc?: number;
  nan?: number;
  centroid?: number;
}
interface AudioFixture {
  ctx: OfflineAudioContext;
  rng: Rng;
  bank: NoiseBank;
  mixer: Mixer;
  samples: WeaponSampleBank;
  t: number;
}
interface AudioVoice {
  node: AudioNode;
  send?: number;
}
interface RenderOptions {
  reverb?: boolean;
  space?: Record<string, number>;
}

const SR = 48000;

function measure(buf: AudioBuffer): AudioMetrics {
  const n = buf.length;
  let peak = 0,
    sum = 0,
    sumSq = 0,
    nan = 0,
    crossings = 0;
  let prev = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v;
      sumSq += v * v;
      if (ch === 0) {
        if ((v > 0 && prev <= 0) || (v < 0 && prev >= 0)) crossings++;
        prev = v;
      }
    }
  }
  const total = n * buf.numberOfChannels;
  const rms = Math.sqrt(sumSq / total);
  // Zero crossing rate -> a crude but stable spectral centre indicator.
  const centroid = (crossings / (n / SR)) * 0.5;
  return {
    // Thresholds below must use measured values, not display rounding. In
    // particular 0.000024 rounds to the 0.00002 silence floor and falsely fails.
    peak,
    rms,
    dc: sum / total,
    nan,
    centroid: Math.round(centroid),
  };
}

/** One offline render: build a fresh mixer, run `fn`, measure the master out. */
async function renderCase(
  seconds: number,
  seed: number,
  fn: (fixture: AudioFixture) => void | Promise<void>,
  loadedSamples: WeaponSampleBank,
  opts: RenderOptions = {}
): Promise<AudioMetrics> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const rng = new Rng(seed);
  const bank = new NoiseBank(ctx, rng.fork(), 1.2);
  await Mixer.prepare(ctx);
  const mixer = new Mixer(ctx, rng.fork(), {});
  const samples = new WeaponSampleBank(ctx);
  // AudioBuffers may be shared across same-rate contexts, but selection state
  // and arrays belong to this render so disposing it cannot empty the cache.
  samples.hitBuffers = Object.fromEntries(
    Object.entries(loadedSamples.hitBuffers).map(([kind, buffers]) => [kind, buffers!.slice()])
  );
  samples.reloadBuffers = Object.fromEntries(
    Object.entries(loadedSamples.reloadBuffers).map(([kind, buffers]) => [kind, buffers!.slice()])
  );
  samples.heartbeatBuffer = loadedSamples.heartbeatBuffer;
  samples.aircraftBuffers = loadedSamples.aircraftBuffers.slice();
  try {
    if (opts.reverb !== false) mixer.buildReverbs();
    if (opts.space) mixer.setSpace(opts.space, 0.001);
    await fn({ ctx, rng, bank, mixer, samples, t: 0.02 });
    return measure(await ctx.startRendering());
  } finally {
    samples.dispose();
    mixer.dispose();
    bank.dispose();
  }
}

/** Connect a voice to a bus and its reverb send, the way the live system does. */
function route(mixer: Mixer, voice: AudioVoice, busName = 'weapons', sendScale = 1): AudioVoice {
  voice.node.connect(mixer.bus(busName));
  if ((voice.send ?? 0) > 0) {
    const g = mixer.actx.createGain();
    g.gain.value = voice.send! * sendScale;
    voice.node.connect(g);
    g.connect(mixer.sendBus(busName));
  }
  return voice;
}

export async function runAudioSelfTest(opts: { verbose?: boolean } = {}) {
  const samples = new WeaponSampleBank(new OfflineAudioContext(2, 1, SR));
  try {
    try {
      // Required recordings decode once for the run, never once per case.
      await samples.load();
    } catch (err) {
      const failure = {
        name: 'samples:load',
        error: err instanceof Error ? err.message : String(err),
      };
      return {
        ok: false,
        cases: 1,
        failures: [failure],
        results: opts.verbose === false ? undefined : [failure],
        spaces: {},
      };
    }
    return await runCases(samples, opts);
  } finally {
    samples.dispose();
  }
}

async function runCases(loadedSamples: WeaponSampleBank, opts: { verbose?: boolean }) {
  const results: SelfTestResult[] = [];
  const push = async (
    name: string,
    seconds: number,
    fn: (fixture: AudioFixture) => void | Promise<void>,
    o: RenderOptions = {}
  ): Promise<void> => {
    const t0 = performance.now();
    try {
      const m = await renderCase(seconds, 0xa0d10 + results.length * 7919, fn, loadedSamples, o);
      results.push({ name, ms: Math.round(performance.now() - t0), ...m });
    } catch (err) {
      results.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  };

  /* ---- impulse responses ---------------------------------------- */
  for (const key of Object.keys(IR_SPECS) as Array<keyof typeof IR_SPECS>) {
    const t0 = performance.now();
    try {
      const ctx = new OfflineAudioContext(2, SR * 0.05, SR);
      const buf = generateIR(ctx, new Rng(0x1234 + key.length), IR_SPECS[key]);
      const m = measure(buf);
      results.push({
        name: `ir:${key}`,
        ms: Math.round(performance.now() - t0),
        seconds: +buf.duration.toFixed(2),
        ...m,
      });
    } catch (err) {
      results.push({ name: `ir:${key}`, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /* ---- weapons, near and far ------------------------------------ */
  for (const key of Object.keys(WEAPON_PROFILES) as Array<keyof typeof WEAPON_PROFILES>) {
    await push(`shot:${key}@2m`, 3.5, ({ bank, rng, mixer, t }) => {
      route(
        mixer,
        weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES[key], {
          when: t,
          distance: 2,
          firstPerson: true,
        })
      );
    });
  }
  await push('shot:rifle:punch', 1.2, ({ bank, rng, mixer, t }) => {
    route(
      mixer,
      weaponPunch(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, {
        when: t,
        distance: 0,
        firstPerson: true,
      })
    );
  });
  await push('shot:suppressed:punch', 1.2, ({ bank, rng, mixer, t }) => {
    route(
      mixer,
      weaponPunch(mixer.actx, bank, rng, WEAPON_PROFILES.suppressed, {
        when: t,
        distance: 0,
        firstPerson: true,
      })
    );
  });
  await push('shot:rifle@120m', 4.5, ({ bank, rng, mixer, t }) => {
    route(
      mixer,
      weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, { when: t, distance: 120 })
    );
  });
  await push('shot:rifle@300m', 5.5, ({ bank, rng, mixer, t }) => {
    route(
      mixer,
      weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, { when: t, distance: 300 })
    );
  });

  /* round-robin variation: 8 rounds of automatic fire must not be identical */
  await push('auto:8rounds', 2.5, ({ bank, rng, mixer, t }) => {
    for (let i = 0; i < 8; i++) {
      route(
        mixer,
        weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, {
          when: t + i * 0.085,
          distance: 2,
          firstPerson: true,
        })
      );
    }
  });

  /* ---- foley ----------------------------------------------------- */
  const surfaces = [
    'concrete',
    'metal',
    'wood',
    'dirt',
    'sand',
    'glass',
    'water',
    'foliage',
    'fabric',
    'flesh',
    'rubber',
    'plaster',
  ] as const;
  for (const s of surfaces) {
    await push(`impact:${s}`, 2.2, ({ samples, rng, mixer, t }) => {
      const voice =
        s === 'flesh'
          ? samples.hit('flesh', rng, { when: t, level: 1 })
          : samples.impact(rng, { when: t, surface: s, level: 1 });
      route(mixer, voice, 'foley');
    });
    await push(`step:${s}`, 2.2, ({ samples, rng, mixer, t }) => {
      route(mixer, samples.step(rng, { when: t, surface: s, gait: 'run' }), 'foley');
    });
  }
  for (const gait of ['walk', 'run', 'sprint', 'crouch', 'land'] as const) {
    await push(`step:concrete:${gait}`, 2.2, ({ samples, rng, mixer, t }) => {
      route(mixer, samples.step(rng, { when: t, surface: 'concrete', gait }), 'foley');
    });
  }
  await push('shell:concrete', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, shellCasing(mixer.actx, bank, rng, { when: t, surface: 'concrete' }), 'foley');
  });
  await push('shell:dirt', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, shellCasing(mixer.actx, bank, rng, { when: t, surface: 'dirt' }), 'foley');
  });
  const reloadCases: Record<string, Partial<Record<ReloadPhase, ReloadKind>>> = {
    ...RELOAD_CUES,
    movement: { start: 'gear' },
  };
  const testedReloads = new Set<ReloadKind>();
  for (const [weapon, cues] of Object.entries(reloadCases)) {
    for (const phase of Object.keys(cues) as ReloadPhase[]) {
      const kind = reloadKind(weapon, phase)!;
      if (testedReloads.has(kind)) continue;
      testedReloads.add(kind);
      await push(`reload:${kind}`, 2.5, ({ samples, rng, mixer, t }) => {
        route(mixer, samples.reload(weapon, phase, rng, { when: t }), 'foley');
      });
    }
  }
  await push('explosion@5m', 6, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 5, radius: 8 }));
  });
  await push('explosion@180m', 7, ({ bank, rng, mixer, t }) => {
    route(mixer, explosion(mixer.actx, bank, rng, { when: t, distance: 180, radius: 12 }));
  });
  await push('bodyfall', 2, ({ samples, rng, mixer, t }) => {
    route(mixer, samples.fall(rng, { when: t }), 'foley');
  });
  await push('cloth', 1.5, ({ samples, rng, mixer, t }) => {
    route(mixer, samples.cloth(rng, { when: t }), 'foley');
  });
  await push('whizz', 1.2, ({ bank, rng, mixer, t }) => {
    route(mixer, bulletWhizz(mixer.actx, bank, rng, { when: t, miss: 1.2 }), 'foley');
  });
  await push('dryfire', 1, ({ bank, rng, mixer, t }) => {
    route(mixer, dryFire(mixer.actx, bank, rng, { when: t }), 'weapons');
  });
  await push('heartbeat', 1.5, ({ samples, mixer, t }) => {
    route(
      mixer,
      heartbeat(mixer.actx, { when: t, level: 0.74, buffer: samples.heartbeatBuffer! }),
      'ui'
    );
  });
  for (const k of ['hitmarker', 'headshot', 'kill', 'damage', 'lowhealth']) {
    await push(
      `ui:${k}`,
      1.5,
      ({ bank, samples, rng, mixer, t }) => {
        const voice =
          k === 'damage'
            ? samples.damage(rng, { when: t, amount: 25, armourAbsorbed: 0, plateBreak: false })
            : uiSound(mixer.actx, bank, rng, k, { when: t });
        route(mixer, voice, 'ui');
      },
      { reverb: false }
    );
  }

  /* ---- voice ----------------------------------------------------- */
  for (const voice of [0, 1]) {
    for (const kind of ['hurt', 'death'] as const) {
      await push(`reaction:${voice}:${kind}`, 2, ({ samples, rng, mixer, t }) => {
        route(mixer, samples.reaction(kind, voice, rng, { when: t }), 'voice');
      });
    }
  }
  for (const key of Object.keys(BARKS)) {
    await push(`bark:${key}`, 3, ({ bank, rng, mixer, t }) => {
      route(mixer, bark(mixer.actx, bank, rng, { when: t, bark: key }), 'voice');
    });
  }
  await push('bark:radio', 3, ({ bank, rng, mixer, t }) => {
    route(mixer, bark(mixer.actx, bank, rng, { when: t, bark: 'contact', radio: true }), 'voice');
  });

  /* ---- ambient one-shots ---------------------------------------- */
  for (const k of ONE_SHOTS) {
    await push(`ambient:${k}`, 14, ({ bank, rng, mixer, t }) => {
      route(mixer, ambientOneShot(mixer.actx, bank, rng, k, { when: t }), 'ambience');
    });
  }

  /* ---- reverb space comparison ---------------------------------- */
  for (const space of ['tight', 'street', 'open', 'tunnel']) {
    const w: Record<string, number> = { tight: 0, room: 0, street: 0, tunnel: 0, open: 0 };
    w[space] = 1;
    await push(
      `tail:${space}`,
      5,
      ({ bank, rng, mixer, t }) => {
        route(
          mixer,
          weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.rifle, {
            when: t,
            distance: 2,
            firstPerson: true,
            echoBoost: 2,
          }),
          'weapons',
          1.4
        );
      },
      { space: w }
    );
  }

  /* ---- limiter stress: everything at once ----------------------- */
  await push('stress:limiter', 4, ({ bank, rng, mixer, t }) => {
    for (let i = 0; i < 14; i++) {
      route(
        mixer,
        weaponShot(mixer.actx, bank, rng, WEAPON_PROFILES.sniper, {
          when: t + i * 0.004,
          distance: 1,
          firstPerson: true,
        })
      );
    }
    for (let i = 0; i < 6; i++) {
      route(
        mixer,
        explosion(mixer.actx, bank, rng, { when: t + i * 0.01, distance: 1, radius: 14 })
      );
    }
  });

  // Append new recorded states so existing isolated synthesis cases keep seeds.
  for (const [name, amount, armourAbsorbed, plateBreak] of [
    ['armour-only', 0, 25, false],
    ['mixed', 15, 15, false],
    ['break-mixed', 15, 15, true],
    ['break-armour-only', 0, 25, true],
  ] as const) {
    await push(
      `damage:${name}`,
      1.5,
      ({ samples, rng, mixer, t }) => {
        route(mixer, samples.damage(rng, { when: t, amount, armourAbsorbed, plateBreak }), 'ui');
      },
      { reverb: false }
    );
  }

  // Finite source audition; tracked movement/loop shutdown is covered by the
  // native bomber integration test rather than leaving an infinite test source.
  await push('aircraft:source', 5, ({ ctx, samples, rng, mixer, t }) => {
    const source = ctx.createBufferSource();
    source.buffer = samples.nextAircraft(rng);
    source.start(t);
    route(mixer, { node: source, send: AIRCRAFT_MIX.send }, 'ambience');
  });

  /* ---- space classifier (pure function, no audio) ---------------- */
  const spaces: Record<string, ReturnType<typeof classifySpace>> = {};
  const box = new Array(9).fill(3.5);
  box[8] = 2.6;
  spaces.smallRoom = classifySpace(box, 40);
  const street = [4, 30, 40, 30, 4, 30, 40, 30, 40];
  spaces.street = classifySpace(street, 40);
  const field = new Array(9).fill(40);
  spaces.open = classifySpace(field, 40);
  const corridor = [1.8, 12, 38, 12, 1.8, 12, 38, 12, 2.4];
  spaces.corridor = classifySpace(corridor, 40);

  const failures = results.filter(
    (r) =>
      r.error ||
      (r.nan ?? 0) > 0 ||
      (r.peak ?? 0) >= 1.0 ||
      (r.rms ?? 0) <= 0.00002 ||
      Math.abs(r.dc ?? 0) > 0.02
  );

  return {
    ok: failures.length === 0,
    cases: results.length,
    failures,
    results: opts.verbose === false ? undefined : results,
    spaces,
  };
}

if (typeof window !== 'undefined')
  (window as Window & { __AUDIO_SELFTEST__?: typeof runAudioSelfTest }).__AUDIO_SELFTEST__ =
    runAudioSelfTest;
