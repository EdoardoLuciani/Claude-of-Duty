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
  when?: number | undefined;
  level?: number | undefined;
}
type UiOptions = VoiceOptions;
interface HeartbeatOptions extends VoiceOptions {
  buffer: AudioBuffer;
}

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
  const tone = (
    type: OscillatorType,
    frequency: number,
    start: number,
    stop: number,
    level: number,
    attack: number | null,
    decay: number,
    lowpass?: number,
    q?: number
  ): void => {
    const source = osc(actx, type, frequency);
    const g = gain(actx, 0);
    const filter = lowpass === undefined ? null : biquad(actx, 'lowpass', lowpass, q);
    source.connect(g);
    if (filter) series(g, filter).connect(out);
    else g.connect(out);
    if (attack === null) hit(g.gain, start, level * lvl, decay);
    else ad(g.gain, start, level * lvl, attack, decay);
    source.start(start);
    source.stop(stop);
  };
  switch (kind) {
    case 'hitmarker': {
      tone('square', 2400, t0, t0 + 0.06, 0.55, null, 0.022, 5200, 0.7);
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
        const t = t0 + i * 0.055;
        tone('triangle', 900 * Math.pow(1.5, i), t, t + 0.2, 0.3, 0.004, 0.09);
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
      tone('square', 620, t0, t0 + 0.05 + 0.05, 0.3, 0.003, 0.05, 4200, 0.8);
      tone('square', 930, t0 + 0.08, t0 + 0.08 + 0.07 + 0.05, 0.22, 0.003, 0.07, 4200, 0.8);
      tone('sine', 140, t0, t0 + 0.14, 0.22, 0.004, 0.07);
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
      tone('triangle', 294, t0 + 0.1, t0 + 0.1 + 0.32, 0.16, 0.006, 0.18, 2400, 0.8);
      tone('triangle', 440, t0 + 0.2, t0 + 0.2 + 0.32, 0.12, 0.006, 0.18, 2400, 0.8);
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
      tone('square', 1760, t0, t0 + 0.06, 0.12, 0.002, 0.03, 3600, 0.8);
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
      tone('sawtooth', 104, t0 + 0.1, t0 + 0.32, 0.22, 0.005, 0.12);
      break;
    }
    case 'grenade_warn': {
      // Three rising beeps — reads as "danger", not as a notification.
      for (let i = 0; i < 3; i++) {
        const bt = t0 + i * 0.14;
        tone('square', 1150 * Math.pow(1.19, i), bt, bt + 0.16, 0.3, 0.004, 0.07, 4200, 0.8);
      }
      break;
    }
    case 'radio_open': {
      // Physical switch/static are required recordings; retain the functional tone.
      tone('square', 880, t0 + 0.11, t0 + 0.28, 0.14, 0.004, 0.06);
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
      tone('sawtooth', 112, t0 + 0.14, t0 + 0.42, 0.3, 0.006, 0.14);
      break;
    }
    case 'radio_strike': {
      // Recorded transmission texture is composed with these acknowledgment tones.
      for (let i = 0; i < 2; i++) {
        const bt = t0 + 0.16 + i * 0.13;
        tone('square', 660 * Math.pow(1.35, i), bt, bt + 0.2, 0.26, 0.004, 0.09);
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
        tone('square', 720 * Math.pow(1.28, i), bt, bt + 0.18, 0.7, 0.004, 0.1);
      }
      break;
    }
    case 'lowhealth': {
      tone('sine', 92, t0, t0 + 0.9, 0.45, 0.05, 0.55);
      break;
    }
    default: {
      tone('sine', 1200, t0, t0 + 0.08, 0.26, null, 0.03);
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
  cadence.onended = (): void => {
    for (const node of nodes) node.disconnect();
  };
  return {
    node: out,
    stop(when = actx.currentTime): void {
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
