import { el, setText, setStyle, damp } from './util.js';
import { FONT_DISPLAY } from './util.js';
import { SCORE } from '../game/index.js';
import { MARKET_DELAY } from '../market/index.js';

/**
 * Between-wave supply shop overlay.
 *
 * A centered modal over a dimmed world. The simulation clock is frozen while
 * the shop is open (see market/index.js), so this overlay — like the
 * game-over screen — animates on raw wall-clock time, never on dt.
 *
 * Buttons are the purchase confirmation: clicking BUY (or pressing 1/2)
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
    const title = el('div', 'ow-market-title', panel, 'SUPPLY MARKET');
    title.style.fontFamily = FONT_DISPLAY;
    this.credits = el('div', 'ow-market-credits', panel, 'CREDITS 000000');
    el('div', 'ow-market-rule', panel);

    // One row per catalog item; state is refreshed every frame from the
    // market's pooled HUD snapshot (see MarketSystem.getHudState).
    this.rows = [];
    for (const item of this.market.catalog) {
      const row = el('div', 'ow-market-row', panel);
      el('div', 'ow-market-name', row, item.label.toUpperCase());
      const count = el('div', 'ow-market-count', row, '');
      const cost = el('div', 'ow-market-cost', row, String(item.cost).padStart(3, '0'));
      const btn = el('button', 'ow-market-buy', row, 'BUY');
      btn.type = 'button';
      btn.dataset.item = item.id;
      this.rows.push({ id: item.id, count, btn });
    }

    el('div', 'ow-market-rule', panel);
    const skip = el('button', 'ow-market-skip', panel, 'SKIP ▸');
    skip.type = 'button';
    skip.addEventListener('click', () => this.skip());
    el('div', 'ow-market-hint', panel, 'ESC SKIP · 1 BUY GRENADES · 2 BUY ARMOUR');

    this.active = false;
    this.shown = 0;
    this.wave = 0;
    this._pulse = 0; // credit readout flash after a purchase

    // One delegated click listener for every item row.
    this._onClick = (e) => {
      const b = e.target?.closest?.('button[data-item]');
      if (b) this._buy(b.dataset.item);
    };
    this._onKey = (e) => {
      if (!this.active) return;
      if (e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        this.skip();
      } else if (e.code === 'Digit1') {
        e.preventDefault();
        this._buy('grenade');
      } else if (e.code === 'Digit2') {
        e.preventDefault();
        this._buy('armour');
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
    const res = this.market.buy(itemId);
    if (!res.ok) return;
    this._pulse = 1;
    this.ctx.peek('ui')?.sfx?.('market_buy', 0.9);
  }

  /** Driven from ui.lateUpdate with RAW dt — the sim clock is frozen here. */
  update(rawDt) {
    if (!this.active && this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
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
      setText(this.waveLine, `WAVE ${this.wave} CLEARED · BONUS +${this.wave * SCORE.wave}`);
    }

    for (let i = 0; i < this.rows.length; i++) {
      const it = s.items[i];
      const row = this.rows[i];
      if (!it) continue;
      setText(row.count, `${Math.floor(it.level / it.step)}/${Math.floor(it.max / it.step)}`);
      setStyle(row.btn, 'opacity', it.affordable ? '' : '0.35');
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
 * A prompt-style chip (seconds in the keycap, draining bar) at the same
 * anchor the interaction prompts use, but its own element — ammo crates
 * drive ui.setPrompt and would overwrite a shared one.
 */
export class MarketCountdown {
  constructor(parent) {
    this.root = el('div', 'ow-mkt-count', parent);
    this.key = el('div', 'ow-mkt-count-key', this.root, '10');
    const col = el('div', null, this.root);
    this.txt = el('div', 'ow-mkt-count-txt', col, 'SUPPLY MARKET IN');
    const bar = el('div', 'ow-mkt-count-bar', col);
    this.fill = el('i', null, bar);
    this.shown = 0;
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
    const fraction = MARKET_DELAY > 0 ? Math.max(0, marketIn) / MARKET_DELAY : 0;
    setStyle(this.fill, 'transform', `scaleX(${fraction.toFixed(3)})`);
  }

  dispose() {
    this.root.remove();
  }
}
