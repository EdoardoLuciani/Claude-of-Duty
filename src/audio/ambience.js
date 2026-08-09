/**
 * AUDIO / AMBIENCE
 *
 * A very quiet, high-passed air floor plus sparse positioned environmental
 * one-shots and distant combat. The air has no LFO or low-frequency content;
 * this avoids the anonymous pulsing loop that sounded like machinery.
 *
 * The beds also react to the space probe: walking inside drops the wind and
 * closes a lowpass over the outdoor content, which is a huge part of why a
 * doorway feels like a doorway.
 */

import { ad, biquad, clamp, gain, osc, series, struckResonator, sweep } from './dsp.js';

export class Ambience {
  constructor(actx, bank, mixer, field, rng) {
    this.actx = actx;
    this.bank = bank;
    this.mixer = mixer;
    this.field = field;
    this.rng = rng;
    this.nodes = [];
    this.started = false;
    this.enclosure = 0;
    this.intensity = 0.65; // distant detail, not a constant competing firefight
    this._timers = { volley: 4, boom: 18, oneshot: 6, chatter: 25 };
  }

  /** Build the beds. Called once, after the graph is live. */
  start() {
    if (this.started) return;
    this.started = true;
    // Keep only broadband air: no brown noise, sub content, resonant low-pass,
    // panning or gain modulation. A long source buffer and a 110 Hz high-pass
    // make this incapable of producing the old 1.5–2 Hz mechanical churn.
    //
    // The 650 Hz high-pass was a mistake: pink noise from 650 Hz to 7.5 kHz is
    // the exact spectral signature of static/hiss — it sat in the ear's most
    // sensitive band from the moment audio started. Air lives lower. 110 Hz
    // still kills sub content and the old machinery churn; 2.8 kHz removes
    // everything above it, so the floor reads as soft air instead of radio
    // static.
    const src = this.bank.source('pink', this.rng, 1, true);
    const hp = biquad(this.actx, 'highpass', 110, 0.65);
    const lp = biquad(this.actx, 'lowpass', 2800, 0.55);
    const g = gain(this.actx, 0.28);
    series(src, hp, lp, g).connect(this.mixer.bus('ambience'));
    src.start(0, src._offset);
    this._airLP = lp;
    this._airGain = g;
    this.nodes.push(src, hp, lp, g);

    // Identifiable events provide the actual environmental narrative.
    this._reseedTimers();
  }

  _reseedTimers() {
    const r = this.rng;
    this._timers.volley = r.range(3, 11);
    this._timers.boom = r.range(14, 44);
    this._timers.oneshot = r.range(5, 17);
    this._timers.chatter = r.range(18, 50);
  }

  /** Outdoor content is filtered and dropped when the listener is enclosed. */
  setEnclosure(v) {
    this.enclosure = clamp(v, 0, 1);
    if (!this.started) return;
    const t = this.actx.currentTime;
    this._airLP?.frequency.setTargetAtTime(2800 - 2400 * this.enclosure, t, 0.6);
    this._airGain?.gain.setTargetAtTime(0.28 - 0.2 * this.enclosure, t, 0.8);
  }

  update(dt, api) {
    if (!this.started) return;
    const r = this.rng;
    const T = this._timers;

    T.volley -= dt;
    if (T.volley <= 0) {
      T.volley = r.range(2.5, 12) / clamp(this.intensity, 0.25, 2);
      api?.distantVolley?.();
    }

    T.boom -= dt;
    if (T.boom <= 0) {
      T.boom = r.range(16, 50) / clamp(this.intensity, 0.25, 2);
      api?.distantBoom?.();
    }

    T.oneshot -= dt;
    if (T.oneshot <= 0) {
      T.oneshot = r.range(6, 20);
      api?.oneShot?.();
    }

    T.chatter -= dt;
    if (T.chatter <= 0) {
      T.chatter = r.range(20, 60);
      api?.distantChatter?.();
    }
  }

  dispose() {
    for (const n of this.nodes) {
      try { n.stop?.(); } catch { /* not a source */ }
      n.disconnect();
    }
    this.nodes.length = 0;
    this.started = false;
  }
}

/* ------------------------------------------------------------------ */
/* Positioned ambient one-shots                                       */
/* ------------------------------------------------------------------ */

/** Weighted table used by the scheduler. */
export const ONE_SHOTS = ['dog', 'siren', 'creak', 'settle', 'birds', 'vehicle', 'heli', 'shout'];

