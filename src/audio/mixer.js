/**
 * AUDIO / MIXER
 *
 * The signal path, top down:
 *
 *   voices ──► bus (weapons | foley | ambience | voice | ui)
 *                │           each bus: trim ──► bus compressor
 *                ▼
 *   ┌── worldSum ─► muffleLP ─► muffleGain ──┐        (deafening / concussion)
 *   │      ▲                                 │
 *   │   reverb returns                       ▼
 *   │      ▲                              masterSum ─► masterComp ─► softClip ─► out
 *   │   convolver x5 (space blend)           ▲
 *   │      ▲                                 │
 *   └── reverbSend ◄─ per-voice send    ui bus + tinnitus (bypass the muffle,
 *                                        so HUD and the ring stay audible)
 *
 * Ducking is a manual sidechain: gunfire pushes `ambience`/`foley` down with a
 * fast setTargetAtTime and lets them float back over ~400 ms. That is exactly
 * what a real game mix does, and it is far more predictable than trying to make
 * a DynamicsCompressor listen to another bus.
 */

import { biquad, gain, limiterCurve, shaper, clamp, osc } from './dsp.js';
import { IR_SPECS, generateIR } from './ir.js';

const TINNITUS_GAIN = 0.008;
const CONCUSSION_CUTOFF_RATIO = 0.075; // full concussion bottoms out at 1.5 kHz

const BUS_DEFS = {
  // Weapons ride ABOVE the bed: measured before the mix pass, a rifle shot
  // peaked at -20 dBFS against an ambient bed at -31 dB mean with -20 dB peaks.
  // The gentler compressor preserves the pressure transient from the field
  // recordings instead of flattening every shot back into the street bed.
  weapons:  { trim: 1.75, comp: { threshold: -1, knee: 4, ratio: 1.5, attack: 0.0015, release: 0.12 } },
  foley:    { trim: 0.9, comp: { threshold: -14, knee: 10, ratio: 2.0, attack: 0.004, release: 0.2 } },
  // Ambient bed deliberately quiet: it is a floor, not a lead vocal. A gunshot
  // should land 15+ dB above it or the street reads as the loudest thing in
  // the mix. Leave environmental detail audible, but below foley and weapons.
  ambience: { trim: 0.07, comp: { threshold: -24, knee: 12, ratio: 2.0, attack: 0.05, release: 0.5 } },
  voice:    { trim: 0.85, comp: { threshold: -18, knee: 8, ratio: 3.0, attack: 0.006, release: 0.22 } },
  ui:       { trim: 1.6,  comp: null },
};

