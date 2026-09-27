import * as THREE from 'three';
import { el, clamp, clamp01, lerp, FONT_STACK } from './util.js';

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
const MASS_LO = [50, 59, 68]; // background block, 1 floor
const MASS_HI = [68, 79, 90]; // ...to 4 floors
const OPEN_LO = [150, 160, 171]; // enterable, 1 floor
const OPEN_HI = [178, 187, 196]; // ...to 4 floors
const MASS_KEY = 'rgba(255,255,255,.40)'; // north/west return
const MASS_SHADE = 'rgba(6,11,16,.45)'; // south/east edge
const MASS_RIM = 'rgba(8,14,19,.85)'; // drawn footprint outline
const DOOR_INK = 'rgba(42,150,96,.95)';
const SHOP_INK = 'rgba(30,140,170,.95)';
const NAME_INK = 'rgba(12,19,25,.92)'; // the loud line of a label
const CODE_INK = 'rgba(12,19,25,.60)'; // its building code, under the name
const BARE_INK = 'rgba(196,214,226,.28)'; // a code on a mass too dark for it

const ramp = (a, b, t) => 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' +
  Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t)) + ')';

/**
 * What the player would call the building: the first furnish rectangle is the
 * one the world authors as its primary use (shop, workshop, storage, living),
 * and `ruin` on the spec outranks it because a ruin is the whole building. A
 * background block authors none of that: it gets a code and no name.
 */
function labelKind(spec) {
  if (spec.ruin) return 'RUIN';
  const kind = spec.rooms?.[0]?.furnish?.[0]?.kind;
  return kind ? kind.toUpperCase() : null;
}

/**
 * Tactical minimap, top left.
 *
 * The map is a plan of the level, drawn from the world's own layout data: real
 * footprint polygons, the street network as the negative space between them,
 * crisp dark outlines, hatched ruins, the door openings, and a label on every
 * building — what it is for, and its code. Once baked, per-frame cost is a
 * single drawImage, a handful of labels, and blips. A world-less context keeps
 * the scrolling grid plate instead of a second map pipeline.
 *
 * Player arrow stays centred and rotates (map is north-up, matching the
 * compass strip); enemy blips come from `getHudActors()` (LOS / recent shot).
 */
export class Minimap {
  constructor(parent, rng) {
    this.root = el('div', 'ow-minimap', parent);
    this.canvas = el('canvas', null, this.root);
    this.g = this.canvas.getContext('2d');
    for (const c of ['tl', 'tr', 'bl', 'br']) el('div', 'ow-mm-corner ' + c, this.root);
    el('div', 'ow-mm-n', this.root, 'N');
    const tag = el('div', 'ow-mm-tag', this.root);
    el('span', null, tag, 'ZONE 07');
    this.scaleTag = el('span', null, tag, '60M');

    this.rng = rng;
    this.k = 1;
    this.cssSize = 178;
    this.span = 190; // metres covered by the bake
    this.viewSpan = 60; // metres visible in the widget
    this.centre = new THREE.Vector2(0, 0);

    this.baked = null;
    this.labels = [];
    this.bakeTries = 0;
    this.bakeDone = false;

    this._probe = new THREE.Vector3();

    this.resize(1);
  }

