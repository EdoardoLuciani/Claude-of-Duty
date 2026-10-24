/** Peak safety tuning, separate from the sustained-energy target. */
export const PEAK_LIMITER = { ceiling: 0.99, releaseMs: 80 } as const;

/** Linked gain envelope for audio delayed by exactly lookaheadSamples.
 * The sliding maximum includes that delayed sample and all its known future.
 * Instant internal attenuation + a full-lookahead moving average gives a smooth
 * anticipatory attack: by the time a peak exits the delay, EVERY averaged gain
 * already respects its ceiling. No sample clipping or emergency clamp is used.
 */
export class LookaheadPeakGain {
  private readonly peaks: Float64Array;
  private readonly frames: Float64Array;
  private readonly smoothing: Float64Array;
  private readonly recovery: number;
  private readonly lookaheadSamples: number;
  private head = 0;
  private tail = 0;
  private frame = 0;
  private cursor = 0;
  private held = 1;
  private sum: number;
  private sumError = 0;

  constructor(sampleRate: number, lookaheadSamples: number) {
    if (!Number.isInteger(lookaheadSamples) || lookaheadSamples < 1)
      throw new RangeError('Peak lookahead must be a positive sample count');
    this.lookaheadSamples = lookaheadSamples;
    this.peaks = new Float64Array(lookaheadSamples + 2);
    this.frames = new Float64Array(lookaheadSamples + 2);
    this.smoothing = new Float64Array(lookaheadSamples).fill(1);
    this.sum = lookaheadSamples;
    this.recovery = 1 - Math.exp(-1 / (sampleRate * PEAK_LIMITER.releaseMs * 0.001));
  }

  next(left: number, right: number): number {
    const frame = this.frame++;
    const size = this.peaks.length;
    while (this.head !== this.tail && this.frames[this.head] < frame - this.lookaheadSamples)
      this.head = (this.head + 1) % size;
    const peak = Math.max(Math.abs(left), Math.abs(right));
    while (this.head !== this.tail) {
      const previous = (this.tail + size - 1) % size;
      if (this.peaks[previous] > peak) break;
      this.tail = previous;
    }
    this.peaks[this.tail] = peak;
    this.frames[this.tail] = frame;
    this.tail = (this.tail + 1) % size;

    const required = Math.min(1, PEAK_LIMITER.ceiling / Math.max(this.peaks[this.head], 1e-12));
    this.held = Math.min(required, this.held + (1 - this.held) * this.recovery);
    // Compensated running sum avoids accumulating cancellation error over a match.
    const delta = this.held - this.smoothing[this.cursor] - this.sumError;
    const sum = this.sum + delta;
    this.sumError = sum - this.sum - delta;
    this.sum = sum;
    this.smoothing[this.cursor] = this.held;
    this.cursor = (this.cursor + 1) % this.lookaheadSamples;
    // These bounds constrain the gain envelope, not the audio sample waveform.
    return Math.max(0, Math.min(1, this.sum / this.lookaheadSamples));
  }
}
