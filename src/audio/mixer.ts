/**
 * AUDIO / MIXER
 *
 * The signal path, top down:
 *
 *   voices ──► bus (weapons | foley | ambience | voice | ui | music)
 *                │           optional compressor for foley / ambience / voice
 *                │           one category gain (balance × volume × duck)
 *                ▼
 *   ┌── worldSum ─┬─► dry weight ─────────┬─► hearing gain ─┐
 *   │      ▲      └─► LP / shelf / wet ───┘                 │
 *   │   reverb returns        (complementary hearing fade)  ▼
 *   │      ▲                         masterSum ─► energy / peak gain ─► volume
 *   │   convolver x5 (space blend)           ▲
 *   │      ▲                                 │
 *   └── reverbSend ◄─ per-voice send    ui bus + tinnitus (bypass the muffle,
 *                                        so HUD and the ring stay audible)
 *
 * Ducking is a manual sidechain: gunfire pushes `ambience`/`foley` down with a
 * fast setTargetAtTime and lets them float back over ~400 ms. The audible
 * post-compressor level changes without altering compressor drive or forgetting
 * the user's volume setting.
 */

import type { Rng } from '../core/rng.ts';
import { biquad, gain, clamp, osc } from './dsp.ts';
import { IR_SPECS, generateIR, type SpaceName } from './ir.ts';
type BusName = keyof typeof BUS_DEFS;
interface MixerBus {
  input: AudioNode;
  level: GainNode;
  comp: DynamicsCompressorNode | null;
  baseTrim: number;
  volume: number;
  duckAmount: number;
  duckHold?: number;
}
interface ReverbSpace {
  conv: ConvolverNode;
  gain: GainNode;
  live: boolean;
}
interface TinnitusVoice {
  g: GainNode;
  nodes: (AudioNode & { stop?: (when?: number) => void })[];
  until: number;
}
interface PendingConcussion {
  level: number;
  at: number;
  attack: number;
}

const TINNITUS_GAIN = 0.008;
const HEARING_SETTLE_SECONDS = 0.03;

// Anchor the rendered current value explicitly before replacing a target/ramp.
// Native automation tests catch discontinuities when hold alone is followed by
// a new ramp without a value event at its start.
function holdHearingParam(param: AudioParam, time: number): void {
  const value = param.value;
  param.cancelAndHoldAtTime(time);
  param.setValueAtTime(value, time);
}
const CONCUSSION_CUTOFF_RATIO = 0.075; // full concussion bottoms out at 1.5 kHz

const BUS_DEFS = {
  // The only authored weapon-level control. Sources have no separate profile
  // trim; shared summation headroom and output safety remain downstream.
  weapons: { trim: 1, comp: null },
  foley: { trim: 0.9, comp: { threshold: -14, knee: 10, ratio: 2.0, attack: 0.004, release: 0.2 } },
  // Ambient bed deliberately quiet: it is a floor, not a lead vocal. A gunshot
  // should land 15+ dB above it or the street reads as the loudest thing in
  // the mix. Leave environmental detail audible, but below foley and weapons.
  ambience: {
    trim: 0.07,
    comp: { threshold: -24, knee: 12, ratio: 2.0, attack: 0.05, release: 0.5 },
  },
  voice: {
    trim: 0.85,
    comp: { threshold: -18, knee: 8, ratio: 3.0, attack: 0.006, release: 0.22 },
  },
  ui: { trim: 1.6, comp: null },
  music: { trim: 1.6, comp: null },
};
const BUS_NAMES = Object.keys(BUS_DEFS) as BusName[];
const preparedContexts = new WeakMap<BaseAudioContext, Promise<void>>();

