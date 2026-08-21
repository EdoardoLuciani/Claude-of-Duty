import { el, setText, setStyle, clamp, Pool } from './util.js';

const SPAN_DEG = 120; // degrees visible across the strip
const STRIP_W = 470; // css px at k=1, must match .ow-compass width
const PPD = STRIP_W / SPAN_DEG;
const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/**
 * Heading strip, top centre.
 *
 * Ticks are laid out once across two full revolutions (0-720deg) with left
 * positions written as `calc(Npx * var(--k))`, so a resolution change re-scales
 * the whole strip with zero JS work. Only the strip's translateX is touched
 * per frame — one style write for 144 ticks.
 */
export class Compass {
  constructor(parent) {
    this.root = el('div', 'ow-compass', parent);
    this.strip = el('div', 'ow-compass-strip', this.root);
    el('div', 'ow-compass-base', this.root);
    el('div', 'ow-compass-caret', this.root);

    for (let a = 0; a < 720; a += 5) {
      const t = el('div', 'ow-tick' + (a % 15 === 0 ? ' maj' : ''), this.strip);
      t.style.left = `calc(${(a * PPD).toFixed(2)}px * var(--k))`;
      const c = CARD[a % 360];
      if (c) {
        const l = el('div', 'ow-tick-l' + (c.length > 1 ? ' sub' : ''), this.strip, c);
        l.style.left = `calc(${(a * PPD).toFixed(2)}px * var(--k))`;
      }
    }
    setStyle(this.strip, 'width', `calc(${(720 * PPD).toFixed(0)}px * var(--k))`);

    this.objPool = new Pool(
      5,
      () => el('div', 'ow-compass-obj'),
      this.root
    );
    this.pingPool = new Pool(
      8,
      () => el('div', 'ow-compass-ping'),
      this.root
    );

    this.k = 1;
    this._heading = 0;
  }

  /** Short-lived bearing tick for a heard sprint. */
  ping(bearing) {
    const it = this.pingPool.acquire();
    it.a = bearing;
    it.life = 1.25;
    it.t = 0;
  }

  /**
   * @param {number} heading degrees, 0 = north, clockwise
   * @param {Array} objectives [{ bearing:deg, label:'A', color }]
   * @param {number} [dt]
   */
  update(heading, objectives, dt = 0) {
    this.k = this.k || 1;
    const k = this.k;
    const h = ((heading % 360) + 360) % 360;
    this._heading = h;
    const x = STRIP_W * 0.5 * k - (h + 360) * PPD * k;
    setStyle(this.strip, 'transform', `translateX(${x.toFixed(2)}px)`);

    const half = STRIP_W * 0.5 * k;
    const items = this.objPool.items;
    let n = 0;
    if (objectives) {
      for (let i = 0; i < objectives.length && n < items.length; i++) {
        const o = objectives[i];
        let rel = o.bearing - h;
        while (rel > 180) rel -= 360;
        while (rel < -180) rel += 360;
        const it = items[n++];
        if (!it.alive) {
          it.alive = true;
          setStyle(it.node, 'display', '');
        }
        const px = clamp(rel * PPD * k, -half + 8 * k, half - 8 * k);
        setText(it.node, o.label ?? '');
        setStyle(it.node, 'left', '50%');
        setStyle(it.node, 'transform', `translateX(calc(-50% + ${px.toFixed(1)}px))`);
        setStyle(it.node, 'background', o.color ?? 'var(--cyan)');
        setStyle(it.node, 'opacity', Math.abs(rel) > SPAN_DEG * 0.5 ? '0.45' : '1');
      }
    }
    for (let i = n; i < items.length; i++) {
      if (items[i].alive) {
        items[i].alive = false;
        setStyle(items[i].node, 'display', 'none');
      }
    }

    const pings = this.pingPool.items;
    for (let i = 0; i < pings.length; i++) {
      const it = pings[i];
      if (!it.alive) continue;
      it.t += dt;
      if (it.t >= it.life) {
        this.pingPool.release(it);
        continue;
      }
      let rel = it.a - h;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      const px = clamp(rel * PPD * k, -half + 8 * k, half - 8 * k);
      const fade = 1 - it.t / it.life;
      setStyle(it.node, 'left', '50%');
      setStyle(it.node, 'transform', `translateX(calc(-50% + ${px.toFixed(1)}px))`);
      setStyle(it.node, 'opacity', fade.toFixed(3));
    }
  }

  setScale(k) {
    this.k = k;
  }

  dispose() {
    this.root.remove();
  }
}

/** Survival run status: one player score, current wave and enemy count. */
export class ScoreBar {
  constructor(parent) {
    this.root = el('div', 'ow-scorebar', parent);

    const scoreGroup = el('div', 'group score-group', this.root);
    el('span', 'label', scoreGroup, 'SCORE');
    this.score = el('b', 'score', scoreGroup, '000000');

    el('div', 'sep', this.root);
    const waveGroup = el('div', 'group', this.root);
    el('span', 'label', waveGroup, 'WAVE');
    this.wave = el('b', 'wave', waveGroup, '1');

    el('div', 'sep', this.root);
    const creditGroup = el('div', 'group', this.root);
    el('span', 'label', creditGroup, 'CREDITS');
    this.credits = el('b', 'credits', creditGroup, '000000');

    el('div', 'sep', this.root);
    this.status = el('div', 'status', this.root, '6 HOSTILES');
  }

  update(s) {
    setText(this.score, String(Math.max(0, Math.round(s.score ?? 0))).padStart(6, '0'));
    setText(this.wave, Math.max(0, Math.round(s.wave ?? 0)));
    setText(this.credits, String(Math.max(0, Math.round(s.credits ?? 0))).padStart(6, '0'));
    if ((s.marketIn ?? 0) > 0) {
      // The shop countdown owns the strip while it runs; NEXT WAVE returns
      // after the market closes (its timer froze mid-countdown).
      setText(this.status, `SUPPLIES IN ${s.marketIn}s`);
    } else if (s.waveIncoming) {
      setText(this.status, `NEXT WAVE ${Math.max(0, Math.ceil(s.nextWaveIn ?? 0))}s`);
    } else {
      const n = Math.max(0, Math.round(s.enemiesRemaining ?? 0));
      setText(this.status, `${n} ${n === 1 ? 'HOSTILE' : 'HOSTILES'}`);
    }
  }

  dispose() {
    this.root.remove();
  }
}
