import type { EngineContext } from '../core/context.ts';
import { damp } from '../core/math.ts';
import type { MarketSystem } from '../market/index.ts';
import { isAttachmentConfig, SLOTS, type AttachmentConfig } from '../weapons/attachments.ts';
import { isWeaponId } from '../weapons/defs.ts';
import { marketIcon } from './market-icons.ts';
import { MarketInspection } from './market-inspection.ts';
import { el, setText, setStyle, setClass } from './util.ts';

type MarketItem = ReturnType<MarketSystem['getHudState']>['items'][number];
type MarketOffer = ReturnType<MarketSystem['getHudState']>['attachments'][number];
type MarketAction = MarketItem['action'];
type MarketSlot = MarketItem['slot'];
type MarketApi = MarketSystem;
type MarketContext = Pick<EngineContext, 'get' | 'peek'>;
interface BuildControl {
  slot: keyof AttachmentConfig;
  select: HTMLSelectElement;
  // Pooled HUD offers: read in place every frame, never looked up.
  options: Array<{ offer: MarketOffer; option: HTMLOptionElement }>;
  cost: HTMLElement;
}
interface MarketCard {
  card: HTMLElement;
  btn: HTMLButtonElement;
  count: HTMLElement;
  pips: HTMLElement[];
  fill: HTMLElement | null;
}
const ACTION_LABEL: Record<MarketAction, string> = {
  buy: 'BUY',
  equipped: 'EQUIPPED',
  max: 'MAX',
};
const SECTION: Record<MarketSlot, string> = {
  kit: 'RESUPPLY',
  secondary: 'SECONDARY',
  primary: 'PRIMARY',
  strike: 'ORDNANCE',
};
function targetCard(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest('[data-item]') : null;
}

/** Between-wave shop animates on raw wall time while simulation is frozen.
 * Weapon cards open a draft; supplies buy immediately. SKIP/Esc leaves;
 * number keys do not buy.
 */
export class MarketOverlay {
  ctx: MarketContext;
  market: MarketApi;
  root: HTMLDialogElement;
  waveLine: HTMLElement;
  credits: HTMLElement;
  _onClick: (event: MouseEvent) => void;
  _onOver: (event: MouseEvent) => void;
  _onKey: (event: KeyboardEvent) => void;
  _onFocus: (event: FocusEvent) => void;
  inspection: MarketInspection;
  buildPanel: HTMLElement;
  buildControls: BuildControl[] = [];
  baseCost: HTMLElement;
  buildTotal: HTMLElement;
  buildStatus: HTMLElement;
  discardWarning: HTMLElement;
  confirm: HTMLButtonElement;
  _selectedId: string | null = null;
  cards: MarketCard[] = [];
  active: boolean = false;
  shown: number = 0;
  wave: number = 0;
  _pulse: number = 0;
  _hoverId: string | null = null;

