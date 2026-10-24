/**
 * AUDIO / PROCEDURAL FOLEY
 *
 * Remaining weapon mechanics, explosion reinforcement, heartbeat and intentional
 * UI cues. Physical contacts, boots, body falls and cloth use required recordings
 * through WeaponSampleBank; do not add synthesized recovery for missing assets.
 */

import type { Rng } from '../core/rng.ts';
import {
  ad,
  biquad,
  clamp,
  gain,
  hit,
  lerp,
  osc,
  saturationCurve,
  semis,
  series,
  shaper,
  struckResonator,
  sweep,
} from './dsp.ts';
import type { NoiseBank } from './dsp.ts';
import type { AudioVoice } from './types.ts';
interface VoiceOptions {
  when?: number;
  level?: number;
}
interface ShellOptions extends VoiceOptions {
  flight?: number;
  surface?: string;
}
interface ReloadOptions {
  when?: number;
  heavy?: number;
  retained?: boolean;
  settleOnly?: boolean;
}
interface ExplosionOptions extends VoiceOptions {
  distance?: number;
  radius?: number;
}
type UiOptions = VoiceOptions;
interface HeartbeatOptions extends VoiceOptions {
  buffer: AudioBuffer;
}
interface ResonatorPart {
  f: number;
  q: number;
  g: number;
  decay: number;
}

/* ------------------------------------------------------------------ */
/* Shell casings                                                      */
/* ------------------------------------------------------------------ */

/**
 * A casing bounces 2–4 times with shortening intervals and then rolls. Brass on
 * concrete is one of the most recognisable sounds in a shooter; the trick is
 * that each bounce is a *different* set of partials because the shell lands on a
 * different part of itself.
 */
export function shellCasing(
  actx: BaseAudioContext,
  bank: NoiseBank,
  rng: Rng,
  o: ShellOptions = {}
): AudioVoice {
  const t0 = (o.when ?? actx.currentTime) + (o.flight ?? rng.range(0.28, 0.52));
  const surface = o.surface ?? 'concrete';
  const hard =
    surface === 'metal' || surface === 'concrete' || surface === 'glass' || surface === 'plaster';
  const soft =
    surface === 'dirt' || surface === 'sand' || surface === 'foliage' || surface === 'fabric';
  const out = gain(actx, 1);
  const base = rng.range(2650, 4200);
  let t = t0;
  let amp = (o.level ?? 1) * (soft ? 0.35 : 1) * rng.range(0.8, 1.1);
  const bounces = soft ? 1 : 2 + ((rng.u32() % 3) | 0);
  let end = t0;
  for (let i = 0; i < bounces; i++) {
    const detune = semis(rng.range(-4, 4));
    struckResonator(
      actx,
      bank,
      rng,
      t,
      [
        {
          f: base * detune,
          q: rng.range(30, 60),
          g: 0.95 * amp,
          decay: rng.range(0.05, 0.13) * (hard ? 1 : 0.5),
        },
        {
          f: base * detune * 1.87,
          q: rng.range(24, 44),
          g: 0.58 * amp,
          decay: rng.range(0.03, 0.08),
        },
        {
          f: base * detune * 3.1,
          q: rng.range(16, 30),
          g: 0.3 * amp,
          decay: rng.range(0.015, 0.04),
        },
        { f: base * detune * 0.42, q: 12, g: 0.2 * amp, decay: 0.03 },
      ],
      0.0015
    ).connect(out);
    end = t + 0.2;
    t += rng.range(0.045, 0.13) * (i === 0 ? 1 : 0.6);
    amp *= rng.range(0.38, 0.62);
    if (amp < 0.03) break;
  }
  // Roll: a stream of very quiet, very short pings.
  if (hard && rng.float() < 0.55) {
    const rolls = 3 + ((rng.u32() % 5) | 0);
    for (let i = 0; i < rolls; i++) {
      const rt = t + i * rng.range(0.018, 0.05);
      struckResonator(
        actx,
        bank,
        rng,
        rt,
        [
          {
            f: base * semis(rng.range(-5, 5)),
            q: rng.range(20, 44),
            g: rng.range(0.03, 0.09) * (o.level ?? 1),
            decay: rng.range(0.01, 0.03),
          },
        ],
        0.0012
      ).connect(out);
      end = Math.max(end, rt + 0.06);
    }
  }
  return { node: out, end: end + 0.05, send: 0.42 };
}

/* ------------------------------------------------------------------ */
/* Reload foley                                                       */
/* ------------------------------------------------------------------ */

/**
 * Reload mechanics, one call per `weapon:reload` phase. Keeping the phases as
 * separate one-shots (instead of one long sound) is what lets the audio stay
 * locked to the animation whatever its length.
 */
