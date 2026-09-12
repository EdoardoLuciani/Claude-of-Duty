import * as THREE from 'three';
import { Rng } from '../../src/core/rng.js';
import {
  facadeWall,
  windowUnit,
  windowState,
  doorUnit,
  shopfront,
  balcony,
  parapet,
  stairRun,
  ladderRun,
  railFence,
  awning,
  drainpipe,
  spallPatch,
  rubbleMound,
  BOX,
  BOX_SOFT,
  IDENT,
  LL,
  worldOf,
} from './kit.js';
import { fbm3, runoffStreak } from './util.js';
import { furnishRoom } from './interiors.js';

/**
 * WORLD — building assembly.
 *
 * A building is a footprint, a floor count and a per-side facade programme. The
 * generator walks each side in ~3 m bays and picks a kit element per bay per
 * floor (shopfront, door, window, arched window, balcony door, blank), then
 * dresses it: plinth, string courses, sills, lintels, shutters, drainpipes,
 * spalled render, bullet damage, roof parapet and roof clutter anchors.
 *
 * Sides are indexed 0:-Z 1:+X 2:+Z 3:-X. Every side gets a panel matrix whose
 * local +Z points INTO the building, so kit elements can work in a single
 * consistent panel space (see kit.js).
 */

const SIDE = [
  { ry: 0, n: [0, 0, -1] },
  { ry: -Math.PI / 2, n: [1, 0, 0] },
  { ry: Math.PI, n: [0, 0, 1] },
  { ry: Math.PI / 2, n: [-1, 0, 0] },
];

const _pm = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** True when a centred patch of half-size (hw, hh) overlaps a facade opening. */
function inOpening(x, y, hw, hh, openings, pad = 0) {
  for (const o of openings) {
    if (
      Math.abs(x - o.x) < o.w / 2 + hw + pad &&
      Math.abs(y - o.y) < o.h / 2 + hh + pad
    ) return true;
  }
  return false;
}

function panelMatrix(spec, side, y) {
  const { x, z, w, d } = spec;
  const s = SIDE[side];
  let px = x;
  let pz = z;
  if (side === 0) pz = z - d / 2;
  else if (side === 2) pz = z + d / 2;
  else if (side === 1) px = x + w / 2;
  else px = x - w / 2;
  _e.set(0, s.ry, 0);
  _q.setFromEuler(_e);
  _p.set(px, y, pz);
  _s.set(1, 1, 1);
  return _pm.compose(_p, _q, _s);
}

/** Repair-render key per wall colour: close in value, different in mix. */
const PATCH_KEY = {
  plaster_cream: 'plaster_sand',
  plaster_sand: 'plaster_cream',
  // A white patch on a blue-grey wall is nearly a stop brighter than the wall and
  // reads as a sheet of paper taped to the building — a cement repair does not.
  plaster_blue: 'concrete',
  plaster_pink: 'plaster_sand',
  plaster_white: 'concrete',
};

