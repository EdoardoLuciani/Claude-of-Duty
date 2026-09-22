import { el, setText, setStyle, setClass, damp } from './util.js';

/** Field-radio request panel — shown while H is held. */
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
      el('div', 'ow-radio-key', row, d.key);
      el('div', 'ow-radio-name', row, d.name);
      const charge = el('div', 'ow-radio-charge', row, '');
      if (d.secret) {
        el('div', 'ow-radio-secret', row, 'TOP-SECRET');
        setClass(row, 'locked', true);
      }
      this.rows.push({ row, charge });
    }

    this.shown = 0;
    this._lastCount = -1;
    setStyle(this.root, 'display', 'none');
  }

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
