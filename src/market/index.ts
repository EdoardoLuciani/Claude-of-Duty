/** Market credits and shop sessions.
 * Score deltas fund credits 1:1; intel credits are independent. Purchases do not alter score.
 * The session mode sets starting credits. A wave clear starts the looting grace period,
 * then opens one shop session; the market overlay owns the gameplay pause.
 * HUD snapshots are pooled; copy rather than retain them.
 */

import type { SystemId, EngineContext } from '../core/context.ts';
import type { EngineEventMap } from '../core/events.ts';
import { SESSION_MODE_POLICY } from '../core/playable-maps.ts';
import type { Health } from '../player/health.ts';
import type { PlayerSystem } from '../player/index.ts';
import {
  BASE_ATTACHMENTS,
  isAttachmentConfig,
  SLOTS,
  type AttachmentConfig,
} from '../weapons/attachment-rules.ts';
import type { WeaponId } from '../weapons/defs.ts';
import type { WeaponSystem } from '../weapons/index.ts';
import { ATTACHMENT_CATALOG, ATTACHMENT_OFFERS } from './attachments.ts';

type MarketItemId = WeaponId | 'ammo' | 'grenade' | 'armour' | 'bandage' | 'carpet';
type MarketSlot = 'kit' | 'secondary' | 'primary' | 'strike';
type MarketAction = 'buy' | 'equipped' | 'max';
interface HudItem {
  id: MarketItemId;
  label: string;
  cost: number;
  max: number;
  step: number;
  unit: string;
  blurb: string;
  slot: MarketSlot;
  level: number;
  affordable: boolean;
  action: MarketAction;
}
interface HudBuildSlot {
  slot: keyof AttachmentConfig;
  cost: number;
  discarded: string | null;
}
interface HudBuild {
  id: WeaponId;
  /** The unconfirmed draft; `current` is the gun's stored build (base when unowned). */
  config: AttachmentConfig;
  current: AttachmentConfig;
  owned: boolean;
  baseCost: number;
  total: number;
  affordable: boolean;
  available: boolean;
  changed: boolean;
  canConfirm: boolean;
  slots: HudBuildSlot[];
}
interface HudState {
  credits: number;
  marketIn: number;
  items: HudItem[];
  build: HudBuild | null;
  attachments: Array<
    (typeof ATTACHMENT_CATALOG)[number] & { compatible: boolean; available: boolean }
  >;
}

/** Looting time after a wave clear, before the shop pauses the wave countdown. */
export const MARKET_DELAY = 15;

/** Catalog order is the shop layout. Kits/strikes BUY (MAX at cap);
 *  guns are bought as builds (`beginBuild`/`confirmBuild`), EQUIPPED when owned. */
const CATALOG = [
  {
    id: 'ammo',
    label: 'Ammo Refill',
    cost: 300,
    step: 100,
    max: 100,
    unit: 'pct',
    slot: 'kit',
    blurb: 'Reserve · full mags',
  },
  {
    id: 'grenade',
    label: 'Grenade Pack',
    cost: 200,
    step: 1,
    max: 6,
    slot: 'kit',
    blurb: 'Frag · +1',
  },
  {
    id: 'armour',
    label: 'Armour Plate',
    cost: 250,
    step: 50,
    max: 150,
    slot: 'kit',
    blurb: 'Ceramic · 25% then buffer',
  },
  {
    id: 'bandage',
    label: 'Bandage',
    cost: 100,
    step: 1,
    max: 4,
    slot: 'kit',
    blurb: 'Dressing · hold H · +50 HP',
  },
  {
    id: 'pistol',
    label: 'P320 Compact',
    cost: 400,
    step: 1,
    max: 1,
    slot: 'secondary',
    blurb: 'Semi-auto · 9×19',
  },
  { id: 'smg', label: 'MPX-9', cost: 800, step: 1, max: 1, slot: 'secondary', blurb: 'SMG · 9×19' },
  {
    id: 'shotgun',
    label: 'M-590',
    cost: 1000,
    step: 1,
    max: 1,
    slot: 'secondary',
    blurb: 'Pump · 12g',
  },
  {
    id: 'rifle',
    label: 'M4A1',
    cost: 900,
    step: 1,
    max: 1,
    slot: 'primary',
    blurb: 'Carbine · 5.56',
  },
  {
    id: 'mcx',
    label: 'MCX VIRTUS',
    cost: 1100,
    step: 1,
    max: 1,
    slot: 'primary',
    blurb: 'Carbine · .300 BLK',
  },
  {
    id: 'lmg',
    label: 'EVOLYS-7.62',
    cost: 1200,
    step: 1,
    max: 1,
    slot: 'primary',
    blurb: 'LMG · 7.62',
  },
  {
    id: 'sniper',
    label: 'AX-338',
    cost: 1500,
    step: 1,
    max: 1,
    slot: 'primary',
    blurb: 'Bolt · 8.6',
  },
  {
    id: 'carpet',
    label: 'Carpet Bomb',
    cost: 1500,
    step: 1,
    max: 3,
    slot: 'strike',
    blurb: 'Strike · radio 1',
  },
] as const;

