import * as THREE from 'three';

import type { EngineContext } from '../core/context.ts';
import type { Rng } from '../core/rng.ts';
import { clamp01, lerp } from './util.ts';
interface Traversable {
  from: [number, number, number];
  to: [number, number, number];
  w?: number;
  kind?: string;
}
function buildingTraversables(info: unknown): Traversable[] {
  if (
    typeof info !== 'object' ||
    info === null ||
    !('traversable' in info) ||
    !Array.isArray(info.traversable)
  )
    return [];
  return info.traversable.filter((value: unknown): value is Traversable => {
    if (typeof value !== 'object' || value === null || !('from' in value) || !('to' in value))
      return false;
    return (
      isPointTuple(value.from) &&
      isPointTuple(value.to) &&
      (!('w' in value) || value.w === undefined || typeof value.w === 'number') &&
      (!('kind' in value) || value.kind === undefined || typeof value.kind === 'string')
    );
  });
}
function isPointTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n: unknown): n is number => typeof n === 'number')
  );
}
type MinimapContext = Pick<EngineContext, 'peek'>;
interface MapLabel {
  x: number;
  z: number;
  code: string;
  w: number;
  text: string | null;
}
interface MapObjective {
  x: number;
  z: number;
  label?: string;
}
interface MapBlip {
  x: number;
  z: number;
  kind: string;
  heading?: number;
  fade?: number;
}
interface MapPulse {
  x: number;
  z: number;
  y?: number;
  radius?: number;
}
export interface MinimapState {
  x?: number;
  z?: number;
  heading?: number;
  fov?: number;
  objectives?: MapObjective[] | null;
  blips?: MapBlip[] | null;
  pulses?: MapPulse[] | null;
  pulseTime?: number;
  playerY?: number;
}

const VBAKE = 1024; // vector layout map: CPU-drawn once, so detail is nearly free

/*
 * The map is drawn as a plan of the level, and its value ladder is deliberately
 * inverted against the rest of the HUD: the out-of-play ground is the darkest
 * thing on the panel, background blocks sit a step above it, the street is
 * lighter again so the road reads as the negative space between the masses, and
 * the buildings you can walk into are the lightest tone on the panel with a full
 * outline around them. Only that last step is new — the walkable floor is what
 * the eye should find first — and the three below it are load-bearing: lift the
 * blocks to meet the street and the road stops reading as a road.
 *
 * Names are the floor plan's own vocabulary (SHOP, STORAGE, LIVING, WORKSHOP,
 * RUIN), read off the furnish rectangles the world already authors. Keep an eye
 * on the top of the range: the lightest tone is capped below the sky so the
 * panel stays a corner of the frame rather than the first thing the eye lands
 * on, and contacts keep their dark rim so they stay the loudest marks here.
 */
const PLATE = '#1b232a'; // out-of-play ground, also the plate under everything
const STREET = '#63717e';
const MASS_LO: [number, number, number] = [50, 59, 68]; // background block, 1 floor
const MASS_HI: [number, number, number] = [68, 79, 90]; // ...to 4 floors
const OPEN_LO: [number, number, number] = [150, 160, 171]; // enterable, 1 floor
const OPEN_HI: [number, number, number] = [178, 187, 196]; // ...to 4 floors
const MASS_KEY = 'rgba(255,255,255,.40)'; // north/west return
const MASS_SHADE = 'rgba(6,11,16,.45)'; // south/east edge
const MASS_RIM = 'rgba(8,14,19,.85)'; // drawn footprint outline
const DOOR_INK = 'rgba(42,150,96,.95)';
const SHOP_INK = 'rgba(30,140,170,.95)';
const ramp = (a: readonly number[], b: readonly number[], t: number): string =>
  'rgb(' +
  Math.round(lerp(a[0], b[0], t)) +
  ',' +
  Math.round(lerp(a[1], b[1], t)) +
  ',' +
  Math.round(lerp(a[2], b[2], t)) +
  ')';

/**
 * What the player would call the building: the first furnish rectangle is the
 * one the world authors as its primary use (shop, workshop, storage, living),
 * and `ruin` on the spec outranks it because a ruin is the whole building. A
 * background block authors none of that: it gets a code and no name.
 */
function labelKind(spec: object): string | null {
  if ('ruin' in spec && spec.ruin) return 'RUIN';
  if (!('rooms' in spec) || !Array.isArray(spec.rooms)) return null;
  const room: unknown = spec.rooms[0];
  if (
    typeof room !== 'object' ||
    room === null ||
    !('furnish' in room) ||
    !Array.isArray(room.furnish)
  )
    return null;
  const furnish: unknown = room.furnish[0];
  if (typeof furnish !== 'object' || furnish === null || !('kind' in furnish)) return null;
  return typeof furnish.kind === 'string' && furnish.kind ? furnish.kind.toUpperCase() : null;
}

