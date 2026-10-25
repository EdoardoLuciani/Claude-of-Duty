import * as THREE from 'three';

import { el, svg, setText, setStyle, Pool, ease, clamp01, metres } from './util.ts';

const _v = new THREE.Vector3();
interface Projection {
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
  _pos: THREE.Vector3;
}
interface Objective {
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
function project(
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
export class WorldMarkers {
  objRoot: HTMLElement;
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
        _pos: THREE.Vector3;
      } => {
        const node = el('div', 'ow-nade');
        const ring = el('div', 'ow-nade-ring', node);
        const core = el('div', 'ow-nade-core', node);
        nadeGlyph(core);
        const label = el('div', 'ow-nade-label', node, 'GRENADE');
        return Object.assign(node, { _ring: ring, _label: label, _pos: new THREE.Vector3() });
      },
      this.objRoot
    );
  }

  /** @param {Array} list [{ position:Vector3, label:'A', name:'CAPTURE', color }] */
  updateObjectives(
    list: Objective[] | null,
    camera: THREE.Camera,
    w: number,
    h: number,
    k: number
  ): void {
    const items = this.objPool.items;
    let n = 0;
    const margin = 74 * k;
    if (list) {
      for (let i = 0; i < list.length && n < items.length; i++) {
        const o = list[i];
        if (!o?.position) continue;
        const p = project(o.position, camera, w, h, margin);
        const it = items[n++];
        if (!it.alive) {
          it.alive = true;
          setStyle(it.node, 'display', '');
        }
        const node = it.node;
        setStyle(
          node,
          'transform',
          `translate(${(p.x - 20 * k).toFixed(1)}px,${(p.y - 12 * k).toFixed(1)}px)`
        );
        setStyle(node, 'width', `${(40 * k).toFixed(1)}px`);
        setText(node._letter, o.label ?? '');
        setText(node._dist, metres(p.dist));
        setText(node._name, o.name ?? '');
        const edge = p.offscreen;
        setStyle(node._dia, 'display', edge ? 'none' : '');
        setStyle(node._chev, 'display', edge ? '' : 'none');
        setStyle(node._letter, 'opacity', edge ? '0' : '1');
        if (edge) setStyle(node._chev, 'transform', `rotate(${p.angle.toFixed(1)}deg)`);
        // distant markers dim so a busy map doesn't turn into a wall of icons
        const fade = clamp01(1.15 - p.dist / 260) * (edge ? 0.72 : 1);
        setStyle(node, 'opacity', fade.toFixed(3));
      }
    }
    for (let i = n; i < items.length; i++) {
      if (items[i].alive) {
        items[i].alive = false;
        setStyle(items[i].node, 'display', 'none');
      }
    }
  }

  /** @param {number} fuse seconds until detonation */
  spawnGrenade(
    position: THREE.Vector3,
    fuse = 2.4
  ): import('./pool-types.ts').PoolRecord<GrenadeNode> {
    const it = this.nadePool.acquire();
    it.life = fuse;
    it.node._pos.copy(position);
    return it;
  }

  updateGrenades(dt: number, camera: THREE.Camera, w: number, h: number, k: number): void {
    const items = this.nadePool.items;
    const margin = 56 * k;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.alive) continue;
      it.t += dt;
      if (it.t >= it.life) {
        this.nadePool.release(it);
        continue;
      }
      const node = it.node;
      const p = project(node._pos, camera, w, h, margin);
      setStyle(node, 'transform', `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`);
      const close = p.dist < 9;
      setText(node._label, close ? 'DANGER CLOSE' : 'GRENADE');
      // pulse rate ramps as the fuse burns down
      const remain = 1 - it.t / it.life;
      const rate = 2.2 + (1 - remain) * 5;
      const ph = (it.t * rate) % 1;
      const rs = 0.7 + 0.9 * ease.outCubic(ph);
      setStyle(node._ring, 'transform', `scale(${rs.toFixed(3)})`);
      setStyle(node._ring, 'opacity', (0.9 * (1 - ph)).toFixed(3));
      setStyle(node, 'opacity', clamp01(remain * 4).toFixed(3));
    }
  }

  clear(): void {
    this.nadePool.releaseAll();
  }

  dispose(): void {
    this.objRoot.remove();
  }
}
