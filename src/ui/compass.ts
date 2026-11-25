import { clamp } from '../core/math.ts';
import { Pool } from './util.ts';

const SPAN_DEG = 120;
export const STRIP_W = 470;
export const PPD = STRIP_W / SPAN_DEG;
export const CARD: Record<number, string> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

/** Heading/heard-ping state; Pixi owns strip layout and rendering. */
export class Compass {
  heading = 0;
  readonly pings = Array.from({ length: 8 }, (): { x: number; alpha: number } => ({
    x: 0,
    alpha: 0,
  }));
  readonly pingPool = new Pool(8);
  ping(bearing: number): void {
    const it = this.pingPool.acquire();
    it.a = bearing;
    it.life = 1.25;
  }
  update(heading: number, dt: number): void {
    this.heading = ((heading % 360) + 360) % 360;
    for (let i = 0; i < this.pingPool.items.length; i++) {
      const it = this.pingPool.items[i];
      if (!this.pingPool.advance(it, dt)) continue;
      let rel = it.a - this.heading;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      this.pings[i].x = clamp(rel * PPD, -STRIP_W * 0.5 + 8, STRIP_W * 0.5 - 8);
      this.pings[i].alpha = 1 - it.t / it.life;
    }
  }
}
interface ScoreState {
  score?: number;
  wave?: number;
  credits?: number;
  marketIn?: number;
  waveIncoming?: boolean;
  nextWaveIn?: number;
  enemiesRemaining?: number;
}
/** Survival run status: one player score, current wave and enemy count. */
export class ScoreBar {
  visible = true;
  score = '000000';
  wave = '1';
  credits = '000000';
  status = '6 HOSTILES';
  update(s: ScoreState): void {
    this.score = String(Math.max(0, Math.round(s.score ?? 0))).padStart(6, '0');
    const wave = Math.max(0, Math.round(s.wave ?? 0));
    const opening = wave === 0 && s.waveIncoming;
    this.wave = opening ? '1' : String(wave);
    this.credits = String(Math.max(0, Math.round(s.credits ?? 0))).padStart(6, '0');
    if ((s.marketIn ?? 0) > 0) this.status = `SUPPLIES IN ${s.marketIn}s`;
    else if (s.waveIncoming) {
      const label = opening ? 'WAVE 1 IN' : 'NEXT WAVE';
      this.status = `${label} ${Math.max(0, Math.ceil(s.nextWaveIn ?? 0))}s`;
    } else {
      const n = Math.max(0, Math.round(s.enemiesRemaining ?? 0));
      this.status = `${n} ${n === 1 ? 'HOSTILE' : 'HOSTILES'}`;
    }
  }
}