/** The four phases are wildly different in energy; level them per phase. */
const RELOAD_TRIM = {
  start: 3.2,
  magout: 3.0,
  magin: 0.7,
  slide: 1.5,
  end: 1.5,
  pump: 2.2,
  shellin: 1.4,
} as const;
type ReloadPhase = keyof typeof RELOAD_TRIM;

export function reloadPhase(
  actx: BaseAudioContext,
  bank: NoiseBank,
  rng: Rng,
  phase: ReloadPhase | undefined,
  o: ReloadOptions = {}
): AudioVoice {
  const t0 = o.when ?? actx.currentTime;
  const heavy = o.heavy ?? 1; // LMG/shotgun = heavier hardware
  const out = gain(actx, 0.42 * (phase === undefined ? 1.5 : (RELOAD_TRIM[phase] ?? 1.5))); // VOICE TRIM
  let end = t0 + 0.3;
  const metal = (t: number, parts: ResonatorPart[], exc = 0.0025): void => {
    struckResonator(actx, bank, rng, t, parts, exc).connect(out);
    end = Math.max(end, t + 0.35);
  };
  const rustle = (t: number, dur: number, level: number, f: number): void => {
    const src = bank.source('white', rng, rng.range(0.8, 1.2));
    const bp = biquad(actx, 'bandpass', f, 0.6);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    ad(g.gain, t, level, 0.02, dur);
    src.start(t, src._offset, dur * 2 + 0.05);
    end = Math.max(end, t + dur * 2);
  };

  switch (phase) {
    case 'shellin':
      // Hull seats in the tube: brass rim clicks the elevator, polymer scrapes in.
      rustle(t0, 0.07, 0.16, rng.range(1800, 2800));
      metal(t0 + 0.02, [
        { f: 2100 * semis(rng.range(-2, 2)), q: 22, g: 0.28 * heavy, decay: 0.03 },
        { f: 740, q: 8, g: 0.18 * heavy, decay: 0.04 },
      ]);
      break;

    case 'start':
      // Hand leaves the grip, palm slaps the magwell, mag catch is pressed.
      rustle(t0, 0.18, 0.2, rng.range(1400, 2200));
      metal(t0 + rng.range(0.04, 0.08), [
        { f: 2450 * semis(rng.range(-2, 2)), q: 30, g: 0.55 * heavy, decay: 0.03 },
        { f: 5100, q: 18, g: 0.25, decay: 0.016 },
        { f: 780, q: 10, g: 0.3 * heavy, decay: 0.045 },
      ]);
      break;

    case 'magout': {
      // Spring release, mag scrapes out of the well, then plastic hits the deck.
      metal(t0, [
        { f: 1650 * semis(rng.range(-2, 2)), q: 24, g: 0.65 * heavy, decay: 0.05 },
        { f: 3400, q: 16, g: 0.35, decay: 0.025 },
      ]);
      const st = t0 + 0.03;
      const src = bank.source('white', rng, rng.range(0.9, 1.3));
      const bp = biquad(actx, 'bandpass', 3200, 1.1);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, st, 4200, 1600, 0.12);
      ad(g.gain, st, 0.2, 0.01, 0.12);
      src.start(st, src._offset, 0.3);
      // A retained tactical magazine must not make a ground-impact sound.
      if (!o.retained) {
        const dt = t0 + rng.range(0.16, 0.3);
        metal(
          dt,
          [
            { f: 480 * semis(rng.range(-3, 3)), q: 9, g: 0.2, decay: 0.05 },
            { f: 1180, q: 7, g: 0.11, decay: 0.03 },
            { f: 2600, q: 5, g: 0.05, decay: 0.015 },
          ],
          0.004
        );
        end = Math.max(end, dt + 0.3);
      }
      break;
    }

    case 'magin': {
      // Fresh mag guided in, seated with a palm strike: a low thunk plus a sharp
      // latch click. The thunk needs real low end or it feels weightless.
      rustle(t0, 0.12, 0.16, rng.range(1200, 2000));
      const it = t0 + rng.range(0.05, 0.1);
      const b = osc(actx, 'sine', 190 * heavy);
      const bg = gain(actx, 0);
      const drv = shaper(actx, saturationCurve(3, 0.5), '2x');
      b.connect(bg);
      series(bg, drv).connect(out);
      sweep(b.frequency, it, 230 * heavy, 110 * heavy, 0.06);
      ad(bg.gain, it, 0.4 * heavy, 0.002, 0.055);
      b.start(it);
      b.stop(it + 0.16);
      metal(
        it,
        [
          { f: 1250 * semis(rng.range(-2, 2)), q: 20, g: 0.3 * heavy, decay: 0.06 },
          { f: 2800, q: 26, g: 0.18, decay: 0.03 },
          { f: 6200, q: 14, g: 0.07, decay: 0.012 },
        ],
        0.003
      );
      metal(
        it + rng.range(0.02, 0.05),
        [
          { f: 3600, q: 34, g: 0.16, decay: 0.02 },
          { f: 7400, q: 20, g: 0.07, decay: 0.01 },
        ],
        0.0015
      );
      break;
    }

    case 'pump': {
      // Forend rack: wood/polymer scrape, the bars slam home, hull ejects.
      rustle(t0, 0.08, 0.28 * heavy, rng.range(900, 1500));
      metal(
        t0 + 0.02,
        [
          { f: 620 * semis(rng.range(-2, 2)), q: 14, g: 0.55 * heavy, decay: 0.07 },
          { f: 1480, q: 18, g: 0.32 * heavy, decay: 0.04 },
          { f: 2800, q: 10, g: 0.14, decay: 0.02 },
        ],
        0.0035
      );
      rustle(t0 + 0.07, 0.09, 0.18, rng.range(1600, 2400));
      metal(
        t0 + 0.16,
        [
          { f: 980 * semis(rng.range(-2, 2)), q: 20, g: 0.48 * heavy, decay: 0.06 },
          { f: 2100, q: 16, g: 0.22, decay: 0.03 },
          { f: 4200, q: 12, g: 0.1, decay: 0.016 },
        ],
        0.003
      );
      break;
    }

    case 'slide':
      // Reuse the existing steel resonators at the authored slide-catch beat,
      // without a fictitious rearward rack or a second clack at reload end.
      metal(t0, [
        { f: 1450 * semis(rng.range(-2, 2)), q: 22, g: 0.3 * heavy, decay: 0.05 },
        { f: 3100, q: 18, g: 0.16, decay: 0.022 },
      ]);
      metal(t0 + 0.008, [{ f: 4900, q: 46, g: 0.09, decay: 0.16 }], 0.002);
      break;
    case 'end':
    default: {
      if (o.settleOnly) {
        rustle(t0, 0.08, 0.08, 1400);
        break;
      }
      // Charging handle: scrape, hard rearward stop, spring-driven return, and
      // the bolt slamming into battery.
      const st = t0;
      const src = bank.source('white', rng, rng.range(0.9, 1.25));
      const bp = biquad(actx, 'bandpass', 2600, 1.6);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, st, 1800, 4200, 0.07);
      ad(g.gain, st, 0.24, 0.008, 0.07);
      src.start(st, src._offset, 0.2);
      metal(st + 0.06, [
        { f: 1450 * semis(rng.range(-2, 2)), q: 22, g: 0.3 * heavy, decay: 0.05 },
        { f: 3100, q: 18, g: 0.16, decay: 0.022 },
      ]);
      // Spring ring — the metallic "zing" behind the clack.
      metal(
        st + 0.065,
        [
          { f: 4900 * semis(rng.range(-3, 3)), q: 46, g: 0.09, decay: 0.16 },
          { f: 7200, q: 38, g: 0.05, decay: 0.1 },
        ],
        0.002
      );
      const bt = st + rng.range(0.1, 0.15);
      const b = osc(actx, 'sine', 150 * heavy);
      const bg = gain(actx, 0);
      b.connect(bg);
      bg.connect(out);
      sweep(b.frequency, bt, 200 * heavy, 90 * heavy, 0.05);
      ad(bg.gain, bt, 0.38 * heavy, 0.0015, 0.05);
      b.start(bt);
      b.stop(bt + 0.14);
      metal(
        bt,
        [
          { f: 1750, q: 20, g: 0.34 * heavy, decay: 0.05 },
          { f: 3900, q: 15, g: 0.15, decay: 0.02 },
          { f: 8200, q: 10, g: 0.05, decay: 0.008 },
        ],
        0.0035
      );
      break;
    }
  }
  return { node: out, end: end + 0.05, send: 0.3 };
}