export class Mixer {
  /**
   * @param {BaseAudioContext} actx
   * @param {import('../core/rng.js').Rng} rng
   */
  constructor(actx, rng, opts = {}) {
    this.actx = actx;
    this.rng = rng;
    // Headroom matters more than loudness: at 0.62 a single gunshot peaks near
    // -3 dBFS and the limiter is only reached by dense combat, so the mix keeps
    // its dynamic range instead of being flattened.
    this.masterVolume = opts.masterVolume ?? 0.95;

    /* ---- master chain (built first, everything hangs off it) ------ */
    this.masterSum = gain(actx, 1);
    // Headroom stage. It sits BEFORE the compressor/clipper on purpose: a
    // post-limiter volume control only scales an already-squashed signal, and
    // that is what destroys the difference between a footstep and a gunshot.
    this.preGain = gain(actx, 0.22);
    this.masterComp = actx.createDynamicsCompressor();
    // Safety net only: a single gunshot should barely touch it, a firefight
    // plus a grenade should be held together by it.
    this.masterComp.threshold.value = -2;
    this.masterComp.knee.value = 3;
    this.masterComp.ratio.value = 4;
    this.masterComp.attack.value = 0.0035;
    this.masterComp.release.value = 0.14;
    this.softClip = shaper(actx, limiterCurve(), '4x');
    this.masterGain = gain(actx, this.masterVolume);

    this.masterSum.connect(this.preGain);
    this.preGain.connect(this.masterComp);
    this.masterComp.connect(this.softClip);
    this.softClip.connect(this.masterGain);
    this.masterGain.connect(actx.destination);

    /* ---- concussion / deafening path ----------------------------- */
    // Everything diegetic runs through this so a nearby explosion can muffle
    // the whole world without touching the HUD or the tinnitus tone.
    this.worldSum = gain(actx, 1);
    this.muffleLP = biquad(actx, 'lowpass', 20000, 0.5);
    this.muffleHS = biquad(actx, 'highshelf', 3500, 0.7, 0);
    this.muffleGain = gain(actx, 1);
    this.worldSum.connect(this.muffleLP);
    this.muffleLP.connect(this.muffleHS);
    this.muffleHS.connect(this.muffleGain);
    this.muffleGain.connect(this.masterSum);

    /* ---- buses ---------------------------------------------------- */
    this.buses = {};
    for (const name in BUS_DEFS) {
      const def = BUS_DEFS[name];
      const input = gain(actx, 1);        // voices connect here
      const duck = gain(actx, 1);         // sidechain victim
      const trim = gain(actx, def.trim);  // static balance
      input.connect(duck);
      duck.connect(trim);
      let tail = trim;
      let comp = null;
      if (def.comp) {
        comp = actx.createDynamicsCompressor();
        comp.threshold.value = def.comp.threshold;
        comp.knee.value = def.comp.knee;
        comp.ratio.value = def.comp.ratio;
        comp.attack.value = def.comp.attack;
        comp.release.value = def.comp.release;
        trim.connect(comp);
        tail = comp;
      }
      // ui bypasses the muffle: menu clicks must survive a grenade.
      tail.connect(name === 'ui' ? this.masterSum : this.worldSum);
      this.buses[name] = { input, duck, trim, comp, baseTrim: def.trim, duckAmount: 0 };
    }

    /* ---- reverb ---------------------------------------------------- */
    // One send bus fanning into five convolvers; the space probe crossfades
    // between them. Sharing the send keeps the cost fixed no matter how many
    // voices are alive.
    this.reverbSend = gain(actx, 1);
    // Pre-send shaping: no sub into the convolvers (muddy) and no fizz above
    // 9 kHz (real rooms do not reflect that back at you from 30 m away).
    this.sendHP = biquad(actx, 'highpass', 170, 0.7);
    this.sendLP = biquad(actx, 'lowpass', 9000, 0.7);
    this.reverbSend.connect(this.sendHP);
    this.sendHP.connect(this.sendLP);

    this.spaces = {};
    this.spaceNames = Object.keys(IR_SPECS);
    // Wet return. The send chain already scales with distance and the IRs are
    // peak-normalised to 0.42. The real firearm recordings already contain
    // their outdoor decay, so this return only establishes the local space;
    // it must never lay a second, warehouse-sized tail over every report.
    this.reverbReturn = gain(actx, 0.26);
    this.reverbReturn.connect(this.worldSum);
    this._irReady = false;

    this.spaceWeights = { tight: 0, room: 0, street: 0.35, tunnel: 0, open: 0.65 };

    /* ---- tinnitus (built on demand, torn down when silent) -------- */
    this._tin = null;
    this._pendingConcussion = null;
    this._concussionAttackUntil = 0;
    this.deafness = 0; // 0..1, public: UI/render may read this

  }

  /**
   * Render the impulse responses. Split out from the constructor because it is
   * the single most expensive thing this subsystem does (~15 ms for all five)
   * and we only want to pay it once audio is actually going to be heard.
   */
  buildReverbs() {
    if (this._irReady) return;
    const actx = this.actx;
    for (const name of this.spaceNames) {
      const conv = actx.createConvolver();
      conv.normalize = false;
      try {
        conv.buffer = generateIR(actx, this.rng.fork(), IR_SPECS[name]);
      } catch (err) {
        console.warn('[audio] IR generation failed for', name, err);
        continue;
      }
      const g = gain(actx, this.spaceWeights[name] ?? 0);
      const live = (this.spaceWeights[name] ?? 0) > 0.012;
      if (live) this.sendLP.connect(conv);
      conv.connect(g);
      g.connect(this.reverbReturn);
      this.spaces[name] = { conv, gain: g, live };
    }
    this._irReady = true;
  }