export class Mixer {
  actx!: BaseAudioContext;
  rng!: Rng;
  masterVolume!: number;
  masterSum!: GainNode;
  energyMix!: AudioWorkletNode;
  masterGain!: GainNode;
  worldSum!: GainNode;
  muffleLP!: BiquadFilterNode;
  muffleHS!: BiquadFilterNode;
  muffleGain!: GainNode;
  muffleDry!: GainNode;
  muffleWet!: GainNode;
  buses!: Record<BusName, MixerBus>;
  reverbSend!: GainNode;
  sendHP!: BiquadFilterNode;
  sendLP!: BiquadFilterNode;
  spaces!: Partial<Record<SpaceName, ReverbSpace>>;
  spaceNames!: SpaceName[];
  reverbReturn!: GainNode;
  _irReady!: boolean;
  spaceWeights!: Record<SpaceName, number>;
  _tin!: TinnitusVoice | null;
  _pendingConcussion!: PendingConcussion | null;
  _concussionAttackUntil!: number;
  deafness!: number;
  /** Load the local audio-thread processor once per context; no silent fallback. */
  static prepare(actx: BaseAudioContext): Promise<void> {
    let ready = preparedContexts.get(actx);
    if (!ready) {
      ready = import('./energy-worklet.ts?worker&url').then(({ default: url }) =>
        actx.audioWorklet.addModule(url)
      );
      preparedContexts.set(actx, ready);
    }
    return ready;
  }

