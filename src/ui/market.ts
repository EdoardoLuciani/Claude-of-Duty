import type { EngineContext } from '../core/context.ts';
import { damp } from '../core/math.ts';
import type { MarketSystem } from '../market/index.ts';
import { SLOTS } from '../weapons/attachment-rules.ts';
import { isWeaponId } from '../weapons/defs.ts';
import { marketIcon } from './market-icons.ts';
import { MarketInspection } from './market-inspection.ts';
import { MarketStats } from './market-stats.ts';
import { el, setText, setStyle, setClass } from './util.ts';

type MarketItem = ReturnType<MarketSystem['getHudState']>['items'][number];
type MarketOffer = ReturnType<MarketSystem['getHudState']>['attachments'][number];
type MarketSlot = MarketItem['slot'];
interface BuildControl {
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
const SECTION: Record<MarketSlot, string> = {
  kit: 'RESUPPLY',
  secondary: 'SECONDARY',
  primary: 'PRIMARY',
  strike: 'ORDNANCE',
};
function targetCard(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest('[data-item]') : null;
}

/** The Supply Market and Range Station share the native catalog, draft and inspection.
 * Survival supplies buy immediately; range resupply and target reset are free actions.
 * The overlay animates on raw wall time while gameplay is frozen. */
export class MarketOverlay {
  readonly market: MarketSystem;
  readonly root: HTMLDialogElement;
  private readonly training: boolean;
  private readonly body: HTMLElement;
  private readonly leave: HTMLButtonElement;
  private readonly rangeStatus: HTMLElement | null;
  private attempt = 0;
  private disposed = false;
  private readonly waveLabel: HTMLElement | null;
  private readonly creditsLabel: HTMLElement;
  _onClick: (event: MouseEvent) => void;
  _onOver: (event: MouseEvent) => void;
  _onKey: (event: KeyboardEvent) => void;
  _onFocus: (event: FocusEvent) => void;
  inspection: MarketInspection;
  buildPanel: HTMLElement;
  buildControls: BuildControl[] = [];
  stats: MarketStats;
  quote: { baseCost: HTMLElement; total: HTMLElement; discardWarning: HTMLElement };
  buildStatus: HTMLElement;
  confirm: HTMLButtonElement;
  _selectedId: string | null = null;
  cards: MarketCard[] = [];
  active: boolean = false;
  shown: number = 0;
  wave: number = 0;
  _pulse: number = 0;
  _hoverId: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly ctx: EngineContext
  ) {
    const training = (this.training = ctx.config.mode === 'training');
    this.market = ctx.get('market');

    this.root = el('dialog', 'ow-market ow-dialog', parent);
    this.root.setAttribute('aria-labelledby', 'ow-market-title');
    if (training) {
      this.root.oncancel = (event): void => {
        event.preventDefault(); // Keep the modal until mouse capture succeeds.
        this.skip();
      };
      document.addEventListener('pointerlockchange', this.lockChanged);
      document.addEventListener('pointerlockerror', this.lockDenied);
    } else {
      // Esc closes the shop. Ignore a queued close if the shop has reopened since.
      this.root.onclose = (): void => {
        if (this.active && !this.root.open) this.skip();
      };
    }
    const panel = el('div', 'ow-market-panel', this.root);

    const head = el('div', 'ow-market-head', panel);
    this.waveLabel = training ? null : el('div', 'ow-market-wave', head);
    const title = el('div', 'ow-market-title', head, training ? 'RANGE STATION' : 'SUPPLY MARKET');
    title.id = 'ow-market-title';
    // Start focus on the title: focusing the first card would preview it.
    title.tabIndex = -1;
    title.autofocus = true;
    const cred = el('div', 'ow-market-cred', head);
    this.creditsLabel = el('b', null, cred, '');
    el('i', null, cred, 'CREDITS');

    this.body = el('div', 'ow-market-body', panel);
    const catalog = el('div', 'ow-market-catalog', this.body);
    this.inspection = new MarketInspection(this.body, ctx.get('weapons'));
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
      this.buildControls.push({ select, options, cost });
      select.onchange = (): void =>
        this.run('selectAttachment', (): void => {
          if (this.body.inert) return;
          const build = this.market.getHudState().build;
          if (!build) return;
          if (this.market.setBuild({ ...build.config, [slot]: select.value || null }))
            this._preview(build.id);
          this._updateBuild();
        });
    }
    el(
      'p',
      'ow-market-inspect-help',
      this.buildPanel,
      'Optics replace removable irons and magnify the aimed view. The suppressor quiets ' +
        'shots and shrinks the muzzle flash; the laser beam does not predict spread or drop.'
    );
    this.stats = new MarketStats(this.buildPanel);
    const baseCost = el('div', 'ow-market-build-base', this.buildPanel);
    const discardWarning = el('p', 'ow-market-build-warning', this.buildPanel);
    const total = el('div', 'ow-market-build-total', this.buildPanel);
    el('span', null, total, 'TOTAL');
    this.quote = { baseCost, discardWarning, total: el('b', null, total, '0') };
    this.buildStatus = el('p', 'ow-market-inspect-help', this.buildPanel);
    this.buildStatus.setAttribute('role', 'status');
    const actions = el('div', 'ow-market-build-actions', this.buildPanel);
    this.confirm = el(
      'button',
      'ow-market-buy',
      actions,
      training ? 'APPLY & RESUME' : 'BUY BUILD'
    );
    this.confirm.type = 'button';
    this.confirm.onclick = (): void =>
      this.run('confirmBuild', (): void => {
        if (this.body.inert) return;
        if (!this.market.confirmBuild()) {
          this.setRangeStatus('This build could not be equipped.');
          this.ctx.peek('ui')?.sfx('market_deny', 0.75);
          return;
        }
        if (training) this.requestResume();
        else {
          this._pulse = 1;
          this.ctx.peek('ui')?.sfx('market_buy', 0.9);
          this._updateBuild();
        }
      });
    const cancel = el('button', 'ow-market-build-cancel', actions, 'CANCEL');
    cancel.type = 'button';
    cancel.onclick = (): void =>
      this.run('cancelBuild', (): void => {
        if (this.body.inert) return;
        const id = this._selectedId;
        this.market.cancelBuild();
        this._selectedId = null;
        this._updateBuild();
        if (id) {
          this._preview(id);
          this.cards.find((row): boolean => row.card.dataset.item === id)?.card.focus();
        }
      });
    if (training) {
      this.buildPanel.append(this.stats.root); // Keep status and actions visible above the stats.
      const reset = el('button', 'ow-market-skip', catalog, 'Reset Targets');
      reset.type = 'button';
      reset.onclick = (): void =>
        this.run('resetTargets', (): void => {
          if (this.body.inert) return;
          this.ctx.get('fx').resetPracticeMarks();
          this.setRangeStatus('Target marks cleared.');
        });
    }
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
    this.leave = el('button', 'ow-market-skip', foot, training ? 'RESUME' : 'SKIP ▸');
    this.leave.type = 'button';
    this.leave.onclick = (): void => this.skip();
    this.rangeStatus = training ? el('div', 'ow-market-hint', foot) : null;
    this.rangeStatus?.setAttribute('role', 'status');
    el(
      'div',
      'ow-market-hint',
      foot,
      training
        ? 'ESC RESUME · UNLIMITED TRAINING CREDIT'
        : 'ESC SKIP · SELECT A WEAPON TO CUSTOMIZE · CONFIRM TO APPLY'
    );