export class MarketSystem {
  static readonly id = 'market';
  static readonly deps: SystemId[] = ['weapons', 'player'];
  declare ctx: EngineContext;
  declare weapons: WeaponSystem;
  declare player: PlayerSystem;
  declare health: Health;
  declare credits: number;
  open: boolean = false;
  delay: number = MARKET_DELAY;
  declare _marketAt: number;
  declare _pendingWave: number;
  _pending: { id: WeaponId; config: AttachmentConfig } | null = null;
  _candidate = { ...BASE_ATTACHMENTS };
  _buildHud: HudBuild = {
    id: 'rifle',
    config: BASE_ATTACHMENTS,
    current: BASE_ATTACHMENTS,
    owned: false,
    baseCost: 0,
    total: 0,
    affordable: false,
    available: false,
    changed: false,
    canConfirm: false,
    slots: SLOTS.map((slot): HudBuildSlot => ({
      slot,
      cost: 0,
      discarded: null,
    })),
  };
  // Preallocated HUD snapshot, pooled like every other subsystem's.
  _hud: HudState = {
    credits: 0,
    marketIn: 0,
    build: null,
    attachments: ATTACHMENT_CATALOG.map((entry): HudState['attachments'][number] => ({
      ...entry,
      compatible: false,
      available: false,
    })),
    items: CATALOG.map((c): HudItem => ({
      id: c.id,
      label: c.label,
      cost: c.cost,
      max: c.max,
      step: c.step,
      unit: 'unit' in c ? c.unit : '',
      blurb: c.blurb,
      slot: c.slot,
      level: 0,
      affordable: false,
      action: 'buy',
    })),
  };
  _off: Array<() => void> = [];

  async init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.weapons = ctx.get('weapons');
    this.player = ctx.get('player');
    this.health = this.player.health;
    this.credits = SESSION_MODE_POLICY[ctx.config.mode].startingCredits;
    /** When the shop should open (ctx.time.elapsed), 0 when not pending. */
    this._marketAt = 0;
    this._pendingWave = 0;

    const on = <K extends keyof EngineEventMap>(
      type: K,
      fn: (event: EngineEventMap[K]) => void
    ): void => {
      this._off.push(ctx.events.on(type, fn));
    };

    // Credits mirror the score's rewards 1:1 (kills, headshots, wave bonuses
    // — see score:change in ARCHITECTURE.md); spending is the only divergence.
    on('score:change', (e): void => {
      this.credits += Math.max(0, e.delta);
    });

    on('wave:complete', (e): void => {
      const wave = Math.max(1, e.wave | 0);
      // Arm the grace period; the shop opens from update() once it elapses.
      this._pendingWave = wave;
      this._marketAt = this.ctx.time.elapsed + MARKET_DELAY;
    });