/* ------------------------------------------------------------------ */
/* Explosions                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {object} o { when, distance, radius, level }
 * Near: a violent transient, a huge sub sweep and a bright shrapnel spatter.
 * Far: almost no transient, a long rolling low rumble, and a big wet tail.
 */
export function explosion(
  actx: BaseAudioContext,
  bank: NoiseBank,
  rng: Rng,
  o: ExplosionOptions = {}
): AudioVoice {
  const t0 = o.when ?? actx.currentTime;
  const dist = Math.max(0, o.distance ?? 0);
  const size = clamp((o.radius ?? 6) / 6, 0.5, 2.4);
  const near = clamp(1 - dist / 70, 0, 1);
  const far = 1 - near;
  const lvl = (o.level ?? 1) * size;
  const tailDur = 3.4 + size * 0.5;
  const out = gain(actx, 1.15); // explosions must retain authority after distance loss

  /* detonation transient */
  if (near > 0.05) {
    const src = bank.source('white', rng, rng.range(0.9, 1.2));
    const hp = biquad(actx, 'highpass', 900, 0.6);
    const drv = shaper(actx, saturationCurve(6, 0.45), '4x');
    const top = biquad(actx, 'lowpass', 17000, 0.7);
    const g = gain(actx, 0);
    series(src, hp, drv, top, g).connect(out);
    hit(g.gain, t0, 3.5 * near * lvl, 0.045);
    src.start(t0, src._offset, 0.15);
  }

  /* sub-bass impact: the thing you feel in your chest */
  {
    const s = osc(actx, 'sine', 110);
    const s2 = osc(actx, 'triangle', 62);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2.5, 0.4), '2x');
    const lp = biquad(actx, 'lowpass', 220, 0.9);
    s.connect(g);
    s2.connect(g);
    series(g, drv, lp).connect(out);
    const subDur = (0.55 + size * 0.35) * rng.range(0.9, 1.15);
    sweep(s.frequency, t0, 130 * size, 26, subDur);
    sweep(s2.frequency, t0, 74 * size, 21, subDur * 1.2);
    ad(g.gain, t0, 0.52 * lvl * (0.55 + near * 0.6), 0.008 + far * 0.05, subDur);
    s.start(t0);
    s2.start(t0);
    s.stop(t0 + subDur * 1.6);
    s2.stop(t0 + subDur * 1.6);
  }

  /* short deep thump: a 48 Hz swell that mimics blast overpressure — the
   * band the recorded take is thin in. Deliberately brief: a sustained sine
   * here reads as an electronic drone instead of an explosion. */
  {
    const s = osc(actx, 'sine', 48);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2, 0.4), '2x');
    const lp = biquad(actx, 'lowpass', 90, 0.9);
    s.connect(g);
    series(g, drv, lp).connect(out);
    const d2 = 0.5 * (0.7 + size * 0.25) * rng.range(0.9, 1.1);
    sweep(s.frequency, t0, 52 * size, 30, d2);
    ad(g.gain, t0, 0.18 * lvl * (0.35 + near * 0.65), 0.02 + far * 0.08, d2);
    s.start(t0);
    s.stop(t0 + d2 * 1.5);
  }

  /* blast body: broadband noise under a fast-falling lowpass */
  {
    const dur = (0.45 + size * 0.5) * (1 + far * 1.8);
    const src = bank.source('white', rng, rng.range(0.6, 1.1), true);
    const lp = biquad(actx, 'lowpass', 6000, 0.8);
    const drv = shaper(actx, saturationCurve(3.5, 0.35), '2x');
    const g = gain(actx, 0);
    series(src, lp, drv, g).connect(out);
    sweep(lp.frequency, t0, lerp(7000, 700, far), lerp(260, 130, far), dur);
    ad(g.gain, t0, 1.05 * lvl, 0.01 + far * 0.06, dur);
    src.start(t0, src._offset, dur * 1.4 + 0.1);
  }

  /* ground bounce: the blast reflects off the ground ~90 ms later — a real
   * ground-level explosion has this second, darker arrival. Kept dark and
   * below the fusion threshold; any louder and it reads as a double-hit. */
  if (near > 0.1) {
    const gb = t0 + 0.085 + size * 0.015;
    const s = osc(actx, 'sine', 95);
    const g = gain(actx, 0);
    const drv = shaper(actx, saturationCurve(2, 0.4), '2x');
    const lp = biquad(actx, 'lowpass', 160, 0.9);
    s.connect(g);
    series(g, drv, lp).connect(out);
    sweep(s.frequency, gb, 95 * size, 34, 0.5);
    ad(g.gain, gb, 0.3 * lvl * near, 0.012, 0.42);
    s.start(gb);
    s.stop(gb + 0.8);
    const src = bank.source('white', rng, rng.range(0.7, 1.0));
    const lp2 = biquad(actx, 'lowpass', 550, 0.8);
    const g2 = gain(actx, 0);
    series(src, lp2, g2).connect(out);
    ad(g2.gain, gb + 0.01, 0.34 * lvl * near, 0.006, 0.32);
    src.start(gb + 0.01, src._offset, 0.6);
  }

  /* mid power band: the 250–900 Hz slice that reads as *force* on speakers.
   * Fades fast with distance so far booms stay rumbly instead of mid-heavy. */
  {
    const dur = 0.42 + size * 0.15;
    const src = bank.source('white', rng, rng.range(0.8, 1.1));
    const bp = biquad(actx, 'bandpass', 520, 1.0);
    const drv = shaper(actx, saturationCurve(2, 0.35), '2x');
    const g = gain(actx, 0);
    series(src, bp, drv, g).connect(out);
    ad(g.gain, t0, lvl * (0.12 + near * 0.88), 0.003 + far * 0.03, dur);
    src.start(t0, src._offset, dur * 1.3);
  }

  /* debris / shrapnel: grains scattered over the following second */
  const grains = Math.round(lerp(35, 4, far) * size);
  for (let i = 0; i < grains; i++) {
    const gt = t0 + rng.range(0.02, 0.9) * rng.range(0.3, 1);
    struckResonator(
      actx,
      bank,
      rng,
      gt,
      [
        {
          f: rng.range(700, 7000),
          q: rng.range(8, 32),
          g: rng.range(0.02, 0.09) * near * lvl,
          decay: rng.range(0.01, 0.09),
        },
      ],
      0.002
    ).connect(out);
  }

  /* heavy chunks: slabs and panels hitting the ground — the texture that makes
   * a blast sound like it moved mass, not just air. */
  for (let i = 0; i < 3; i++) {
    const gt = t0 + 0.1 + rng.range(0, 0.55);
    struckResonator(
      actx,
      bank,
      rng,
      gt,
      [
        {
          f: rng.range(70, 220),
          q: rng.range(5, 12),
          g: rng.range(0.14, 0.26) * near * lvl,
          decay: rng.range(0.12, 0.3),
        },
      ],
      0.004
    ).connect(out);
  }

  /* Late settling debris keeps some detail above the low rumble. */
  for (let i = 0; i < 5; i++) {
    const gt = t0 + 1 + rng.range(0, 2);
    const f = rng.range(900, 5200);
    const q = rng.range(14, 34);
    const dur = rng.range(0.06, 0.16);
    const src = bank.source('white', rng, 1);
    const bp = biquad(actx, 'bandpass', f, q);
    const g = gain(actx, 0);
    series(src, bp, g).connect(out);
    sweep(bp.frequency, gt, f * 1.12, f * 0.85, dur);
    ad(g.gain, gt, rng.range(0.087, 0.19) * near * lvl, 0.002, dur);
    src.start(gt, src._offset, 0.05);
  }

  /* Broadband settling tail, swept darker as it decays. */
  {
    const dur = 3.2 + size * 0.8;
    const src = bank.source('pink', rng, rng.range(0.5, 0.9), true);
    const lp = biquad(actx, 'lowpass', 1400, 0.7);
    const g = gain(actx, 0);
    series(src, lp, g).connect(out);
    sweep(lp.frequency, t0, 3500, 600, dur);
    ad(g.gain, t0 + 0.05, 1.45 * lvl * (0.4 + near * 0.6), 0.12, dur);
    src.start(t0 + 0.05, src._offset, dur * 1.3);
  }

  /* Long pink-noise swell keeps the tail alive without sounding tonal. */
  {
    const src = bank.source('pink', rng, rng.range(0.4, 0.8), true);
    const hp = biquad(actx, 'highpass', 18, 0.7);
    const lp = biquad(actx, 'lowpass', 220, 0.5);
    const g = gain(actx, 0);
    series(src, hp, lp, g).connect(out);
    ad(g.gain, t0 + 0.35, 2.6 * lvl * (0.4 + near * 0.6), 0.3, tailDur);
    src.start(t0 + 0.35, src._offset, tailDur * 1.4);
  }

  return { node: out, end: t0 + 0.45 + tailDur * 1.4, send: 0.85 + far * 0.5 };
}