export function ambientOneShot(actx, bank, rng, kind, o = {}) {
  const t0 = o.when ?? actx.currentTime;
  const out = gain(actx, 0.55); // VOICE TRIM
  const lvl = o.level ?? 1;
  let end = t0 + 1;

  switch (kind) {
    case 'dog': {
      // Two or three barks, each a short formant-ish yelp.
      const n = 2 + ((rng.u32() % 2) | 0);
      for (let i = 0; i < n; i++) {
        const bt = t0 + i * rng.range(0.24, 0.44);
        const o1 = osc(actx, 'sawtooth', rng.range(220, 340));
        const bp = biquad(actx, 'bandpass', rng.range(700, 1200), 2.2);
        const g = gain(actx, 0);
        series(o1, bp, g).connect(out);
        sweep(o1.frequency, bt, rng.range(300, 420), rng.range(150, 220), 0.11);
        ad(g.gain, bt, 0.5 * lvl, 0.01, 0.1);
        o1.start(bt); o1.stop(bt + 0.3);
        const ns = bank.source('white', rng, 1);
        const nbp = biquad(actx, 'bandpass', 2400, 1.2);
        const ng = gain(actx, 0);
        series(ns, nbp, ng).connect(out);
        ad(ng.gain, bt, 0.12 * lvl, 0.008, 0.08);
        ns.start(bt, ns._offset, 0.2);
        end = bt + 0.4;
      }
      return { node: out, end, send: 0.7 };
    }
    case 'siren': {
      // Distant two-tone, wailing, drifting in and out.
      const dur = rng.range(4, 9);
      const o1 = osc(actx, 'sine', 620);
      const o2 = osc(actx, 'sine', 930);
      const g = gain(actx, 0);
      const lp = biquad(actx, 'lowpass', 1800, 0.8);
      o1.connect(g); o2.connect(g); series(g, lp).connect(out);
      const wob = osc(actx, 'sine', rng.range(0.35, 0.6));
      const wg = gain(actx, 110);
      wob.connect(wg); wg.connect(o1.frequency); wg.connect(o2.frequency);
      wob.start(t0);
      ad(g.gain, t0, 0.022 * lvl, dur * 0.3, dur * 0.7);
      o1.start(t0); o2.start(t0);
      o1.stop(t0 + dur + 0.5); o2.stop(t0 + dur + 0.5); wob.stop(t0 + dur + 0.5);
      return { node: out, end: t0 + dur + 0.6, send: 1.1 };
    }
    case 'creak': {
      // Metal fatigue: a high-Q band swept slowly, plus a final pop.
      const dur = rng.range(0.9, 2.4);
      const src = bank.source('white', rng, rng.range(0.6, 1));
      const bp = biquad(actx, 'bandpass', 900, 22);
      const g = gain(actx, 0);
      series(src, bp, g).connect(out);
      sweep(bp.frequency, t0, rng.range(500, 900), rng.range(1100, 2200), dur);
      ad(g.gain, t0, 0.3 * lvl, dur * 0.3, dur * 0.8);
      src.start(t0, src._offset, dur * 1.5);
      struckResonator(actx, bank, rng, t0 + dur * 0.9, [
        { f: rng.range(400, 1400), q: 20, g: 0.18 * lvl, decay: 0.1 },
      ], 0.003).connect(out);
      return { node: out, end: t0 + dur * 1.6, send: 0.8 };
    }
    case 'settle': {
      // Rubble shifting: a handful of grains and a soft low thump.
      for (let i = 0; i < 7; i++) {
        struckResonator(actx, bank, rng, t0 + rng.range(0, 0.7), [
          { f: rng.range(600, 5000), q: rng.range(8, 26), g: rng.range(0.02, 0.09) * lvl, decay: rng.range(0.01, 0.07) },
        ], 0.002).connect(out);
      }
      const b = osc(actx, 'sine', 90);
      const g = gain(actx, 0);
      b.connect(g); g.connect(out);
      sweep(b.frequency, t0, 110, 55, 0.15);
      ad(g.gain, t0, 0.14 * lvl, 0.01, 0.16);
      b.start(t0); b.stop(t0 + 0.4);
      return { node: out, end: t0 + 1.1, send: 0.6 };
    }
    case 'birds': {
      const n = 3 + ((rng.u32() % 5) | 0);
      for (let i = 0; i < n; i++) {
        const bt = t0 + rng.range(0, 1.4);
        const o1 = osc(actx, 'sine', 3200);
        const g = gain(actx, 0);
        o1.connect(g); g.connect(out);
        const up = rng.float() < 0.5;
        sweep(o1.frequency, bt, up ? 2600 : 4400, up ? 4600 : 2700, 0.06);
        ad(g.gain, bt, 0.05 * lvl, 0.008, 0.06);
        o1.start(bt); o1.stop(bt + 0.2);
      }
      return { node: out, end: t0 + 1.8, send: 0.9 };
    }
    case 'vehicle': {
      // A truck passing somewhere out of sight.
      const dur = rng.range(3.5, 7);
      const src = bank.source('brown', rng, rng.range(0.7, 1));
      const lp = biquad(actx, 'lowpass', 300, 0.9);
      const g = gain(actx, 0);
      series(src, lp, g).connect(out);
      sweep(lp.frequency, t0, 200, 460, dur * 0.5);
      sweep(lp.frequency, t0 + dur * 0.5, 460, 180, dur * 0.5);
      ad(g.gain, t0, 0.16 * lvl, dur * 0.45, dur * 0.55);
      src.start(t0, src._offset, dur * 1.2);
      // Engine order: a low buzz that follows the same envelope.
      const e = osc(actx, 'sawtooth', rng.range(52, 78));
      const eg = gain(actx, 0);
      const elp = biquad(actx, 'lowpass', 240, 1.2);
      e.connect(eg); series(eg, elp).connect(out);
      ad(eg.gain, t0, 0.035 * lvl, dur * 0.45, dur * 0.55);
      e.start(t0); e.stop(t0 + dur * 1.2);
      return { node: out, end: t0 + dur * 1.3, send: 0.7 };
    }
    case 'heli': {
      // Rotor thump: an amplitude-modulated dark noise bed, no sample needed.
      const dur = rng.range(6, 12);
      const src = bank.source('brown', rng, rng.range(0.8, 1.1));
      const lp = biquad(actx, 'lowpass', 420, 0.9);
      const g = gain(actx, 0);
      // Blade-pass modulation: a separate multiplier, because an LFO connected
      // to a gain param sums with the envelope instead of scaling it.
      const am = gain(actx, 0.45);
      series(src, lp, g, am).connect(out);
      ad(g.gain, t0, 2.1 * lvl, dur * 0.4, dur * 0.6);
      src.start(t0, src._offset, dur * 1.2);
      const thump = osc(actx, 'sine', rng.range(4.6, 6.4));
      const tg = gain(actx, 0.5);
      thump.connect(tg); tg.connect(am.gain);
      thump.start(t0); thump.stop(t0 + dur * 1.2);
      // Turbine whine an octave-ish above the blade rate harmonics.
      const w = osc(actx, 'sawtooth', rng.range(280, 420));
      const wbp = biquad(actx, 'bandpass', 1400, 6);
      const wg = gain(actx, 0);
      series(w, wbp, wg).connect(out);
      ad(wg.gain, t0, 0.11 * lvl, dur * 0.4, dur * 0.6);
      w.start(t0); w.stop(t0 + dur * 1.2);
      return { node: out, end: t0 + dur * 1.3, send: 0.9 };
    }
    case 'shout':
    default: {
      // Unintelligible distant shouting — deliberately just contour, no words.
      const dur = rng.range(0.3, 0.7);
      const o1 = osc(actx, 'sawtooth', rng.range(110, 160));
      const bp1 = biquad(actx, 'bandpass', rng.range(600, 900), 4);
      const bp2 = biquad(actx, 'bandpass', rng.range(1300, 2000), 5);
      const g = gain(actx, 0);
      o1.connect(bp1); o1.connect(bp2);
      bp1.connect(g); bp2.connect(g);
      const lp = biquad(actx, 'lowpass', 2600, 0.8);
      series(g, lp).connect(out);
      sweep(o1.frequency, t0, rng.range(130, 170), rng.range(95, 125), dur);
      ad(g.gain, t0, 0.2 * lvl, 0.05, dur);
      o1.start(t0); o1.stop(t0 + dur + 0.2);
      return { node: out, end: t0 + dur + 0.3, send: 1.2 };
    }
  }
}
