/*
 * MARKET — between-wave supply shop.
 *
 * Owns the run's credits economy and the shop session. Credits are earned at
 * the same rates as the survival score (see SCORE in game/index.js) but are a
 * separate pool: score is the run's record, credits are the shop's fuel.
 *
 * Every wave clear arms a 10 s grace period (time to collect ammo), then
 * opens the shop. While it is open the simulation clock is frozen
 * (time.scale = 0), which also holds the AI wave countdown — no AI code
 * needs to know the market exists. The shop closes on player action
 * (Skip/Esc); it never auto-closes, and there is one session per wave.
 *
 * PUBLIC API — `const market = ctx.get('market')`
 *   market.credits
 *   market.open
 *   market.openShop() / market.closeShop()
 *   market.buy(itemId)      -> { ok, reason } — applies instantly
 *   market.getHudState()    -> { credits, open, items:[{id,label,cost,level,
 *                               max,step,affordable}] } (pooled, copy on read)
 *
 * Events consumed: damage:dealt, wave:complete, game:restart.
 * Events emitted:  market:open {wave}, market:close, market:purchase
 *                  { item, cost, credits }.
 */

import { SCORE } from '../game/index.js';

/** Grace period after a wave clear before the shop opens: time to collect
 *  ammo and breathe. The AI wave delay (20 s) is longer than this window, so
 *  the shop always opens before the next wave — and freezing time on open
 *  holds whatever countdown remains. */
export const MARKET_DELAY = 10;

/** One catalog row per buyable item. `step` is the purchase granularity and
 *  the display unit (a plate is 50 HP; a pack is 1 grenade). */
const CATALOG = [
  { id: 'grenade', label: 'Grenade Pack', cost: 300, step: 1, max: 6 },
  { id: 'armour', label: 'Armour Plate', cost: 250, step: 50, max: 150 },
];

export class MarketSystem {
  static id = 'market';
  static deps = ['weapons', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this.credits = 0;
    this.open = false;
    this.catalog = CATALOG;
    /** When the shop should open (ctx.time.elapsed), 0 when not pending. */
    this._marketAt = 0;
    this._pendingWave = 0;

    // Preallocated HUD snapshot, pooled like every other subsystem's.
    this._hud = {
      credits: 0,
      open: false,
      marketIn: 0,
      items: CATALOG.map((c) => ({
        id: c.id, label: c.label, cost: c.cost, max: c.max, step: c.step,
        level: 0, affordable: false,
      })),
    };

    this._off = [];
    const on = (type, fn) => this._off.push(ctx.events.on(type, fn));

    // Kills pay credits at the same rates as score. The payload is marked
    // `killed` by the AI before emission, so listener order is irrelevant.
    on('damage:dealt', (e) => {
      const target = e?.target;
      if (!e?.killed || !target || this._isPlayerTarget(target)) return;
      if (target.staged || target.silentDeath || target.friendly || target.team === 0) return;
      this.credits += SCORE.elimination + (e.headshot ? SCORE.headshot : 0);
    });

    on('wave:complete', (e) => {
      const wave = Math.max(1, e?.wave | 0);
      this.credits += wave * SCORE.wave;
      // Arm the grace period; the shop opens from update() once it elapses.
      this._pendingWave = wave;
      this._marketAt = this.ctx.time.elapsed + MARKET_DELAY;
    });

    on('game:restart', () => this.reset());
  }

  _isPlayerTarget(target) {
    return target === 'player' || target === this.ctx.peek('player') || target.isPlayer === true;
  }

  _level(itemId) {
    if (itemId === 'grenade') return this.ctx.get('weapons')?.grenades ?? 0;
    if (itemId === 'armour') return this.ctx.get('player')?.health?.armour ?? 0;
    return 0;
  }

  /** Engine update hook: open the shop once the grace period elapses. */
  update() {
    if (this._marketAt <= 0 || this.open) return;
    // The field is quiet after a clear, but a stray blast can still kill the
    // player mid-window — never open the shop over the death screen.
    if (this.ctx.peek('player')?.dead) return;
    if (this.ctx.time.elapsed >= this._marketAt) {
      this.openShop(this._pendingWave);
      this._marketAt = 0;
    }
  }

  /** Freeze the run and open the shop. `wave` is the wave just cleared. */
  openShop(wave = 0) {
    if (this.open) return;
    this.open = true;
    this.ctx.time.scale = 0;
    this.ctx.events.emit('market:open', { wave });
  }

  /** Resume the run. The wave countdown continues where it froze. */
  closeShop() {
    if (!this.open) return;
    this.open = false;
    this.ctx.time.scale = 1;
    this.ctx.events.emit('market:close', {});
  }

  /**
   * Buy one unit of an item. Validates session, cap and balance; applies the
   * purchase instantly. Returns { ok:false, reason } or { ok:true }.
   */
  buy(itemId) {
    if (!this.open) return { ok: false, reason: 'closed' };
    const item = CATALOG.find((c) => c.id === itemId);
    if (!item) return { ok: false, reason: 'unknown' };
    if (this._level(itemId) >= item.max) return { ok: false, reason: 'max' };
    if (this.credits < item.cost) return { ok: false, reason: 'credits' };
    this.credits -= item.cost;
    if (itemId === 'grenade') this.ctx.get('weapons').addGrenades(item.step);
    else this.ctx.get('player').addArmour(item.step);
    this.ctx.events.emit('market:purchase', {
      item: itemId, cost: item.cost, credits: this.credits,
    });
    return { ok: true };
  }

  /** Stable, allocation-free snapshot polled by the HUD and the shop overlay. */
  getHudState() {
    const h = this._hud;
    h.credits = this.credits;
    h.open = this.open;
    h.marketIn = this._marketAt > 0 && !this.open
      ? Math.max(0, Math.ceil(this._marketAt - this.ctx.time.elapsed))
      : 0;
    const items = h.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lvl = this._level(it.id);
      it.level = lvl;
      it.affordable = lvl < it.max && this.credits >= it.cost;
    }
    return h;
  }

  reset() {
    this.credits = 0;
    this._marketAt = 0;
    this._pendingWave = 0;
    this.closeShop(); // restores time.scale even if a session was open
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
  }
}
