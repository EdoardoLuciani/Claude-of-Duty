import { Pool, ease, clamp01 } from './util.ts';

export const KILLFEED_CAPACITY = 6;

interface KillfeedEvent {
  attacker?: string;
  victim?: string;
  headshot?: boolean;
  mine?: boolean;
  attackerFriendly?: boolean;
}
interface KillfeedRow {
  attacker: string;
  victim: string;
  headshot: boolean;
  mine: boolean;
  attackerFriendly: boolean;
  sequence: number;
  x: number;
  alpha: number;
}

/** Six bounded rows, newest first, with the original 5.6s lifetime. */
export class Killfeed {
  readonly pool = new Pool(KILLFEED_CAPACITY, (): null => null);
  readonly rows = Array.from({ length: KILLFEED_CAPACITY }, (): KillfeedRow => ({
    attacker: '',
    victim: '',
    headshot: false,
    mine: false,
    attackerFriendly: true,
    sequence: 0,
    x: 26,
    alpha: 0,
  }));
  life = 5.6;
  private sequence = 0;
  push(e: KillfeedEvent): (typeof this.pool.items)[number] {
    const it = this.pool.acquire();
    it.life = this.life;
    const row = this.rows[it.i];
    row.attacker = (e.attacker ?? 'UNKNOWN').toUpperCase();
    row.victim = (e.victim ?? 'UNKNOWN').toUpperCase();
    row.headshot = !!e.headshot;
    row.mine = !!e.mine;
    row.attackerFriendly = e.attackerFriendly !== false;
    row.sequence = ++this.sequence;
    return it;
  }
  update(dt: number): void {
    for (const it of this.pool.items) {
      if (!it.alive) continue;
      it.t += dt;
      if (it.t >= it.life) {
        this.pool.release(it);
        continue;
      }
      const inT = clamp01(it.t / 0.16),
        outT = clamp01((it.t - (it.life - 0.45)) / 0.45),
        row = this.rows[it.i];
      row.x = Number(((1 - ease.outQuint(inT)) * 26).toFixed(2));
      row.alpha = Number((ease.outQuad(inT) * (1 - ease.inQuad(outT))).toFixed(3));
    }
  }
  clear(): void {
    this.pool.releaseAll();
  }
}
