import * as THREE from 'three';

import { el, svg, setText, setStyle, Pool, ease, clamp01, metres } from './util.ts';

const _v = new THREE.Vector3();
export interface Projection {
  x: number;
  y: number;
  dist: number;
  behind: boolean;
  offscreen: boolean;
  angle: number;
}
interface ObjectiveNode extends HTMLElement {
  _dia: SVGSVGElement;
  _chev: SVGSVGElement;
  _letter: HTMLElement;
  _dist: HTMLElement;
  _name: HTMLElement;
}
interface GrenadeNode extends HTMLElement {
  _ring: HTMLElement;
  _label: HTMLElement;
}
export interface Objective {
  position?: THREE.Vector3;
  label?: string;
  name?: string;
  color?: string;
}

/**
 * Projects a world point into HUD pixels.
 * Returns the shared scratch object — never held past the call site.
 */
const _proj: Projection = { x: 0, y: 0, dist: 0, behind: false, offscreen: false, angle: 0 };
export function projectMarker(
  pos: THREE.Vector3,
  camera: THREE.Camera,
  w: number,
  h: number,
  margin: number
): Projection {
  _v.copy(pos);
  const dist = _v.distanceTo(camera.position);
  _v.project(camera);
  const behind = _v.z > 1;
  let x = (_v.x * 0.5 + 0.5) * w;
  let y = (-_v.y * 0.5 + 0.5) * h;
  if (behind) {
    // mirror through the centre so the edge arrow points the correct way
    x = w - x;
    y = h - y;
  }
  const cx = w * 0.5;
  const cy = h * 0.5;
  let dx = x - cx;
  let dy = y - cy;
  const mx = w * 0.5 - margin;
  const my = h * 0.5 - margin;
  let off = behind;
  if (Math.abs(dx) > mx || Math.abs(dy) > my) {
    off = true;
    const s = Math.min(mx / (Math.abs(dx) || 1e-4), my / (Math.abs(dy) || 1e-4));
    dx *= s;
    dy *= s;
  }
  _proj.x = cx + dx;
  _proj.y = cy + dy;
  _proj.dist = dist;
  _proj.behind = behind;
  _proj.offscreen = off;
  _proj.angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return _proj;
}

function diamond(parent: HTMLElement): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg(
    'rect',
    {
      x: 3.2,
      y: 3.2,
      width: 9.6,
      height: 9.6,
      transform: 'rotate(45 8 8)',
      fill: 'rgba(121,210,255,.9)',
      stroke: 'rgba(6,20,28,.75)',
      'stroke-width': 1,
    },
    s
  );
  return s;
}

function chevron(parent: HTMLElement): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg(
    'path',
    {
      d: 'M8 1.5 14.4 13H1.6z',
      fill: 'rgba(121,210,255,.95)',
      stroke: 'rgba(6,20,28,.7)',
      'stroke-width': 1,
    },
    s
  );
  return s;
}

function nadeGlyph(parent: HTMLElement): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 16 16' }, parent);
  svg(
    'circle',
    {
      cx: 8,
      cy: 8,
      r: 5.4,
      fill: 'rgba(255,63,49,.95)',
      stroke: 'rgba(0,0,0,.5)',
      'stroke-width': 1,
    },
    s
  );
  svg('rect', { x: 7.2, y: 0.8, width: 1.6, height: 3.2, fill: 'rgba(255,63,49,.95)' }, s);
  return s;
}

/**
 * World-anchored objective markers with distance and grenade danger indicators.
 *
 * Off-screen targets are clamped to a rectangular ring inside the safe area and
 * their glyph swaps to a chevron pointing at the target — the same behaviour as
 * a CoD objective you have turned away from.
 */
export interface ObjectiveMarkerState {
  visible: boolean;
  x: number;
  y: number;
  edge: boolean;
  angle: number;
  alpha: number;
  label: string;
  distance: string;
  name: string;
}
export interface GrenadeMarkerState {
  visible: boolean;
  position: THREE.Vector3;
  t: number;
  life: number;
  x: number;
  y: number;
  label: string;
  ringScale: number;
  ringAlpha: number;
  alpha: number;
}

export class WorldMarkers {
  readonly objectives: ObjectiveMarkerState[] = Array.from(
    { length: 6 },
    (): ObjectiveMarkerState => ({
      visible: false,
      x: 0,
      y: 0,
      edge: false,
      angle: 0,
      alpha: 0,
      label: '',
      distance: '',
      name: '',
    })
  );
  readonly grenades: GrenadeMarkerState[] = Array.from({ length: 4 }, (): GrenadeMarkerState => ({
    visible: false,
    position: new THREE.Vector3(),
    t: 0,
    life: 1,
    x: 0,
    y: 0,
    label: '',
    ringScale: 1,
    ringAlpha: 0,
    alpha: 0,
  }));
  private nextGrenade = 0;
  objRoot: HTMLElement;
  // Element pools are native presentation only; snapshots above own all state.
  objPool: Pool<ObjectiveNode>;
  nadePool: Pool<GrenadeNode>;
  constructor(parent: HTMLElement) {
    this.objRoot = el('div', 'ow-layer', parent);
    this.objPool = new Pool(
      6,
      (): HTMLDivElement & {
        _dia: SVGSVGElement;
        _chev: SVGSVGElement;
        _letter: HTMLDivElement;
        _dist: HTMLDivElement;
        _name: HTMLDivElement;
      } => {
        const node = el('div', 'ow-mk');
        const gl = el('div', 'ow-mk-glyph', node);
        const dia = diamond(gl);
        const chev = chevron(gl);
        chev.style.display = 'none';
        const letter = el('div', 'ow-mk-letter', gl, 'A');
        const dist = el('div', 'ow-mk-dist', node, '0M');
        const name = el('div', 'ow-mk-name', node, '');
        return Object.assign(node, {
          _dia: dia,
          _chev: chev,
          _letter: letter,
          _dist: dist,
          _name: name,
        });
      },
      this.objRoot
    );

    this.nadePool = new Pool(
      4,
      (): HTMLDivElement & {
        _ring: HTMLDivElement;
        _label: HTMLDivElement;
      } => {
        const node = el('div', 'ow-nade');
        const ring = el('div', 'ow-nade-ring', node);
        const core = el('div', 'ow-nade-core', node);
        nadeGlyph(core);
        const label = el('div', 'ow-nade-label', node, 'GRENADE');
        return Object.assign(node, { _ring: ring, _label: label });
      },
      this.objRoot
    );
  }