  /**
   * Blend weights from the space probe. Ramped so doorways do not click.
   *
   * Convolvers whose weight has fallen to nothing are unplugged from the send:
   * a 2.8 s stereo convolution is the most expensive node in the graph and
   * there is no reason to compute three of them into a zero gain. Typically two
   * of the five are live at any moment.
   */
  setSpace(weights, smooth = 0.35) {
    const t = this.actx.currentTime;
    for (const name of this.spaceNames) {
      const w = clamp(weights[name] ?? 0, 0, 1);
      this.spaceWeights[name] = w;
      const s = this.spaces[name];
      if (!s) continue;
      s.gain.gain.setTargetAtTime(w, t, smooth);
      const want = w > 0.012;
      if (want === s.live) continue;
      if (want) {
        this.sendLP.connect(s.conv);
      } else {
        // Its gain is already ~0, so cutting the input is inaudible.
        try { this.sendLP.disconnect(s.conv); } catch { /* not connected */ }
      }
      s.live = want;
    }
  }

  /** Bus input node a voice should connect to. */
  bus(name) {
    return (this.buses[name] ?? this.buses.foley).input;
  }

  /**
   * Sidechain duck. `amount` 0..1 of gain reduction, `hold` seconds before it
   * starts floating back. Called on every gunshot and explosion.
   */
  duck(amount, hold = 0.12) {
    const t = this.actx.currentTime;
    const apply = (name, scale) => {
      const b = this.buses[name];
      if (!b) return;
      const a = clamp(amount * scale, 0, 0.92);
      if (a <= b.duckAmount + 0.01) return; // an existing deeper duck wins
      b.duckAmount = a;
      b.duckHold = hold;
      b.duck.gain.cancelScheduledValues(t);
      b.duck.gain.setTargetAtTime(1 - a, t, 0.012);
    };
    apply('ambience', 1);
    apply('foley', 0.55);
    apply('voice', 0.4);
  }

  /**
   * Temporary hearing damage. `level` 0..1. After `delay` seconds, fades the
   * world muffle and tinnitus in with the supplied `attack` time constant.
   */
  concuss(level, delay = 0, attack = 0.02) {
    level = clamp(level, 0, 1);
    if (delay > 0) {
      const at = this.actx.currentTime + delay;
      const pending = this._pendingConcussion;
      if (!pending || level > pending.level || at < pending.at) {
        this._pendingConcussion = { level, at, attack };
      }
      return;
    }
    if (level <= this.deafness) return;
    this.deafness = level;
    const t = this.actx.currentTime;
    const ramp = Math.max(0.001, attack);
    const cutoff = 20000 * Math.pow(CONCUSSION_CUTOFF_RATIO, level);
    this.muffleLP.frequency.cancelScheduledValues(t);
    this.muffleLP.frequency.setTargetAtTime(clamp(cutoff, 320, 20000), t, ramp);
    this.muffleHS.gain.setTargetAtTime(-8 * level, t, ramp);
    this.muffleGain.gain.setTargetAtTime(1 - 0.3 * level, t, ramp);
    this._concussionAttackUntil = t + ramp * 3;
    this._startTinnitus(level, Math.max(0.03, ramp));
  }

  _startTinnitus(level, attack = 0.03) {
    const actx = this.actx;
    const t = actx.currentTime;
    if (this._tin) {
      // Re-trigger: just push the envelope back up.
      this._tin.g.gain.cancelScheduledValues(t);
      this._tin.g.gain.setTargetAtTime(TINNITUS_GAIN * level, t, attack);
      this._tin.until = t + 4 + 7 * level;
      return;
    }
    const g = gain(actx, 0);
    // Two close tones plus a third an octave up: a single sine reads as a test
    // tone, three beating partials read as ringing ears.
    const o1 = osc(actx, 'sine', 3980);
    const o2 = osc(actx, 'sine', 4130);
    const o3 = osc(actx, 'sine', 7420);
    const g1 = gain(actx, 0.6), g2 = gain(actx, 0.45), g3 = gain(actx, 0.18);
    o1.connect(g1); o2.connect(g2); o3.connect(g3);
    g1.connect(g); g2.connect(g); g3.connect(g);
    // Slow wobble so it never sounds like a stuck oscillator.
    const lfo = osc(actx, 'sine', 0.23);
    const lfoG = gain(actx, 26);
    lfo.connect(lfoG);
    lfoG.connect(o2.frequency);
    g.connect(this.masterSum); // post-muffle on purpose
    o1.start(t); o2.start(t); o3.start(t); lfo.start(t);
    g.gain.setTargetAtTime(TINNITUS_GAIN * level, t, attack);
    this._tin = { g, nodes: [o1, o2, o3, lfo, g1, g2, g3, lfoG], until: t + 4 + 7 * level };
  }

