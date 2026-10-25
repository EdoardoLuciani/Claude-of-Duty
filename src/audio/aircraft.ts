import { gain } from './dsp.ts';
import type { SpatialField } from './spatial.ts';

export const AIRCRAFT_URLS = [
  new URL('./samples/aircraft/propeller-1.opus', import.meta.url).href,
  new URL('./samples/aircraft/propeller-2.opus', import.meta.url).href,
] as const;
export const AIRCRAFT_MIX = {
  gain: 12.5,
  send: 0.08,
  priority: 0.65,
  fadeIn: 0.35,
  fadeOut: 0.25,
  pauseFade: 0.08,
  positionSmooth: 0.035,
} as const;
export interface AircraftPosition {
  x: number;
  y: number;
  z: number;
}
type AircraftEmitter = NonNullable<ReturnType<SpatialField['acquire']>>;

/** One recorded loop in the existing tracked spatial pool. No timers/fetches. */
export class AircraftVoice {
  actx: BaseAudioContext;
  emitter: AircraftEmitter;
  source: AudioBufferSourceNode;
  node: GainNode;
  startTime: number;
  ended = false;
  stopping = false;
  paused = false;

  constructor(
    actx: BaseAudioContext,
    field: SpatialField,
    emitter: AircraftEmitter,
    buffer: AudioBuffer,
    when: number
  ) {
    this.actx = actx;
    this.emitter = emitter;
    this.startTime = when;
    this.node = gain(actx, 0);
    this.source = actx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.loopStart = 0;
    this.source.loopEnd = buffer.duration;
    this.source.connect(this.node);
    field.hold(emitter, this.node, Infinity);
    this.source.onended = (): void => this._finish();
    this.node.gain.setValueAtTime(0, when);
    this.node.gain.linearRampToValueAtTime(1, when + AIRCRAFT_MIX.fadeIn);
    try {
      this.source.start(when);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  move(position: AircraftPosition, paused = false): void {
    if (this.stopping || this.ended || !Number.isFinite(position.x + position.y + position.z))
      return;
    this.emitter.moveTo(position.x, position.y, position.z, AIRCRAFT_MIX.positionSmooth);
    this.setPaused(paused);
  }

  setPaused(paused: boolean): void {
    if (this.ended || this.stopping || paused === this.paused) return;
    this.paused = paused;
    this._fade(paused ? 0 : 1, AIRCRAFT_MIX.pauseFade);
  }

  _fade(level: number, seconds: number): void {
    const now = this.actx.currentTime;
    const current = this.node.gain.value;
    this.node.gain.cancelScheduledValues(now);
    this.node.gain.setValueAtTime(current, now);
    const start = level > 0 ? Math.max(now, this.startTime) : now;
    if (start > now) this.node.gain.setValueAtTime(current, start);
    this.node.gain.linearRampToValueAtTime(level, start + seconds);
  }

  stop(): void {
    if (this.stopping || this.ended) return;
    this.stopping = true;
    this._fade(0, AIRCRAFT_MIX.fadeOut);
    this.source.stop(this.actx.currentTime + AIRCRAFT_MIX.fadeOut);
    // Keep the fade in the pool's normal finite retirement path. A stolen slot
    // cannot be detached by our later onended callback (identity checked below).
    this.emitter.tracked = false;
    this.emitter.endTime = this.actx.currentTime + AIRCRAFT_MIX.fadeOut + 0.02;
  }

  _finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.source.onended = null;
    this.source.disconnect();
    this.node.disconnect();
    if (this.emitter.attached === this.node) this.emitter.detach();
  }

  /** Immediate shutdown for graph disposal/terminal errors, even during a fade. */
  dispose(): void {
    if (this.ended) return;
    try {
      this.source.stop();
    } catch {
      /* source may not have started */
    }
    this._finish();
  }
}