  updateObjectives(
    list: Objective[] | null,
    camera: THREE.Camera,
    w: number,
    h: number,
    k: number,
    present = true
  ): void {
    let n = 0;
    if (list)
      for (const o of list) {
        if (!o?.position) continue;
        if (n >= this.objectives.length) break;
        const p = projectMarker(o.position, camera, w, h, 74 * k),
          state = this.objectives[n++];
        state.visible = true;
        state.x = p.x;
        state.y = p.y;
        state.edge = p.offscreen;
        state.angle = p.angle;
        state.alpha = clamp01(1.15 - p.dist / 260) * (p.offscreen ? 0.72 : 1);
        state.label = o.label ?? '';
        state.distance = metres(p.dist);
        state.name = o.name ?? '';
      }
    for (let i = n; i < this.objectives.length; i++) this.objectives[i].visible = false;
    if (!present) return;
    for (let i = 0; i < this.objectives.length; i++) {
      const s = this.objectives[i],
        node = this.objPool.items[i].node;
      setStyle(node, 'display', s.visible ? '' : 'none');
      if (!s.visible) continue;
      setStyle(
        node,
        'transform',
        `translate(${(s.x - 20 * k).toFixed(1)}px,${(s.y - 12 * k).toFixed(1)}px)`
      );
      setStyle(node, 'width', `${(40 * k).toFixed(1)}px`);
      setText(node._letter, s.label);
      setText(node._dist, s.distance);
      setText(node._name, s.name);
      setStyle(node._dia, 'display', s.edge ? 'none' : '');
      setStyle(node._chev, 'display', s.edge ? '' : 'none');
      setStyle(node._letter, 'opacity', s.edge ? '0' : '1');
      if (s.edge) setStyle(node._chev, 'transform', `rotate(${s.angle.toFixed(1)}deg)`);
      setStyle(node, 'opacity', s.alpha.toFixed(3));
    }
  }

  /** Copy caller position; same bounded oldest-first reuse as the native pool. */
  spawnGrenade(position: THREE.Vector3, fuse = 2.4): GrenadeMarkerState {
    let slot = this.grenades[0],
      oldest = -Infinity;
    for (let i = 0; i < this.grenades.length; i++) {
      const index = (this.nextGrenade + i) % this.grenades.length,
        candidate = this.grenades[index];
      if (!candidate.visible) {
        slot = candidate;
        this.nextGrenade = (index + 1) % this.grenades.length;
        break;
      }
      const age = candidate.t / (candidate.life || 1);
      if (age > oldest) {
        oldest = age;
        slot = candidate;
      }
    }
    slot.visible = true;
    slot.t = 0;
    slot.life = fuse;
    slot.position.copy(position);
    return slot;
  }

  updateGrenades(
    dt: number,
    camera: THREE.Camera,
    w: number,
    h: number,
    k: number,
    present = true
  ): void {
    for (let i = 0; i < this.grenades.length; i++) {
      const s = this.grenades[i];
      if (s.visible) {
        s.t += dt;
        if (s.t >= s.life) s.visible = false;
        else {
          const p = projectMarker(s.position, camera, w, h, 56 * k);
          s.x = p.x;
          s.y = p.y;
          s.label = p.dist < 9 ? 'DANGER CLOSE' : 'GRENADE';
          const remain = 1 - s.t / s.life,
            phase = (s.t * (2.2 + (1 - remain) * 5)) % 1;
          s.ringScale = 0.7 + 0.9 * ease.outCubic(phase);
          s.ringAlpha = 0.9 * (1 - phase);
          s.alpha = clamp01(remain * 4);
        }
      }
      if (!present) continue;
      const node = this.nadePool.items[i].node;
      setStyle(node, 'display', s.visible ? '' : 'none');
      if (!s.visible) continue;
      setStyle(node, 'transform', `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`);
      setText(node._label, s.label);
      setStyle(node._ring, 'transform', `scale(${s.ringScale.toFixed(3)})`);
      setStyle(node._ring, 'opacity', s.ringAlpha.toFixed(3));
      setStyle(node, 'opacity', s.alpha.toFixed(3));
    }
  }

  clear(present = true): void {
    for (const state of this.grenades) state.visible = false;
    if (present) for (const item of this.nadePool.items) setStyle(item.node, 'display', 'none');
  }

  dispose(): void {
    this.objRoot.remove();
  }
}
