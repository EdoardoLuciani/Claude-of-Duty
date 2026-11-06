/**
 * UI primitives: DOM construction, easing curves, pooling, formatting.
 *
 * Rules obeyed here:
 *  - No per-frame allocation. Pools hand back existing elements/records.
 *  - No Math.random(). Anything random comes from an Rng fork passed in.
 *  - No CSS keyframe animation on gameplay feedback: every animated value is
 *    driven from update() so capture frames are deterministic.
 */

/** Local condensed font stacks: Avenir Next Condensed for body, DIN Condensed for
 * display numerals, with Arial Narrow / Helvetica Neue fallbacks. No webfonts.
 */
export const FONT_STACK =
  '"Avenir Next Condensed","DIN Alternate","Roboto Condensed","Arial Narrow",' +
  '"Helvetica Neue",Inter,system-ui,-apple-system,sans-serif';

/** Display face: the ammo count, banners, the menu title. */
export const FONT_DISPLAY =
  '"DIN Condensed","Avenir Next Condensed","Oswald","Arial Narrow",' +
  '"Helvetica Neue",Impact,system-ui,sans-serif';

export const FONT_MONO = '"SF Mono",ui-monospace,"Roboto Mono",Menlo,monospace';

type CachedElement = Element & {
  style: CSSStyleDeclaration;
  _owText?: string;
  _ows?: Map<string, string>;
  _owc?: Map<string, boolean>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string | null,
  parent?: Node | null,
  text?: string | number
): HTMLElementTagNameMap[K];
export function el(
  tag: string,
  cls?: string | null,
  parent?: Node | null,
  text?: string | number
): HTMLElement;
export function el(
  tag: string,
  cls?: string | null,
  parent?: Node | null,
  text?: string | number
): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = String(text);
  if (parent) parent.appendChild(n);
  return n;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number> | null,
  parent?: Node | null
): SVGElementTagNameMap[K];
export function svg(
  tag: string,
  attrs?: Record<string, string | number> | null,
  parent?: Node | null
): SVGElement;
export function svg(
  tag: string,
  attrs?: Record<string, string | number> | null,
  parent?: Node | null
): SVGElement {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}

/** Write textContent only when it actually changed — avoids layout thrash. */
export function setText(node: CachedElement, value: string | number): void {
  const s = String(value);
  if (node._owText !== s) {
    node._owText = s;
    node.textContent = s;
  }
}

/** Write any style property only on change. */
export function setStyle(node: CachedElement, prop: string, value: string): void {
  const styles = node._ows ?? (node._ows = new Map());
  if (styles.get(prop) !== value) {
    styles.set(prop, value);
    node.style.setProperty(prop, value);
  }
}

export function setClass(node: CachedElement, cls: string, on: boolean): void {
  const classes = node._owc ?? (node._owc = new Map());
  if (classes.get(cls) !== on) {
    classes.set(cls, on);
    node.classList.toggle(cls, on);
  }
}

export const ease: Record<string, (t: number) => number> = {
  inQuad: (t): number => t * t,
  outQuad: (t): number => t * (2 - t),
  outCubic: (t): number => 1 - (1 - t) ** 3,
  outQuint: (t): number => 1 - (1 - t) ** 5,
  inOutSine: (t): number => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Overshoot then settle — hitmarker / banner punch. */
  outBack: (t): number => {
    const c = 1.9;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  },
};

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Framerate-independent exponential approach. `rate` = 1/e per second. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export interface PoolRecord {
  readonly node: null;
  alive: boolean;
  t: number;
  life: number;
  i: number;
  a: number;
  b: number;
  c: number;
}

/** Fixed-size retained animation state; Pixi owns the visual objects. */
export class Pool {
  readonly items: PoolRecord[];
  private next = 0;

  constructor(count: number) {
    this.items = Array.from({ length: count }, (_, i): PoolRecord => ({
      node: null,
      alive: false,
      t: 0,
      life: 1,
      i,
      a: 0,
      b: 0,
      c: 0,
    }));
  }

  /** Free slots rotate; a full pool reuses the greatest normalized age. */
  acquire(): PoolRecord {
    let best = this.items[this.next];
    let bestAge = -Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[(this.next + i) % this.items.length];
      if (!item.alive) {
        this.next = (item.i + 1) % this.items.length;
        best = item;
        break;
      }
      const age = item.t / (item.life || 1);
      if (age > bestAge) {
        bestAge = age;
        best = item;
      }
    }
    best.alive = true;
    best.t = 0;
    return best;
  }

  /** Advance one slot in its controller's loop, without callbacks or allocations. */
  advance(item: PoolRecord, dt: number): boolean {
    if (!item.alive) return false;
    item.t += dt;
    if (item.t >= item.life) item.alive = false;
    return item.alive;
  }

  releaseAll(): void {
    for (const item of this.items) item.alive = false;
  }
}
