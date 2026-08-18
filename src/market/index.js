/*
 * MARKET — between-wave supply shop.
 *
 * Owns the run's credits economy and the shop session. Credits mirror the
 * score's rewards 1:1 (score:change deltas: kills, headshots, wave bonuses)
 * but are a separate pool: score is the run's record, credits are the shop's
 * fuel.
 *
 * Every wave clear arms a 10 s grace period (time to collect ammo), then the
 * shop opens and freezes the sim clock (time.scale = 0), which also holds the
 * AI wave countdown — no AI code needs to know the market exists. One session
 * per wave; the player leaves with Skip/Esc.
 *
 * PUBLIC API — `const market = ctx.get('market')`
 *   market.credits
 *   market.open
 *   market.openShop() / market.closeShop()
 *   market.buy(itemId)      -> boolean — applies instantly
 *   market.getHudState()    -> { credits, marketIn, items:[{id,label,
 *                               cost,level,max,step,unit,affordable}] }
 *                               (pooled, copy on read)
 *
 * Events consumed: score:change, wave:complete, game:restart.
 * Events emitted:  market:open {wave}, market:close.
 */

/** Grace period after a wave clear before the shop opens: time to collect
 *  ammo and breathe. The AI wave delay (20 s) is longer than this window, so
 *  the shop always opens before the next wave — and freezing time on open
 *  holds whatever countdown remains. */
export const MARKET_DELAY = 10;

/** One catalog row per buyable item. `step` is the purchase granularity and
 *  the display unit (a plate is 50 HP; a pack is 1 grenade). */
const CATALOG = [
  { id: 'grenade', label: 'Grenade Pack', cost: 200, step: 1, max: 6 },
  { id: 'armour', label: 'Armour Plate', cost: 250, step: 50, max: 150 },
  // Ammo sells in one whole refill; `unit: 'pct'` makes the overlay show the
  // aggregate reserve as a percentage instead of a count.
  { id: 'ammo', label: 'Ammo Refill', cost: 300, step: 100, max: 100, unit: 'pct' },
  { id: 'carpet', label: 'Carpet Bomb', cost: 1500, step: 1, max: 3 },
  // Primary slot: buying the LMG replaces the M4 (and back).
  { id: 'lmg', label: 'EVOLYS-7.62', cost: 1200, step: 1, max: 1 },
  { id: 'rifle', label: 'M4A1', cost: 900, step: 1, max: 1 },
  { id: 'shotgun', label: 'M-590', cost: 1000, step: 1, max: 1 },
  { id: 'smg', label: 'MPX-9', cost: 800, step: 1, max: 1 },
  { id: 'sniper', label: 'AX-338', cost: 1500, step: 1, max: 1 },
];

export class MarketSystem {
  static id = 'market';
  static deps = ['weapons', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this.weapons = ctx.get('weapons');
    this.player = ctx.get('player');
    this.health = this.player.health;
    this.credits = 0;
    this.open = false;
    this.delay = MARKET_DELAY;
    /** When the shop should open (ctx.time.elapsed), 0 when not pending. */
    this._marketAt = 0;
    this._pendingWave = 0;

    // Preallocated HUD snapshot, pooled like every other subsystem's.
    this._hud = {
      credits: 0,
      marketIn: 0,
      items: CATALOG.map((c) => ({
        id: c.id, label: c.label, cost: c.cost, max: c.max, step: c.step,
        unit: c.unit ?? '', level: 0, affordable: false,
      })),
    };

    this._off = [];
    const on = (type, fn) => this._off.push(ctx.events.on(type, fn));

    // Credits mirror the score's rewards 1:1 (kills, headshots, wave bonuses
    // — see score:change in ARCHITECTURE.md); spending is the only divergence.
    on('score:change', (e) => {
      this.credits += Math.max(0, e?.delta ?? 0);
    });

    on('wave:complete', (e) => {
      const wave = Math.max(1, e?.wave | 0);
      // Arm the grace period; the shop opens from update() once it elapses.
      this._pendingWave = wave;
      this._marketAt = this.ctx.time.elapsed + MARKET_DELAY;
    });

    on('game:restart', () => this.reset());
  }

  _level(itemId) {
    if (itemId === 'grenade') return this.weapons.grenades;
    if (itemId === 'armour') return this.health.armour;
    if (itemId === 'ammo') return Math.round(this.weapons.ammoFraction() * 100);
    if (itemId === 'carpet') return this.weapons.carpetBombs;
    if (itemId === 'lmg' || itemId === 'rifle' || itemId === 'sniper' || itemId === 'shotgun' || itemId === 'smg') return this.weapons.owns(itemId) ? 1 : 0;
    return 0;
  }

  /** Engine update hook: open the shop once the grace period elapses. */
  update() {
    if (this._marketAt <= 0 || this.open) return;
    // The field is quiet after a clear, but a stray blast can still kill the
    // player mid-window — never open the shop over the death screen.
    if (this.player.dead) return;
    if (this.ctx.time.elapsed >= this._marketAt) {
      this.openShop(this._pendingWave);
      this._marketAt = 0;
    }
  }

  /** Freeze the run and open the shop. `wave` is the wave just cleared. */
  openShop(wave = 0) {
    if (this.open) return;
    this.open = true;
    this._prevScale = this.ctx.time.scale;
    this._prevControl = this.player.controlEnabled;
    this.ctx.time.scale = 0;
    this.player.setControlEnabled(false);
    this.ctx.events.emit('market:open', { wave });
  }

  /** Resume the run. The wave countdown continues where it froze. */
  closeShop() {
    if (!this.open) return;
    this.open = false;
    this.ctx.time.scale = this._prevScale ?? 1;
    this.player.setControlEnabled(this._prevControl);
    this.ctx.events.emit('market:close', {});
  }

  /** Buy one unit when the shop is open and the player can afford it. */
  buy(itemId) {
    if (!this.open) return false;
    const item = CATALOG.find((c) => c.id === itemId);
    if (!item || this._level(itemId) >= item.max || this.credits < item.cost) return false;
    this.credits -= item.cost;
    if (itemId === 'grenade') this.weapons.addGrenades(item.step);
    else if (itemId === 'armour') this.health.addArmour(item.step);
    else if (itemId === 'ammo') this.weapons.refillAmmo();
    else if (itemId === 'carpet') this.weapons.addCarpetBombs(item.step);
    else if (itemId === 'shotgun' || itemId === 'smg') this.weapons.equipSecondary(itemId);
    else this.weapons.equipPrimary(itemId);
    return true;
  }

  /** Stable, allocation-free snapshot polled by the HUD and the shop overlay. */
  getHudState() {
    const h = this._hud;
    h.credits = this.credits;
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
