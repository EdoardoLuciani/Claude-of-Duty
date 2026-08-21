/** Looping tent-radio bed for the shop. Rendered once into a buffer; the live
 *  graph just starts/stops a BufferSource. */

import { NoiseBank, adsr, biquad, gain, osc, series, shaper, saturationCurve } from './dsp.js';

const BPM = 72;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 4;
const LOOP = BAR * BARS;

function midi(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/** Dusty Rhodes: 1:1 FM sine, index decays so the attack bells then the body sits. */
function rhodes(actx, dest, freq, t0, dur, level) {
  const car = osc(actx, 'sine', freq);
  const mod = osc(actx, 'sine', freq);
  const modG = gain(actx, 0);
  const outG = gain(actx, 0);
  const lp = biquad(actx, 'lowpass', 2100, 0.75);
  mod.connect(modG);
  modG.connect(car.frequency);
  car.connect(lp);
  lp.connect(outG);
  outG.connect(dest);
  adsr(modG.gain, t0, freq * 0.55, 0.008, 0.22, dur * 0.35, 0.12, 0.45);
  adsr(outG.gain, t0, level, 0.014, 0.28, dur * 0.45, 0.32, 0.7);
  car.start(t0);
  mod.start(t0);
  car.stop(t0 + dur + 0.9);
  mod.stop(t0 + dur + 0.9);
}

function bass(actx, dest, freq, t0, dur, level) {
  const o1 = osc(actx, 'sine', freq);
  const o2 = osc(actx, 'triangle', freq * 2);
  const mix = gain(actx, 0);
  const lp = biquad(actx, 'lowpass', 340, 0.7);
  const g2 = gain(actx, 0.18);
  o1.connect(mix);
  o2.connect(g2);
  g2.connect(mix);
  mix.connect(lp);
  lp.connect(dest);
  adsr(mix.gain, t0, level, 0.02, 0.18, dur * 0.7, 0.55, 0.35);
  o1.start(t0);
  o2.start(t0);
  o1.stop(t0 + dur + 0.5);
  o2.stop(t0 + dur + 0.5);
}

function chime(actx, dest, freq, t0, level) {
  const o = osc(actx, 'sine', freq);
  const g = gain(actx, 0);
  const lp = biquad(actx, 'lowpass', 3800, 0.8);
  o.connect(g);
  g.connect(lp);
  lp.connect(dest);
  adsr(g.gain, t0, level, 0.004, 0.12, 0.05, 0.2, 0.9);
  o.start(t0);
  o.stop(t0 + 1.2);
}

/**
 * Four bars, D dorian, never quite resolving:
 *   Dm9 | Bbmaj7 | Gm11 | A7sus
 */
function score(actx, dest) {
  const chords = [
    [50, 57, 60, 64, 65], // D3 A3 C4 E4 F4
    [46, 53, 57, 62],     // Bb2 F3 A3 D4
    [43, 50, 53, 58, 60], // G2 D3 F3 Bb3 C4
    [45, 52, 55, 60],     // A2 E3 G3 C4
  ];
  const roots = [38, 34, 43, 45]; // D2 Bb1 G2 A2
  for (let bar = 0; bar < BARS; bar++) {
    const t = 0.04 + bar * BAR;
    const hold = BAR * 0.92;
    bass(actx, dest, midi(roots[bar]), t, hold, 0.22);
    const notes = chords[bar];
    for (let i = 0; i < notes.length; i++) {
      rhodes(actx, dest, midi(notes[i]), t + i * 0.03, hold, 0.07 - i * 0.006);
    }
  }
  // Sparse melody so the loop has a shape, not just pads.
  rhodes(actx, dest, midi(69), 0.04 + BAR * 0 + BEAT * 2, BEAT * 1.6, 0.09); // A4
  rhodes(actx, dest, midi(72), 0.04 + BAR * 0 + BEAT * 3.1, BEAT * 1.2, 0.08); // C5
  rhodes(actx, dest, midi(67), 0.04 + BAR * 1 + BEAT * 1.5, BEAT * 1.8, 0.07); // G4
  rhodes(actx, dest, midi(74), 0.04 + BAR * 2 + BEAT * 2, BEAT * 1.5, 0.09); // D5
  rhodes(actx, dest, midi(64), 0.04 + BAR * 3 + BEAT * 0.05, BEAT * 1.4, 0.08); // E4
  chime(actx, dest, midi(81), 0.04 + BAR * 3 + BEAT * 3, 0.045); // A5
}

function hiss(actx, bank, dest, rng) {
  const src = bank.source('pink', rng, 1, true);
  const bp = biquad(actx, 'bandpass', 1400, 0.55);
  const g = gain(actx, 0.045);
  series(src, bp, g).connect(dest);
  src.start(0);
}

function seam(buf, ms = 14) {
  const n = Math.min(buf.length - 1, Math.floor(buf.sampleRate * ms / 1000));
  if (n < 8) return;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    const len = d.length;
    for (let i = 0; i < n; i++) {
      const f = i / n;
      d[i] = d[i] * f + d[len - n + i] * (1 - f);
    }
  }
}