/** One-time authored terrain bake/data; PixiMinimap owns all live presentation. */
export class Minimap {
  rng: Rng;
  span: number;
  viewSpan: number;
  centre: THREE.Vector2;
  baked: HTMLCanvasElement | null;
  labels: MapLabel[];
  bakeTries: number;
  bakeDone: boolean;
  _probe: THREE.Vector3;
  constructor(rng: Rng) {
    this.rng = rng;
    this.span = 190; // metres covered by the bake
    this.viewSpan = 60; // metres visible in the widget
    this.centre = new THREE.Vector2(0, 0);

    this.baked = null;
    this.labels = [];
    this.bakeTries = 0;
    this.bakeDone = false;

    this._probe = new THREE.Vector3();
  }

  /* --------------------------------------------------------------- bake --- */

  tryBake(ctx: MinimapContext): void {
    if (this.bakeDone || this.bakeTries > 6) return;
    this.bakeTries++;
    if (this._buildVectorMap(ctx)) this.bakeDone = true;
  }

  /**
   * Vector layout map from the world's footprints, doors, and room kinds.
   *
   * Two dozen axis-aligned LEVEL-space polygons plus `isOpen` — not scene
   * geometry. 1024² because a 1.8 m door is a smudge at 512² over 190 m.
   * The level-to-canvas affine comes from three `levelToWorld` probes so the
   * map inherits the world's yaw without this module knowing it.
   */
  _buildVectorMap(ctx: MinimapContext): boolean {
    const world = ctx.peek('world');
    const infos = world?.buildings;
    if (!world || !Array.isArray(infos) || !infos.length) return false;
    if (typeof world.levelToWorld !== 'function' || typeof world.isOpen !== 'function')
      return false;

    const N = VBAKE;
    const ppm = N / this.span;
    const p = this._probe;
    const o = world.levelToWorld(0, 0, 0, p);
    const ox = o.x;
    const oz = o.z;
    const ex = world.levelToWorld(1, 0, 0, p);
    const xx = ex.x - ox;
    const xz = ex.z - oz;
    const ez = world.levelToWorld(0, 0, 1, p);
    const zx = ez.x - ox;
    const zz = ez.z - oz;
    if (!Number.isFinite(xx) || !Number.isFinite(zz)) return false;

    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    const g = cv.getContext('2d')!;

    // out-of-play ground: the darkest tone on the panel, but nowhere near black
    g.fillStyle = PLATE;
    g.fillRect(0, 0, N, N);

    // level -> canvas, so everything below is authored in metres of LEVEL space
    g.setTransform(
      xx * ppm,
      xz * ppm,
      zx * ppm,
      zz * ppm,
      (ox - this.centre.x) * ppm + N * 0.5,
      (oz - this.centre.y) * ppm + N * 0.5
    );

    // ---- street / alley network, as run-length rects in level space --------
    // isOpen() is authored in world space; the affine above converts, so the
    // runs come out exactly axis-aligned in the level frame they were authored
    // in and tile without seams.
    const STEP = 0.5;
    g.fillStyle = STREET;
    for (let lz = -64; lz < 54; lz += STEP) {
      let run = -1;
      for (let lx = -44; lx <= 44 + STEP; lx += STEP) {
        const cxw = ox + lx * xx + (lz + STEP * 0.5) * zx;
        const czw = oz + lx * xz + (lz + STEP * 0.5) * zz;
        const open = lx <= 44 && world.isOpen(cxw, czw, 0);
        if (open && run < 0) run = lx;
        else if (!open && run >= 0) {
          g.fillRect(run, lz, lx - run, STEP * 1.16);
          run = -1;
        }
      }
    }

    // ---- building footprints ---------------------------------------------
    const labels: MapLabel[] = [];
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const spec = info && 'spec' in info ? info.spec : info;
      if (!spec || spec.w === undefined || spec.d === undefined) continue;
      const x0 = (spec.x ?? 0) - spec.w * 0.5;
      const z0 = (spec.z ?? 0) - spec.d * 0.5;
      const enterable = 'enterable' in spec && !!spec.enterable;
      // taller mass reads slightly lighter, so the skyline is legible on the map
      const floors = 'floors' in spec && typeof spec.floors === 'number' ? spec.floors : 2;
      const t = clamp01((floors - 1) / 3);
      g.fillStyle = enterable ? ramp(OPEN_LO, OPEN_HI, t) : ramp(MASS_LO, MASS_HI, t);
      g.fillRect(x0, z0, spec.w, spec.d);
      // a light return on the north and west edges: a cheap key-light cue that
      // separates two footprints sharing a wall
      g.fillStyle = MASS_KEY;
      g.fillRect(x0, z0, spec.w, 0.34);
      g.fillRect(x0, z0, 0.34, spec.d);
      g.fillStyle = MASS_SHADE;
      g.fillRect(x0, z0 + spec.d - 0.34, spec.w, 0.34);
      g.fillRect(x0 + spec.w - 0.34, z0, 0.34, spec.d);

      // a ruin is a footprint with an open roof: hatch it, the way the plan does
      if ('ruin' in spec && spec.ruin) {
        g.save();
        g.beginPath();
        g.rect(x0, z0, spec.w, spec.d);
        g.clip();
        g.strokeStyle = 'rgba(10,16,21,.30)';
        g.lineWidth = 0.18;
        g.beginPath();
        for (let k = -spec.d; k < spec.w + spec.d; k += 2) {
          g.moveTo(x0 + k, z0);
          g.lineTo(x0 + k + spec.d, z0 + spec.d);
        }
        g.stroke();
        g.restore();
      }

      // enterable masses get a full outline: on this palette the outline, not
      // the fill, is what tells one footprint from the next
      g.strokeStyle = MASS_RIM;
      g.lineWidth = enterable ? 0.26 : 0.14;
      g.strokeRect(x0, z0, spec.w, spec.d);

      // the way in: `traversable` gives the path through the opening, which is
      // perpendicular to the facade it is cut into and whose midpoint sits on
      // it. The opening itself runs along the wall, and `w` is how wide it is
      // (1.8 for a door, wider for a shopfront), so draw the crossing of the
      // path, not the path. Then the name: what the player would call this
      // building, drawn live.
      if (enterable) {
        g.lineWidth = 0.55;
        g.lineCap = 'butt';
        for (const tr of buildingTraversables(info)) {
          const ux = tr.to[0] - tr.from[0];
          const uz = tr.to[2] - tr.from[2];
          const len = Math.hypot(ux, uz) || 1;
          const hw = (tr.w ?? 1.8) * 0.5;
          const mx = (tr.from[0] + tr.to[0]) * 0.5;
          const mz = (tr.from[2] + tr.to[2]) * 0.5;
          g.strokeStyle = tr.kind === 'shop' ? SHOP_INK : DOOR_INK;
          g.beginPath();
          g.moveTo(mx - (uz / len) * hw, mz + (ux / len) * hw);
          g.lineTo(mx + (uz / len) * hw, mz - (ux / len) * hw);
          g.stroke();
        }
      }

      // one label per building: the name where the world gives one, its code
      // always, and the room the pair has on screen. The level is yawed, so that
      // is the footprint's axis-aligned extent along world X: a little wider
      // than the mass itself, but the label sits at its centre, where the two
      // come out within a couple of px of each other.
      const wv = world.levelToWorld(spec.x, 0, spec.z, p);
      labels.push({
        x: wv.x,
        z: wv.z,
        code: 'id' in spec && typeof spec.id === 'string' ? spec.id : '',
        text: enterable ? labelKind(spec) : null,
        w: spec.w * Math.abs(xx) + spec.d * Math.abs(zx),
      });
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.labels = labels;

    // ---- grain: no HUD surface is a flat colour --------------------------
    // A 64² noise tile stamped over the bake, rather than a per-pixel pass with
    // an rng call in it: at VBAKE that loop alone was a million iterations and
    // a full-image readback on the main thread, which is what turned the bake
    // into a visible hitch. This is not that grain — it is stronger per pixel
    // (±3.8 against ±2.75) and it repeats every 11.9 m of ground — but at 3%
    // alpha it does the same job for the cost of one fill.
    const tile = document.createElement('canvas');
    tile.width = 64;
    tile.height = 64;
    const tg = tile.getContext('2d')!;
    const tImg = tg.createImageData(64, 64);
    const td = tImg.data;
    for (let i = 0; i < td.length; i += 4) {
      const v = this.rng.float() < 0.5 ? 0 : 255;
      td[i] = v;
      td[i + 1] = v;
      td[i + 2] = v;
      td[i + 3] = 255;
    }
    tg.putImageData(tImg, 0, 0);
    g.globalAlpha = 0.03;
    g.fillStyle = g.createPattern(tile, 'repeat') ?? '#000';
    g.fillRect(0, 0, N, N);

    this.baked = cv;
    return true;
  }

  dispose(): void {
    this.baked = null;
    this.labels = [];
  }
}
