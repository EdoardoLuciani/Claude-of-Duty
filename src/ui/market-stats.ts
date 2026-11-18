import { DEG } from '../core/math.ts';
import { BASE_ATTACHMENTS, buildDef, type AttachmentConfig } from '../weapons/attachments.ts';
import { shotInterval, type WeaponId } from '../weapons/defs.ts';
import { el, setClass, setText } from './util.ts';

type EffectiveDef = ReturnType<typeof buildDef>;

/** Rows read the same effective definition gameplay fires. `better` is the direction
 * that helps the player; 0 marks a trade-off with no universal direction. */
const ROWS: ReadonlyArray<{
  label: string;
  title: string;
  better: -1 | 0 | 1;
  value(def: EffectiveDef): number;
  format(value: number, def: EffectiveDef): string;
}> = [
  {
    label: 'Damage',
    title: 'Per hit before range falloff and armour; shotguns list damage × pellets.',
    better: 1,
    value: (def): number => def.damage,
    format: (v, def): string => (def.pellets ? `${v} × ${def.pellets}` : `${v}`),
  },
  {
    label: 'Fire rate',
    title: 'Rounds per minute; bolt guns use their cycle time.',
    better: 0,
    value: (def): number => 60 / shotInterval(def),
    format: (v): string => `${Math.round(v)} rpm`,
  },
  {
    label: 'Magazine',
    title: 'Rounds per magazine, belt or tube, excluding the chambered round.',
    better: 1,
    value: (def): number => def.magSize,
    format: (v): string => `${v} rds`,
  },
  {
    label: 'Velocity',
    title: 'Muzzle velocity: faster rounds drop less and arrive sooner.',
    better: 1,
    value: (def): number => def.muzzleVelocity,
    format: (v): string => `${v} m/s`,
  },
  {
    label: 'Hip spread',
    title: 'Random cone radius from the hip at rest, before stance and movement modifiers.',
    better: -1,
    value: (def): number => def.spreadHip,
    format: (v): string => `${v.toFixed(2)}°`,
  },
  {
    label: 'ADS spread',
    title: 'Random cone radius aimed at rest, before stance and movement modifiers.',
    better: -1,
    value: (def): number => def.spreadAds,
    format: (v): string => `${v.toFixed(2)}°`,
  },
  {
    label: 'Recoil',
    title: 'Average sightline climb per shot before ADS/crouch bracing; first shots climb more.',
    better: -1,
    value: (def): number => def.recoil.pitch / DEG,
    format: (v): string => `${v.toFixed(2)}°`,
  },
  {
    label: 'ADS time',
    title: 'Time to raise the sights from the hip.',
    better: -1,
    value: (def): number => def.adsTime * 1000,
    format: (v): string => `${Math.round(v)} ms`,
  },
];

interface StatRow {
  base: HTMLElement;
  owned: HTMLElement;
  draft: HTMLElement;
  delta: HTMLElement;
}

/** Base, owned and draft stats of the selected build; resolved only when a build changes. */
export class MarketStats {
  root: HTMLTableElement;
  caption: HTMLElement;
  ownedHead: HTMLElement;
  rows: StatRow[] = [];
  _id: WeaponId | null = null;
  _current: AttachmentConfig | null = null;
  _config: AttachmentConfig | null = null;
  _owned = false;

  constructor(parent: HTMLElement) {
    this.root = el('table', 'ow-market-stats', parent);
    this.caption = el('caption', null, this.root);
    const head = el('tr', null, el('thead', null, this.root));
    const column = (label: string): HTMLTableCellElement =>
      Object.assign(el('th', null, head, label), { scope: 'col' });
    column('Stat');
    column('Base');
    this.ownedHead = column('Owned');
    column('Draft');
    const body = el('tbody', null, this.root);
    for (const row of ROWS) {
      const tr = el('tr', null, body);
      const th = el('th', null, tr, row.label);
      th.scope = 'row';
      th.title = row.title;
      const base = el('td', null, tr);
      const owned = el('td', null, tr);
      const draft = el('td', null, tr);
      const value = el('span', null, draft);
      const delta = el('span', 'ow-market-stat-delta', draft);
      this.rows.push({ base, owned, draft: value, delta });
    }
  }

  /** Builds are frozen snapshots, so identity tells whether anything changed. */
  update(id: WeaponId, current: AttachmentConfig, config: AttachmentConfig, owned: boolean): void {
    if (
      id === this._id &&
      current === this._current &&
      config === this._config &&
      owned === this._owned
    )
      return;
    this._id = id;
    this._current = current;
    this._config = config;
    this._owned = owned;
    const base = buildDef(id, BASE_ATTACHMENTS);
    const stored = buildDef(id, current);
    const draft = buildDef(id, config);
    setText(this.caption, owned ? 'Draft change vs owned build' : 'Draft change vs base weapon');
    this.ownedHead.hidden = !owned;
    for (let i = 0; i < ROWS.length; i++) {
      const row = ROWS[i];
      const cells = this.rows[i];
      setText(cells.base, row.format(row.value(base), base));
      cells.owned.hidden = !owned;
      setText(cells.owned, row.format(row.value(stored), stored));
      const value = row.value(draft);
      setText(cells.draft, row.format(value, draft));
      // An unowned gun stores the base build, so the stored build is always the reference.
      const change = value / row.value(stored) - 1;
      const pct = Math.round(change * 100);
      const quality = pct === 0 ? 0 : Math.sign(change) * row.better;
      const word = quality > 0 ? ' better' : quality < 0 ? ' worse' : '';
      setText(cells.delta, pct === 0 ? '' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%${word}`);
      setClass(cells.delta, 'better', quality > 0);
      setClass(cells.delta, 'worse', quality < 0);
    }
  }
}
