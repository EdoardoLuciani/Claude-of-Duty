import { el, setText, setStyle, setClass, damp } from './util.js';

/**
 * Field-radio request panel.
 *
 * Appears above the ammo block while the radio is out (H). Three request
 * rows, one per number key: 1 is the carpet bomb (charge count on the right,
 * green when available, dim when spent), 2 and 3 are locked rows marked
 * TOP-SECRET. Pure readout — every value comes from `weapons.getHudState()`
 * (radioEquipped, carpetCount), polled on raw dt so it survives the frozen
 * sim clock.
 */
export class RadioPanel {
  constructor(parent, ctx) {
    this.ctx = ctx;

    this.root = el('div', 'ow-radio', parent);
    this.panel = el('div', 'ow-radio-panel', this.root);
    const head = el('div', 'ow-radio-head', this.panel);
    el('div', 'ow-radio-title', head, 'FIELD RADIO');
    el('div', 'ow-radio-hint', head, 'H STOWS');

    this.rows = [];
    const defs = [
      { key: '1', name: 'CARPET BOMB', secret: false },
      { key: '2', name: 'REQUEST', secret: true },
      { key: '3', name: 'REQUEST', secret: true },
    ];
    for (const d of defs) {
      const row = el('div', 'ow-radio-row', this.panel);
      const key = el('div', 'ow-radio-key', row, d.key);
      const name = el('div', 'ow-radio-name', row, d.name);
      const charge = el('div', 'ow-radio-charge', row, '');
      if (d.secret) {
        el('div', 'ow-radio-secret', row, 'TOP-SECRET');
        setClass(row, 'locked', true);
      }
      this.rows.push({ row, key, name, charge, secret: d.secret });
    }

    this.shown = 0;
    this._lastCount = -1;
    this._lastActive = -1;
    setStyle(this.root, 'display', 'none');
  }

  /** Driven from ui.lateUpdate with RAW dt. */
  update(rawDt) {
    const wp = this.ctx.peek('weapons');
    const active = !!wp?.radioEquipped;
    this.shown = damp(this.shown, active ? 1 : 0, active ? 12 : 14, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'opacity', this.shown.toFixed(3));
    if (!active) return;

    // Row 1 carries the live charge count; row 2/3 are static locks.
    const count = Math.max(0, wp.carpetBombs ?? 0);
    if (count !== this._lastCount) {
      this._lastCount = count;
      const r = this.rows[0];
      setText(r.charge, count > 0 ? `x${count}` : 'EMPTY');
      setClass(r.row, 'ready', count > 0);
      setClass(r.row, 'empty', count <= 0);
    }
  }

  dispose() {
    this.root.remove();
  }
}
