import { el, setText, setStyle, damp } from './util.js';

/**
 * Between-wave supply shop overlay.
 *
 * A centered modal over a dimmed world. The simulation clock is frozen while
 * the shop is open (see market/index.js), so this overlay — like the
 * game-over screen — animates on raw wall-clock time, never on dt.
 *
 * Buttons are the purchase confirmation: clicking BUY (or pressing 1-3)
 * applies one unit immediately. The panel stays open until the player
 * explicitly leaves (SKIP or Esc).
 */
export class MarketOverlay {
  constructor(parent, ctx) {
    this.ctx = ctx;
    this.market = ctx.get('market');

    this.root = el('div', 'ow-market', parent);
    const panel = el('div', 'ow-market-panel', this.root);

    this.waveLine = el('div', 'ow-market-wave', panel, '');
    el('div', 'ow-market-title', panel, 'SUPPLY MARKET');
    this.credits = el('div', 'ow-market-credits', panel, 'CREDITS 000000');
    el('div', 'ow-market-rule', panel);

    // One row per catalog item; state is refreshed every frame from the
    // market's pooled HUD snapshot (see MarketSystem.getHudState).
    this.rows = [];
    const items = this.market.getHudState().items;
    for (const item of items) {
      const row = el('div', 'ow-market-row', panel);
      el('div', 'ow-market-name', row, item.label.toUpperCase());
      const count = el('div', 'ow-market-count', row, '');
      el('div', 'ow-market-cost', row, String(item.cost).padStart(3, '0'));
      const btn = el('button', 'ow-market-buy', row, 'BUY');
      btn.type = 'button';
      btn.dataset.item = item.id;
      this.rows.push({ count, btn });
    }

    el('div', 'ow-market-rule', panel);
    const skip = el('button', 'ow-market-skip', panel, 'SKIP ▸');
    skip.type = 'button';
    skip.addEventListener('click', () => this.skip());
    el('div', 'ow-market-hint', panel, 'ESC SKIP · 1-3 BUY ITEMS');

    this.active = false;
    this.shown = 0;
    this.wave = 0;
    this._pulse = 0; // credit readout flash after a purchase

    this._buyKeys = Object.fromEntries(items.map((item, i) => [`Digit${i + 1}`, item.id]));

    // One delegated click listener for every item row.
    this._onClick = (e) => {
      const b = e.target?.closest?.('button[data-item]');
      if (b) this._buy(b.dataset.item);
    };
    this._onKey = (e) => {
      if (!this.active) return;
      const item = this._buyKeys[e.code];
      if (item) {
        e.preventDefault();
        this._buy(item);
      } else if (e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        this.skip();
      }
    };
    this.root.addEventListener('click', this._onClick);
    addEventListener('keydown', this._onKey);

    setStyle(this.root, 'display', 'none');
  }

  show(wave = 0) {
    if (this.active) return;
    this.active = true;
    this.shown = 0;
    this.wave = wave;
    document.exitPointerLock?.();
  }

  hide() {
    this.active = false;
  }

  skip() {
    this.market.closeShop(); // emits market:close -> ui hides this overlay
  }

  _buy(itemId) {
    if (!this.market.buy(itemId)) return;
    this._pulse = 1;
    this.ctx.peek('ui')?.sfx?.('market_buy', 0.9);
  }

  /** Driven from ui.lateUpdate with RAW dt — the sim clock is frozen here. */
  update(rawDt) {
    this.shown = damp(this.shown, this.active ? 1 : 0, this.active ? 8 : 12, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', this.active ? 'auto' : 'none');
    setStyle(this.root, 'opacity', this.shown.toFixed(3));

    // ---- live state -----------------------------------------------------
    const s = this.market.getHudState();
    this._pulse = Math.max(0, this._pulse - rawDt * 3);
    const cred = String(Math.max(0, Math.round(s.credits))).padStart(6, '0');
    setText(this.credits, `CREDITS ${cred}`);
    setStyle(this.credits, 'filter', this._pulse > 0 ? 'brightness(1.5)' : '');
    if (this.wave > 0) {
      setText(this.waveLine, `WAVE ${this.wave} CLEARED`);
    }

    for (let i = 0; i < this.rows.length; i++) {
      const it = s.items[i];
      const row = this.rows[i];
      if (!it) continue;
      setText(row.count, it.unit === 'pct' ? `${it.level}%` : `${Math.floor(it.level / it.step)}/${Math.floor(it.max / it.step)}`);
      row.btn.disabled = !it.affordable;
    }
  }

  dispose() {
    this.root.removeEventListener('click', this._onClick);
    removeEventListener('keydown', this._onKey);
    this.root.remove();
  }
}

/**
 * Countdown to the shop: shown during the post-wave grace period so the
 * player knows the market is coming and how long they have to loot ammo.
 * A prompt-style chip (seconds in the keycap, draining bar) anchored under
 * the scorebar — its own element, because ammo crates drive ui.setPrompt
 * and would overwrite a shared one at the interaction-prompt anchor.
 */
export class MarketCountdown {
  constructor(parent, delay) {
    this.root = el('div', 'ow-mkt-count', parent);
    this.key = el('div', 'ow-mkt-count-key', this.root, '10');
    const col = el('div', null, this.root);
    el('div', 'ow-mkt-count-txt', col, 'SUPPLY MARKET IN');
    const bar = el('div', 'ow-mkt-count-bar', col);
    this.fill = el('i', null, bar);
    this.shown = 0;
    this.delay = delay;
    setStyle(this.root, 'display', 'none');
  }

  /** Driven from ui.lateUpdate with RAW dt — survives the frozen sim. */
  update(rawDt, marketIn) {
    const active = marketIn > 0;
    this.shown = damp(this.shown, active ? 1 : 0, active ? 14 : 9, rawDt);
    if (this.shown < 0.005) {
      setStyle(this.root, 'display', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'opacity', this.shown.toFixed(3));
    setText(this.key, String(Math.max(1, marketIn)));
    setStyle(this.fill, 'transform', `scaleX(${(Math.max(0, marketIn) / this.delay).toFixed(3)})`);
  }

  dispose() {
    this.root.remove();
  }
}
