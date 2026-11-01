import { el, setText, clamp, Pool } from './util.ts';

export const SPAN_DEG = 120;
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
  readonly pingPool = new Pool(8, (): null => null);
  ping(bearing: number): void {
    const it = this.pingPool.acquire();
    it.a = bearing;
    it.life = 1.25;
  }
  update(heading: number, dt: number): void {
    this.heading = ((heading % 360) + 360) % 360;
    for (let i = 0; i < this.pingPool.items.length; i++) {
      const it = this.pingPool.items[i];
      if (!it.alive) continue;
      it.t += dt;
      if (it.t >= it.life) {
        this.pingPool.release(it);
        continue;
      }
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
  declare root: HTMLElement;
  declare score: HTMLElement;
  declare wave: HTMLElement;
  declare credits: HTMLElement;
  declare status: HTMLElement;
  constructor(parent: HTMLElement) {
    this.root = el('div', 'ow-scorebar', parent);

    const scoreGroup = el('div', 'group score-group', this.root);
    el('span', 'label', scoreGroup, 'SCORE');
    this.score = el('b', 'score', scoreGroup, '000000');

    el('div', 'sep', this.root);
    const waveGroup = el('div', 'group', this.root);
    el('span', 'label', waveGroup, 'WAVE');
    this.wave = el('b', 'wave', waveGroup, '1');

    el('div', 'sep', this.root);
    const creditGroup = el('div', 'group', this.root);
    el('span', 'label', creditGroup, 'CREDITS');
    this.credits = el('b', 'credits', creditGroup, '000000');

    el('div', 'sep', this.root);
    this.status = el('div', 'status', this.root, '6 HOSTILES');
  }

  update(s: ScoreState): void {
    setText(this.score, String(Math.max(0, Math.round(s.score ?? 0))).padStart(6, '0'));
    setText(this.wave, Math.max(0, Math.round(s.wave ?? 0)));
    setText(this.credits, String(Math.max(0, Math.round(s.credits ?? 0))).padStart(6, '0'));
    if ((s.marketIn ?? 0) > 0) {
      // The shop countdown owns the strip while it runs; NEXT WAVE returns
      // after the market closes (its timer froze mid-countdown).
      setText(this.status, `SUPPLIES IN ${s.marketIn}s`);
    } else if (s.waveIncoming) {
      setText(this.status, `NEXT WAVE ${Math.max(0, Math.ceil(s.nextWaveIn ?? 0))}s`);
    } else {
      const n = Math.max(0, Math.round(s.enemiesRemaining ?? 0));
      setText(this.status, `${n} ${n === 1 ? 'HOSTILE' : 'HOSTILES'}`);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