/* ------------------------------------------------------------------ */
/* UI                                                                 */
/* ------------------------------------------------------------------ */

/** Non-diegetic feedback. Short, dry, and deliberately synthetic. */
export function uiSound(
  actx: BaseAudioContext,
  bank: NoiseBank,
  rng: Rng,
  kind: string,
  o: UiOptions = {}
): AudioVoice {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 1);
  const lvl = o.level ?? 1;
  switch (kind) {
    case 'hitmarker': {
      const o1 = osc(actx, 'square', 2400);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 5200, 0.7);
      o1.connect(g);
      series(g, lp).connect(out);
      hit(g.gain, t0, 0.55 * lvl, 0.022);
      o1.start(t0);
      o1.stop(t0 + 0.06);
      break;
    }
    case 'headshot': {
      const o1 = osc(actx, 'square', 3200);
      const o2 = osc(actx, 'square', 4800);
      const g = gain(actx, 0);
      o1.connect(g);
      o2.connect(g);
      g.connect(out);
      hit(g.gain, t0, 0.34 * lvl, 0.05);
      o1.start(t0);
      o2.start(t0 + 0.03);
      o1.stop(t0 + 0.12);
      o2.stop(t0 + 0.14);
      break;
    }
    case 'kill': {
      for (let i = 0; i < 3; i++) {
        const o1 = osc(actx, 'triangle', 900 * Math.pow(1.5, i));
        const g = gain(actx, 0);
        o1.connect(g);
        g.connect(out);
        ad(g.gain, t0 + i * 0.055, 0.3 * lvl, 0.004, 0.09);
        o1.start(t0 + i * 0.055);
        o1.stop(t0 + i * 0.055 + 0.2);
      }
      break;
    }
    case 'armour': {
      // Ceramic plate strike: brighter and harder than a flesh hitmarker.
      const r = struckResonator(
        actx,
        bank,
        rng,
        t0,
        [
          { f: 3900, q: 30, g: 0.09 * lvl, decay: 0.045 },
          { f: 6400, q: 22, g: 0.05 * lvl, decay: 0.025 },
        ],
        0.0015
      );
      r.connect(out);
      break;
    }
    case 'market_buy': {
      // Shop tick: two-tone blip plus a wood drawer thunk.
      const tick = (t: number, f: number, g0: number, decay: number): void => {
        const o = osc(actx, 'square', f);
        const gg = gain(actx, 0);
        const lp = biquad(actx, 'lowpass', 4200, 0.8);
        o.connect(gg);
        series(gg, lp).connect(out);
        ad(gg.gain, t, g0 * lvl, 0.003, decay);
        o.start(t);
        o.stop(t + decay + 0.05);
      };
      tick(t0, 620, 0.3, 0.05);
      tick(t0 + 0.08, 930, 0.22, 0.07);
      const thump = osc(actx, 'sine', 140);
      const tg = gain(actx, 0);
      thump.connect(tg);
      tg.connect(out);
      ad(tg.gain, t0, 0.22 * lvl, 0.004, 0.07);
      thump.start(t0);
      thump.stop(t0 + 0.14);
      break;
    }
    case 'market_open': {
      // Radio click, then a short fifth — the tent set coming on.
      const src = bank.source('white', rng, 0.9);
      const bp = biquad(actx, 'bandpass', 1800, 0.85);
      const g = gain(actx, 0);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.42 * lvl, 0.005, 0.14);
      src.start(t0, src._offset, 0.35);
      const fifth = (t: number, f: number, g0: number): void => {
        const o = osc(actx, 'triangle', f);
        const og = gain(actx, 0);
        const lp = biquad(actx, 'lowpass', 2400, 0.8);
        o.connect(og);
        og.connect(lp);
        lp.connect(out);
        ad(og.gain, t, g0 * lvl, 0.006, 0.18);
        o.start(t);
        o.stop(t + 0.32);
      };
      fifth(t0 + 0.1, 294, 0.16);
      fifth(t0 + 0.2, 440, 0.12);
      break;
    }
    case 'market_close': {
      // Squelch: noise burst plus a falling tone as the set cuts out.
      const src = bank.source('white', rng, 1.05);
      const bp = biquad(actx, 'bandpass', 1600, 0.8);
      const g = gain(actx, 0);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.38 * lvl, 0.004, 0.12);
      src.start(t0, src._offset, 0.3);
      const o = osc(actx, 'square', 520);
      const og = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 1800, 0.7);
      o.connect(og);
      og.connect(lp);
      lp.connect(out);
      sweep(o.frequency, t0, 520, 160, 0.18);
      ad(og.gain, t0, 0.14 * lvl, 0.004, 0.16);
      o.start(t0);
      o.stop(t0 + 0.28);
      break;
    }
    case 'market_hover': {
      const o = osc(actx, 'square', 1760);
      const gg = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 3600, 0.8);
      o.connect(gg);
      series(gg, lp).connect(out);
      ad(gg.gain, t0, 0.12 * lvl, 0.002, 0.03);
      o.start(t0);
      o.stop(t0 + 0.06);
      break;
    }
    case 'market_deny': {
      const o1 = osc(actx, 'sawtooth', 138);
      const lp = biquad(actx, 'lowpass', 640, 1.1);
      const g = gain(actx, 0);
      o1.connect(lp);
      lp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.32 * lvl, 0.005, 0.12);
      o1.start(t0);
      o1.stop(t0 + 0.24);
      const o2 = osc(actx, 'sawtooth', 104);
      const g2 = gain(actx, 0);
      o2.connect(g2);
      g2.connect(out);
      ad(g2.gain, t0 + 0.1, 0.22 * lvl, 0.005, 0.12);
      o2.start(t0 + 0.1);
      o2.stop(t0 + 0.32);
      break;
    }
    case 'grenade_warn': {
      // Three rising beeps — reads as "danger", not as a notification.
      for (let i = 0; i < 3; i++) {
        const bt = t0 + i * 0.14;
        const o1 = osc(actx, 'square', 1150 * Math.pow(1.19, i));
        const lp = biquad(actx, 'lowpass', 4200, 0.8);
        const g = gain(actx, 0);
        o1.connect(g);
        series(g, lp).connect(out);
        ad(g.gain, bt, 0.3 * lvl, 0.004, 0.07);
        o1.start(bt);
        o1.stop(bt + 0.16);
      }
      break;
    }
    case 'grenade_pin': {
      // Pin pull: a tight metallic double-click — pin, then the spoon spring.
      const click = (t: number, f: number, g0: number, decay: number): void => {
        const o = osc(actx, 'square', f);
        const gg = gain(actx, 0);
        o.connect(gg);
        gg.connect(out);
        ad(gg.gain, t, g0 * lvl, 0.002, decay);
        o.start(t);
        o.stop(t + decay + 0.05);
      };
      click(t0, 3400, 0.5, 0.03);
      click(t0 + 0.07, 2200, 0.3, 0.035);
      break;
    }
    case 'grenade_tick': {
      // Cook warning: one short beep, reads as "almost done".
      const o1 = osc(actx, 'square', 2200);
      const lp = biquad(actx, 'lowpass', 5200, 0.7);
      const g = gain(actx, 0);
      o1.connect(lp);
      lp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.4 * lvl, 0.003, 0.05);
      o1.start(t0);
      o1.stop(t0 + 0.09);
      break;
    }
    case 'grenade_throw': {
      // Arm whip: a short bandpassed noise swell.
      const src = bank.source('white', rng, 1.0);
      const bp = biquad(actx, 'bandpass', 900, 0.8);
      const g = gain(actx, 0);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.5 * lvl, 0.01, 0.14);
      src.start(t0, src._offset, 0.3);
      break;
    }
    case 'radio_open': {
      const src = bank.source('white', rng, 0.9);
      const bp = biquad(actx, 'bandpass', 1900, 0.9);
      const g = gain(actx, 0);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.5 * lvl, 0.006, 0.16);
      src.start(t0, src._offset, 0.4);
      const o = osc(actx, 'square', 880);
      const og = gain(actx, 0);
      o.connect(og);
      og.connect(out);
      ad(og.gain, t0 + 0.11, 0.14 * lvl, 0.004, 0.06);
      o.start(t0 + 0.11);
      o.stop(t0 + 0.28);
      break;
    }
    case 'radio_denied': {
      const o1 = osc(actx, 'sawtooth', 150);
      const lp = biquad(actx, 'lowpass', 700, 1.2);
      const g = gain(actx, 0);
      o1.connect(lp);
      lp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.4 * lvl, 0.006, 0.16);
      o1.start(t0);
      o1.stop(t0 + 0.32);
      const o2 = osc(actx, 'sawtooth', 112);
      const g2 = gain(actx, 0);
      o2.connect(g2);
      g2.connect(out);
      ad(g2.gain, t0 + 0.14, 0.3 * lvl, 0.006, 0.14);
      o2.start(t0 + 0.14);
      o2.stop(t0 + 0.42);
      break;
    }
    case 'radio_strike': {
      const src = bank.source('white', rng, 0.9);
      const bp = biquad(actx, 'bandpass', 1500, 0.7);
      const g = gain(actx, 0);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.34 * lvl, 0.005, 0.2);
      src.start(t0, src._offset, 0.4);
      for (let i = 0; i < 2; i++) {
        const bt = t0 + 0.16 + i * 0.13;
        const o = osc(actx, 'square', 660 * Math.pow(1.35, i));
        const og = gain(actx, 0);
        o.connect(og);
        og.connect(out);
        ad(og.gain, bt, 0.26 * lvl, 0.004, 0.09);
        o.start(bt);
        o.stop(bt + 0.2);
      }
      break;
    }
    case 'bandage': {
      // Soft filtered swell when a bandage completes. Deliberately unpitched.
      const src = bank.source('pink', rng, 0.9);
      const bp = biquad(actx, 'bandpass', 700, 1.1);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, t0, 500, 1900, 0.5);
      ad(g.gain, t0, 0.3 * lvl, 0.15, 0.45);
      src.start(t0, src._offset, 0.9);
      const o1 = osc(actx, 'sine', 420);
      const og = gain(actx, 0);
      o1.connect(og);
      og.connect(out);
      sweep(o1.frequency, t0, 380, 640, 0.45);
      ad(og.gain, t0, 0.12 * lvl, 0.14, 0.4);
      o1.start(t0);
      o1.stop(t0 + 0.8);
      break;
    }
    case 'intel_beep': {
      // Short detector ping. One spatial voice, not a doubled UI alarm.
      const o1 = osc(actx, 'square', 740);
      const o2 = osc(actx, 'square', 1480);
      const lp = biquad(actx, 'lowpass', 2800, 0.7);
      const g = gain(actx, 0);
      o1.connect(g);
      o2.connect(g);
      series(g, lp).connect(out);
      ad(g.gain, t0, 0.24 * lvl, 0.004, 0.08);
      o1.start(t0);
      o2.start(t0);
      o1.stop(t0 + 0.16);
      o2.stop(t0 + 0.16);
      break;
    }
    case 'intel_call': {
      // Round callout: a radio hiss, then three rising beeps.
      const src = bank.source('white', rng, 0.7);
      const bp = biquad(actx, 'bandpass', 1800, 0.8);
      const hg = gain(actx, 0);
      src.connect(bp);
      bp.connect(hg);
      hg.connect(out);
      ad(hg.gain, t0, 0.22 * lvl, 0.004, 0.18);
      src.start(t0, src._offset, 0.35);
      for (let i = 0; i < 3; i++) {
        const bt = t0 + 0.08 + i * 0.16;
        const o = osc(actx, 'square', 720 * Math.pow(1.28, i));
        const og = gain(actx, 0);
        o.connect(og);
        og.connect(out);
        ad(og.gain, bt, 0.7 * lvl, 0.004, 0.1);
        o.start(bt);
        o.stop(bt + 0.18);
      }
      break;
    }
    case 'lowhealth': {
      const o1 = osc(actx, 'sine', 92);
      const g = gain(actx, 0);
      o1.connect(g);
      g.connect(out);
      ad(g.gain, t0, 0.45 * lvl, 0.05, 0.55);
      o1.start(t0);
      o1.stop(t0 + 0.9);
      break;
    }
    default: {
      const o1 = osc(actx, 'sine', 1200);
      const g = gain(actx, 0);
      o1.connect(g);
      g.connect(out);
      hit(g.gain, t0, 0.26 * lvl, 0.03);
      o1.start(t0);
      o1.stop(t0 + 0.08);
    }
  }
  return { node: out, end: t0 + 0.9, send: 0 };
}

