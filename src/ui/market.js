import { el, setText, setStyle, setClass, damp } from './util.js';
import { MARKET_SECTIONS } from '../market/index.js';
import { marketIcon } from './market-icons.js';

const ACTION_LABEL = { buy: 'BUY', swap: 'SWAP', equipped: 'EQUIPPED', max: 'MAX' };

/**
 * Between-wave supply shop overlay.
 *
 * A centered modal over a dimmed world. The simulation clock is frozen while
 * the shop is open (see market/index.js), so this overlay — like the
 * game-over screen — animates on raw wall-clock time, never on dt.
 *
 * Cards are the purchase confirmation: clicking a card (or pressing 1-9)
 * applies one unit immediately. The panel stays open until the player
 * explicitly leaves (SKIP or Esc).
 */
export class MarketOverlay {
  constructor(parent, ctx) {
    this.ctx = ctx;
    this.market = ctx.get('market');

    this.root = el('div', 'ow-market', parent);
    const panel = el('div', 'ow-market-panel', this.root);

    const head = el('div', 'ow-market-head', panel);
    this.waveLine = el('div', 'ow-market-wave', head, '');
    el('div', 'ow-market-title', head, 'SUPPLY MARKET');
    const cred = el('div', 'ow-market-cred', head);
    this.credits = el('b', null, cred, '000000');
    el('i', null, cred, 'CREDITS');

    this.cards = [];
    const items = this.market.getHudState().items;
    const byCat = new Map();
    for (const item of items) {
      const list = byCat.get(item.category) ?? [];
      list.push(item);
      byCat.set(item.category, list);
    }

    let hotkey = 1;
    let secN = 1;
    for (const sec of MARKET_SECTIONS) {
      const group = byCat.get(sec.id);
      if (!group?.length) continue;
      const block = el('div', 'ow-market-sec', panel);
      const h = el('div', 'ow-market-sec-h', block);
      el('span', 'ow-market-sec-n', h, String(secN++).padStart(2, '0'));
      el('span', 'ow-market-sec-l', h, sec.label.toUpperCase());
      el('i', 'ow-market-sec-rule', h);
      const grid = el('div', `ow-market-grid ${sec.id}`, block);
      for (const item of group) {
        grid.appendChild(this._card(item, hotkey));
        hotkey++;
      }
    }

    const foot = el('div', 'ow-market-foot', panel);
    const skip = el('button', 'ow-market-skip', foot, 'SKIP ▸');
    skip.type = 'button';
    skip.addEventListener('click', () => this.skip());
    el('div', 'ow-market-hint', foot, 'ESC SKIP · 1-9 BUY');

    this.active = false;
    this.shown = 0;
    this.wave = 0;
    this._pulse = 0;
    this._hoverId = null;

    this._buyKeys = Object.fromEntries(items.map((item, i) => [`Digit${i + 1}`, item.id]));

    this._onClick = (e) => {
      const card = e.target?.closest?.('[data-item]');
      if (card) this._buy(card.dataset.item);
    };
    this._onOver = (e) => {
      if (!this.active) return;
      const card = e.target?.closest?.('[data-item]');
      const id = card?.dataset?.item ?? null;
      if (id === this._hoverId) return;
      this._hoverId = id;
      if (id) this.ctx.peek('ui')?.sfx?.('market_hover', 0.4);
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
    this.root.addEventListener('mouseover', this._onOver);
    addEventListener('keydown', this._onKey);

    setStyle(this.root, 'display', 'none');
  }

  _card(item, key) {
    const card = el('div', 'ow-market-card', null);
    card.dataset.item = item.id;
    el('div', 'ow-market-key', card, String(key));
    const well = el('div', 'ow-market-icon', card);
    marketIcon(item.id, well);
    el('div', 'ow-market-name', card, item.label.toUpperCase());
    el('div', 'ow-market-blurb', card, item.blurb.toUpperCase());

    const meta = el('div', 'ow-market-meta', card);
    const stock = el('div', 'ow-market-stock', meta);
    const pipMax = (item.unit === 'pct' || item.slot === 'primary' || item.slot === 'secondary')
      ? 0
      : Math.floor(item.max / item.step);
    const pips = [];
    if (pipMax > 0 && pipMax <= 8) {
      const row = el('div', 'ow-market-pips', stock);
      for (let i = 0; i < pipMax; i++) pips.push(el('i', null, row));
    }
    const bar = item.unit === 'pct' ? el('div', 'ow-market-bar', stock) : null;
    const fill = bar ? el('i', null, bar) : null;
    const count = el('div', 'ow-market-count', stock, '');
    el('div', 'ow-market-cost', meta, String(item.cost).padStart(4, '0'));

    const btn = el('button', 'ow-market-buy', card, 'BUY');
    btn.type = 'button';
    btn.dataset.item = item.id;
    this.cards.push({ card, btn, count, pips, fill, pipMax });
    return card;
  }

  show(wave = 0) {
    if (this.active) return;
    this.active = true;
    this.shown = 0;
    this.wave = wave;
    this._hoverId = null;
    document.exitPointerLock?.();
  }

  hide() {
    this.active = false;
    this._hoverId = null;
  }

  skip() {
    this.market.closeShop(); // emits market:close -> ui hides this overlay
  }

  _buy(itemId) {
    if (!this.market.buy(itemId)) {
      this.ctx.peek('ui')?.sfx?.('market_deny', 0.75);
      return;
    }
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

    const s = this.market.getHudState();
    this._pulse = Math.max(0, this._pulse - rawDt * 3);
    const cred = String(Math.max(0, Math.round(s.credits))).padStart(6, '0');
    setText(this.credits, cred);
    setStyle(this.credits, 'filter', this._pulse > 0 ? 'brightness(1.55)' : '');
    if (this.wave > 0) setText(this.waveLine, `WAVE ${this.wave} CLEARED`);

    for (let i = 0; i < this.cards.length; i++) {
      const it = s.items[i];
      const row = this.cards[i];
      if (!it) continue;
      const units = Math.floor(it.level / it.step);
      const cap = Math.floor(it.max / it.step);
      const gun = it.slot === 'primary' || it.slot === 'secondary';
      setText(row.count, gun ? '' : it.unit === 'pct' ? `${it.level}%` : `${units}/${cap}`);
      if (row.fill) setStyle(row.fill, 'transform', `scaleX(${(it.level / 100).toFixed(3)})`);
      for (let p = 0; p < row.pips.length; p++) setClass(row.pips[p], 'on', p < units);
      setText(row.btn, ACTION_LABEL[it.action] ?? 'BUY');
      row.btn.disabled = !it.affordable;
      setClass(row.card, 'on', it.action === 'equipped');
      setClass(row.card, 'capped', it.action === 'max');
      setClass(row.card, 'broke', !it.affordable && it.action !== 'equipped' && it.action !== 'max');
    }
  }

  dispose() {
    this.root.removeEventListener('click', this._onClick);
    this.root.removeEventListener('mouseover', this._onOver);
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
