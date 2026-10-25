/**
 * AUDIO / PROCEDURAL FOLEY
 *
 * Recorded heartbeat playback and intentional UI cues.
 * Reload handling, physical contacts, boots, body falls and cloth use required
 * recordings through WeaponSampleBank; do not synthesize missing assets.
 */

import type { Rng } from '../core/rng.ts';
import { ad, biquad, gain, hit, osc, series, struckResonator, sweep } from './dsp.ts';
import type { NoiseBank } from './dsp.ts';
import type { AudioVoice } from './types.ts';
interface VoiceOptions {
  when?: number;
  level?: number;
}
type UiOptions = VoiceOptions;
interface HeartbeatOptions extends VoiceOptions {
  buffer: AudioBuffer;
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
    case 'radio_open': {
      // Physical switch/static are required recordings; retain the functional tone.
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
      // Recorded transmission texture is composed with these acknowledgment tones.
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
      // Recorded receive texture is separate; keep all three useful rising beeps.
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