const sideLen = (spec, side) => (side === 0 || side === 2 ? spec.w : spec.d);
const interiorFloorCount = (spec) => spec.enterable ? spec.interiorFloors ?? spec.floors : 0;
const floorIsEnterable = (spec, floor) => floor < interiorFloorCount(spec);
function occupiedFloorCount(spec) {
  const n = interiorFloorCount(spec);
  let top = 0;
  for (const fl of spec.stairFlights ?? []) top = Math.max(top, fl.floor + 2);
  return Math.min(spec.floors ?? n, Math.max(n, top));
}
function sinkAdds(A) {
  return {
    cache: (id, fn) => A.cache(id, fn),
    has: (id) => A.has(id),
    add() {},
    addOnce() {},
    put() {},
    putS() {},
  };
}
function stableSeed(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Per-floor footprint. `spec.setback = { from, depth, side? }` pulls every floor
 * at or above `from` back from one face, leaving a roof terrace over the floor
 * below — the standard Mediterranean/Levantine form, and the thing that lets
 * afternoon sun down onto the street instead of walling it into shade.
 */
function floorSpec(spec, f) {
  const sb = spec.setback;
  if (!sb || f < sb.from) return spec;
  const d = sb.depth;
  const side = sb.side ?? spec.streetSide ?? 0;
  const o = { ...spec };
  if (side === 1) {
    o.x = spec.x - d / 2;
    o.w = spec.w - d;
  } else if (side === 3) {
    o.x = spec.x + d / 2;
    o.w = spec.w - d;
  } else if (side === 0) {
    o.z = spec.z + d / 2;
    o.d = spec.d - d;
  } else {
    o.z = spec.z - d / 2;
    o.d = spec.d - d;
  }
  return o;
}

/** Perimeter base course with every ground-floor opening subtracted. */
function openPlinth(A, spec, info, t, height, key) {
  for (let side = 0; side < 4; side++) {
    if (spec.skipSides?.includes(side)) continue;
    const len = sideLen(spec, side);
    const holes = info.facadeOpenings
      .filter((opening) => opening.side === side && opening.f === 0 && opening.y0 < height)
      .map((opening) => [opening.localX - opening.w / 2 - 0.08, opening.localX + opening.w / 2 + 0.08])
      .sort((a, b) => a[0] - b[0]);
    let cursor = -len / 2;
    const segments = [];
    for (const hole of holes) {
      const h0 = Math.max(-len / 2, hole[0]);
      const h1 = Math.min(len / 2, hole[1]);
      if (h0 > cursor + 0.02) segments.push([cursor, h0]);
      cursor = Math.max(cursor, h1);
    }
    if (cursor < len / 2 - 0.02) segments.push([cursor, len / 2]);
    const pm = panelMatrix(spec, side, 0).clone();
    for (const [a, b] of segments) {
      A.add(
        key,
        BOX(A),
        LL(pm, (a + b) / 2, height / 2, 0, 0, b - a, height, t + 0.14),
        { masks: [0.55, 0.75, 0.45] }
      );
    }
  }
}

/** The strip of roof left exposed by a setback: slab, coping and a parapet. */
function terrace(A, rng, spec, y) {
  const sb = spec.setback;
  const side = sb.side ?? spec.streetSide ?? 0;
  const d = sb.depth;
  const horiz = side === 1 || side === 3;
  const sign = side === 1 || side === 2 ? 1 : -1;
  const cx = horiz ? spec.x + sign * (spec.w / 2 - d / 2) : spec.x;
  const cz = horiz ? spec.z : spec.z + sign * (spec.d / 2 - d / 2);
  const sx = horiz ? d : spec.w;
  const sz = horiz ? spec.d : d;
  A.add('roof_screed', BOX(A), LL(IDENT, cx, y - 0.13, cz, 0, sx + 0.08, 0.26, sz + 0.08), {
    masks: [0.45, 0.3, 0.15],
    support: 'floor',
  });
  // parapet along the exposed edge, low enough to fight over from the terrace
  const ph = 0.92;
  const px = horiz ? spec.x + sign * (spec.w / 2 - 0.11) : spec.x;
  const pz = horiz ? spec.z : spec.z + sign * (spec.d / 2 - 0.11);
  A.add(spec.wallKey ?? 'plaster_cream', BOX(A), LL(IDENT, px, y + ph / 2, pz, 0, horiz ? 0.22 : spec.w + 0.1, ph, horiz ? spec.d + 0.1 : 0.22), {
    masks: [0.5, 0.5, 0.2],
  });
  A.add('concrete', BOX_SOFT(A), LL(IDENT, px, y + ph + 0.05, pz, 0, horiz ? 0.32 : spec.w + 0.2, 0.1, horiz ? spec.d + 0.2 : 0.32), {
    masks: [0.8, 0.35, 0.1],
  });
  // the returns at each end of the terrace
  for (const s of [-1, 1]) {
    const ex = horiz ? cx : spec.x + s * (spec.w / 2 - 0.11);
    const ez = horiz ? spec.z + s * (spec.d / 2 - 0.11) : cz;
    A.add(spec.wallKey ?? 'plaster_cream', BOX(A), LL(IDENT, ex, y + ph / 2, ez, 0, horiz ? d : 0.22, ph, horiz ? 0.22 : d), {
      masks: [0.5, 0.5, 0.2],
    });
  }
  return { cx, cz, sx, sz, y };
}

/**
 * @returns {object} anchors for the dressing pass:
 *   { facades:[{side, x, y, ry, wx, wz, nx, nz}], roof:{...}, balconies:[] }
 */
export function buildBuilding(A, rng, spec) {
  const t = spec.t ?? 0.34;
  const floors = spec.floors ?? 3;
  const groundH = spec.groundH ?? 3.45;
  const upperH = spec.upperH ?? 3.05;
  const wallKey = spec.wallKey ?? 'plaster_cream';
  const streetSide = spec.streetSide ?? 0;
  const info = {
    spec,
    floorY: [],
    balconies: [],
    roofY: 0,
    windows: [],
    awnings: [],
    facadeOpenings: [],
    traversable: [],
    ladders: [],
    top: 0,
  };

  // ---------------------------------------------------------------- plinth --
  // A base course everywhere: catches the ground grime band and stops the walls
  // reading as slabs dropped on a plane.
  const plinthH = spec.plinthH ?? 0.42;
  if (!spec.enterable) {
    A.add(
      spec.plinthKey ?? 'concrete',
      BOX(A),
      LL(IDENT, spec.x, plinthH / 2, spec.z, 0, spec.w + 0.14, plinthH, spec.d + 0.14),
      { masks: [0.55, 0.75, 0.45] }
    );
  }

  let y = 0;
  info.terraces = [];
  for (let f = 0; f < floors; f++) {
    const h = f === 0 ? groundH : upperH;
    const fs = floorSpec(spec, f);
    info.floorY.push(y);
    for (let side = 0; side < 4; side++) {
      if (spec.skipSides?.includes(side)) continue;
      buildFacade(A, rng, fs, info, { side, f, y, h, t, wallKey, streetSide, floors });
    }
    // ---- floor / ceiling slab of the NEXT level ----
    y += h;
    if (f < floors - 1) {
      interiorSlab(A, rng, floorSpec(spec, f + 1), y, t, f + 1);
      // the setback happens on top of this floor: dress the exposed strip
      if (spec.setback && f + 1 === spec.setback.from) {
        info.terraces.push(terrace(A, rng, spec, y));
      }
    }
  }
  info.roofY = y;
  info.top = y;
  if (spec.enterable) {
    openPlinth(A, spec, info, t, plinthH, spec.plinthKey ?? 'concrete');
  }

  // ------------------------------------------------------------------ roof --
  const ts = floorSpec(spec, floors - 1);
  interiorSlab(A, rng, ts, y, t, floors, true);
  if (spec.parapet !== false) {
    parapet(A, spec.parapetKey ?? wallKey, ts.x, ts.z, ts.w + 0.1, ts.d + 0.1, y, rng, {
      h: spec.parapetH ?? 0.78,
      t: 0.22,
      gaps: roofGapsFromStairs(spec, info),
    });
  }
  info.roofSpec = ts;

  // ----------------------------------------------------------- interiors ---
  if (spec.enterable) {
    // Keep new suite furnishing from rerolling later facades and stable props.
    const interiorRng = spec.interiorFloors ? new Rng(stableSeed(`interior:${spec.id}`)) : rng;
    buildInterior(A, interiorRng, spec, info, t, groundH, upperH, floors);
    buildExteriorStairs(A, spec, info);
    const accessibleFloors = occupiedFloorCount(spec);
    if (accessibleFloors < floors) {
      // Back unauthored upper rooms with a dark core.
      const top = floorSpec(spec, floors - 1);
      const inset = 2.0;
      const cw = Math.max(1.0, top.w - inset * 2);
      const cd = Math.max(1.0, top.d - inset * 2);
      const base = info.floorY[accessibleFloors];
      const coreH = Math.max(0.5, y - base - 0.45);
      A.add(
        'interior_shell',
        BOX(A),
        LL(IDENT, top.x, base + coreH / 2, top.z, 0, cw, coreH, cd),
        { masks: [0.1, 0.95, 0.9] }
      );
    }
  } else {
    // Non-enterable: a dark core so windows read as depth, not as a hole into
    // a lit empty shell.
    // Sized off the SMALLEST floor plate so a setback never leaves the core
    // poking out through an upper wall.
    const top = floorSpec(spec, floors - 1);
    const inset = 2.0;
    const cw = Math.max(1.0, top.w - inset * 2);
    const cd = Math.max(1.0, top.d - inset * 2);
    // Stop the core short of the roof slab: coplanar faces z-fight, and a dark
    // core showing through the roof turns every rooftop into a grey blotch.
    const coreH = Math.max(0.5, y - 0.45);
    // `interior_shell`, not white plaster: seen through a doorway or a blown-out
    // hole a bright core reads as a sheet of paper taped behind the opening.
    A.add(
      'interior_shell',
      BOX(A),
      LL(IDENT, top.x, coreH / 2, top.z, 0, cw, coreH, cd),
      { masks: [0.1, 0.95, 0.9] }
    );
    for (let f = 0; f <= floors; f++) {
      const fs = floorSpec(spec, Math.min(f, floors - 1));
      const fy = f === 0 ? 0.1 : info.floorY[f] ?? y;
      A.add(
        'floor_concrete',
        BOX(A),
        LL(IDENT, fs.x, fy - 0.06, fs.z, 0, fs.w - t * 2, 0.16, fs.d - t * 2),
        { masks: [0.2, 0.8, 0.6], support: 'floor' }
      );
    }
  }

  // ------------------------------------------------------------- drainpipe --
  // A downpipe has to die into the wall it is clipped to. On a setback face the
  // wall STOPS at the terrace, so a pipe run to the main roof height carries on
  // three metres into open sky and reads as a floating mast — which is exactly
  // what it was doing. Clamp the top to the parapet of whatever surface is
  // actually above the pipe.
  const dpSide = streetSide;
  const pmD = panelMatrix(spec, dpSide, 0);
  const len = sideLen(spec, dpSide);
  const sbSide = spec.setback ? spec.setback.side ?? streetSide : -1;
  const dpTop =
    sbSide === dpSide
      ? (info.floorY[spec.setback.from] ?? info.roofY) + 0.55
      : info.roofY + 0.4;
  drainpipe(A, pmD.clone(), rng.range(-len / 2 + 0.4, -len / 2 + 1.0), dpTop, dpTop, rng);
  if (rng.float() < 0.6) {
    drainpipe(A, pmD.clone(), rng.range(len / 2 - 1.0, len / 2 - 0.4), dpTop, dpTop, rng);
  }

  return info;
}

// =============================================================== facades ====
function buildFacade(A, rng, spec, info, ctx) {
  const { side, f, y, h, t, wallKey, streetSide, floors } = ctx;
  const len = sideLen(spec, side);
  const pm = panelMatrix(spec, side, y).clone();
  const street = side === streetSide;
  const secondary = spec.secondarySide === side;
  const openFace = street || secondary || spec.doorBays?.[side] !== undefined;

  const bays = Math.max(1, Math.round(len / 3.05));
  const bw = len / bays;
  const openings = [];
  const deco = [];

  const ruinTop = spec.ruin && f === floors - 1;
  const cut = spec.wallCuts?.find((c) => c.side === side && c.f === f);
  const clearBal = spec.exteriorStairs?.some((s) => s.side === side && s.clearBalconies);

  for (let b = 0; b < bays; b++) {
    const bx = -len / 2 + (b + 0.5) * bw;
    const kitA = cut && Math.abs(bx - cut.x) < bw * 0.5 ? sinkAdds(A) : A;
    // edge bays keep more solid wall so corners stay strong
    const room = Math.min(bw - 1.0, 2.6);
    let kind = 'blank';
    if (f === 0) {
      if (openFace) {
        const shopHere = spec.shops !== false && room > 2.0 && rng.float() < (street ? 0.5 : 0.25);
        if (spec.doorBays?.[side] === b) kind = 'door';
        else if (shopHere) kind = 'shop';
        else if (rng.float() < 0.72) kind = 'window';
      } else if (rng.float() < 0.4) kind = 'window';
    } else {
      if (rng.float() < (openFace ? 0.88 : 0.6)) {
        kind = spec.arches && f === 1 ? 'arch' : 'window';
        if (openFace && f >= 1 && rng.float() < (spec.balconies ?? 0.35)) kind = 'balconyDoor';
      }
    }
    if (ruinTop && rng.float() < 0.5) kind = kind === 'blank' ? 'blank' : 'ragged';

    /**
     * Hand-authored override for the bays that carry a sightline the map
     * depends on (the shop the interior camera looks out of, the doorway that
     * connects an alley to a stairwell). A string names the kind; an object
     * additionally passes options to the kit element.
     */
    let forced = spec.bayKinds?.[side]?.[f]?.[b];
    if (typeof forced === 'string') forced = { kind: forced };
    if (forced) kind = forced.kind;

    switch (kind) {
      case 'door': {
        const usable = floorIsEnterable(spec, f);
        // Leave headroom for the controller's 0.42 m step sweep.
        const doorH = usable ? 2.7 : 2.16;
        const o = { x: bx, y: doorH / 2, w: usable ? 1.8 : 1.12, h: doorH, kind };
        openings.push(o);
        deco.push(() => {
          const legacyOpenRoll = rng.float();
          if (legacyOpenRoll < 0.45) rng.range(0.5, 1.6);
          return doorUnit(kitA, pm, o, rng, {
            t,
            // Rest usable leaves against the inner return, outside traversal.
            open: usable ? Math.PI / 2 : 0,
            leafKey: rng.pick(['metal_green', 'metal_blue', 'wood_dark']),
          });
        });
        if (usable) {
          info.traversable.push({
            kind: 'door', side, w: o.w,
            from: worldOf(pm, bx, 0, -1.15).slice(),
            to: worldOf(pm, bx, 0, 1.15).slice(),
          });
        }
        break;
      }
      case 'shop': {
        const sw = Math.min(bw - 0.75, 3.1);
        const o = { x: bx, y: 1.32, w: sw, h: 2.58, kind };
        openings.push(o);
        // Never fully shuttered: a market street with every shop closed is dead,
        // and a shutter over an interior sightline blocks the shot.
        let drop = forced?.drop ?? (rng.float() < 0.5 ? rng.range(0.1, 0.55) : 0);
        // Enterable openings stay walkable; kit inside-dressing is interiors.js.
        // Only explicitly authored shop bays are traversal routes.
        const usable = floorIsEnterable(spec, f) && !!forced;
        if (usable) drop = 0;
        deco.push(() => shopfront(kitA, pm, o, rng, {
          t,
          drop,
          // Interior dressing performs its own opening-aware support checks.
          inside: false,
          counter: !usable,
          preserveInsideRng: !!spec.interiorFloors || !spec.enterable,
        }));
        if (usable) {
          info.traversable.push({
            kind: 'shop', side, w: o.w,
            from: worldOf(pm, bx, 0, -1.15).slice(),
            to: worldOf(pm, bx, 0, 1.15).slice(),
          });
        }
        if (rng.float() < 0.8) {
          const aw = sw + 0.5;
          deco.push(() =>
            awning(clearBal ? sinkAdds(A) : kitA, pm, bx, o.y + o.h / 2 + 0.55, aw, rng, {
              depth: rng.range(1.3, 1.9),
              key: rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
              legs: rng.float() < 0.4,
            })
          );
          info.awnings.push({ side, x: bx, y: o.y + o.h / 2 + 0.55, w: aw, pm });
        }
        break;
      }
      case 'window': {
        const ww = Math.min(room, rng.range(1.05, 1.3));
        const wh = f === 0 ? 1.62 : 1.48;
        const o = { x: bx, y: (f === 0 ? 1.05 : 0.95) + wh / 2, w: ww, h: wh, kind };
        openings.push(o);
        const broken = rng.float() < (spec.damage ?? 0.15) * 1.6;
        // One window per bay is not the same window per bay: pick a state so the
        // facade carries open casements, boarded holes, shut louvres, curtains and
        // the occasional lit room instead of one repeated glazed panel.
        const st = broken ? 'open' : windowState(rng, f, spec.damage ?? 0.15, { allowLit: !openFace || f > 0 });
        deco.push(() =>
          windowUnit(kitA, pm, o, rng, {
            t,
            broken,
            state: st,
            back: !floorIsEnterable(spec, f),
            grille: f === 0 && st !== 'boarded' && rng.float() < 0.55,
            shutters: f > 0 && (st === 'shuttered' || rng.float() < 0.4),
            shutterKey: spec.shutterKey ?? rng.pick(['metal_blue', 'metal_green', 'wood_dark']),
            curtain: st === 'curtain' || (st === 'glazed' && rng.float() < 0.25),
          })
        );
        info.windows.push({ side, f, x: bx, y: o.y, w: ww, h: wh, pm, state: st });
        break;
      }
      case 'arch': {
        const ww = Math.min(room, 1.35);
        const o = { x: bx, y: 1.05 + 0.9, w: ww, h: 1.9, arch: 0.62, kind };
        openings.push(o);
        const st = windowState(rng, f, spec.damage ?? 0.15);
        deco.push(() =>
          windowUnit(kitA, pm, o, rng, {
            t,
            broken: rng.float() < 0.2,
            state: st,
            back: !floorIsEnterable(spec, f),
            shutters: false,
            curtain: st === 'curtain' || rng.float() < 0.3,
            lintel: false,
          })
        );
        info.windows.push({ side, f, x: bx, y: o.y, w: ww, h: o.h, pm, state: st });
        break;
      }
      case 'balconyDoor': {
        const ww = Math.min(room, 1.15);
        const o = { x: bx, y: 1.12, w: ww, h: 2.24, kind };
        openings.push(o);
        const bwid = Math.min(bw - 0.35, 2.6);
        deco.push(() => {
          const legacyOpenRoll = rng.float();
          const legacyOpen = legacyOpenRoll < 0.5 ? rng.range(0.6, 1.5) : 0;
          doorUnit(kitA, pm, o, rng, {
            t,
            open: floorIsEnterable(spec, f) ? Math.PI / 2 : legacyOpen,
            leafKey: 'wood_dark',
          });
          const balY = 0.02;
          const depth = rng.range(1.0, 1.35);
          const railing = rng.float() < 0.45 ? 'concrete' : 'metal';
          // Keep the balcony RNG sequence stable when an authored obstruction
          // requires this bay to remain clear.
          if (spec.omitBalconies?.[side]?.[bx]) return;
          const bal = balcony(clearBal ? sinkAdds(A) : kitA, pm, bx, balY, bwid, rng, {
            depth,
            railing,
            key: spec.wallKey ?? 'plaster_cream',
          });
          // `y` here is PANEL-LOCAL, like info.windows/info.awnings: `pm`
          // already carries the floor height. Publishing the world floor `y`
          // made dressing place balcony clutter at 2*floorY (props and rugs
          // floating in mid-air above the street).
          info.balconies.push({ side, x: bx, y: balY, w: bal.w, d: bal.d, pm });
        });
        break;
      }
      case 'ragged': {
        const o = { x: bx, y: h * 0.55, w: Math.min(bw - 0.4, 2.2), h: h * 0.8, ragged: 0.22, kind };
        openings.push(o);
        break;
      }
      default:
        break;
    }
  }

  for (const o of openings) {
    const wp = worldOf(pm, o.x, o.y, 0);
    info.facadeOpenings.push({
      side, f, kind: o.kind, localX: o.x, x: wp[0], z: wp[2], w: o.w,
      y0: wp[1] - o.h / 2,
      y1: wp[1] + o.h / 2,
    });
  }
  let wallHoles = openings;
  if (cut) {
    const ch = cut.h ?? 2.7;
    const cw = cut.w ?? 1.8;
    wallHoles = openings.filter((o) => Math.abs(o.x - cut.x) >= bw * 0.5);
    wallHoles.push({ x: cut.x, y: ch / 2, w: cw, h: ch, kind: 'door' });
  }

  // ---- the wall itself ----
  const isTop = f === floors - 1;
  facadeWall(A, pm, {
    w: len,
    h: h + (isTop ? 0.02 : 0),
    t,
    key: wallKey,
    openings: wallHoles,
    rng,
    top: spec.ruin && isTop && (side === streetSide || side === spec.ruinSide) ? 'ragged' : 'flat',
    raggedAmp: 0.55,
    jag: isTop && !spec.ruin ? 0.03 : 0,
    warp: 0.02,
    paint: (x, wy, z, nx, ny, nz, out) => {
      // extra grime toward the base of the ground floor and under the eaves
      const base = f === 0 ? Math.max(0, 1 - wy / 1.4) : 0;
      const n = fbm3(x * 0.7, wy * 0.7, z * 0.7, 2);
      out[1] = Math.min(1, out[1] + base * base * 0.55 * (0.5 + n));
      out[2] = Math.min(1, out[2] + base * base * 0.4);
    },
  });

  for (const fn of deco) fn();

  // ---- rain runoff below every opening and ledge --------------------------
  // The world knows where the water comes off: sills, shopfront heads, awning
  // bars and balcony slabs. A facade with no runs below its openings reads as
  // freshly painted, which is the one thing a street like this never is.
  //
  // Drawn from a stream keyed to this panel's identity rather than from `rng`, so
  // adding or tuning the weathering never re-rolls the level's layout.
  const wr = new Rng(
    (Math.round((spec.x + 512) * 977 + (spec.z + 512) * 7919) ^ (side * 131 + f * 1237)) >>> 0
  );
  for (const o of openings) {
    if (o.kind === 'ragged') continue;
    const sillY = o.y - o.h / 2;
    // Not every sill sheds the same amount, and a couple are bone dry.
    if (wr.float() < 0.22) continue;
    const run = Math.min(wr.range(0.7, 1.8), Math.max(0.25, sillY - 0.12));
    const g = runoffStreak(wr, o.w * wr.range(0.6, 1.0), run, {
      amount: wr.range(0.72, 1.0),
    });
    A.addOnce(wallKey, g, LL(pm, o.x + wr.range(-0.1, 0.1), sillY - 0.03, -0.012, 0, 1, 1, 1));
    // a second, narrower run off one corner of the sill: water finds a low spot
    if (wr.float() < 0.55) {
      const sgn = wr.float() < 0.5 ? -1 : 1;
      const run2 = Math.min(wr.range(0.5, 1.3), Math.max(0.2, sillY - 0.1));
      const g2 = runoffStreak(wr, wr.range(0.1, 0.22), run2, { amount: wr.range(0.8, 1.0), cols: 3 });
      A.addOnce(
        wallKey,
        g2,
        LL(pm, o.x + sgn * o.w * wr.range(0.32, 0.5), sillY - 0.02, -0.013, 0, 1, 1, 1)
      );
    }
  }
  // and one long run off the string course / cornice per open facade
  if (openFace && wr.float() < 0.8) {
    const g = runoffStreak(wr, wr.range(0.18, 0.4), wr.range(1.0, 1.8), {
      amount: wr.range(0.78, 1.0),
      cols: 4,
    });
    A.addOnce(
      wallKey,
      g,
      LL(pm, wr.range(-len / 2 + 0.4, len / 2 - 0.4), h - 0.16, -0.012, 0, 1, 1, 1)
    );
  }

  // ---- string course between floors ----
  if (f < ctx.floors - 1 && (openFace || rng.float() < 0.5)) {
    A.add(
      spec.trimKey ?? 'concrete',
      BOX_SOFT(A),
      LL(pm, 0, h - 0.09, -0.055, 0, len + 0.06, 0.13, 0.12),
      { masks: [0.7, 0.45, 0.2] }
    );
  }
  // ---- top cornice ----
  if (f === ctx.floors - 1 && !spec.ruin) {
    A.add(
      spec.trimKey ?? 'concrete',
      BOX_SOFT(A),
      LL(pm, 0, h - 0.14, -0.11, 0, len + 0.14, 0.22, 0.2),
      { masks: [0.75, 0.5, 0.25] }
    );
  }

  // ---- damage: spalled render exposing brick, bullet-pocked plaster ----
  const dmg = spec.damage ?? 0.2;
  const spalls = Math.round(dmg * 5 * (openFace ? 1.4 : 0.7));
  for (let i = 0; i < spalls; i++) {
    const sx = rng.range(-len / 2 + 0.5, len / 2 - 0.5);
    const sy = rng.range(0.4, h - 0.5);
    const pw = rng.range(0.35, 1.0);
    const ph = rng.range(0.3, 0.8);
    const g = spallPatch(rng, pw, ph, 0.03);
    // Same skip as pocks: a brick patch in a doorway reads as a floating wall.
    if (inOpening(sx, sy, pw * 0.5, ph * 0.5, openings, 0.12)) continue;
    A.addOnce('brick_fine', g, LL(pm, sx, sy, 0.01, 0, 1, 1, 1));
  }
  // patched render — a slightly different mix where somebody repaired it. Kept
  // in the same value family as the wall, or it reads as a paper poster.
  if (openFace && rng.float() < 0.5) {
    const px = rng.range(-len / 2 + 1, len / 2 - 1);
    const py = rng.range(0.5, h - 1.2);
    const pw = rng.range(0.6, 1.4);
    const ph = rng.range(0.5, 1.1);
    const g = spallPatch(rng, pw, ph, 0.02);
    // Same value family as the wall: a bright white patch on cream render reads
    // as a sheet of paper stuck to the building.
    if (!inOpening(px, py, pw * 0.5, ph * 0.5, openings, 0.12)) {
      A.addOnce(PATCH_KEY[wallKey] ?? 'plaster_sand', g, LL(pm, px, py, 0.013, 0, 1, 1, 1));
    }
  }

  // ---- bullet pocks, clustered where somebody took cover ----
  if (A.has('pock')) {
    const bursts = Math.round(dmg * 6) + (openFace ? 2 : 0);
    for (let i = 0; i < bursts; i++) {
      const cx = rng.range(-len / 2 + 0.4, len / 2 - 0.4);
      const cy = rng.range(0.5, Math.min(h - 0.4, 3.0));
      const n = rng.int(3, 9);
      for (let j = 0; j < n; j++) {
        const px = cx + rng.gauss() * 0.45;
        const py = cy + rng.gauss() * 0.32;
        if (Math.abs(px) > len / 2 - 0.15) continue;
        if (py < 0.15 || py > h - 0.15) continue;
        // skip pocks that would land inside an opening
        let inHole = false;
        for (const o of openings) {
          if (
            px > o.x - o.w / 2 - 0.05 &&
            px < o.x + o.w / 2 + 0.05 &&
            py > o.y - o.h / 2 - 0.05 &&
            py < o.y + o.h / 2 + 0.05
          ) {
            inHole = true;
            break;
          }
        }
        if (inHole) continue;
        // Just proud of the render. The pock is a raised-rim crater now, not a
        // solid cone, so burying the origin 4 mm inside the wall (which is what
        // hid the old cone's base) would sink the whole thing out of sight.
        const wp = worldOf(pm, px, py, 0.0015);
        const s = rng.range(0.55, 1.5);
        A.putS('pock', wp[0], wp[1], wp[2], SIDE[side].ry + Math.PI, s, s, rng.range(0.5, 1.2), [
          1,
          rng.range(0.7, 1.3),
          1,
        ]);
      }
    }
  }
}

// ================================================================= slabs ====
/** Floor slab for one level, with the stairwell void left open. */
function interiorSlab(A, rng, spec, y, t, level, roof = false) {
  const iw = spec.w - t * 2;
  const id = spec.d - t * 2;
  const key = roof ? 'roof_screed' : 'floor_concrete';
  const hole = spec.enterable ? (spec.stairHoles?.[level] ?? null) : null;
  const thick = roof ? 0.26 : 0.2;
  if (!hole) {
    A.add(key, BOX(A), LL(IDENT, spec.x, y - thick / 2, spec.z, 0, iw, thick, id), {
      masks: roof ? [0.45, 0.25, 0.12] : [0.3, 0.55, 0.35],
      support: 'floor',
    });
  } else {
    // picture-frame decomposition around the void
    const x0 = spec.x - iw / 2;
    const x1 = spec.x + iw / 2;
    const z0 = spec.z - id / 2;
    const z1 = spec.z + id / 2;
    const hx0 = hole.x0;
    const hx1 = hole.x1;
    const hz0 = hole.z0;
    const hz1 = hole.z1;
    const parts = [
      [x0, z0, x1, hz0],
      [x0, hz1, x1, z1],
      [x0, hz0, hx0, hz1],
      [hx1, hz0, x1, hz1],
    ];
    for (const [ax, az, bx, bz] of parts) {
      const w = bx - ax;
      const d = bz - az;
      if (w < 0.05 || d < 0.05) continue;
      A.add(key, BOX(A), LL(IDENT, (ax + bx) / 2, y - thick / 2, (az + bz) / 2, 0, w, thick, d), {
        masks: roof ? [0.45, 0.25, 0.12] : [0.3, 0.55, 0.35],
        support: 'floor',
      });
    }
  }
  // exposed ceiling beams / joists under the slab, seen from inside
  if (!roof && level <= interiorFloorCount(spec)) {
    const n = Math.max(2, Math.round(id / 1.5));
    const xL = spec.x - iw / 2;
    const xR = spec.x + iw / 2;
    for (let i = 0; i < n; i++) {
      const bz = spec.z - id / 2 + ((i + 0.5) / n) * id;
      const spans = hole && bz > hole.z0 - 0.08 && bz < hole.z1 + 0.08
        ? [[xL, hole.x0], [hole.x1, xR]]
        : [[xL, xR]];
      for (const [ax, bx] of spans) {
        const jw = bx - ax;
        if (jw < 0.2) continue;
        A.add('wood_dark', BOX(A), LL(IDENT, (ax + bx) / 2, y - thick - 0.08, bz, 0, jw, 0.16, 0.13), {
          masks: [0.4, 0.6, 0.5],
        });
      }
    }
  }
}

function exteriorFlight(spec, info, fl) {
  const fromY = info.floorY[fl.fromFloor ?? 0] ?? 0;
  const toY = info.floorY[fl.toFloor ?? 1] ?? info.roofY;
  const steps = Math.max(6, Math.round((toY - fromY) / 0.19));
  const run = fl.run ?? 0.275;
  const sw = fl.w ?? 1.05;
  const dir = fl.dir ?? 1;
  const out = fl.out ?? 0.08;
  const landW = 0.8;
  return {
    fromY, toY, steps, rise: (toY - fromY) / steps, run, D: steps * run, sw, dir, out, landW,
    landX: fl.doorX + dir * (landW / 2),
    landD: sw + out,
  };
}

function roofGapsFromStairs(spec, info) {
  const gaps = [];
  for (const fl of spec.exteriorStairs ?? []) {
    const g = exteriorFlight(spec, info, fl);
    if (Math.abs(g.toY - info.roofY) > 0.01) continue;
    const wp = worldOf(panelMatrix(floorSpec(spec, 0), fl.side, 0), g.landX, 0, 0);
    gaps.push({
      side: fl.side,
      x: fl.side === 0 || fl.side === 2 ? wp[0] : wp[2],
      w: g.landW + 0.9,
    });
  }
  return gaps;
}

export function exteriorStairBoxes(spec, info) {
  const boxes = [];
  for (const fl of spec.exteriorStairs ?? []) {
    const g = exteriorFlight(spec, info, fl);
    const pm = panelMatrix(floorSpec(spec, 0), fl.side, 0).clone();
    const x0 = Math.min(fl.doorX, fl.doorX - g.dir * g.D, g.landX - g.landW / 2);
    const x1 = Math.max(fl.doorX, fl.doorX - g.dir * g.D, g.landX + g.landW / 2);
    const corners = [
      worldOf(pm, x0, 0, -g.landD).slice(),
      worldOf(pm, x1, 0, 0.15).slice(),
    ];
    boxes.push({
      x0: Math.min(corners[0][0], corners[1][0]) - 0.2,
      x1: Math.max(corners[0][0], corners[1][0]) + 0.2,
      z0: Math.min(corners[0][2], corners[1][2]) - 0.2,
      z1: Math.max(corners[0][2], corners[1][2]) + 0.2,
      y0: g.fromY - 0.2,
      y1: g.toY + 1.9,
    });
  }
  return boxes;
}

function buildExteriorStairs(A, spec, info) {
  for (const fl of spec.exteriorStairs ?? []) {
    const g = exteriorFlight(spec, info, fl);
    const wall = panelMatrix(floorSpec(spec, 0), fl.side, 0).clone();
    const key = fl.key ?? 'concrete';
    _e.set(0, g.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    _q.setFromEuler(_e);
    _p.set(fl.doorX - g.dir * g.D, g.fromY, -(g.sw / 2) - g.out);
    _s.set(1, 1, 1);
    stairRun(A, wall.clone().multiply(new THREE.Matrix4().compose(_p, _q, _s)), 0, 0, 0, g.sw, g.steps, g.rise, g.run, {
      key, railing: fl.railing, railKey: fl.railKey, postEvery: fl.postEvery, midRail: fl.midRail,
    });
    A.add(key, BOX(A), LL(wall, g.landX, g.toY - 0.07, -g.landD / 2, 0, g.landW, 0.14, g.landD), {
      masks: [0.55, 0.5, 0.25],
      support: 'floor',
    });
    const rk = { railKey: fl.railKey ?? 'metal_rust' };
    _e.set(0, Math.PI / 2, 0);
    _q.setFromEuler(_e);
    _p.set(g.landX - g.landW / 2, g.toY, -g.landD);
    railFence(A, wall.clone().multiply(new THREE.Matrix4().compose(_p, _q, _s)), g.landW, rk);
    if (fl.endRail !== false) {
      _e.set(0, 0, 0);
      _q.setFromEuler(_e);
      _p.set(g.landX + g.dir * g.landW / 2, g.toY, -g.landD);
      railFence(A, wall.clone().multiply(new THREE.Matrix4().compose(_p, _q, _s)), g.landD, rk);
    }
  }
}

function buildLadders(A, spec, info, t) {
  for (const ld of spec.ladders ?? []) {
    const f = ld.floor ?? 0;
    const fs = floorSpec(spec, f);
    const iw = fs.w - t * 2;
    const id = fs.d - t * 2;
    const x0 = fs.x - iw / 2;
    const z0 = fs.z - id / 2;
    const y0 = info.floorY[f] + (f === 0 && spec.interiorFloors ? 0.16 : 0);
    const y1 = info.roofY;
    const w = ld.w ?? 0.56;
    const along = ld.along ?? 0.2;
    const wall = ld.wall ?? 'west';
    let ox, oz, ry, nx, nz;
    if (wall === 'west') {
      ox = x0; oz = z0 + along * id; ry = Math.PI / 2; nx = 1; nz = 0;
    } else if (wall === 'east') {
      ox = x0 + iw; oz = z0 + along * id; ry = -Math.PI / 2; nx = -1; nz = 0;
    } else if (wall === 'south') {
      ox = x0 + along * iw; oz = z0; ry = 0; nx = 0; nz = 1;
    } else {
      ox = x0 + along * iw; oz = z0 + id; ry = Math.PI; nx = 0; nz = -1;
    }
    _e.set(0, ry, 0);
    _q.setFromEuler(_e);
    _p.set(ox, y0, oz);
    _s.set(1, 1, 1);
    ladderRun(A, new THREE.Matrix4().compose(_p, _q, _s), y1 - y0, { w, key: ld.key });
    info.ladders.push({
      x: ox + nx * 0.38,
      z: oz + nz * 0.38,
      y0,
      y1,
      radius: ld.radius ?? 0.42,
      nx,
      nz,
    });
  }
}

function fenceHole(A, hole, y) {
  const dz = hole.z1 - hole.z0;
  const dx = hole.x1 - hole.x0;
  for (const side of hole.rails ?? []) {
    let len = dz;
    if (side === 'east') { _e.set(0, 0, 0); _p.set(hole.x1, y, hole.z0); }
    else if (side === 'west') { _e.set(0, Math.PI, 0); _p.set(hole.x0, y, hole.z1); }
    else if (side === 'north') { _e.set(0, -Math.PI / 2, 0); _p.set(hole.x0, y, hole.z1); len = dx; }
    else if (side === 'south') { _e.set(0, Math.PI / 2, 0); _p.set(hole.x1, y, hole.z0); len = dx; }
    else throw new Error(`fenceHole: unknown side ${side}`);
    _q.setFromEuler(_e);
    _s.set(1, 1, 1);
    railFence(A, new THREE.Matrix4().compose(_p, _q, _s), len, { railKey: hole.railKey });
  }
}

// ============================================================= interiors ====
function buildInterior(A, rng, spec, info, t, groundH, upperH, floors) {
  const it = 0.16; // partition thickness
  const g0 = floorSpec(spec, 0);
  const groundFloorY = spec.interiorFloors
    ? 0.16
    : Math.max(0.13, spec.plinthH ?? 0.42);

  // Share one floor datum between the slab, furnishing and traversal.
  A.add(
    'floor_concrete',
    BOX(A),
    LL(IDENT, g0.x, groundFloorY - 0.07, g0.z, 0, g0.w - t * 2, 0.14, g0.d - t * 2),
    { masks: [0.3, 0.6, 0.4], support: 'floor' }
  );

  const rooms = spec.rooms ?? [];
  const accessibleFloors = occupiedFloorCount(spec);
  for (let f = 0; f < accessibleFloors; f++) {
    // Room plans are normalised, so they follow a setback automatically.
    const fs = floorSpec(spec, f);
    const iw = fs.w - t * 2;
    const id = fs.d - t * 2;
    const x0 = fs.x - iw / 2;
    const z0 = fs.z - id / 2;
    const fy = info.floorY[f] + (f === 0 ? groundFloorY : 0);
    const fh = f === 0 ? groundH - groundFloorY : upperH;
    // partitions for this floor
    const plan = rooms[f] ?? rooms[rooms.length - 1] ?? null;
    const partitions = [];
    const doors = info.traversable.map((opening) => ({
      x: (opening.from[0] + opening.to[0]) / 2,
      z: (opening.from[2] + opening.to[2]) / 2,
    }));
    if (plan) {
      for (const wall of plan.walls) {
        const [ax, az, bx, bz, doorAt] = wall;
        const wx0 = x0 + ax * iw;
        const wz0 = z0 + az * id;
        const wx1 = x0 + bx * iw;
        const wz1 = z0 + bz * id;
        partitions.push({ x0: wx0, z0: wz0, x1: wx1, z1: wz1 });
        const len = Math.hypot(wx1 - wx0, wz1 - wz0);
        const ry = Math.atan2(wx1 - wx0, wz1 - wz0) - Math.PI / 2;
        _e.set(0, ry, 0);
        _q.setFromEuler(_e);
        _p.set((wx0 + wx1) / 2 - Math.sin(ry) * (it / 2), fy, (wz0 + wz1) / 2 - Math.cos(ry) * (it / 2));
        _s.set(1, 1, 1);
        const pm = new THREE.Matrix4().compose(_p, _q, _s);
        const holes = [];
        if (doorAt !== undefined && doorAt !== null) {
          holes.push({ x: -len / 2 + doorAt * len, y: 1.18, w: 1.05, h: 2.36 });
          doors.push({ x: wx0 + (wx1 - wx0) * doorAt, z: wz0 + (wz1 - wz0) * doorAt });
        }
        facadeWall(A, pm, {
          w: len,
          h: fh,
          t: it,
          key: 'plaster_white',
          openings: holes,
          rng,
          warp: 0.012,
          bevel: 0.012,
          paint: (px, py, pz, nx, ny, nz, out) => {
            const base = Math.max(0, 1 - py / 1.1);
            out[1] = Math.min(1, out[1] + base * base * 0.5);
            out[2] = Math.min(1, out[2] + base * base * 0.35);
          },
        });
        for (const hole of holes) {
          doorUnit(A, pm, hole, rng, { t: it, leaf: false });
        }
      }
    }

    // ---- stairs rising out of this floor ----
    for (const fl of spec.stairFlights ?? []) {
      if (fl.floor !== f) continue;
      const base = info.floorY[f] + (f === 0 ? groundFloorY : 0);
      const climb = (info.floorY[f + 1] ?? info.roofY) - base;
      const steps = Math.max(6, Math.round(climb / 0.19));
      const rise = climb / steps;
      const run = fl.run ?? 0.275;
      const sw = fl.w ?? 1.2;
      _e.set(0, fl.ry ?? 0, 0);
      _q.setFromEuler(_e);
      _p.set(x0 + fl.x * iw, base, z0 + fl.z * id);
      _s.set(1, 1, 1);
      const pm = new THREE.Matrix4().compose(_p, _q, _s);
      stairRun(A, pm, 0, 0, 0, sw, steps, rise, run, {
        key: 'concrete_dark',
        railing: fl.railing,
        carriage: fl.carriage,
        railKey: fl.railKey,
        postEvery: fl.postEvery,
        midRail: fl.midRail,
      });
      const D = steps * run;
      const H = steps * rise;
      if (fl.landing !== false) {
        A.add('concrete_dark', BOX(A), LL(pm, 0, H - 0.1, D + 0.55, 0, sw + 0.1, 0.2, 1.1), {
          masks: [0.4, 0.5, 0.3],
          support: 'floor',
        });
      }
    }

    const hole = spec.stairHoles?.[f];
    if (hole) fenceHole(A, hole, fy);

    // furnishing
    if (plan?.furnish) {
      for (const r of plan.furnish) {
        furnishRoom(A, rng, {
          kind: r.kind,
          detail: r.detail,
          // so furnishing never stacks a shelf across a shopfront opening
          street: spec.streetSide,
          x0: x0 + r.x0 * iw,
          z0: z0 + r.z0 * id,
          x1: x0 + r.x1 * iw,
          z1: z0 + r.z1 * id,
          y: fy,
          h: fh,
          envelope: { x0, z0, x1: x0 + iw, z1: z0 + id },
          facadeOpenings: info.facadeOpenings.filter((opening) => opening.f === f),
          partitions,
          doors,
          voids: Object.values(spec.stairHoles ?? {}),
        });
      }
    }
  }

  buildLadders(A, spec, info, t);

  const roofHole = spec.stairHoles?.[floors];
  if (roofHole) fenceHole(A, roofHole, info.roofY);

  // roof access: a stair penthouse box with an open doorway
  if (spec.roofAccess && roofHole) {
    const px = (roofHole.x0 + roofHole.x1) / 2;
    const pz = roofHole.z1 + 1.35;
    const y = info.roofY;
    for (let side = 0; side < 4; side++) {
      const pm = panelMatrix({ x: px, z: pz, w: 2.4, d: 2.6 }, side, y).clone();
      const holes = side === 0 || side === 2 ? [{ x: 0, y: 1.08, w: 1.05, h: 2.16 }] : [];
      facadeWall(A, pm, {
        w: side === 0 || side === 2 ? 2.4 : 2.6,
        h: 2.5,
        t: 0.22,
        key: spec.wallKey ?? 'plaster_cream',
        openings: holes,
        rng,
        warp: 0.015,
      });
    }
    A.add('concrete', BOX(A), LL(IDENT, px, y + 2.6, pz, 0, 2.7, 0.2, 2.9), {
      masks: [0.5, 0.45, 0.2],
    });
  }
}

/** A hole in the roof slab and a matching heap of rubble on the floor below. */
export function collapseRoof(A, rng, spec, info, hole) {
  rubbleMound(A, rng, hole.x, info.floorY[info.floorY.length - 1] + 0.15, hole.z, 2.1, 26, {
    key: 'concrete',
  });
}
