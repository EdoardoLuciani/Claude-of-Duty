import type { ElementPool, PoolRecord } from './pool-types.ts';
import { Pool, ease, clamp01 } from './util.ts';

export const SEG = 7;
export const SEG_STEP = 8.2; // degrees between segment centres
export const SEG_ARC = 8.9; // degrees each segment covers (slight overlap = solid arc)
export const R_MAIN = 112;

/** World-relative damage direction and fade state; no DOM presenter. */
export class DamageArcs {
  readonly visuals = Array.from(
    { length: 6 },
    (): { rotation: number; scale: number; alpha: number } => ({ rotation: 0, scale: 1, alpha: 0 })
  );
  readonly pool: ElementPool<null> = new Pool(6, (): null => null);
  life = 2;

  /**
   * @param {number} dx world X of the direction player -> source (need not be unit)
   * @param {number} dz world Z of that direction
   * @param {number} intensity 0..1, scales opacity and the spawn punch
   */
  spawn(dx: number, dz: number, intensity = 1): PoolRecord<null> {
    const len = Math.hypot(dx, dz) || 1;
    const it = this.pool.acquire();
    it.life = this.life;
    it.a = dx / len;
    it.b = dz / len;
    it.c = clamp01(intensity);
    return it;
  }

  /** Basis vectors are the camera's right/forward projected to XZ. */
  update(dt: number, rx: number, rz: number, fx: number, fz: number): void {
    const items = this.pool.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.alive) continue;
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) {
        this.pool.release(it);
        continue;
      }
      const deg = (Math.atan2(it.a * rx + it.b * rz, it.a * fx + it.b * fz) * 180) / Math.PI;
      // punch in fast, hold, then a long tail — 2s total
      const inT = clamp01(it.t / 0.09);
      const scale = 0.92 + 0.08 * ease.outQuint(inT);
      const hold = clamp01((u - 0.18) / 0.82);
      const alpha = (0.35 + 0.65 * it.c) * (1 - ease.inQuad(hold)) * ease.outQuad(inT);
      const visual = this.visuals[i];
      visual.rotation = (deg * Math.PI) / 180;
      visual.scale = scale;
      visual.alpha = alpha;
    }
  }

  clear(): void {
    this.pool.releaseAll();
  }
}
