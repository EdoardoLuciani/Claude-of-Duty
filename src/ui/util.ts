/**
 * UI primitives: DOM construction, easing curves, pooling, formatting.
 *
 * Rules obeyed here:
 *  - No per-frame allocation. Pools hand back existing elements/records.
 *  - No Math.random(). Anything random comes from an Rng fork passed in.
 *  - No CSS keyframe animation on gameplay feedback: every animated value is
 *    driven from update() so capture frames are deterministic.
 */

/**
 * Condensed system stacks — no webfonts, crisp at any size.
 *
 * Verified against the capture browser with `node src/ui/preview.mjs --fonts`:
 * "Avenir Next Condensed" (four weights) carries the body text, "DIN Condensed"
 * (very narrow, bold only) carries display numerals, and both degrade through
 * Arial Narrow / Helvetica Neue on machines without them.
 */
export const FONT_STACK =
  '"Avenir Next Condensed","DIN Alternate","Roboto Condensed","Arial Narrow",' +
  '"Helvetica Neue",Inter,system-ui,-apple-system,sans-serif';

/** Display face: the ammo count, banners, the menu title. */
export const FONT_DISPLAY =
  '"DIN Condensed","Avenir Next Condensed","Oswald","Arial Narrow",' +
  '"Helvetica Neue",Impact,system-ui,sans-serif';

export const FONT_MONO = '"SF Mono",ui-monospace,"Roboto Mono",Menlo,monospace';

/* ------------------------------------------------------------------ dom --- */

import type { PoolRecord as BasePoolRecord } from './pool-types.ts';
type CachedElement = Element & { [key: string]: any; style: CSSStyleDeclaration };
interface PoolRecord<Node extends HTMLElement = HTMLElement> extends BasePoolRecord<Node> { [key: string]: any }

export function el<T extends HTMLElement = HTMLElement>(tag: string, cls?: string | null, parent?: Node | null, text?: string | number): T {
  const n = document.createElement(tag) as T;
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = String(text);
  if (parent) parent.appendChild(n);
  return n;
}

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, string | number> | null, parent?: Node | null): SVGElementTagNameMap[K];
export function svg(tag: string, attrs?: Record<string, string | number> | null, parent?: Node | null): SVGElement;
export function svg(tag: string, attrs?: Record<string, string | number> | null, parent?: Node | null): SVGElement {
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
  const key = '_ows_' + prop;
  if (node[key] !== value) {
    node[key] = value;
    node.style.setProperty(prop, value);
  }
}

export function setClass(node: CachedElement, cls: string, on: boolean): void {
  const key = '_owc_' + cls;
  if (node[key] !== on) {
    node[key] = on;
    node.classList.toggle(cls, on);
  }
}

/* --------------------------------------------------------------- easing --- */

export const ease: Record<string, (t: number) => number> = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuint: (t) => 1 - (1 - t) ** 5,
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Overshoot then settle — hitmarker / banner punch. */
  outBack: (t) => {
    const c = 1.9;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  },
  /** Damped oscillation, k = number of bounces. */
  outElastic: (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return 1 - 2 ** (-9 * t) * Math.cos(t * 22);
  },
  /** Fast attack, slow release — good for anything that must feel "snappy". */
  punch: (t) => (t < 0.18 ? ease.outQuint(t / 0.18) : 1 - ease.inOutSine((t - 0.18) / 0.82)),
};

/* ----------------------------------------------------------------- math --- */

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Framerate-independent exponential approach. `rate` = 1/e per second. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/* ------------------------------------------------------------- format --- */

/** Distance readout: <10m one decimal, else integer. */
export function metres(d: number): string {
  return d < 10 ? d.toFixed(1) + 'M' : (d | 0) + 'M';
}

/* ------------------------------------------------------------------ pool --- */

/**
 * Fixed-size element pool. `make()` builds one element; records carry their own
 * animation state. Nothing is allocated after construction.
 */
export class Pool<Node extends HTMLElement = HTMLElement> {
  items: PoolRecord<Node>[]; count: number; _next: number;
  constructor(count: number, make: (index: number) => Node, parent?: HTMLElement | null) {
    this.items = new Array(count);
    for (let i = 0; i < count; i++) {
      const node = make(i);
      if (parent) parent.appendChild(node);
      node.style.display = 'none';
      this.items[i] = { node, alive: false, t: 0, life: 1, i, a: 0, b: 0, c: 0, d: 0, s: '' };
    }
    this.count = count;
    this._next = 0;
  }

  /** Oldest-first reuse so a burst never starves. */
  acquire(): PoolRecord<Node> {
    let best: PoolRecord<Node> | null = null;
    let bestT = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const it = this.items[(this._next + i) % this.count];
      if (!it.alive) {
        this._next = (it.i + 1) % this.count;
        it.alive = true;
        it.t = 0;
        it.node.style.display = '';
        return it;
      }
      const age = it.t / (it.life || 1);
      if (age > bestT) {
        bestT = age;
        best = it;
      }
    }
    best!.alive = true;
    best!.t = 0;
    best!.node.style.display = '';
    return best!;
  }

  release(it: PoolRecord<Node>): void {
    if (!it.alive) return;
    it.alive = false;
    it.node.style.display = 'none';
  }

  releaseAll(): void {
    for (let i = 0; i < this.count; i++) this.release(this.items[i]);
  }
}