// Generated gain envelope only, shared per context; no recorded audio or timers.
const intelCadences = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Fictional phone-alert-style cabinet alarm: fixed buzzy tones, not a sweep.
 * Intentionally NOT the real WEA pitches/cadence (853+960 Hz, long-short-short).
 * 740+880 Hz double pulses keep the urgent character but distinguish the game cue.
 * Reference: https://freesound.org/people/HVR_EAS/sounds/532937/
 * The mixer protects output; interruption kills the actual loop within 30 ms.
 */
export function intelSiren(actx: BaseAudioContext): { node: GainNode; stop(when?: number): void } {
  const now = actx.currentTime;
  const level = 0.22; // audible warning, not gunfire-level sustained energy
  let envelope = intelCadences.get(actx);
  if (!envelope) {
    envelope = actx.createBuffer(1, Math.round(actx.sampleRate * 1.5), actx.sampleRate);
    const data = envelope.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / actx.sampleRate;
      const pulse = t < 0.7 ? t : t - 0.7;
      // 0.5 s ON / 0.2 s OFF / 0.5 s ON / 0.3 s OFF, with click-free edges.
      data[i] = pulse >= 0.5 ? 0 : Math.min(1, pulse / 0.008, (0.5 - pulse) / 0.008);
    }
    intelCadences.set(actx, envelope);
  }
  const cadence = actx.createBufferSource();
  cadence.buffer = envelope;
  cadence.loop = true;
  const out = gain(actx, 0);
  const gate = gain(actx, 0);
  const filter = biquad(actx, 'lowpass', 3200, 0.8);
  const bed = gain(actx, 0.45);
  const low = osc(actx, 'square', 740);
  const high = osc(actx, 'square', 880);
  low.connect(bed);
  high.connect(bed);
  bed.connect(filter);
  filter.connect(gate);
  cadence.connect(gate.gain);
  gate.connect(out);
  out.gain.linearRampToValueAtTime(level, now + 0.01);
  low.start(now);
  high.start(now);
  cadence.start(now);
  const nodes = [low, high, cadence, bed, filter, gate, out];
  let stopped = false;
  cadence.onended = () => {
    for (const node of nodes) node.disconnect();
  };
  return {
    node: out,
    stop(when = actx.currentTime) {
      if (stopped) return;
      stopped = true;
      out.gain.cancelScheduledValues(when);
      out.gain.setValueAtTime(when > now + 0.01 ? level : 0, when);
      out.gain.linearRampToValueAtTime(0, when + 0.025);
      low.stop(when + 0.03);
      high.stop(when + 0.03);
      cadence.stop(when + 0.03);
    },
  };
}

/** One required recorded double thump per player heartbeat. */
export function heartbeat(actx: BaseAudioContext, o: HeartbeatOptions): AudioVoice {
  const t0 = o.when ?? actx.currentTime;
  const src = actx.createBufferSource();
  src.buffer = o.buffer;
  const out = gain(actx, o.level ?? 1);
  src.connect(out);
  src.start(t0);
  return { node: out, end: t0 + o.buffer.duration + 0.05, send: 0 };
}