  constructor(parent: HTMLElement, ctx: MarketContext) {
    this.ctx = ctx;
    this.market = ctx.get('market');

    this.root = el('dialog', 'ow-market ow-dialog', parent);
    this.root.setAttribute('aria-labelledby', 'ow-market-title');
    // Esc (native cancel) closes the dialog; route it through the same skip path.
    // `close` is queued, so ignore a stale event if the shop has reopened since.
    this.root.onclose = (): void => {
      if (this.active && !this.root.open) this.skip();
    };
    const panel = el('div', 'ow-market-panel', this.root);

    const head = el('div', 'ow-market-head', panel);
    this.waveLine = el('div', 'ow-market-wave', head, '');
    const title = el('div', 'ow-market-title', head, 'SUPPLY MARKET');
    title.id = 'ow-market-title';
    // Start focus on the title: focusing the first card would preview it.
    title.tabIndex = -1;
    title.autofocus = true;
    const cred = el('div', 'ow-market-cred', head);
    this.credits = el('b', null, cred, '000000');
    el('i', null, cred, 'CREDITS');

    const body = el('div', 'ow-market-body', panel);
    const catalog = el('div', 'ow-market-catalog', body);
    this.inspection = new MarketInspection(body, ctx.get('weapons'));
    this.buildPanel = el('section', 'ow-market-build', this.inspection.root);
    this.buildPanel.hidden = true;
    this.buildPanel.setAttribute('aria-label', 'Weapon customization');
    el('h3', 'ow-market-sec-l', this.buildPanel, 'CUSTOMIZE BUILD');
    for (const slot of SLOTS) {
      const row = el('label', 'ow-market-build-slot', this.buildPanel);
      el('span', null, row, slot.toUpperCase());
      const select = el('select', null, row);
      select.setAttribute('aria-label', `${slot} attachment`);
      const none = el('option', null, select, slot === 'optic' ? 'Iron sights · free' : 'None');
      none.value = '';
      const options: BuildControl['options'] = [];
      for (const offer of this.market.getHudState().attachments) {
        if (offer.slot !== slot) continue;
        const option = el('option', null, select, `${offer.label} · ${offer.cost}`);
        option.value = offer.id;
        options.push({ offer, option });
      }
      const cost = el('span', 'ow-market-build-cost', row);
      this.buildControls.push({ slot, select, options, cost });
      select.onchange = (): void => {
        const build = this.market.getHudState().build;
        if (!build) return;
        const config: unknown = { ...build.config, [slot]: select.value || null };
        if (isAttachmentConfig(config, build.id) && this.market.setBuild(config))
          this._preview(build.id);
        this._updateBuild();
      };
    }
    el(
      'p',
      'ow-market-inspect-help',
      this.buildPanel,
      'Optics replace removable iron sights. Laser and suppressor add no handling or damage bonuses.'
    );
    this.baseCost = el('div', 'ow-market-build-base', this.buildPanel);
    this.discardWarning = el('p', 'ow-market-build-warning', this.buildPanel);
    const total = el('div', 'ow-market-build-total', this.buildPanel);
    el('span', null, total, 'TOTAL');
    this.buildTotal = el('b', null, total, '0');
    this.buildStatus = el('p', 'ow-market-inspect-help', this.buildPanel);
    this.buildStatus.setAttribute('role', 'status');
    const actions = el('div', 'ow-market-build-actions', this.buildPanel);
    this.confirm = el('button', 'ow-market-buy', actions, 'BUY BUILD');
    this.confirm.type = 'button';
    this.confirm.onclick = (): void => {
      if (!this.market.confirmBuild()) {
        this.ctx.peek('ui')?.sfx('market_deny', 0.75);
        return;
      }
      this._pulse = 1;
      this.ctx.peek('ui')?.sfx('market_buy', 0.9);
      this._updateBuild();
    };
    const cancel = el('button', 'ow-market-build-cancel', actions, 'CANCEL');
    cancel.type = 'button';
    cancel.onclick = (): void => {
      const id = this._selectedId;
      this.market.cancelBuild();
      this._selectedId = null;
      this._updateBuild();
      if (id) {
        this._preview(id);
        this.cards.find((row): boolean => row.card.dataset.item === id)?.card.focus();
      }
    };
    const items = this.market.getHudState().items;
    let secN = 1,
      lastSlot: MarketSlot | '' = '',
      grid: HTMLElement | null = null;
    for (const item of items) {
      if (item.slot !== lastSlot) {
        lastSlot = item.slot;
        const block = el('div', 'ow-market-sec', catalog);
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
    skip.addEventListener('click', (): void => this.skip());
    el('div', 'ow-market-hint', foot, 'ESC SKIP · SELECT A WEAPON TO CUSTOMIZE · CONFIRM TO APPLY');

    this._onClick = (e: MouseEvent): void => {
      const card = targetCard(e.target);
      if (!this.active || !card) return;
      const item = this.market
        .getHudState()
        .items.find((it): boolean => it.id === card.dataset.item);
      if (!item) return;
      if (isWeaponId(item.id)) {
        if (this._selectedId !== item.id) this.market.beginBuild(item.id);
      } else this.market.cancelBuild();
      this._selectedId = item.id;
      this._preview(item.id);
      this._updateBuild();
      if (!isWeaponId(item.id) && e.target instanceof Element && e.target.closest('.ow-market-buy'))
        this._buy(item.id);
    };
    this._onOver = (e: MouseEvent): void => {
      if (!this.active) return;
      const card = targetCard(e.target);
      const id = card?.dataset.item ?? null;
      if (id === this._hoverId) return;
      this._hoverId = id;
      if (id) {
        this.ctx.peek('ui')?.sfx('market_hover', 0.4);
        if (!this._selectedId) this._preview(id);
      }
    };
    this._onFocus = (e): void => {
      const id = targetCard(e.target)?.dataset.item;
      if (this.active && id && !this._selectedId) this._preview(id);
    };
    this._onKey = (e: KeyboardEvent): void => {
      if (!this.active) return;
      if (
        (e.code === 'Enter' || e.code === 'Space') &&
        e.target instanceof HTMLElement &&
        e.target.matches('.ow-market-card[data-item]')
      ) {
        e.preventDefault();
        e.target.click();
      }
    };
    this.root.addEventListener('click', this._onClick);
    this.root.addEventListener('mouseover', this._onOver);
    this.root.addEventListener('focusin', this._onFocus);
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
    const gun = isWeaponId(item.id);
    card.tabIndex = 0;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${item.label}, select to inspect`);
    const pipMax = item.unit === 'pct' || gun ? 0 : Math.floor(item.max / item.step);
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
    btn.setAttribute(
      'aria-label',
      isWeaponId(item.id)
        ? `Customize ${item.label}`
        : `Purchase ${item.label} for ${item.cost} credits`
    );
    this.cards.push({ card, btn, count, pips, fill });
    return card;
  }

  show(wave = 0): void {
    if (this.active) return;
    this.active = true;
    this.shown = 0;
    this.wave = wave;
    this._hoverId = null;
    this._selectedId = null;
    this._updateBuild();
    for (const row of this.cards) setClass(row.card, 'inspecting', false);
    this.inspection.active = true;
    this.inspection.controls.enabled = false;
    setStyle(this.root, 'display', ''); // Initial focus needs a rendered dialog.
    this.root.showModal();
    document.exitPointerLock();
  }

  hide(): void {
    this.active = false;
    this.root.close();
    this._hoverId = null;
    this._selectedId = null;
    this.market.cancelBuild();
    this.buildPanel.hidden = true;
    this.inspection.hide();
  }

  _preview(id: string): void {
    const state = this.market.getHudState();
    const item = state.items.find((it): boolean => it.id === id);
    if (!item) return;
    for (const row of this.cards) setClass(row.card, 'inspecting', row.card.dataset.item === id);
    // A weapon without a draft previews its stored build (inspection's default).
    const config = state.build?.id === item.id ? state.build.config : undefined;
    void this.inspection.select(item.id, item.label, config);
  }

  _updateBuild(state = this.market.getHudState()): void {
    const build = state.build;
    this.buildPanel.hidden = !build;
    if (!build) return;
    let discarded = '';
    for (let i = 0; i < this.buildControls.length; i++) {
      // Controls and quote lines share SLOTS order.
      const control = this.buildControls[i];
      const line = build.slots.at(i);
      if (!line) continue;
      const value = build.config[control.slot] ?? '';
      if (control.select.value !== value) control.select.value = value;
      for (const { offer, option } of control.options) {
        if (option.hidden !== !offer.compatible) option.hidden = !offer.compatible;
        if (option.disabled !== !offer.available) option.disabled = !offer.available;
      }
      setText(control.cost, line.cost ? `+${line.cost}` : '0');
      if (line.discarded) discarded += `${discarded ? ' · ' : ''}${line.discarded}`;
    }
    setText(
      this.baseCost,
      build.owned ? 'Base weapon · owned' : `Base weapon · ${build.baseCost} credits`
    );
    setText(this.discardWarning, discarded ? `On confirm, discard ${discarded}. No refund.` : '');
    this.discardWarning.hidden = !discarded;
    setText(this.buildTotal, `${build.total} CREDITS`);
    setText(this.confirm, build.owned ? 'APPLY CHANGES' : 'BUY BUILD');
    this.confirm.disabled = !build.canConfirm;
    setText(
      this.buildStatus,
      !build.available
        ? 'This build is unavailable: weapon or attachment failed to load.'
        : !build.affordable
          ? 'Not enough credits. Edit the build or cancel.'
          : !build.changed
            ? 'No changes to apply.'
            : 'Nothing is spent until you confirm.'
    );
  }

  skip(): void {
    this.market.closeShop(); // emits market:close -> ui hides this overlay
  }

  _buy(itemId: Parameters<MarketApi['buy']>[0]): void {
    if (!this.market.buy(itemId)) {
      this.ctx.peek('ui')?.sfx('market_deny', 0.75);
      return;
    }
    this._pulse = 1;
    this.ctx.peek('ui')?.sfx('market_buy', 0.9);
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

    this.inspection.update();
    const s = this.market.getHudState();
    this._updateBuild(s);
    this._pulse = Math.max(0, this._pulse - rawDt * 3);
    const cred = String(Math.max(0, Math.round(s.credits))).padStart(6, '0');
    setText(this.credits, cred);
    setStyle(this.credits, 'filter', this._pulse > 0 ? 'brightness(1.55)' : '');
    if (this.wave > 0) setText(this.waveLine, `WAVE ${this.wave} CLEARED`);

    for (let i = 0; i < this.cards.length; i++) {
      const it = s.items.at(i);
      const row = this.cards[i];
      if (!it) continue;
      const units = Math.floor(it.level / it.step);
      const cap = Math.floor(it.max / it.step);
      const gun = isWeaponId(it.id);
      setText(row.count, gun ? '' : it.unit === 'pct' ? `${it.level}%` : `${units}/${cap}`);
      if (row.fill) setStyle(row.fill, 'transform', `scaleX(${(it.level / 100).toFixed(3)})`);
      for (let p = 0; p < row.pips.length; p++) setClass(row.pips[p], 'on', p < units);
      setText(row.btn, gun ? 'CUSTOMIZE' : ACTION_LABEL[it.action]);
      row.btn.disabled = !gun && !it.affordable;
      setClass(row.card, 'on', it.action === 'equipped');
      setClass(row.card, 'capped', it.action === 'max');
      setClass(row.card, 'broke', !gun && !it.affordable && it.action !== 'max');
    }
  }

  dispose(): void {
    this.root.removeEventListener('click', this._onClick);
    this.root.removeEventListener('mouseover', this._onOver);
    this.root.removeEventListener('focusin', this._onFocus);
    this.inspection.dispose();
    removeEventListener('keydown', this._onKey);
    this.root.remove();
  }
}

/** Independent post-wave countdown; uses raw time while the shop freezes simulation. */
export class MarketCountdown {
  shown = 0;
  value = '10';
  fraction = 1;
  readonly delay: number;
  constructor(delay: number) {
    this.delay = delay;
  }
  update(rawDt: number, marketIn: number): void {
    this.shown = damp(this.shown, marketIn > 0 ? 1 : 0, marketIn > 0 ? 14 : 9, rawDt);
    if (this.shown < 0.005) return;
    this.value = String(Math.max(1, marketIn));
    this.fraction = Number((Math.max(0, marketIn) / this.delay).toFixed(3));
  }
}