async function renderBed(sampleRate, rng) {
  const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!Offline) return null;
  const sr = sampleRate || 48000;
  const ctx = new Offline(2, Math.ceil(sr * LOOP), sr);
  const bank = new NoiseBank(ctx, rng.fork(), 2.4);
  const sum = gain(ctx, 1);
  const drive = shaper(ctx, saturationCurve(2.4, 0.12), '2x');
  const bp = biquad(ctx, 'bandpass', 980, 0.65);
  const hs = biquad(ctx, 'highshelf', 3200, 0.7, -7);
  const out = gain(ctx, 0.7);
  series(sum, drive, bp, hs, out).connect(ctx.destination);
  score(ctx, sum);
  hiss(ctx, bank, sum, rng);
  const buf = await ctx.startRendering();
  seam(buf);
  return buf;
}

export class TentRadio {
  constructor(actx, mixer, rng) {
    this.actx = actx;
    this.mixer = mixer;
    this.rng = rng;
    this._buf = null;
    this._warm = null;
    this._src = null;
    this._gain = null;
    this._lfo = null;
    this.playing = false;
  }

  /** Kick off the offline render; first `start()` awaits this. */
  warm() {
    if (this._warm) return this._warm;
    this._warm = renderBed(this.actx.sampleRate, this.rng)
      .then((buf) => { this._buf = buf; return buf; })
      .catch(() => { this._buf = null; return null; });
    return this._warm;
  }

  async start() {
    if (this.playing) return;
    if (!this._buf) await this.warm();
    if (!this._buf || this.playing) return;
    this.playing = true;
    const actx = this.actx;
    const t = actx.currentTime;
    const g = gain(actx, 0);
    const src = actx.createBufferSource();
    src.buffer = this._buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = this._buf.duration;
    src.connect(g);
    g.connect(this.mixer.bus('music'));
    // Tiny wow so the loop never sits dead-on pitch — a radio, not a click track.
    const lfo = osc(actx, 'sine', 0.17);
    const lfoG = gain(actx, 0.004);
    lfo.connect(lfoG);
    lfoG.connect(src.playbackRate);
    src.start(t);
    lfo.start(t);
    g.gain.setTargetAtTime(1, t, 0.35);
    this._src = src;
    this._gain = g;
    this._lfo = lfo;
    this._lfoG = lfoG;
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    const t = this.actx.currentTime;
    const g = this._gain;
    if (g) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.22);
    }
    const src = this._src;
    const lfo = this._lfo;
    const lfoG = this._lfoG;
    this._src = this._gain = this._lfo = this._lfoG = null;
    const later = t + 1.1;
    try { src?.stop(later); } catch { /* already stopped */ }
    try { lfo?.stop(later); } catch { /* already stopped */ }
    setTimeout(() => {
      try { src?.disconnect(); } catch { /* noop */ }
      try { g?.disconnect(); } catch { /* noop */ }
      try { lfo?.disconnect(); } catch { /* noop */ }
      try { lfoG?.disconnect(); } catch { /* noop */ }
    }, 1200);
  }

  dispose() {
    this.stop();
    this._buf = null;
    this._warm = null;
  }
}