  /** Per-frame housekeeping: duck recovery, deafening recovery, tinnitus teardown. */
  update(dt) {
    const t = this.actx.currentTime;

    if (this._pendingConcussion && t >= this._pendingConcussion.at) {
      const { level, attack } = this._pendingConcussion;
      this._pendingConcussion = null;
      this.concuss(level, 0, attack);
    }

    for (const name in this.buses) {
      const b = this.buses[name];
      if (b.duckAmount <= 0) continue;
      if (b.duckHold > 0) {
        b.duckHold -= dt;
        continue;
      }
      b.duckAmount = Math.max(0, b.duckAmount - dt * 2.6);
      b.duck.gain.setTargetAtTime(1 - b.duckAmount, t, 0.09);
      if (b.duckAmount < 0.01) {
        b.duckAmount = 0;
        b.duck.gain.setTargetAtTime(1, t, 0.09);
      }
    }

    if (this.deafness > 0 && t >= this._concussionAttackUntil) {
      // Recovery is slow at first then quick — matches how temporary threshold
      // shift actually behaves, and it feels dramatic.
      this.deafness = Math.max(0, this.deafness - dt * (0.1 + this.deafness * 0.22));
      const cutoff = 20000 * Math.pow(CONCUSSION_CUTOFF_RATIO, this.deafness);
      this.muffleLP.frequency.setTargetAtTime(clamp(cutoff, 1200, 20000), t, 0.25);
      this.muffleHS.gain.setTargetAtTime(-8 * this.deafness, t, 0.25);
      this.muffleGain.gain.setTargetAtTime(1 - 0.3 * this.deafness, t, 0.25);
    }

    if (this._tin) {
      if (t > this._tin.until - 3.5) this._tin.g.gain.setTargetAtTime(0, t, 1.1);
      if (t > this._tin.until) {
        for (const n of this._tin.nodes) {
          try { n.stop?.(t); } catch { /* already stopped */ }
          n.disconnect();
        }
        this._tin.g.disconnect();
        this._tin = null;
      }
    }
  }

  setMasterVolume(v) {
    this.masterVolume = clamp(v, 0, 1);
    this.masterGain.gain.setTargetAtTime(this.masterVolume, this.actx.currentTime, 0.03);
  }

  setBusVolume(name, v) {
    const b = this.buses[name];
    if (!b) return;
    b.trim.gain.setTargetAtTime(clamp(v, 0, 2) * b.baseTrim, this.actx.currentTime, 0.05);
  }

  /** Rough gain-reduction readout, handy for the debug overlay. */
  get reduction() {
    return this.masterComp.reduction ?? 0;
  }

  dispose() {
    this._pendingConcussion = null;
    if (this._tin) {
      for (const n of this._tin.nodes) {
        try { n.stop?.(); } catch { /* noop */ }
        n.disconnect();
      }
      this._tin.g.disconnect();
      this._tin = null;
    }
    for (const name in this.spaces) {
      this.spaces[name].conv.disconnect();
      this.spaces[name].conv.buffer = null;
      this.spaces[name].gain.disconnect();
    }
    this.spaces = {};
    for (const name in this.buses) {
      const b = this.buses[name];
      b.input.disconnect(); b.duck.disconnect(); b.trim.disconnect(); b.comp?.disconnect();
    }
    this.reverbSend.disconnect(); this.sendHP.disconnect(); this.sendLP.disconnect();
    this.reverbReturn.disconnect();
    this.worldSum.disconnect(); this.muffleLP.disconnect(); this.muffleHS.disconnect();
    this.muffleGain.disconnect();
    this.masterSum.disconnect(); this.preGain.disconnect(); this.masterComp.disconnect();
    this.softClip.disconnect(); this.masterGain.disconnect();
  }
}
