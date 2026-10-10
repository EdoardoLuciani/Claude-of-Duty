import { el, setText, setStyle, setClass, damp } from './util.ts';
import { marketIcon } from './market-icons.ts';

type MarketId = 'ammo' | 'grenade' | 'armour' | 'bandage' | 'smg' | 'rifle' | 'mcx' | 'shotgun' | 'lmg' | 'sniper' | 'carpet';
type MarketAction = 'buy' | 'swap' | 'equipped' | 'max';
type MarketSlot = 'kit' | 'secondary' | 'primary' | 'strike';
interface MarketItem { id: MarketId; label: string; blurb: string; cost: number; max: number; step: number; unit: string; slot: MarketSlot; level: number; affordable: boolean; action: MarketAction }
interface MarketState { credits: number; marketIn: number; items: MarketItem[] }
interface MarketApi { getHudState(): MarketState; closeShop(): void; buy(itemId: string | undefined): boolean }
interface MarketContext { get<T = unknown>(id: string): T; peek<T = unknown>(id: string): T | undefined }
interface MarketCard { card: HTMLElement; btn: HTMLButtonElement; count: HTMLElement; pips: HTMLElement[]; fill: HTMLElement | null }
const ACTION_LABEL: Record<MarketAction, string> = { buy: 'BUY', swap: 'SWAP', equipped: 'EQUIPPED', max: 'MAX' };
const SECTION: Record<MarketSlot, string> = { kit: 'RESUPPLY', secondary: 'SECONDARY', primary: 'PRIMARY', strike: 'ORDNANCE' };
function targetCard(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest('[data-item]') as HTMLElement | null : null;
}

/**
 * Between-wave supply shop overlay.
 *
 * A centered modal over a dimmed world. The simulation clock is frozen while
 * the shop is open (see market/index.js), so this overlay — like the
 * game-over screen — animates on raw wall-clock time, never on dt.
 *
 * Cards are the purchase confirmation: clicking a card (or activating its
 * button with Enter/Space) applies one unit immediately. The panel stays open
 * until the player explicitly leaves (SKIP or Esc). Number keys do not buy.
 */
export class MarketOverlay {
  ctx: MarketContext; market: MarketApi; root: HTMLElement; waveLine: HTMLElement; credits: HTMLElement; cards: MarketCard[];
  active: boolean; shown: number; wave: number; _pulse: number; _hoverId: string | null;
  _onClick: (event: MouseEvent) => void; _onOver: (event: MouseEvent) => void; _onKey: (event: KeyboardEvent) => void;
  constructor(parent: HTMLElement, ctx: MarketContext) {
    this.ctx = ctx;
    this.market = ctx.get<MarketApi>('market');

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
    let secN = 1, lastSlot: MarketSlot | '' = '', grid: HTMLElement | null = null;
    for (const item of items) {
      if (item.slot !== lastSlot) {
        lastSlot = item.slot;
        const block = el('div', 'ow-market-sec', panel);
        const h = el('div', 'ow-market-sec-h', block);
        el('span', 'ow-market-sec-n', h, String(secN++).padStart(2, '0'));
        el('span', 'ow-market-sec-l', h, SECTION[item.slot]);
        el('i', 'ow-market-sec-rule', h);
        grid = el('div', 'ow-market-grid', block);
      }
      grid!.appendChild(this._card(item));
    }

    const foot = el('div', 'ow-market-foot', panel);
    const skip = el('button', 'ow-market-skip', foot, 'SKIP ▸');
    skip.type = 'button';
    skip.addEventListener('click', () => this.skip());
    el('div', 'ow-market-hint', foot, 'ESC SKIP · CLICK / ENTER TO BUY');

    this.active = false;
    this.shown = 0;
    this.wave = 0;
    this._pulse = 0;
    this._hoverId = null;

    this._onClick = (e: MouseEvent): void => {
      const card = targetCard(e.target);
      if (card) this._buy(card.dataset.item);
    };
    this._onOver = (e: MouseEvent): void => {
      if (!this.active) return;
      const card = targetCard(e.target);
      const id = card?.dataset?.item ?? null;
      if (id === this._hoverId) return;
      this._hoverId = id;
      if (id) this.ctx.peek<{ sfx?(kind: string, level: number): void }>('ui')?.sfx?.('market_hover', 0.4);
    };
    this._onKey = (e: KeyboardEvent): void => {
      if (!this.active) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.skip();
      }
    };
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('mouseover', this._onOver);
    addEventListener('keydown', this._onKey);

    setStyle(this.root, 'display', 'none');
  }

  _card(item: MarketItem): HTMLElement {
    const card = el('div', 'ow-market-card', null);
    card.dataset.item = item.id;
    const well = el('div', 'ow-market-icon', card);
    marketIcon(item.id, well);
    el('div', 'ow-market-name', card, item.label);
    el('div', 'ow-market-blurb', card, item.blurb);

    const meta = el('div', 'ow-market-meta', card);
    const stock = el('div', 'ow-market-stock', meta);
    const gun = item.action === 'equipped' || item.action === 'swap';
    const pipMax = (item.unit === 'pct' || gun) ? 0 : Math.floor(item.max / item.step);
    const pips: HTMLElement[] = [];
    if (pipMax > 0) {
      const row = el('div', 'ow-market-pips', stock);
      for (let i = 0; i < pipMax; i++) pips.push(el('i', null, row));
    }
    const bar = item.unit === 'pct' ? el('div', 'ow-market-bar', stock) : null;
    const fill = bar ? el('i', null, bar) : null;
    const count = el('div', 'ow-market-count', stock, '');
    el('div', 'ow-market-cost', meta, String(item.cost).padStart(4, '0'));

    const btn = el('button', 'ow-market-buy', card, 'BUY');
    btn.type = 'button';
    this.cards.push({ card, btn, count, pips, fill });
    return card;
  }

  show(wave = 0): void {
    if (this.active) return;
    this.active = true;
    this.shown = 0;
    this.wave = wave;
    this._hoverId = null;
    document.exitPointerLock?.();
  }

  hide(): void {
    this.active = false;
    this._hoverId = null;
  }

  skip(): void {
    this.market.closeShop(); // emits market:close -> ui hides this overlay
  }

  _buy(itemId: string | undefined): void {
    if (!this.market.buy(itemId)) {
      this.ctx.peek<{ sfx?(kind: string, level: number): void }>('ui')?.sfx?.('market_deny', 0.75);
      return;
    }
    this._pulse = 1;
    this.ctx.peek<{ sfx?(kind: string, level: number): void }>('ui')?.sfx?.('market_buy', 0.9);
  }

  /** Driven from ui.lateUpdate with RAW dt — the sim clock is frozen here. */
  update(rawDt: number): void {
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
      const gun = it.action === 'equipped' || it.action === 'swap';
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

  dispose(): void {
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
  root: HTMLElement; key: HTMLElement; fill: HTMLElement; shown: number; delay: number;
  constructor(parent: HTMLElement, delay: number) {
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
  update(rawDt: number, marketIn: number): void {
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

  dispose(): void {
    this.root.remove();
  }
}