    on('game:restart', (): void => this.reset());
  }

  _level(itemId: MarketItemId): number {
    if (itemId === 'grenade') return this.weapons.grenades;
    if (itemId === 'armour') return this.health.armour;
    if (itemId === 'bandage') return this.player.bandages;
    if (itemId === 'ammo') return Math.floor(this.weapons.ammoFraction() * 100);
    if (itemId === 'carpet') return this.weapons.carpetBombs;
    return this.weapons.owns(itemId) ? 1 : 0;
  }

  /** Engine update hook: open the shop once the grace period elapses. */
  update(): void {
    if (this._marketAt <= 0 || this.open) return;
    // The field is quiet after a clear, but a stray blast can still kill the
    // player mid-window — never open the shop over the death screen.
    if (this.player.dead) return;
    if (this.ctx.time.elapsed >= this._marketAt) {
      this.openShop(this._pendingWave);
      this._marketAt = 0;
    }
  }

  /** Open a shop session; `wave` is the wave just cleared, 0 at a counter. */
  openShop(wave = 0): void {
    if (this.open) return;
    this.open = true;
    this.ctx.events.emit('market:open', { wave });
  }

  /** End the session. The wave countdown continues where the pause froze it. */
  closeShop(): void {
    this.cancelBuild();
    if (!this.open) return;
    this.open = false;
    this.ctx.events.emit('market:close', {});
  }

  /** Buy one supply unit when the shop is open and affordable; weapons are bought as builds. */
  buy(itemId: Exclude<MarketItemId, WeaponId>): boolean {
    if (!this.open) return false;
    const item = CATALOG.find((c): boolean => c.id === itemId);
    if (!item || this._level(itemId) >= item.max || this.credits < item.cost) return false;
    if (itemId === 'grenade') this.weapons.addGrenades(item.step);
    else if (itemId === 'armour') this.health.addArmour(item.step);
    else if (itemId === 'bandage') {
      if (!this.player.addBandages(item.step)) return false;
    } else if (itemId === 'ammo') this.weapons.refillAmmo();
    else this.weapons.addCarpetBombs(item.step);
    this.credits -= item.cost;
    return true;
  }

  /** One draft, never an inventory: changing selection discards the previous draft. */
  beginBuild(id: WeaponId): boolean {
    if (!this.open) return false;
    // Unowned guns hold the base build, so this is always the starting point.
    this._pending = { id, config: this.weapons.getAttachments(id) };
    return true;
  }

  setBuild(config: unknown): boolean {
    if (!this.open || !this._pending || !isAttachmentConfig(config, this._pending.id)) return false;
    this._pending.config = Object.freeze({ ...config });
    return true;
  }

  cancelBuild(): void {
    this._pending = null;
    this._hud.build = null;
  }

  confirmBuild(): boolean {
    const build = this.getHudState().build;
    if (!build?.canConfirm || !this.weapons.applyBuild(build.id, build.config)) return false;
    this.credits -= build.total;
    this.beginBuild(build.id);
    return true;
  }

  _updateBuild(): void {
    const pending = this._pending;
    this._hud.build = pending ? this._buildHud : null;
    if (!pending) return;
    const { id, config } = pending;
    const h = this._buildHud;
    h.id = id;
    h.config = config;
    h.owned = this.weapons.owns(id);
    const current = (h.current = this.weapons.getAttachments(id));
    h.baseCost = 0;
    if (!h.owned) for (const item of CATALOG) if (item.id === id) h.baseCost = item.cost;
    h.total = h.baseCost;
    h.changed = !h.owned;
    for (const line of h.slots) {
      const selected = config[line.slot];
      const previous = current[line.slot];
      const changed = selected !== previous;
      // New attachments are charged; replaced or removed ones are discarded without refund.
      line.cost = changed && selected ? ATTACHMENT_OFFERS[selected].cost : 0;
      line.discarded = changed && previous ? ATTACHMENT_OFFERS[previous].label : null;
      h.changed ||= changed;
      h.total += line.cost;
    }
    h.available = this.weapons.canConfigure(id, config);
    h.affordable = this.credits >= h.total;
    h.canConfirm = this.open && h.changed && h.available && h.affordable;
    for (const offer of this._hud.attachments) {
      Object.assign(this._candidate, config);
      // Keep slot/id correlation explicit without allocating candidate objects per frame.
      if (offer.slot === 'optic') this._candidate.optic = offer.id;
      else if (offer.slot === 'muzzle') this._candidate.muzzle = offer.id;
      else if (offer.slot === 'rail') this._candidate.rail = offer.id;
      else this._candidate.support = offer.id;
      offer.compatible = isAttachmentConfig(this._candidate, id);
      offer.available = offer.compatible && this.weapons.canConfigure(id, this._candidate);
    }
  }

  /** Stable, allocation-free snapshot polled by the HUD and the shop overlay. */
  getHudState(): HudState {
    const h = this._hud;
    h.credits = this.credits;
    h.marketIn =
      this._marketAt > 0 && !this.open
        ? Math.max(0, Math.ceil(this._marketAt - this.ctx.time.elapsed))
        : 0;
    for (const it of h.items) {
      const lvl = this._level(it.id);
      it.level = lvl;
      it.affordable = lvl < it.max && this.credits >= it.cost;
      const gun = it.slot === 'primary' || it.slot === 'secondary';
      it.action = lvl < it.max ? 'buy' : gun ? 'equipped' : 'max';
    }
    this._updateBuild();
    return h;
  }

  /** Cache payout. Separate from score:change so the record and the shop can diverge. */
  addCredits(n: number): number {
    const add = Math.max(0, Math.round(n));
    if (!Number.isFinite(add) || !add) return this.credits;
    this.credits += add;
    return this.credits;
  }

  reset(): void {
    this.credits = SESSION_MODE_POLICY[this.ctx.config.mode].startingCredits;
    this._marketAt = 0;
    this._pendingWave = 0;
    this.closeShop();
  }

  dispose(): void {
    for (const off of this._off) off();
    this._off.length = 0;
  }
}