  resize(k) {
    this.k = k;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(this.cssSize * k * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.px = px;
  }

  /* --------------------------------------------------------------- bake --- */

  tryBake(ctx) {
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
  _buildVectorMap(ctx) {
    const world = ctx.peek('world');
    const infos = world?.buildings;
    if (!Array.isArray(infos) || !infos.length) return false;
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
    const g = cv.getContext('2d');

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
    const labels = [];
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const spec = info?.spec ?? info;
      if (!spec || spec.w === undefined || spec.d === undefined) continue;
      const x0 = (spec.x ?? 0) - spec.w * 0.5;
      const z0 = (spec.z ?? 0) - spec.d * 0.5;
      const enterable = !!spec.enterable;
      // taller mass reads slightly lighter, so the skyline is legible on the map
      const t = clamp01(((spec.floors ?? 2) - 1) / 3);
      g.fillStyle = enterable
        ? ramp(OPEN_LO, OPEN_HI, t)
        : ramp(MASS_LO, MASS_HI, t);
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
      if (spec.ruin) {
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
        for (const tr of info.traversable ?? []) {
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
        x: wv.x, z: wv.z, code: spec.id ?? '',
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
    const tg = tile.getContext('2d');
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
    g.fillStyle = g.createPattern(tile, 'repeat');
    g.fillRect(0, 0, N, N);

    this.baked = cv;
    return true;
  }

  /* --------------------------------------------------------------- draw --- */

  /**
   * @param {object} s { x, z, heading(deg), fov(deg),
   *                     blips:[{x,z,kind,heading,fade}], objectives:[{x,z,label}] }
   */
  draw(s) {
    const g = this.g;
    const S = this.px;
    if (!S) return;
    const half = S * 0.5;
    const ppm = S / this.viewSpan; // canvas pixels per metre

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);

    // base plate — never pure black, always slightly blue. Opaque, and every
    // layer above it is opaque or drawn over it, so the widget composites as a
    // single solid tile: nothing in the scene can show through the map. While
    // the bake is still coming, this plate is the whole panel.
    g.fillStyle = PLATE;
    g.fillRect(0, 0, S, S);

    g.save();
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();

    const cx = s.x ?? 0;
    const cz = s.z ?? 0;

    if (this.baked) {
      const B = this.baked.width;
      const bppm = B / this.span;
      const srcW = this.viewSpan * bppm;
      const sx = (cx - this.centre.x) * bppm + B * 0.5 - srcW * 0.5;
      const sy = (cz - this.centre.y) * bppm + B * 0.5 - srcW * 0.5;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.baked, sx, sy, srcW, srcW, 0, 0, S, S);
    }

    // 10m grid, phase-locked to world space so it scrolls with the player
    const u = S / this.cssSize; // canvas pixels per css reference pixel
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(10,17,23,.20)';
    g.beginPath();
    const n0x = Math.floor((cx - this.viewSpan * 0.5) / 10);
    const n1x = Math.ceil((cx + this.viewSpan * 0.5) / 10);
    for (let n = n0x; n <= n1x; n++) {
      const X = Math.round((n * 10 - cx) * ppm + half) + 0.5;
      g.moveTo(X, 0);
      g.lineTo(X, S);
    }
    const n0z = Math.floor((cz - this.viewSpan * 0.5) / 10);
    const n1z = Math.ceil((cz + this.viewSpan * 0.5) / 10);
    for (let n = n0z; n <= n1z; n++) {
      const Y = Math.round((n * 10 - cz) * ppm + half) + 0.5;
      g.moveTo(0, Y);
      g.lineTo(S, Y);
    }
    g.stroke();

    // view cone
    const heading = ((s.heading ?? 0) * Math.PI) / 180;
    const fov = (((s.fov ?? 80) * 0.5) * Math.PI) / 180;
    const coneR = S * 0.42;
    const grad = g.createRadialGradient(half, half, 2, half, half, coneR);
    grad.addColorStop(0, 'rgba(222,242,255,.26)');
    grad.addColorStop(0.7, 'rgba(222,242,255,.075)');
    grad.addColorStop(1, 'rgba(214,238,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(half, half);
    g.arc(half, half, coneR, -Math.PI / 2 + heading - fov, -Math.PI / 2 + heading + fov);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(226,244,255,.17)';
    g.lineWidth = 1;
    g.stroke();

    // building names — above the cone so the wedge cannot wash them out, below
    // the objectives and blips so the contacts still own the panel
    this._drawLabels(g, s, ppm, half, S, u);

    // objectives
    const objs = s.objectives;
    if (objs) {
      g.font = `700 ${(9.5 * u).toFixed(1)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const r = 6 * u;
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        const dx = clamp((o.x - cx) * ppm + half, r + 1, S - r - 1);
        const dy = clamp((o.z - cz) * ppm + half, r + 1, S - r - 1);
        g.fillStyle = 'rgba(121,210,255,.94)';
        g.strokeStyle = 'rgba(4,14,20,.8)';
        g.lineWidth = 1;
        g.beginPath();
        g.rect(dx - r, dy - r, r * 2, r * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#06171f';
        g.fillText(o.label ?? '', dx, dy + 0.5);
      }
    }

    // blips
    const blips = s.blips;
    if (blips) {
      // Off-map contacts stay off.
      const rim = 9 * u;
      for (let i = 0; i < blips.length; i++) {
        const b = blips[i];
        const dx = (b.x - cx) * ppm + half;
        const dy = (b.z - cz) * ppm + half;
        if (dx < rim || dx > S - rim || dy < rim || dy > S - rim) continue;
        const fade = b.fade ?? 1;
        if (fade <= 0.01) continue;
        const enemy = b.kind !== 'friend';
        const r = 3.4 * u;
        g.save();
        g.globalAlpha = fade;
        g.translate(dx, dy);
        g.rotate(((b.heading ?? 0) * Math.PI) / 180);
        g.fillStyle = enemy ? 'rgba(255,74,58,.96)' : 'rgba(126,196,255,.95)';
        g.shadowColor = enemy ? 'rgba(255,60,40,.85)' : 'rgba(120,190,255,.7)';
        g.shadowBlur = 6 * u;
        g.beginPath();
        g.moveTo(0, -r * 1.5);
        g.lineTo(r * 1.15, r * 1.1);
        g.lineTo(-r * 1.15, r * 1.1);
        g.closePath();
        g.fill();
        // a dark rim: on light footprints the red no longer owns the panel on
        // its own, and a contact has to stay the loudest mark on the map. Round
        // joins, or the miter on that sharp nose doubles the stroke width into
        // a spike past the tip.
        g.shadowBlur = 0;
        g.lineWidth = 1.1 * u;
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(6,10,14,.70)';
        g.stroke();
        g.restore();
      }
    }

    // player arrow
    g.save();
    g.translate(half, half);
    g.rotate(heading);
    const pr = 4.8 * u;
    g.beginPath();
    g.moveTo(0, -pr * 1.55);
    g.lineTo(pr * 1.15, pr * 1.3);
    g.lineTo(0, pr * 0.6);
    g.lineTo(-pr * 1.15, pr * 1.3);
    g.closePath();
    g.fillStyle = '#f6fcff';
    g.strokeStyle = 'rgba(2,6,10,.85)';
    g.lineWidth = 1.6 * u;
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(180,225,255,.85)';
    g.shadowBlur = 5 * u;
    g.stroke();
    g.fill();
    g.shadowBlur = 0;
    g.restore();

    // edge falloff so the map sinks into the frame instead of ending abruptly
    const vg = g.createRadialGradient(half, half, S * 0.28, half, half, S * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.17)');
    g.fillStyle = vg;
    g.fillRect(0, 0, S, S);

    g.restore();
  }

  /**
   * Building labels: what the building is for, with its code under it.
   *
   * A mass you can walk into is named in the floor plan's vocabulary (SHOP,
   * STORAGE, LIVING, WORKSHOP, RUIN); a background block has no such name and
   * carries its code alone, in a light ink, because it is dark enough that dark
   * ink on it lands at a contrast no one can read. So every mass on the map can
   * be called out, but only the enterable ones are announced.
   *
   * A label is only drawn when it fits the footprint under it — measured, with
   * one step down in type size before giving up, because a name that spills
   * onto the dark ground is the one thing this palette cannot carry — and it
   * fades out over the last few pixels before the frame edge, so a word is never
   * chopped in half. Both are why this runs live rather than in the bake: the
   * map pans underneath the labels.
   */
  _drawLabels(g, s, ppm, half, S, u) {
    const cx = s.x ?? 0;
    const cz = s.z ?? 0;
    const SIZE = 9; // name, css px at k=1
    const CODE = 7.5; // code, css px at k=1
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < this.labels.length; i++) {
      const L = this.labels[i];
      const dx = (L.x - cx) * ppm + half;
      const dy = (L.z - cz) * ppm + half;
      const room = L.w * ppm + 2 * u; // 2 css px a label may overhang its mass

      let size = SIZE * u;
      let tw = 0;
      if (L.text) {
        g.font = `700 ${size.toFixed(1)}px ${FONT_STACK}`;
        tw = g.measureText(L.text).width;
        if (tw > room) {
          size = SIZE * 0.8 * u;
          g.font = `700 ${size.toFixed(1)}px ${FONT_STACK}`;
          tw = g.measureText(L.text).width;
          if (tw > room) continue;
        }
      }
      // kept under the name it sits beneath, as well as under CODE, so a name
      // that had to shrink does not end up outranked by its own code
      const csize = Math.min(CODE * u, size * 0.85);
      g.font = `600 ${csize.toFixed(1)}px ${FONT_STACK}`;
      const cw = g.measureText(L.code).width;
      const boxW = Math.max(tw, cw);
      if (boxW > room) continue;

      // fade on the label's own box, not its anchor: a half-drawn word reads
      // as a glitch, a word that dims out reads as the map running out. Both
      // axes take a half-extent. The name sits 0.62 above the anchor and the
      // code 0.78 below it, each about half a cap tall, so the block reaches
      // 1.2 * size either way — not the 1.7 the two lines add up to, which was
      // retiring names ~1.5 m further in from the top and bottom rim than the
      // glyphs need (and half of `csize` for a code with no name above it).
      const halfW = boxW * 0.5;
      const halfH = L.text ? size * 1.2 : csize * 0.5;
      const edge = Math.min(
        Math.min(dx - halfW, S - dx - halfW),
        Math.min(dy - halfH, S - dy - halfH)
      );
      const a = clamp01((edge - u) / (10 * u));
      if (a <= 0.02) continue;
      g.globalAlpha = a;

      if (L.text) {
        g.font = `700 ${size.toFixed(1)}px ${FONT_STACK}`;
        g.fillStyle = NAME_INK;
        g.fillText(L.text, dx, dy - size * 0.62);
      }
      g.font = `600 ${csize.toFixed(1)}px ${FONT_STACK}`;
      g.fillStyle = L.text ? CODE_INK : BARE_INK;
      g.fillText(L.code, dx, L.text ? dy + size * 0.78 : dy + 0.5);
    }
    g.restore();
  }

  dispose() {
    this.baked = null;
    this.labels = [];
    this.root.remove();
  }
}