  /**
   * @param {BaseAudioContext} actx
   * @param {import('../core/rng.ts').Rng} rng
   */
  constructor(actx: BaseAudioContext, rng: Rng, opts: { masterVolume?: number } = {}) {
    this.actx = actx;
    this.rng = rng;
    // User volume is last. Category balance and summation headroom belong
    // upstream of the single shared peak-safety processor.
    this.masterVolume = opts.masterVolume ?? 1;

    /* ---- master chain (built first, everything hangs off it) ------ */
    this.masterSum = gain(actx, 1);
    // Linked RMS and peak constraints share one lookahead and one applied
    // gain. Output 1 exposes RMS-only audio for inspection, not another route.
    this.energyMix = new AudioWorkletNode(actx, 'cod-energy-mix', {
      numberOfInputs: 1,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.masterGain = gain(actx, this.masterVolume);

    this.masterSum.connect(this.energyMix);
    // Output 0: shared energy/peak-controlled mix. Output 1: RMS-only review
    // tap, normally unconnected. Both use the SAME 5 ms audio delay.
    this.energyMix.connect(this.masterGain);
    this.masterGain.connect(actx.destination);

    /* ---- concussion / deafening path ----------------------------- */
    // Everything diegetic runs through this so a nearby explosion can muffle
    // the whole world without touching the HUD or the tinnitus tone.
    this.worldSum = gain(actx, 1);
    this.muffleLP = biquad(actx, 'lowpass', 20000, 0.5);
    this.muffleHS = biquad(actx, 'highshelf', 3500, 0.7, 0);
    this.muffleGain = gain(actx, 1);
    // Complementary routing weights, not additional volume controls. Healthy
    // hearing is a true dry bypass; the live filters never touch that signal.
    this.muffleDry = gain(actx, 1);
    this.muffleWet = gain(actx, 0);
    this.worldSum.connect(this.muffleDry);
    this.muffleDry.connect(this.muffleGain);
    this.worldSum.connect(this.muffleLP);
    this.muffleLP.connect(this.muffleHS);
    this.muffleHS.connect(this.muffleWet);
    this.muffleWet.connect(this.muffleGain);
    this.muffleGain.connect(this.masterSum);

    /* ---- buses ---------------------------------------------------- */
    this.buses = {} as Record<BusName, MixerBus>;
    for (const name of BUS_NAMES) {
      const def = BUS_DEFS[name];
      const level = gain(actx, def.trim);
      let comp: DynamicsCompressorNode | null = null;
      if (def.comp) {
        comp = actx.createDynamicsCompressor();
        comp.threshold.value = def.comp.threshold;
        comp.knee.value = def.comp.knee;
        comp.ratio.value = def.comp.ratio;
        comp.attack.value = def.comp.attack;
        comp.release.value = def.comp.release;
        comp.connect(level);
      }
      // ui/music bypass the muffle so HUD ticks and the shop radio survive a grenade.
      // Keep category volume/balance out of the compressor detector. Ducking
      // now controls the audible post-compressor level too, not its drive.
      level.connect(name === 'ui' || name === 'music' ? this.masterSum : this.worldSum);
      this.buses[name] = {
        input: comp ?? level,
        level,
        comp,
        baseTrim: def.trim,
        volume: 1,
        duckAmount: 0,
      };
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
    this.spaceNames = Object.keys(IR_SPECS) as SpaceName[];
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
  buildReverbs(): void {
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
  setSpace(weights: Partial<Record<SpaceName, number>>, smooth = 0.35): void {
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
        try {
          this.sendLP.disconnect(s.conv);
        } catch {
          /* not connected */
        }
      }
      s.live = want;
    }
  }

  /** Bus input node a voice should connect to. */
  bus(name: string): AudioNode {
    return (this.buses[name as BusName] ?? this.buses.foley).input;
  }

  /**
   * Sidechain duck. `amount` 0..1 of gain reduction, `hold` seconds before it
   * starts floating back. Called on every gunshot and explosion.
   */
  duck(amount: number, hold = 0.12): void {
    const t = this.actx.currentTime;
    const apply = (name: BusName, scale: number): void => {
      const b = this.buses[name];
      if (!b) return;
      const a = clamp(amount * scale, 0, 0.92);
      if (a <= b.duckAmount + 0.01) return; // an existing deeper duck wins
      b.duckAmount = a;
      b.duckHold = hold;
      b.level.gain.cancelScheduledValues(t);
      this._setBusLevel(b, 0.012);
    };
    apply('ambience', 1);
    apply('foley', 0.55);
    apply('voice', 0.4);
  }

  /**
   * Temporary hearing damage. `level` 0..1. After `delay` seconds, fades the
   * world muffle and tinnitus in with the supplied `attack` time constant.
   */
  concuss(level: number, delay = 0, attack = 0.02): void {
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
    // A retrigger can interrupt the finite healthy-settle ramp. Hold the actual
    // current values before replacing automation, rather than jumping backward.
    holdHearingParam(this.muffleLP.frequency, t);
    holdHearingParam(this.muffleHS.gain, t);
    holdHearingParam(this.muffleGain.gain, t);
    this.muffleLP.frequency.setTargetAtTime(clamp(cutoff, 320, 20000), t, ramp);
    this.muffleHS.gain.setTargetAtTime(-8 * level, t, ramp);
    this.muffleGain.gain.setTargetAtTime(1 - 0.3 * level, t, ramp);
    this._fadeHearing(1, t + ramp * 3);
    this._concussionAttackUntil = t + ramp * 3;
    this._startTinnitus(level, Math.max(0.03, ramp));
  }

  /** Linear complementary fades: equal-power would boost these correlated paths. */
  _fadeHearing(wet: number, end: number): void {
    const t = this.actx.currentTime;
    holdHearingParam(this.muffleDry.gain, t);
    holdHearingParam(this.muffleWet.gain, t);
    this.muffleDry.gain.linearRampToValueAtTime(1 - wet, end);
    this.muffleWet.gain.linearRampToValueAtTime(wet, end);
  }

  _startTinnitus(level: number, attack = 0.03): void {
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
    const g1 = gain(actx, 0.6),
      g2 = gain(actx, 0.45),
      g3 = gain(actx, 0.18);
    o1.connect(g1);
    o2.connect(g2);
    o3.connect(g3);
    g1.connect(g);
    g2.connect(g);
    g3.connect(g);
    // Slow wobble so it never sounds like a stuck oscillator.
    const lfo = osc(actx, 'sine', 0.23);
    const lfoG = gain(actx, 26);
    lfo.connect(lfoG);
    lfoG.connect(o2.frequency);
    g.connect(this.masterSum); // post-muffle on purpose
    o1.start(t);
    o2.start(t);
    o3.start(t);
    lfo.start(t);
    g.gain.setTargetAtTime(TINNITUS_GAIN * level, t, attack);
    this._tin = { g, nodes: [o1, o2, o3, lfo, g1, g2, g3, lfoG], until: t + 4 + 7 * level };
  }

  /** Per-frame housekeeping: duck recovery, deafening recovery, tinnitus teardown. */
  update(dt: number): void {
    const t = this.actx.currentTime;

    if (this._pendingConcussion && t >= this._pendingConcussion.at) {
      const { level, attack } = this._pendingConcussion;
      this._pendingConcussion = null;
      this.concuss(level, 0, attack);
    }

    for (const name of BUS_NAMES) {
      const b = this.buses[name];
      if (b.duckAmount <= 0) continue;
      const duckHold = b.duckHold ?? 0;
      if (duckHold > 0) {
        b.duckHold = duckHold - dt;
        continue;
      }
      b.duckAmount = Math.max(0, b.duckAmount - dt * 2.6);
      if (b.duckAmount < 0.01) b.duckAmount = 0;
      this._setBusLevel(b, 0.09);
    }

    if (this.deafness > 0 && t >= this._concussionAttackUntil) {
      // Recovery is slow at first then quick — matches how temporary threshold
      // shift actually behaves, and it feels dramatic.
      this.deafness = Math.max(0, this.deafness - dt * (0.1 + this.deafness * 0.22));
      if (this.deafness === 0) {
        // Finish at EXACT dry/unity values in finite time. Keep filter state
        // continuous in the muted branch; do not sweep poles through Nyquist.
        const end = t + HEARING_SETTLE_SECONDS;
        this._fadeHearing(0, end);
        this.muffleLP.frequency.setTargetAtTime(20000, t, 0.25);
        this.muffleHS.gain.setTargetAtTime(0, t, 0.25);
        holdHearingParam(this.muffleGain.gain, t);
        this.muffleGain.gain.linearRampToValueAtTime(1, end);
      } else {
        const cutoff = 20000 * Math.pow(CONCUSSION_CUTOFF_RATIO, this.deafness);
        this.muffleLP.frequency.setTargetAtTime(clamp(cutoff, 1200, 20000), t, 0.25);
        this.muffleHS.gain.setTargetAtTime(-8 * this.deafness, t, 0.25);
        this.muffleGain.gain.setTargetAtTime(1 - 0.3 * this.deafness, t, 0.25);
      }
    }

    if (this._tin) {
      if (t > this._tin.until - 3.5) this._tin.g.gain.setTargetAtTime(0, t, 1.1);
      if (t > this._tin.until) {
        for (const n of this._tin.nodes) {
          try {
            n.stop?.(t);
          } catch {
            /* already stopped */
          }
          n.disconnect();
        }
        this._tin.g.disconnect();
        this._tin = null;
      }
    }
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp(v, 0, 1);
    this.masterGain.gain.setTargetAtTime(this.masterVolume, this.actx.currentTime, 0.03);
  }

  setBusVolume(name: string, v: number): void {
    const b = this.buses[name as BusName];
    if (!b) return;
    b.volume = clamp(v, 0, 2);
    this._setBusLevel(b, 0.05);
  }

  /** Balance, user volume and ducking share one gain; a mute always wins. */
  _setBusLevel(b: MixerBus, smooth: number): void {
    b.level.gain.setTargetAtTime(
      b.baseTrim * b.volume * (1 - b.duckAmount),
      this.actx.currentTime,
      smooth
    );
  }

  dispose(): void {
    this._pendingConcussion = null;
    if (this._tin) {
      for (const n of this._tin.nodes) {
        try {
          n.stop?.();
        } catch {
          /* noop */
        }
        n.disconnect();
      }
      this._tin.g.disconnect();
      this._tin = null;
    }
    for (const name of Object.keys(this.spaces) as SpaceName[]) {
      const space = this.spaces[name];
      if (!space) continue;
      space.conv.disconnect();
      space.conv.buffer = null;
      space.gain.disconnect();
    }
    this.spaces = {};
    for (const name of Object.keys(this.buses) as BusName[]) {
      const b = this.buses[name];
      b.level.disconnect();
      b.comp?.disconnect();
    }
    this.reverbSend.disconnect();
    this.sendHP.disconnect();
    this.sendLP.disconnect();
    this.reverbReturn.disconnect();
    this.worldSum.disconnect();
    this.muffleLP.disconnect();
    this.muffleHS.disconnect();
    this.muffleGain.disconnect();
    this.muffleDry.disconnect();
    this.muffleWet.disconnect();
    this.masterSum.disconnect();
    this.energyMix.onprocessorerror = null;
    this.energyMix.port.postMessage('stop');
    this.energyMix.disconnect();
    this.energyMix.port.close();
    this.masterGain.disconnect();
  }
}
