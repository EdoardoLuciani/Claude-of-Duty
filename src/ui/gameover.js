import { el, damp, ease, setStyle } from './util.js';

/**
 * End-of-run overlay. It deliberately waits for the death camera to finish its
 * crane before becoming interactive; simulation keeps running underneath, so
 * the ragdoll and final shot never freeze halfway through.
 */
export class GameOverScreen {
  constructor(parent, ctx, onRestart) {
    this.ctx = ctx;
    this.onRestart = onRestart;
    this.root = el('div', 'ow-gameover', parent);
    const panel = el('div', 'ow-gameover-panel', this.root);
    this.eyebrow = el('div', 'ow-gameover-eyebrow', panel, 'MISSION STATUS');
    this.title = el('div', 'ow-gameover-title', panel, 'KILLED IN ACTION');
    el('div', 'ow-gameover-rule', panel);
    el('div', 'ow-gameover-sub', panel, 'Your watch has ended');
    this.button = el('button', 'ow-gameover-button', panel, 'NEW GAME');
    el('div', 'ow-gameover-hint', panel, 'ENTER / SPACE');

    this.active = false;
    this.elapsed = 0;
    this.shown = 0;
    this.delay = 2.85;
    this._click = () => this.restart();
    this._key = (e) => {
      if (!this.active || this.elapsed < this.delay) return;
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault();
      this.restart();
    };
    this.button.addEventListener('click', this._click);
    addEventListener('keydown', this._key);
    setStyle(this.root, 'display', 'none');
  }

  show() {
    if (this.active) return;
    this.active = true;
    this.elapsed = 0;
    document.exitPointerLock?.();
  }

  hide() {
    this.active = false;
    this.elapsed = 0;
  }

  restart() {
    if (!this.active || this.elapsed < this.delay) return;
    this.hide();
    this.onRestart?.();
  }

  update(rawDt) {
    if (this.active) this.elapsed += rawDt;
    const ready = this.active && this.elapsed >= this.delay;
    this.shown = damp(this.shown, ready ? 1 : 0, ready ? 5.5 : 12, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', ready ? 'auto' : 'none');
    setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
    const y = (1 - ease.outCubic(this.shown)) * 18;
    setStyle(this.root, 'transform', `translateY(${y.toFixed(2)}px)`);
  }

  dispose() {
    this.button.removeEventListener('click', this._click);
    removeEventListener('keydown', this._key);
    this.root.remove();
  }
}
