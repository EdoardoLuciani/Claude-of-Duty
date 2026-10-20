import { LookaheadPeakGain } from './peak.ts';

/** Shared mix tuning, not per-weapon gain or automatic quiet-scene boosting. */
export const ENERGY_MIX = {
  maxGain: 1,
  targetRms: 0.28,
  windowMs: 20,
  attackMs: 3,
  releaseMs: 250,
  lookaheadMs: 5,
} as const;

/** Shared lookahead, parallel RMS/peak detectors, one stereo-linked gain.
 * The tighter constraint wins; multiplying two independent gain reductions
 * would unnecessarily attenuate audio already contained by the RMS envelope. */
export class EnergyPeakController {
  private readonly powersL: Float64Array;
  private readonly powersR: Float64Array;
  private readonly delayL: Float32Array;
  private readonly delayR: Float32Array;
  private readonly peak: LookaheadPeakGain;
  private readonly attack: number;
  private readonly release: number;
  private powerIndex = 0;
  private delayIndex = 0;
  private sumL = 0;
  private sumR = 0;
  gain: number = ENERGY_MIX.maxGain;

  constructor(sampleRate: number) {
    const window = Math.max(1, Math.round((sampleRate * ENERGY_MIX.windowMs) / 1000));
    const delay = Math.max(1, Math.round((sampleRate * ENERGY_MIX.lookaheadMs) / 1000));
    this.powersL = new Float64Array(window);
    this.powersR = new Float64Array(window);
    this.delayL = new Float32Array(delay);
    this.delayR = new Float32Array(delay);
    this.peak = new LookaheadPeakGain(sampleRate, delay);
    this.attack = Math.exp(-1 / (sampleRate * ENERGY_MIX.attackMs * 0.001));
    this.release = Math.exp(-1 / (sampleRate * ENERGY_MIX.releaseMs * 0.001));
  }

  /** No allocations, messages or frame-rate-dependent state in the render loop. */
  process(
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    outL: Float32Array,
    outR: Float32Array,
    energyL?: Float32Array,
    energyR?: Float32Array
  ): void {
    const size = this.powersL.length;
    for (let i = 0; i < outL.length; i++) {
      const l = left?.[i] ?? 0;
      const r = right?.[i] ?? l;
      const pL = l * l;
      const pR = r * r;
      this.sumL += pL - this.powersL[this.powerIndex];
      this.sumR += pR - this.powersR[this.powerIndex];
      this.powersL[this.powerIndex] = pL;
      this.powersR[this.powerIndex] = pR;
      this.powerIndex = (this.powerIndex + 1) % size;

      // The hotter channel controls BOTH channels: preserve stereo/HRTF balance,
      // including opposite-polarity signals that a mono detector would cancel.
      const rms = Math.sqrt(Math.max(0, this.sumL, this.sumR) / size);
      const target = Math.min(ENERGY_MIX.maxGain, ENERGY_MIX.targetRms / Math.max(rms, 1e-12));
      const smoothing = target < this.gain ? this.attack : this.release;
      this.gain = target + (this.gain - target) * smoothing;

      const peakGain = this.peak.next(l, r);
      const applied = Math.min(this.gain, peakGain);
      const delayedL = this.delayL[this.delayIndex];
      const delayedR = this.delayR[this.delayIndex];
      // Auxiliary native output exposes the actual RMS-only signal for review.
      if (energyL) energyL[i] = delayedL * this.gain;
      if (energyR) energyR[i] = delayedR * this.gain;
      outL[i] = delayedL * applied;
      outR[i] = delayedR * applied;
      this.delayL[this.delayIndex] = l;
      this.delayR[this.delayIndex] = r;
      this.delayIndex = (this.delayIndex + 1) % this.delayL.length;
    }
  }
}
