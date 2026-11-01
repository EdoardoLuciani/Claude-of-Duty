import type { ElementPool, PoolRecord } from './pool-types.ts';
import { Pool, ease, clamp01 } from './util.ts';

export const R_IN = 13; // well outside the reticle blades, so the two never merge
export const R_OUT = 28.5;

/** kind -> { colour, weight, scale, life, ring } */
export type HitmarkerKind = 'hit' | 'armour' | 'head' | 'kill';

interface HitmarkerStyle {
  c: string;
  w: number;
  s: number;
  life: number;
  ring: number;
  spin: number;
}

export const KINDS: Record<HitmarkerKind, HitmarkerStyle> = {
  hit: { c: '#f6fafc', w: 1.8, s: 1.0, life: 0.26, ring: 0, spin: 0 },
  armour: { c: '#8fdcff', w: 2.0, s: 1.03, life: 0.28, ring: 0.5, spin: 0 },
  head: { c: '#ffc247', w: 2.2, s: 1.08, life: 0.32, ring: 0.3, spin: 0 },
  kill: { c: '#ff4433', w: 2.7, s: 1.18, life: 0.42, ring: 1, spin: 9 },
};

/**
 * Hitmarkers.
 *
 * Timing is the whole point: 0-40ms the X snaps in past its rest size
 * (outBack), 40-120ms it settles, then it holds bright and fades. Anything
 * slower than this feels like a notification instead of a hit.
 */
export class Hitmarkers {
  readonly visuals = Array.from(
    { length: 10 },
    (): {
      kind: HitmarkerKind;
      scale: number;
      alpha: number;
      rotation: number;
      ringScale: number;
      ringAlpha: number;
    } => ({
      kind: 'hit' as HitmarkerKind,
      scale: 1,
      alpha: 0,
      rotation: 0,
      ringScale: 1,
      ringAlpha: 0,
    })
  );
  readonly pool: ElementPool<null> = new Pool(10, (): null => null);

  /** @param {'hit'|'armour'|'head'|'kill'} kind */
  spawn(kind: HitmarkerKind = 'hit'): PoolRecord<null> {
    const k = KINDS[kind] ?? KINDS.hit;
    const it = this.pool.acquire();
    it.life = k.life;
    it.a = k.s;
    it.b = k.ring;
    it.c = k.spin;
    this.visuals[it.i].kind = kind in KINDS ? kind : 'hit';
    return it;
  }

  update(dt: number): void {
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
      // snap in over the first 34% of life, then hold, then fall off
      const inT = clamp01(u / 0.34);
      const scale = it.a * (0.62 + 0.38 * ease.outBack(inT));
      const alpha = u < 0.55 ? 1 : 1 - ease.inOutSine((u - 0.55) / 0.45);
      const rot = it.c * ease.outCubic(inT);
      const visual = this.visuals[i];
      visual.scale = scale;
      visual.alpha = alpha;
      visual.rotation = (rot * Math.PI) / 180;
      const rt = clamp01(u / 0.6);
      visual.ringScale = 0.55 + 1.15 * ease.outQuint(rt);
      visual.ringAlpha = it.b * (1 - ease.outQuad(rt));
    }
  }

  clear(): void {
    this.pool.releaseAll();
  }
}