    this._onClick = (e: MouseEvent): void =>
      this.run('selectItem', (): void => {
        const card = targetCard(e.target);
        if (!card || this.body.inert) return;
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
        if (
          !isWeaponId(item.id) &&
          e.target instanceof Element &&
          e.target.closest('.ow-market-buy')
        )
          this._buy(item.id);
      });
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

    const gun = isWeaponId(item.id);
    card.tabIndex = 0;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${item.label}, select to inspect`);
    const pips: HTMLElement[] = [];
    let fill: HTMLElement | null = null;
    const meta = el('div', 'ow-market-meta', card);
    const stock = el('div', 'ow-market-stock', meta);
    const pipMax = item.unit === 'pct' || gun ? 0 : Math.floor(item.max / item.step);
    if (pipMax > 0) {
      const row = el('div', 'ow-market-pips', stock);
      for (let i = 0; i < pipMax; i++) pips.push(el('i', null, row));
    }
    if (item.unit === 'pct') fill = el('i', null, el('div', 'ow-market-bar', stock));
    const count = el('div', 'ow-market-count', stock, '');
    el('div', 'ow-market-cost', meta, String(item.cost).padStart(4, '0'));

    const btn = el('button', 'ow-market-buy', card, gun ? 'CUSTOMIZE' : 'BUY');
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
    if (this.active || this.disposed) return;
    const { engine, input, events } = this.ctx;
    const training = this.training;
    if (
      training &&
      (engine.error ||
        engine.gameplaySuspended ||
        !input.enabled ||
        input.frozen ||
        !this.market.openRange())
    )
      return;
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
    if (training) {
      // Retain the weapon pose, reload and live grenades while the range is open.
      engine.setGameplaySuspended(true);
      input.enabled = false;
      input.clear();
      events.emit('ui:pause', { paused: true });
    }
    if (!training || document.pointerLockElement === this.ctx.canvas) document.exitPointerLock();
  }

  hide(): void {
    this.active = false;
    this.root.close();
    if (this.training) {
      this.market.closeShop();
      this.shown = 0;
      setStyle(this.root, 'display', 'none'); // Terminal errors stop the UI update hook too.
      this.body.inert = false;
      setText(this.leave, 'RESUME');
      this.setRangeStatus('');
    } else this.market.cancelBuild();
    this._hoverId = null;
    this._selectedId = null;
    this.buildPanel.hidden = true;
    this.inspection.hide();
  }

  _preview(id: string): void {
    const state = this.market.getHudState();
    const item = state.items.find((it): boolean => it.id === id);
    if (!item) return;
    for (const row of this.cards) setClass(row.card, 'inspecting', row.card.dataset.item === id);
    const config = state.build?.id === item.id ? state.build.config : undefined;
    void this.inspection.select(item.id, item.label, config);
  }

  _updateBuild(state = this.market.getHudState()): void {
    const build = state.build;
    this.buildPanel.hidden = !build;
    if (!build) return;
    this.stats.update(build.id, build.current, build.config, build.owned);
    let discarded = '';
    for (let i = 0; i < this.buildControls.length; i++) {
      // Controls and quote lines share SLOTS order.
      const control = this.buildControls[i];
      const line = build.slots.at(i);
      if (!line) continue;
      const value = build.config[line.slot] ?? '';
      if (control.select.value !== value) control.select.value = value;
      let compatible = false;
      for (const { offer, option } of control.options) {
        compatible ||= offer.compatible;
        if (option.hidden !== !offer.compatible) option.hidden = !offer.compatible;
        if (option.disabled !== !offer.available) option.disabled = !offer.available;
      }
      control.select.disabled = !compatible;
      setText(control.cost, line.cost ? `+${line.cost}` : '0');
      if (line.discarded) discarded += `${discarded ? ' · ' : ''}${line.discarded}`;
    }
    const { baseCost, discardWarning, total } = this.quote;
    setText(
      baseCost,
      build.owned ? 'Base weapon · owned' : `Base weapon · ${build.baseCost} credits`
    );
    setText(discardWarning, discarded ? `On confirm, discard ${discarded}. No refund.` : '');
    discardWarning.hidden = !discarded;
    setText(total, `${build.total} CREDITS`);
    if (!this.training) setText(this.confirm, build.owned ? 'APPLY CHANGES' : 'BUY BUILD');
    this.confirm.disabled = this.body.inert || !build.canConfirm;
    setText(
      this.buildStatus,
      !build.available
        ? 'This build is unavailable: weapon or attachment failed to load.'
        : this.training
          ? build.equipBlocked
            ? 'Resume to finish cycling before changing weapons.'
            : 'Try this build for free.'
          : !build.affordable
            ? 'Not enough credits. Edit the build or cancel.'
            : !build.changed
              ? 'No changes to apply.'
              : 'Nothing is spent until you confirm.'
    );
  }

  skip(): void {
    this.run('resume', (): void => {
      if (this.training) this.requestResume();
      else this.market.closeShop(); // emits market:close -> ui hides this overlay
    });
  }

  private setRangeStatus(message: string): void {
    if (this.rangeStatus) setText(this.rangeStatus, message);
  }

  private run(action: string, call: () => void): void {
    if (!this.active || this.ctx.engine.error) return;
    try {
      call();
    } catch (error) {
      this.ctx.engine.fail('ui', action, error);
    }
  }

  private requestResume(): void {
    this.body.inert = this.confirm.disabled = true;
    setText(this.leave, 'RETRY RESUME');
    this.leave.focus();
    this.setRangeStatus('Waiting for mouse capture. Retry if needed.');
    const attempt = ++this.attempt;
    const { canvas, input, engine } = this.ctx;
    if (document.pointerLockElement === canvas) this.lockChanged();
    else
      input.requestPointerLock((requested): void => {
        if (!requested) {
          if (attempt === this.attempt) this.lockDenied();
        } else if ((this.disposed || engine.error) && document.pointerLockElement === canvas) {
          document.exitPointerLock();
        }
      });
    input.requestFullscreen();
  }

  private lockDenied = (): void => {
    if (this.body.inert)
      this.setRangeStatus('Mouse capture unavailable. Select Retry Resume to try again.');
  };

  private lockChanged = (): void => {
    const { canvas, engine, input, events } = this.ctx;
    if (!this.body.inert || document.pointerLockElement !== canvas || !engine.running) return;
    this.run('resume', (): void => {
      this.hide();
      engine.setGameplaySuspended(false); // Clears pending inputs and pointer-lock loss.
      input.enabled = true;
      events.emit('ui:pause', { paused: false });
    });
  };

  _buy(itemId: Parameters<MarketSystem['buy']>[0]): void {
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
    setText(
      this.creditsLabel,
      Number.isFinite(s.credits) ? String(Math.max(0, Math.round(s.credits))).padStart(6, '0') : '∞'
    );
    setStyle(this.creditsLabel, 'filter', this._pulse > 0 ? 'brightness(1.55)' : '');
    if (this.waveLabel && this.wave > 0) setText(this.waveLabel, `WAVE ${this.wave} CLEARED`);

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
      setText(row.btn, gun ? 'CUSTOMIZE' : it.action === 'max' ? 'MAX' : 'BUY');
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
    this.disposed = true;
    if (this.training) {
      document.removeEventListener('pointerlockchange', this.lockChanged);
      document.removeEventListener('pointerlockerror', this.lockDenied);
      this.market.closeShop();
    }
    removeEventListener('keydown', this._onKey);
    try {
      this.inspection.dispose();
    } finally {
      this.root.remove();
    }
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
