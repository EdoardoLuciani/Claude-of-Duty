/** Sparse finite environmental recordings and distant combat; no continuous bed. */
import type { Rng } from '../core/rng.ts';
import { clamp } from './dsp.ts';
export { ENVIRONMENT_KINDS as ONE_SHOTS } from './environment.ts';
interface AmbientTimers {
  volley: number;
  boom: number;
  oneshot: number;
}
interface AmbientApi {
  distantVolley?(): void;
  distantBoom?(): void;
  oneShot?(): void;
}

export class Ambience {
  rng: Rng;
  started = false;
  intensity = 0.65;
  _timers: AmbientTimers = { volley: 4, boom: 18, oneshot: 6 };
  constructor(rng: Rng) {
    this.rng = rng;
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this._reseedTimers();
  }
  _reseedTimers(): void {
    const r = this.rng;
    this._timers.volley = r.range(3, 11);
    this._timers.boom = r.range(14, 44);
    this._timers.oneshot = r.range(5, 17);
  }
  update(dt: number, api?: AmbientApi): void {
    if (!this.started) return;
    const r = this.rng,
      T = this._timers;
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
    // No invented tactical calls at phantom actors. Suitable isolated distant
    // human activity is still a source gap; silence is preferable to wrong speech.
  }
  dispose(): void {
    this.started = false;
  }
}

// Preserve existing event references; the recorded bank owns per-category trims.
export const AMBIENT_EVENT_GAIN = { near: 2.5, heli: 2.5, siren: 14 } as const;
