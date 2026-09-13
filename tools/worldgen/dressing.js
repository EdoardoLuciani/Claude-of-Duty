import * as THREE from 'three';
import {
  BOX,
  BOX_FINE,
  BOX_SOFT,
  BOX_THIN,
  IDENT,
  LL,
  worldOf,
  ryOf,
  rubbleMound,
  mergeSimple,
  stripedCloth,
  spallPatch,
} from './kit.js';
import { burntCar } from './props.js';
import {
  clothGeometry,
  catenaryTube,
  patchGeometry,
  driftBerm,
  chamferBox,
  fillMasks,
  paintMasks,
  rockGeometry,
  tubeY,
} from './util.js';
import { STREET, BUILDINGS, SET_PIECES, GATE } from './layout.js';
import { isOpen, groundY } from './queries.js';

/**
 * WORLD — set dressing.
 *
 * Geometry makes a level; dressing makes it a *place*. This pass builds merged
 * ground wear, cloth, cables and other procedural micro-detail around the
 * explicitly authored props in placements/. Everything is authored in LEVEL
 * space and batched through the Assembler.
 */

const _m = new THREE.Matrix4();

/**
 * A dirt/rubble skirt at the base of a heavy prop.
 *
 * Nothing in the real world meets the ground on a clean line: there is a dust
 * halo where it was dragged into place, grit swept up against it, and a few
 * pebbles that got kicked out. Without this every crate, drum and barrier reads
 * as a decal pasted onto the deck — the single cheapest grounding cue there is.
 */
export function groundSkirt(A, rng, x, y, z, radius, opts = {}) {
  const r = radius * rng.range(1.15, 1.55);
  const g = patchGeometry(rng, r, { lobes: 11, wobble: 0.5 });
  A.addOnce(
    opts.key ?? 'dirt',
    g,
    LL(IDENT, x, y + 0.011 + rng.range(0, 0.005), z, rng.float() * 6.28, 1, 1, rng.range(0.7, 1.0)),
    { masks: [0.08, opts.grime ?? 0.85, opts.ao ?? 0.55] }
  );
  // a second, tighter and darker ring right at the contact line
  const g2 = patchGeometry(rng, radius * rng.range(0.75, 1.0), { lobes: 9, wobble: 0.35 });
  A.addOnce('dirt', g2, LL(IDENT, x, y + 0.018 + rng.range(0, 0.004), z, rng.float() * 6.28, 1, 1, 0.85), {
    masks: [0.05, 1.0, 0.8],
  });
  const n = opts.pebbles ?? rng.int(4, 8);
  for (let i = 0; i < n; i++) {
    const a = rng.float() * 6.28;
    const rr = radius * rng.range(0.75, 1.5);
    const px = x + Math.cos(a) * rr;
    const pz = z + Math.sin(a) * rr;
    if (!isOpen(px, pz, 0.05)) continue;
    A.put(
      rng.pick(['rock_b', 'rock_b', 'brick_b', 'cinder', 'rock_a', 'litter']),
      px,
      groundY(px, pz) + 0.012,
      pz,
      rng.float() * 6.28,
      rng.range(0.45, 0.95),
      [1, rng.range(1.1, 1.5), 1],
      rng.range(-0.3, 0.3),
      rng.range(-0.3, 0.3)
    );
  }
}

// =============================================================== prototypes ==
/** Props that only the dressing pass uses. */
export function registerDressingProps(A, rng) {
  const P = (id, key, geo, opts = {}) => A.proto(id, { geo, key, ...opts });

  P('wreck', 'metal_dark', burntCar(), { chunk: false });

  // A wheel still on the hub of a wreck — flat tyre, exposed rim.
  P(
    'wheel_flat',
    'rubber',
    (() => {
      const g = new THREE.TorusGeometry(0.24, 0.11, 10, 16);
      g.rotateY(Math.PI / 2);
      const pa = g.getAttribute('position');
      for (let i = 0; i < pa.count; i++) {
        const y = pa.getY(i);
        pa.setY(i, y * 0.82);
      }
      g.computeVertexNormals();
      fillMasks(g, 0.3, 0.6, 0.2);
      return g;
    })()
  );

  // Broken glass fan under a blown-out window.
  P(
    'glass_shards',
    'glass',
    (() => {
      const list = [];
      for (let i = 0; i < 9; i++) {
        const s = 0.03 + rng.float() * 0.06;
        const g = chamferBox(s, 0.004, s * rng.range(0.5, 1.6), 0.001);
        g.applyMatrix4(
          _m.makeRotationY(rng.float() * 6.28).setPosition(
            rng.range(-0.5, 0.5),
            0.003,
            rng.range(-0.4, 0.4)
          )
        );
        fillMasks(g, 0.6, 0.2, 0);
        list.push(g);
      }
      const g = mergeSimple(list);
      for (const p of list) p.dispose();
      return g;
    })(),
    { maxDist: 40, castShadow: false }
  );

  // Cinder blocks — the universal Middle-Eastern building unit.
  P(
    'cinder',
    'concrete_prop',
    (() => {
      const g = chamferBox(0.44, 0.21, 0.21, 0.012);
      paintMasks(g, (x, y, z, nx, ny, nz, out) => {
        out[0] = 0.7;
        out[1] = 0.3 + Math.max(0, -ny) * 0.5;
        out[2] = Math.max(0, -ny) * 0.4;
      });
      g.translate(0, 0.105, 0);
      return g;
    })()
  );

  // A stack of flat bread crates / produce trays for the stalls.
  P(
    'tray',
    'wood_prop',
    (() => {
      const list = [];
      const add = (sx, sy, sz, x, y, z) => {
        const g = chamferBox(sx, sy, sz, 0.005);
        g.translate(x, y, z);
        list.push(g);
      };
      add(0.6, 0.02, 0.42, 0, 0.01, 0);
      for (const s of [-1, 1]) {
        add(0.6, 0.09, 0.02, 0, 0.055, s * 0.2);
        add(0.02, 0.09, 0.42, s * 0.29, 0.055, 0);
      }
      const g = mergeSimple(list);
      for (const p of list) p.dispose();
      paintMasks(g, (x, y, z, nx, ny, nz, out) => {
        out[0] = 0.8;
        out[1] = 0.35;
      });
      return g;
    })()
  );

  // Produce heap: a lumpy mound that sits in a tray.
  P(
    'produce',
    'burlap',
    (() => {
      const list = [];
      for (let i = 0; i < 7; i++) {
        const g = rockGeometry(rng, rng.range(0.055, 0.1), 0, 0.8);
        g.translate(rng.range(-0.22, 0.22), 0.035 + rng.range(0, 0.04), rng.range(-0.14, 0.14));
        list.push(g);
      }
      const g = mergeSimple(list);
      for (const p of list) p.dispose();
      fillMasks(g, 0.15, 0.2, 0.1);
      return g;
    })(),
    { maxDist: 60 }
  );

  // Wall conduit box — small, but it is what makes a facade look serviced.
  P(
    'conduit_box',
    'metal_dark',
    (() => {
      const list = [];
      const b = chamferBox(0.2, 0.26, 0.11, 0.008);
      list.push(b);
      const lid = chamferBox(0.17, 0.22, 0.02, 0.004);
      lid.translate(0, 0, 0.065);
      list.push(lid);
      const g = mergeSimple(list);
      for (const p of list) p.dispose();
      paintMasks(g, (x, y, z, nx, ny, nz, out) => {
        out[0] = 0.85;
        out[1] = 0.45;
      });
      return g;
    })(),
    { maxDist: 55 }
  );

  // Cheap plastic chair — one is on every roof and outside every shop.
  P(
    'stool',
    'wood_prop',
    (() => {
      const list = [];
      const top = chamferBox(0.34, 0.04, 0.34, 0.01);
      top.translate(0, 0.42, 0);
      list.push(top);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const leg = chamferBox(0.035, 0.42, 0.035, 0.005);
          leg.applyMatrix4(
            _m.makeRotationZ(sx * 0.06).setPosition(sx * 0.13, 0.21, sz * 0.13)
          );
          list.push(leg);
        }
      const g = mergeSimple(list);
      for (const p of list) p.dispose();
      paintMasks(g, (x, y, z, nx, ny, nz, out) => {
        out[0] = 0.8;
        out[1] = 0.3 + Math.max(0, -ny) * 0.4;
      });
      return g;
    })()
  );
  return A;
}

// ================================================================== street ==
export function dressStreet(A, rng) {
  marketStalls(A, rng);
  barrierGrounding(A, rng);
  wreckScorch(A, rng);
  palmGrounding(A, rng);
  streetLampGrounding(A, rng);
  overheadLines(A, rng);
  facadeHangings(A, rng);
  rubbleDust(A, rng);
  streetRubble(A, rng);
  streetFloor(A, rng);
}


// --- the street floor -------------------------------------------------------
/**
 * The bottom third of every wide shot.
 *
 * A street is not a plane with a few crates on it: it is a floor with mass —
 * sand and swept rubble banked against every wall base, masonry spilling off the
 * kerb, polished ruts down the driving line, and enough at eye level in the
 * 10-30 m band to give the alley depth. The berms do double duty: they bury the
 * hard geometric line where wall meets ground, which otherwise reads as a
 * Z-fighting seam in every establishing shot.
 */
function streetFloor(A, rng) {
  const { halfWidth: HW, kerb: KB, walkH: WH, zMin, zMax } = STREET;

  // ---- 0. the wall-to-ground junction ----
  // A facade that meets the pavement on a ruled line is the tell that says
  // "two boxes intersecting". Every real wall has a 15-25 cm band of splashed
  // dirt at its foot. It is drawn on the outer face of the building's PLINTH, in
  // the plinth's own material with the grime mask pinned high, so it reads as
  // staining on the concrete rather than as a stripe of mud geometry — and the
  // segment-by-segment height jitter keeps its top edge from ruling a second
  // straight line 20 cm up.
  for (const side of [-1, 1]) {
    let z = zMin;
    while (z < zMax) {
      const seg = rng.range(0.5, 1.1);
      const cz = z + seg / 2;
      let host = null;
      for (const b of BUILDINGS) {
        // the facade that faces the street sits at |x| = kerb
        if (Math.abs(Math.abs(b.x) - b.w / 2 - KB) > 0.3) continue;
        if (Math.sign(b.x) !== side) continue;
        if (cz > b.z - b.d / 2 + 0.05 && cz < b.z + b.d / 2 - 0.05) {
          host = b;
          break;
        }
      }
      if (host) {
        const h = rng.range(0.15, 0.25);
        // the plinth stands 7 cm proud of the facade: stain ITS face, not the
        // render 7 cm behind it, or the band is buried and does nothing
        const px = side * (KB + 0.056);
        A.add(
          host.plinthKey ?? 'concrete',
          BOX_THIN(A),
          LL(IDENT, px, WH + h / 2 - 0.025, cz, 0, 0.034, h, seg * 0.99),
          { masks: [0.0, 1.0, 0.85] }
        );
        // and a low fillet of swept grit in the corner itself
        if (rng.float() < 0.75) {
          const g = driftBerm(rng, seg * 0.95, rng.range(0.16, 0.34), rng.range(0.04, 0.09), {
            nz: 3,
          });
          A.addOnce(
            'dirt',
            g,
            LL(IDENT, side * (KB - 0.04), WH - 0.012, cz, side > 0 ? Math.PI / 2 : -Math.PI / 2, 1, 1, 1),
            { masks: [0.1, 0.95, 0.7] }
          );
        }
      }
      z += seg;
    }
  }

  // ---- 1. drift berms banked against the building line, both sides ----
  for (const side of [-1, 1]) {
    let z = zMin + 1;
    while (z < zMax - 2) {
      const len = rng.range(2.2, 6.5);
      const cz = z + len / 2;
      const x = side * (KB - 0.06);
      // Alley mouths and doorways stay clear: a berm across a door reads as a bug.
      if (isOpen(x - side * 0.5, cz, 0.05) && rng.float() < 0.96) {
        const h = rng.range(0.14, 0.42);
        const w = rng.range(0.6, 1.5);
        const g = driftBerm(rng, len, w, h);
        // ry = -PI/2 for the +X side puts the tall edge against the wall
        A.addOnce(
          rng.float() < 0.72 ? 'sand' : 'road_dust',
          g,
          LL(IDENT, x, WH - 0.02, cz, side > 0 ? Math.PI / 2 : -Math.PI / 2, 1, 1, 1),
          { masks: [0.15, 0.55, 0.45] }
        );
      }
      z += len + rng.range(0.1, 0.9);
    }
  }

  // ---- 2. the kerb line: sand spilling off the pavement into the gutter ----
  for (let i = 0; i < 70; i++) {
    const side = rng.float() < 0.5 ? -1 : 1;
    const cz = rng.range(zMin + 2, zMax - 2);
    const len = rng.range(1.2, 3.4);
    if (!isOpen(side * (HW + 0.4), cz, 0.05)) continue;
    const g = driftBerm(rng, len, rng.range(0.35, 0.8), rng.range(0.05, 0.14), { nz: 3 });
    A.addOnce('sand', g, LL(IDENT, side * (HW + 0.12), 0.02, cz, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 1, 1), {
      masks: [0.15, 0.5, 0.3],
    });
  }

  // ---- 3. tyre tracks polished into the dust along the driving line ----
  // Two ruts, laid as long overlapping strips so the line wanders instead of
  // ruling a straight edge down the middle of the frame.
  for (const side of [-1, 1]) {
    let z = zMin + 2;
    while (z < zMax - 3) {
      const len = rng.range(5.0, 13.0);
      const x = side * rng.range(1.25, 1.95);
      const camber = (1 - (x / HW) ** 2) * 0.055 + 0.038;
      const g = patchGeometry(rng, 0.34, { lobes: 13, wobble: 0.28 });
      A.addOnce(
        'road_rut',
        g,
        LL(IDENT, x, camber, z + len / 2, rng.range(-0.03, 0.03), 1, 1, len / 0.68),
        { masks: [0.55, 0.5, 0.15] }
      );
      // a lighter, wider halo of disturbed dust either side of the polished strip
      if (rng.float() < 0.7) {
        const hg = patchGeometry(rng, 0.62, { lobes: 11, wobble: 0.4 });
        A.addOnce(
          'road_dust',
          hg,
          LL(IDENT, x, camber - 0.004, z + len / 2, rng.range(-0.04, 0.04), 1, 1, len / 1.24),
          { masks: [0.45, 0.15, 0.08] }
        );
      }
      // the fine dust ridge thrown up between the wheels
      if (rng.float() < 0.6) {
        const dg = driftBerm(rng, len * 0.8, 0.3, 0.035, { nz: 3 });
        A.addOnce('road_dust', dg, LL(IDENT, x - side * 0.42, camber + 0.004, z + len / 2, Math.PI / 2, 1, 1, 1), {
          masks: [0.1, 0.4, 0.2],
        });
      }
      z += len + rng.range(0.5, 4.0);
    }
  }
  // a couple of turning scuffs where vehicles have swung across the road
  for (let i = 0; i < 8; i++) {
    const z = rng.range(zMin + 5, zMax - 5);
    const g = patchGeometry(rng, rng.range(0.5, 1.1), { lobes: 12, wobble: 0.5 });
    const x = rng.range(-HW + 0.6, HW - 0.6);
    A.addOnce(
      'asphalt',
      g,
      LL(IDENT, x, (1 - (x / HW) ** 2) * 0.055 + 0.04, z, rng.float() * 3.14, 1, 1, rng.range(1.4, 2.6)),
      { masks: [0.45, 0.4, 0.15] }
    );
  }

  // Ground the largest authored set pieces with merged dust patches. The prop
  // transforms themselves live in placements/ and are added by placeBaked().
  for (const [x, z, radius] of [
    [-3.35, -6.2, 1.1],
    [-5.1, -2.0, 0.8],
    [4.9, -11.5, 0.8],
    [4.75, 6.2, 0.7],
    [-5.5, 6.2, 0.55],
    [5.55, -1.2, 0.72],
    [5.45, -26.5, 0.55],
  ]) groundSkirt(A, rng, x, groundY(x, z), z, radius, { pebbles: 0 });
}

// --- market stalls ----------------------------------------------------------
function marketStalls(A, rng) {
  const canopy = ['fabric_red', 'fabric_teal', 'fabric_cream'];
  for (const [x, z, ry, w] of SET_PIECES.stalls) {
    const y = groundY(x, z);
    for (const t of [-0.42, 0.42]) {
      groundSkirt(A, rng, x + Math.cos(ry) * w * t, y, z - Math.sin(ry) * w * t, 0.4, { pebbles: 0 });
    }
    const width = w * rng.range(1.02, 1.16);
    const depth = rng.range(1.32, 1.6);
    const keys = [rng.pick(canopy), rng.pick(canopy)];
    const slack = rng.range(0.8, 1.5);
    stripedCloth(A, keys, LL(IDENT, x, y + 2.02, z, ry, 1, 1, 1, -Math.PI / 2), width, depth, {
      segY: 7,
      sag: 0.19 * slack,
      wrinkle: 0.028 * slack,
      bulge: 0.05 * slack,
      thickness: 0.0028,
      fray: 0.012,
      skipBand: rng.float() < 0.3 ? rng.int(0, 5) : -1,
      rng,
      masks: [0.35, rng.range(0.4, 0.7), 0.15],
    });
    stripedCloth(A, keys, LL(IDENT, x, y + 1.86, z, ry), width, rng.range(0.24, 0.4), {
      segY: 3,
      sag: 0.06 * slack,
      wrinkle: 0.028 * slack,
      thickness: 0.0026,
      fray: 0.016,
      rng,
      masks: [0.4, rng.range(0.45, 0.75), 0.2],
    });
  }
}

// --- barriers ---------------------------------------------------------------
function barrierGrounding(A, rng) {
  for (const [x, z, ry] of SET_PIECES.jerseys) {
    const y = groundY(x, z);
    for (const t of [-0.55, 0.55]) {
      groundSkirt(A, rng, x + Math.sin(ry) * t * 1.1, y, z + Math.cos(ry) * t * 1.1, 0.52, { pebbles: 0 });
    }
  }
  for (const [x, z, ry] of [
    [-4.0, 22.0, 0.1], [4.2, 14.5, -0.15], [-4.3, -1.0, 0.05],
    [4.3, -12.0, 0.2], [-4.1, -30.0, -0.1], [4.0, -37.5, 0.12], [-2.0, -41.0, 1.5],
  ]) {
    const y = groundY(x, z);
    for (const t of [-0.4, 0.4]) {
      groundSkirt(A, rng, x + Math.cos(ry) * t, y, z - Math.sin(ry) * t, 0.62, { pebbles: 0 });
    }
  }
}

// --- sandbags ---------------------------------------------------------------
/**
 * A course-laid sandbag wall.
 *
 * What makes a stack of bags read as cover rather than as a tray of bread rolls:
 *
 *  - three different bag silhouettes, picked so neighbours rarely match;
 *  - the bags INTERPENETRATE. Real bags are laid wet-soft and squash into each
 *    other; 1-2 cm of overlap along the run and between courses is what closes
 *    the daylight gaps that turn a wall into a lattice;
 *  - squash grows with the number of bags above, so the bottom course is
 *    visibly flatter and wider than the top one;
 *  - per-bag yaw ±12°, non-uniform scale 0.90-1.12, and 2-4 cm of row-pitch
 *    jitter so no two courses line up;
 *  - the odd header bag laid across the run, and per-bag weathering variation.
 *
 * `baseY` puts the run on a roof or a rampart walkway instead of the street.
 */
export function sandbagWall(A, rng, x, z, ry, len, courses = 3, baseY = null) {
  const y = baseY ?? groundY(x, z);
  const BAG_W = 0.5;
  const BAG_H = 0.17;
  const IDS = ['sandbag_a', 'sandbag_b', 'sandbag_c'];
  let cy = y + 0.01;
  let prev = -1;
  for (let c = 0; c < courses; c++) {
    // load from the bags above: the bottom of a five-high wall carries most of it
    const load = (courses - 1 - c) / Math.max(1, courses - 1);
    const squash = 1 - load * 0.19; // vertical
    const spread = 1 + load * 0.07; // and it bulges out sideways
    // 2-4 cm of row-pitch jitter, so course seams never stack vertically
    const pitch = BAG_W - rng.range(0.02, 0.04);
    const per = Math.max(2, Math.round(len / pitch));
    const stagger = (c % 2) * pitch * 0.5 + rng.range(-0.03, 0.03);
    const shrink = c === courses - 1 && courses > 2 ? 1 : 0;
    const bagH = BAG_H * squash;
    for (let i = shrink; i < per - shrink; i++) {
      const lx = -len / 2 + stagger + (i + 0.5) * pitch;
      if (Math.abs(lx) > len / 2) continue;
      // never the same silhouette twice in a row
      let pick = rng.int(0, 2);
      if (pick === prev) pick = (pick + 1 + rng.int(0, 1)) % 3;
      prev = pick;
      // Headers: bags turned across the run. Real emplacements are laid part
      // stretcher, part header, and the mix is what stops a run reading as a
      // row of identical parallel loaves.
      const header = rng.float() < 0.3;
      const lz = rng.range(-0.03, 0.03) + (header ? rng.range(-0.05, 0.05) : 0);
      const px = x + Math.cos(ry) * lx + Math.sin(ry) * lz;
      const pz = z - Math.sin(ry) * lx + Math.cos(ry) * lz;
      A.putS(
        IDS[pick],
        px,
        cy, // the bag prop's origin is its base, so scale never lifts it
        pz,
        ry + (header ? Math.PI / 2 : 0) + rng.range(-0.21, 0.21),
        rng.range(0.9, 1.12) * spread,
        rng.range(0.9, 1.06) * squash,
        rng.range(0.94, 1.12) * spread,
        [1, rng.range(0.7, 1.6), rng.range(0.85, 1.3)],
        rng.range(-0.09, 0.09),
        rng.range(-0.11, 0.11)
      );
    }
    // the next course beds 1.5-2.5 cm into this one
    cy += bagH - rng.range(0.015, 0.025);
  }
  if (baseY !== null) return; // a rampart run: no ground clutter behind it
  // spilled sand and grit along the foot of the run: bags leak, and the line
  // where the bottom course meets the deck is otherwise a ruled edge
  const skirts = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i < skirts; i++) {
    const lx = -len / 2 + ((i + 0.5) / skirts) * len;
    groundSkirt(A, rng, x + Math.cos(ry) * lx, y, z - Math.sin(ry) * lx, 0.44, {
      pebbles: rng.int(1, 3),
      key: 'sand',
      grime: 0.7,
    });
  }
  // ammo tins and a jerry can behind the wall
  for (let i = 0; i < rng.int(1, 3); i++) {
    const lx = rng.range(-len / 2, len / 2);
    const px = x + Math.cos(ry) * lx + Math.sin(ry) * 0.7;
    const pz = z - Math.sin(ry) * lx + Math.cos(ry) * 0.7;
    if (!isOpen(px, pz, 0.3)) continue;
    A.put(
      rng.pick(['jerry_can', 'crate_b', 'box_card_a', 'gas_bottle']),
      px,
      groundY(px, pz),
      pz,
      rng.float() * 6.28,
      1,
      [1, 1.3, 1]
    );
  }
}

// --- wrecks -----------------------------------------------------------------
function wreckScorch(A, rng) {
  for (const [x, z] of SET_PIECES.wrecks) {
    const y = groundY(x, z);
    const scorch = patchGeometry(rng, rng.range(2.6, 3.4), { lobes: 11, wobble: 0.5 });
    A.addOnce('asphalt', scorch, LL(IDENT, x, y + 0.008, z, rng.float() * 6.28, 1, 1, 0.7), {
      masks: [0.05, 1.0, 0.9],
    });
  }
}

// --- palms ------------------------------------------------------------------
function palmGrounding(A, rng) {
  for (const [x, z] of SET_PIECES.palms) {
    if (x === -9 && z === -10.2) continue; // west-alley spawn occupies this palm base
    const y = groundY(x, z);
    const patch = patchGeometry(rng, rng.range(0.9, 1.4), { lobes: 10, wobble: 0.45 });
    A.addOnce('dirt', patch, LL(IDENT, x, y + 0.02, z, rng.float() * 6.28), { masks: [0.1, 0.8, 0.5] });
  }
}

// --- street lamps -----------------------------------------------------------
function streetLampGrounding(A, rng) {
  for (const [x, z] of SET_PIECES.lamps) {
    const y = groundY(x, z);
    const ry = x < 0 ? 0 : Math.PI;
    const armX = x + Math.cos(ry) * 0.88;
    const armZ = z - Math.sin(ry) * 0.88;
    groundSkirt(A, rng, x, y, z, 0.34, { pebbles: 0 });
    A.lampAnchors.push({ x: armX, y: y + 5.3, z: armZ });
  }
}

// --- cables, laundry --------------------------------------------------------
function overheadLines(A, rng) {
  const insulator = (x, y, z) => {
    A.add('concrete_dark', BOX_FINE(A), LL(IDENT, x, y, z, 0, 0.1, 0.16, 0.1), {
      masks: [0.6, 0.5, 0.2],
    });
  };
  for (const [x0, y0, z0, x1, y1, z1, sag] of SET_PIECES.cables) {
    const t = catenaryTube([x0, y0, z0], [x1, y1, z1], sag, 0.022, { seg: 14, radial: 4, jitter: 0.05 });
    A.addOnce('metal_dark', t, null, { masks: [0.4, 0.7, 0.2] });
    // a second, thinner line running with it — never one lonely wire
    const t2 = catenaryTube(
      [x0, y0 - 0.22, z0 + 0.18],
      [x1, y1 - 0.18, z1 + 0.2],
      sag * 1.12,
      0.014,
      { seg: 14, radial: 4, jitter: 0.06 }
    );
    A.addOnce('metal_dark', t2, null, { masks: [0.4, 0.7, 0.2] });
    insulator(x0, y0 + 0.06, z0);
    insulator(x1, y1 + 0.06, z1);
  }

  const SAG = 0.42;
  for (const [x0, y0, z0, x1, y1, z1] of SET_PIECES.laundry) {
    const line = catenaryTube([x0, y0, z0], [x1, y1, z1], SAG, 0.012, { seg: 12, radial: 4 });
    A.addOnce('metal_dark', line, null, { masks: [0.3, 0.6, 0.2] });
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(-dz, dx);
    const n = Math.max(2, Math.round(len / 1.7));
    const K = Math.cosh(1.5) - 1;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (rng.float() < 0.12) continue;
      // hang from the line where the line actually is: same catenary as the tube
      const droop = (Math.cosh(1.5) - Math.cosh((t - 0.5) * 3)) / K;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const py = y0 + (y1 - y0) * t - SAG * droop - 0.03;
      const w = rng.range(0.72, 1.15);
      const h = rng.range(0.85, 1.45);
      const cloth = clothGeometry(w, h, {
        segX: 9,
        segY: 10,
        sag: rng.range(0.18, 0.3),
        wrinkle: rng.range(0.05, 0.085),
        rng,
        twist: rng.range(0.1, 0.2),
        bulge: 0.06,
        thickness: rng.range(0.0016, 0.003),
        fray: rng.range(0.01, 0.03),
        bow: x0 > 0 ? -1 : 1,
      });
      A.addOnce(
        rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream', 'burlap']),
        cloth,
        LL(IDENT, px, py - h / 2 + 0.02, pz, ry, 1, 1, 1),
        { masks: [0.3, rng.range(0.4, 0.8), 0.2] }
      );
    }
  }
}

// --- hanging rugs on facades ------------------------------------------------
function facadeHangings(A, rng) {
  for (const [x, y, z, ry, w, h] of SET_PIECES.hangings) {
    // A rug on a facade is the biggest single piece of cloth in the frame, so it
    // is also the one that most obviously reads as a sheet of glass if it has no
    // thickness, no hem and no slack. Heavy gauge, deep folds, frayed bottom.
    const cloth = clothGeometry(w, h, {
      segX: 10,
      segY: 10,
      sag: rng.range(0.09, 0.15),
      wrinkle: rng.range(0.04, 0.07),
      rng,
      bulge: rng.range(0.05, 0.11),
      twist: rng.range(0.03, 0.1),
      thickness: rng.range(0.0026, 0.004),
      fray: rng.range(0.015, 0.035),
      bow: -1, // belly out into the street, not through the facade
    });
    A.addOnce(rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']), cloth, LL(IDENT, x, y, z, ry), {
      masks: [0.35, rng.range(0.42, 0.72), 0.2],
    });
    // the rail it hangs from
    A.add('metal_rust', BOX_FINE(A), LL(IDENT, x, y + h / 2 + 0.06, z, ry, w + 0.2, 0.035, 0.035), {
      masks: [0.9, 0.5, 0.1],
    });
    // a second, smaller rug beside it, half-rolled
    if (rng.float() < 0.6) {
      const c2 = clothGeometry(w * 0.55, h * 0.7, {
        segX: 7,
        segY: 8,
        sag: 0.12,
        wrinkle: 0.06,
        rng,
        thickness: 0.0032,
        fray: 0.025,
        bow: -1,
      });
      A.addOnce(
        rng.pick(['fabric_red', 'fabric_cream']),
        c2,
        LL(IDENT, x - Math.sin(ry) * (w * 0.75), y - 0.25, z - Math.cos(ry) * (w * 0.75), ry),
        { masks: [0.4, 0.6, 0.25] }
      );
    }
  }
}

// --- rubble -----------------------------------------------------------------
function rubbleDust(A, rng) {
  for (const [x, z, radius, count] of SET_PIECES.rubble) {
    const y = groundY(x, z);
    rubbleMound(A, rng, x, y, z, radius, count, { key: 'concrete' });
    const patch = patchGeometry(rng, radius * 1.5, { lobes: 12, wobble: 0.4 });
    A.addOnce('dirt', patch, LL(IDENT, x, y + 0.012, z, rng.float() * 6.28), { masks: [0.1, 0.9, 0.6] });
  }
}

function streetRubble(A, rng) {
  for (const [x, z] of [
    [-5.4, 16.5], [5.5, 11.0], [-5.6, 2.0], [5.6, -4.0],
    [-5.5, -13.5], [5.4, -19.0], [-5.3, -25.5], [5.5, -33.0],
  ]) {
    rubbleMound(A, rng, x, groundY(x, z), z, rng.range(1.1, 1.9), rng.int(18, 30), {
      key: 'concrete_prop',
    });
  }
}

// =============================================================== buildings ==
/**
 * Facade services and roof clutter, driven by the anchors each building
 * returned while it was being generated.
 */
export function dressBuildings(A, rng, infos) {
  for (const info of infos) dressBuilding(A, rng, info);
  alleyLines(A, rng);
}

function dressBuilding(A, rng, info) {
  const spec = info.spec;
  const top = info.roofY;

  // ---- AC units, conduit and sat dishes hung off the open facades ----
  for (const wnd of info.windows) {
    const pm = wnd.pm;
    if (wnd.f === 0) continue;
    if (rng.float() < 0.34) {
      // beside the window, bracketed off the wall
      const dx = (rng.float() < 0.5 ? -1 : 1) * (wnd.w / 2 + 0.55);
      // condensate runs down the render below the unit: a narrow grime streak
      const runH = wnd.y - 1.1;
      if (runH > 0.5) {
        A.add(
          'plaster_sand',
          BOX_FINE(A),
          LL(pm, wnd.x + dx, wnd.y - 0.75 - runH / 2, -0.004, 0, 0.16, runH, 0.008),
          { masks: [0.0, 1.0, 0.75] }
        );
      }
    }
    // washing line strung across a balcony window
    if (rng.float() < 0.18) {
      const a = worldOf(pm, wnd.x - wnd.w / 2 - 0.1, wnd.y + 0.5, -0.12).slice();
      const b = worldOf(pm, wnd.x + wnd.w / 2 + 0.1, wnd.y + 0.45, -0.12).slice();
      const line = catenaryTube(a, b, 0.08, 0.008, { seg: 6, radial: 4 });
      A.addOnce('metal_dark', line, null, { masks: [0.3, 0.6, 0] });
      for (let i = 0; i < 2; i++) {
        const t = 0.3 + i * 0.4;
        const cloth = clothGeometry(rng.range(0.3, 0.5), rng.range(0.4, 0.7), {
          segX: 5,
          segY: 6,
          sag: 0.1,
          wrinkle: rng.range(0.04, 0.065),
          twist: 0.1,
          fray: 0.012,
          rng,
        });
        A.addOnce(
          rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
          cloth,
          LL(
            IDENT,
            a[0] + (b[0] - a[0]) * t,
            a[1] - 0.35,
            a[2] + (b[2] - a[2]) * t,
            ryOf(pm) + Math.PI / 2
          ),
          { masks: [0.35, 0.6, 0.2] }
        );
      }
    }
  }

  // ---- balconies get lived in ----
  for (const bal of info.balconies) {
    const pm = bal.pm;
    // rug over the railing — instantly reads as inhabited
    if (rng.float() < 0.55) {
      const cloth = clothGeometry(rng.range(0.8, 1.4), rng.range(0.7, 1.1), {
        segX: 7,
        segY: 7,
        sag: 0.09,
        wrinkle: rng.range(0.04, 0.07),
        thickness: 0.0034,
        fray: rng.range(0.012, 0.03),
        rng,
      });
      const wp = worldOf(pm, bal.x + rng.range(-0.3, 0.3), bal.y + 0.95, -bal.d - 0.03);
      A.addOnce(
        rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream']),
        cloth,
        LL(IDENT, wp[0], wp[1], wp[2], ryOf(pm) + Math.PI),
        { masks: [0.4, 0.55, 0.2] }
      );
    }
  }

  // ---- roof detail ----
  // Roofs are playable ground in this map (balconies and parapets are the
  // elevation layer), so they get real density, not a token water tank.
  // The ROOF plate, not the ground footprint. On a setback building the two
  // differ by a couple of metres, and using the footprint hangs water tanks,
  // aerials and crate stacks in mid-air over the terrace void.
  const rs = info.roofSpec ?? spec;
  const rx0 = rs.x - rs.w / 2 + 1.0;
  const rx1 = rs.x + rs.w / 2 - 1.0;
  const rz0 = rs.z - rs.d / 2 + 1.0;
  const rz1 = rs.z + rs.d / 2 - 1.0;
  const roofY = top + 0.02;
  // dust and grit blown into the roof corners
  for (let i = 0; i < 4; i++) {
    const g = patchGeometry(rng, rng.range(0.6, 1.6), { lobes: 9, wobble: 0.5 });
    A.addOnce(
      'dirt',
      g,
      LL(IDENT, rng.range(rx0, rx1), roofY + 0.012, rng.range(rz0, rz1), rng.float() * 6.28, 1, 1, 0.7),
      { masks: [0.1, 0.85, 0.5] }
    );
  }
  // rooftop laundry line between the parapets
  if (rs.w > 10 && rng.float() < 0.4) {
    const a = [rs.x - rs.w / 2 + 0.4, roofY + 1.0, rng.range(rz0, rz1)];
    const b = [rs.x + rs.w / 2 - 0.4, roofY + 0.96, rng.range(rz0, rz1)];
    const line = catenaryTube(a, b, 0.3, 0.01, { seg: 10, radial: 4 });
    A.addOnce('metal_dark', line, null, { masks: [0.3, 0.6, 0] });
    for (const sx of [-1, 1]) {
      A.add('metal_rust', BOX_FINE(A), LL(IDENT, rs.x + sx * (rs.w / 2 - 0.4), roofY + 0.9, a[2] + (sx > 0 ? b[2] - a[2] : 0), 0, 0.06, 1.8, 0.06), {
        masks: [0.9, 0.5, 0.1],
      });
    }
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cloth = clothGeometry(rng.range(0.5, 0.8), rng.range(0.45, 0.8), {
        segX: 7,
        segY: 8,
        sag: rng.range(0.12, 0.22),
        wrinkle: rng.range(0.045, 0.075),
        twist: rng.range(0.08, 0.18),
        fray: rng.range(0.01, 0.025),
        rng,
      });
      A.addOnce(
        rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream', 'burlap']),
        cloth,
        LL(
          IDENT,
          a[0] + (b[0] - a[0]) * t,
          a[1] - 0.5 - 0.22 * Math.sin(t * Math.PI),
          a[2] + (b[2] - a[2]) * t,
          0
        ),
        { masks: [0.3, rng.range(0.4, 0.8), 0.2] }
      );
    }
  }
  // aerials: thin, tall, and they do a lot for a skyline
  for (let i = 0; i < rng.int(1, 3); i++) {
    const px = rng.range(rx0, rx1);
    const pz = rng.range(rz0, rz1);
    const h = rng.range(1.4, 3.2);
    const pipe = A.cache('aerial', () => tubeY(0.018, 1, { radial: 5 }));
    A.add('metal_rust', pipe, LL(IDENT, px, roofY, pz, 0, 1, h, 1), { masks: [0.9, 0.5, 0.1] });
    for (let k = 0; k < 4; k++) {
      A.add(
        'metal_rust',
        pipe,
        LL(IDENT, px, roofY + h * (0.5 + k * 0.11), pz, rng.float() * 3.14, 1, rng.range(0.25, 0.5), 1, 0, Math.PI / 2),
        { masks: [0.9, 0.5, 0.1] }
      );
    }
  }
}

/** Cables and washing lines strung across the alleys between buildings. */
function alleyLines(A, rng) {
  const spans = [
    [-6.6, 5.0, 21.0, -6.6, 5.4, 24.0],
    [-6.6, 4.2, -9.0, -6.6, 4.6, -11.5],
    [7.0, 4.6, 2.5, 7.0, 4.2, 6.6],
    [7.0, 5.6, -16.0, 7.0, 5.2, -20.0],
    [-8.0, 6.4, 20.6, -8.0, 6.0, 23.8],
    [8.6, 6.2, 2.2, 8.6, 5.8, 7.2],
  ];
  for (const [x0, y0, z0, x1, y1, z1] of spans) {
    const t = catenaryTube([x0, y0, z0], [x1, y1, z1], 0.5, 0.016, { seg: 10, radial: 4, jitter: 0.04 });
    A.addOnce('metal_dark', t, null, { masks: [0.4, 0.7, 0.2] });
    const n = rng.int(2, 4);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const cloth = clothGeometry(rng.range(0.45, 0.8), rng.range(0.5, 1.0), {
        segX: 6,
        segY: 8,
        sag: rng.range(0.12, 0.22),
        wrinkle: rng.range(0.045, 0.075),
        twist: rng.range(0.08, 0.18),
        fray: rng.range(0.01, 0.025),
        rng,
      });
      A.addOnce(
        rng.pick(['fabric_red', 'fabric_teal', 'fabric_cream', 'burlap']),
        cloth,
        LL(
          IDENT,
          x0 + (x1 - x0) * f,
          y0 + (y1 - y0) * f - 0.6 - 0.4 * Math.sin(f * Math.PI),
          z0 + (z1 - z0) * f,
          Math.atan2(-(z1 - z0), x1 - x0)
        ),
        { masks: [0.3, rng.range(0.4, 0.8), 0.2] }
      );
    }
  }
}

// ================================================================ the gate ==
/**
 * A deep opening in the terminator mass: a recessed panel with a genuinely dark
 * back plane and a lintel over it. Used for the loggia arcade and the tower's
 * window band — an opening you can see INTO is the cheapest way to prove a wall
 * has thickness, and a run of them breaks up the largest flat surface in the
 * frame without adding a single extra draw call.
 */
function gateAperture(A, rng, x, y, z, w, h, t, opts = {}) {
  // The street runs down -Z and every hero camera looks along it, so +Z is the
  // face that matters: the north elevation is the one in every frame.
  const zf = z + t / 2;
  const rec = opts.recess ?? 0.5;
  // the void: dark, set well back, so the reveal shadows across it
  A.add('window_void', BOX(A), LL(IDENT, x, y, zf - rec - 0.06, 0, w, h, 0.12), {
    masks: [0.15, 0.95, 1.0],
  });
  // reveal: four returns boxing the void in, in shadow all afternoon
  A.add('concrete_dark', BOX(A), LL(IDENT, x, y + h / 2 + 0.07, zf - rec / 2, 0, w + 0.3, 0.14, rec), {
    masks: [0.3, 0.85, 0.9],
  });
  A.add('concrete_dark', BOX(A), LL(IDENT, x, y - h / 2 - 0.07, zf - rec / 2, 0, w + 0.3, 0.14, rec), {
    masks: [0.55, 0.75, 0.7],
  });
  for (const s of [-1, 1]) {
    A.add(
      'concrete_dark',
      BOX(A),
      LL(IDENT, x + s * (w / 2 + 0.07), y, zf - rec / 2, 0, 0.14, h, rec),
      { masks: [0.3, 0.8, 0.85] }
    );
  }
  // stone lintel / arch head standing proud of the wall face
  A.add('concrete', BOX_SOFT(A), LL(IDENT, x, y + h / 2 + 0.16, zf + 0.09, 0, w + 0.5, 0.2, 0.34), {
    masks: [0.7, 0.5, 0.25],
  });
  if (opts.sill !== false) {
    A.add('concrete', BOX_SOFT(A), LL(IDENT, x, y - h / 2 - 0.1, zf + 0.12, 0, w + 0.44, 0.11, 0.42), {
      masks: [0.55, 0.45, 0.3],
    });
  }
  // a shutter or a rag hanging in some of them: nothing is uniform
  if (rng.float() < 0.4) {
    A.add(
      'metal_rust',
      BOX(A),
      LL(
        IDENT,
        x + rng.range(-0.1, 0.1),
        y - h * 0.1,
        zf - 0.14,
        0,
        w * rng.range(0.5, 0.9),
        h * rng.range(0.4, 0.8),
        0.03
      ),
      { masks: [0.9, 0.6, 0.2] }
    );
  }
}

/**
 * An irregular crenellated run.
 *
 * A merlon run at a perfectly regular pitch, all one height, all one value, is
 * the single loudest "untextured blockout" tell there is. This walks the run
 * with varied widths, varied gaps, varied heights, a few leaning, a few sheared
 * off level with the walkway, exposed clay block where the render has spalled
 * off the corners, and a coping course under the whole thing so the crenels
 * throw a hard shadow line back onto the wall.
 */
function merlonRun(A, rng, x0, x1, z, t, yTop, opts = {}) {
  const key = opts.key ?? 'plaster_sand';
  const dt = t * (opts.depth ?? 0.45);
  const zc = z + t / 2 - dt / 2 - (opts.set ?? 0.06); // set back from the +Z face
  // coping course the merlons stand on, proud of the wall on both faces
  A.add('concrete', BOX_SOFT(A), LL(IDENT, (x0 + x1) / 2, yTop + 0.07, z, 0, x1 - x0, 0.14, t + 0.3), {
    masks: [0.85, 0.4, 0.15],
    support: 'rampart',
  });
  let x = x0 + rng.range(0.05, 0.35);
  while (x < x1 - 0.4) {
    const w = Math.min(rng.range(0.62, 1.35), x1 - 0.1 - x);
    if (w < 0.3) break;
    const broken = rng.float() < 0.22;
    const h = broken ? rng.range(0.16, 0.42) : rng.range(0.62, 1.15);
    const cx = x + w / 2;
    const lean = rng.range(-0.035, 0.035);
    A.add(key, BOX(A), LL(IDENT, cx, yTop + 0.14 + h / 2, zc, 0, w, h, dt, 0, lean), {
      masks: [0.55, 0.45, 0.2],
    });
    // a cap stone on some, and spalled render showing the clay block beneath
    if (!broken && rng.float() < 0.55) {
      A.add('concrete', BOX_SOFT(A), LL(IDENT, cx, yTop + 0.16 + h, zc, 0, w + 0.1, 0.07, dt + 0.1), {
        masks: [0.9, 0.35, 0.1],
      });
    }
    if (rng.float() < 0.45) {
      const g = spallPatch(rng, w * rng.range(0.3, 0.62), h * rng.range(0.25, 0.55), 0.02);
      A.addOnce(
        'brick_fine',
        g,
        LL(IDENT, cx + rng.range(-w * 0.2, w * 0.2), yTop + 0.14 + h * rng.range(0.3, 0.7), zc + dt / 2 - 0.013)
      );
    }
    x += w + rng.range(0.34, 0.95);
  }
}

/**
 * The street terminator at the south end of the vista.
 *
 * Four masses at four heights, stepped in Z as well as Y, with a pointed archway
 * through the middle, an upper loggia of dark recessed openings, a rampart
 * walkway on corbels with a shadowed underside, sandbag emplacements on top, and
 * a sliver of sky over the arch that shows `BS3` receding behind it. The old
 * version was a single 17 m slab at one height with square merlons on a perfectly
 * regular pitch — the largest flat surface in most frames, sitting exactly where
 * the eye lands.
 */
export function buildGate(A, rng) {
  const { z, depth, span, height, outerW, bodyH, xL0, xL1, hL, xR0, xR1, hR, eastProud, xT0, xT1, hT, towerProud } = GATE;
  const t = depth;

  /** One block of the mass: body, plinth, cornice, spalled render, walkway. */
  const block = (x0, x1, h, tt, zc, o = {}) => {
    const cx = (x0 + x1) / 2;
    const w = x1 - x0;
    A.add(o.key ?? 'plaster_sand', BOX(A), LL(IDENT, cx, h / 2, zc, 0, w, h, tt), {
      masks: [0.45, 0.6, 0.35],
    });
    // plinth: catches the ground grime band and the sand drift at the base
    A.add('concrete', BOX_SOFT(A), LL(IDENT, cx, 0.4, zc, 0, w + 0.24, 0.8, tt + 0.26), {
      masks: [0.6, 0.85, 0.55],
    });
    // Pilasters standing 0.3 m proud at each end of the block. These are what
    // give the face a lit edge and a cast shadow instead of one flat value.
    for (const s of [-1, 1]) {
      A.add(o.key ?? 'plaster_sand', BOX(A), LL(IDENT, cx + s * (w / 2 - 0.3), h * 0.5, zc + tt / 2 + 0.15, 0, 0.6, h - 0.2, 0.34), {
        masks: [0.6, 0.5, 0.25],
      });
    }
    // cornice, well proud of the face: the strongest horizontal shadow on the
    // whole terminator, and a full stop of value between the two faces.
    A.add('concrete', BOX_SOFT(A), LL(IDENT, cx, h - 0.22, zc + 0.2, 0, w + 0.5, 0.3, tt + 0.66), {
      masks: [0.8, 0.45, 0.2],
    });
    // corbels under it, so the overhang reads as carried rather than floating
    const nb = Math.max(2, Math.round(w / 1.15));
    for (let i = 0; i < nb; i++) {
      const bx = x0 + 0.35 + (i / Math.max(1, nb - 1)) * (w - 0.7);
      A.add('concrete', BOX(A), LL(IDENT, bx, h - 0.62, zc + tt / 2 + 0.22, 0, 0.22, 0.44, 0.46), {
        masks: [0.7, 0.55, 0.35],
      });
    }
    // A string course at mid height. The sun is 32 degrees up, so every
    // horizontal ledge on a shaded elevation reads as a bright line — this is
    // the cheapest way to break a big shaded face into readable bands.
    A.add('concrete', BOX_SOFT(A), LL(IDENT, cx, h * 0.46, zc + tt / 2 + 0.11, 0, w + 0.18, 0.16, 0.3), {
      masks: [0.8, 0.5, 0.25],
    });
    // Spalled render over the visible face. Small and nearly flush: a big patch
    // standing proud reads as a paint splash rather than as exposed clay block.
    const sp = Math.round(w * h * 0.05);
    for (let i = 0; i < sp; i++) {
      const g = spallPatch(rng, rng.range(0.24, 0.7), rng.range(0.22, 0.6), 0.022);
      A.addOnce(
        'brick_fine',
        g,
        LL(IDENT, rng.range(x0 + 0.5, x1 - 0.5), rng.range(0.9, h - 0.7), zc + tt / 2 - 0.014)
      );
    }
    return { cx, w };
  };

  // ------------------------------------------------------- the four masses --
  // west gatehouse block: lowest, with an upper loggia of three dark openings
  block(xL0, xL1, hL, t, z);
  for (let i = 0; i < 3; i++) {
    gateAperture(A, rng, xL0 + 1.0 + i * ((xL1 - xL0 - 2.0) / 2), hL * 0.66, z, 0.9, 1.5, t);
  }
  gateAperture(A, rng, (xL0 + xL1) / 2, hL * 0.3, z, 1.1, 1.3, t);
  merlonRun(A, rng, xL0, xL1, z, t, hL);

  // east block: nearly two metres taller and half a metre proud, so the skyline
  // steps twice and the block has a sunlit west return of its own
  const zR = z + eastProud / 2;
  const tR = t + eastProud;
  block(xR0, xR1, hR, tR, zR, { key: 'plaster_blue' });
  gateAperture(A, rng, (xR0 + xR1) / 2, hR * 0.62, zR, 1.0, 1.6, tR);
  gateAperture(A, rng, (xR0 + xR1) / 2, hR * 0.34, zR, 0.85, 1.2, tR);
  merlonRun(A, rng, xR0, xR1, zR, tR, hR, { key: 'plaster_blue' });

  // The tower is the upper stage of the east gatehouse, not a second full-height
  // mass driven through E4. Sharing the east block footprint preserves the tall
  // terminator while leaving a clean seam before the building line at x=6.5.
  const zT = z + towerProud / 2;
  const tT = t + towerProud;
  const towerBase = hR - 0.12;
  const towerH = hT - towerBase;
  const towerCx = (xT0 + xT1) / 2;
  const towerW = xT1 - xT0;
  A.add(
    'plaster_cream',
    BOX(A),
    LL(IDENT, towerCx, towerBase + towerH / 2, zT, 0, towerW, towerH, tT),
    { masks: [0.45, 0.6, 0.35] }
  );
  for (const s of [-1, 1]) {
    A.add(
      'plaster_cream',
      BOX(A),
      LL(IDENT, towerCx + s * (towerW / 2 - 0.3), towerBase + towerH / 2, zT + tT / 2 + 0.15, 0, 0.6, towerH, 0.34),
      { masks: [0.6, 0.5, 0.25] }
    );
  }
  A.add(
    'concrete',
    BOX_SOFT(A),
    LL(IDENT, towerCx, hT - 0.22, zT + 0.2, 0, towerW + 0.5, 0.3, tT + 0.66),
    { masks: [0.8, 0.45, 0.2] }
  );
  gateAperture(A, rng, towerCx, towerBase + towerH * 0.52, zT, 1.45, 1.15, tT, { recess: 0.75 });
  merlonRun(A, rng, xT0, xT1, zT, tT, hT, { key: 'plaster_cream' });
  // a bent aerial on the tower: breaks the hard corner against the sky
  A.add('metal_rust', BOX(A), LL(IDENT, xT1 - 0.5, hT + 1.9, zT, 0, 0.06, 3.4, 0.06, 0.04, 0.07), {
    masks: [0.95, 0.5, 0],
  });
  A.put('sat_dish', xT0 + 0.9, hT + 0.3, zT + 0.4, 0.7, 1, [1, 1.3, 1]);

  // sandbag emplacements on the ramparts, and a crate of ammunition
  sandbagWall(A, rng, xL0 + 1.9, z - 0.15, 0.0, 2.4, 3, hL + 0.16);
  sandbagWall(A, rng, xR0 + 1.7, zR - 0.15, 0.0, 1.9, 3, hR + 0.16);
  sandbagWall(A, rng, (xT0 + xT1) / 2, zT - 0.25, 0.0, 2.2, 4, hT + 0.16);
  A.skirts = false;
  A.put('crate_c', xL1 - 1.2, hL + 0.16, z - 0.6, 0.4, 1, [1, 1.3, 1]);
  A.put('barrel_rust', xR0 + 0.6, hR + 0.16, zR - 0.5, 0.2, 1, [1, 1.4, 1]);
  A.skirts = true;

  // The spandrel over the arch, built as a wall panel with a pointed hole so
  // the arch has real depth and a reveal.
  const spanH = bodyH - height;
  A.add('plaster_sand', BOX(A), LL(IDENT, 0, height + spanH / 2, z, 0, span + 0.4, spanH, t), {
    masks: [0.45, 0.6, 0.35],
  });

  // Arch voussoirs: individual stones around a pointed profile.
  const seg = 15;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    const r = span / 2;
    const px = -Math.cos(a) * r;
    const py = height - r + Math.sin(a) * r * 1.18;
    if (py < height - r - 0.01) continue;
    const ang = a - Math.PI / 2;
    A.add(
      'concrete',
      BOX(A),
      LL(IDENT, px, py, z, 0, 0.62, 0.42, t + 0.14, 0, -ang),
      { masks: [0.7, 0.45, 0.25] }
    );
  }
  // spring-line blocks and the walls beside the opening
  for (const sx of [-1, 1]) {
    A.add('concrete', BOX(A), LL(IDENT, sx * (span / 2 + 0.1), height - span / 2 - 0.2, z, 0, 0.6, 0.4, t + 0.2), {
      masks: [0.7, 0.5, 0.3],
    });
  }

  /**
   * The rampart walkway over the arch. It projects 0.75 m toward the camera on
   * corbels, which puts a hard 0.75 m band of shadow across the spandrel and the
   * arch head — the value break that stops the middle of the terminator reading
   * as one flat tone — and its own top surface is in full sun.
   */
  const wz = z + t / 2 + 0.38;
  A.add('roof_screed', BOX(A), LL(IDENT, 0, bodyH + 0.11, wz, 0, span + 1.4, 0.22, 0.82), {
    masks: [0.55, 0.35, 0.15],
    support: 'rampart',
  });
  for (let i = 0; i < 6; i++) {
    const bx = -(span + 0.6) / 2 + (i / 5) * (span + 0.6);
    A.add('concrete', BOX(A), LL(IDENT, bx, bodyH - 0.24, wz - 0.06, 0, 0.2, 0.46, 0.66), {
      masks: [0.7, 0.6, 0.4],
    });
  }
  // a low, irregular parapet along the walkway's outer edge, sandbags behind it
  merlonRun(A, rng, -span / 2 - 0.6, span / 2 + 0.6, z + 0.76, t, bodyH + 0.22, {
    depth: 0.34,
    set: 0.02,
  });
  sandbagWall(A, rng, -0.9, z + 0.15, 0.0, 2.0, 3, bodyH + 0.34);

  // guard hut and checkpoint clutter under the arch
  A.put('block_big', 0.0, 0.0, z + 3.2, 0.1, 1, [1, 1.2, 1]);
  const checkpointBarriers = [
    [-3.6, z + 3.2, 0.1],
    [2.4, z + 2.2, 1.6],
    [-1.4, z - 2.4, 1.5],
    [2.0, z - 2.8, 0.2],
  ];
  for (const [bx, bz, br] of checkpointBarriers) {
    A.put('jersey', bx, 0, bz, br, 1, [1, rng.range(0.9, 1.3), 1]);
  }
  sandbagWall(A, rng, -1.9, z + 4.6, 0.1, 2.4, 4);
  sandbagWall(A, rng, 2.1, z - 4.4, 0.0, 2.0, 3, 0);
  for (let i = 0; i < 24; i++) {
    const px = rng.range(-outerW / 2, outerW / 2);
    const pz = z + rng.range(-5, 5);
    if (Math.abs(px) > span / 2 && Math.abs(pz - z) < t / 2 + 0.3) continue;
    if (checkpointBarriers.some(([bx, bz]) => Math.hypot(px - bx, pz - bz) < 1.2)) continue;
    A.put(
      rng.pick(['brick_a', 'brick_b', 'rock_b', 'litter', 'cinder', 'can', 'weeds', 'plank_b']),
      px,
      groundY(px, pz) + 0.02,
      pz,
      rng.float() * 6.28,
      rng.range(0.6, 1.2),
      [1, 1.4, 1]
    );
  }
  // spalled corners and a bullet-scarred face
  rubbleMound(A, rng, -span / 2 - 1.0, 0, z + 1.4, 1.2, 16, { key: 'concrete' });
  rubbleMound(A, rng, span / 2 + 1.4, 0, z - 1.6, 1.0, 12, { key: 'concrete' });
  // Bullet scarring, clustered. Kept off the tower, whose face stands 0.9 m
  // proud — a pock on the main plane there would float inside the masonry.
  if (A.has('pock')) {
    for (let b = 0; b < 12; b++) {
      const cx = rng.range(xL0 + 0.5, xR1 - 0.5);
      const cy = rng.range(0.6, 6.0);
      if (Math.abs(cx) < span / 2 && cy < height) continue;
      for (let j = 0; j < rng.int(3, 8); j++) {
        const px = cx + rng.gauss() * 0.4;
        const py = cy + rng.gauss() * 0.3;
        if (Math.abs(px) < span / 2 && py < height) continue;
        if (px < xL0 + 0.1 || px > xR1 - 0.1 || py < 0.2) continue;
        if (py > (px < xL1 ? hL : hR) - 0.4) continue;
        const s = rng.range(0.55, 1.4);
        A.putS('pock', px, py, z + t / 2 + 0.0015, 0, s, s, rng.range(0.5, 1.2), [1, rng.range(0.7, 1.3), 1]);
      }
    }
    // and a burst across the tower's own proud face
    for (let b = 0; b < 4; b++) {
      const cx = rng.range(xT0 + 0.4, xT1 - 0.4);
      const cy = rng.range(0.8, hT - 1.0);
      for (let j = 0; j < rng.int(3, 7); j++) {
        const px = cx + rng.gauss() * 0.35;
        const py = cy + rng.gauss() * 0.28;
        if (px < xT0 + 0.1 || px > xT1 - 0.1 || py < 0.3) continue;
        const s = rng.range(0.5, 1.3);
        A.putS('pock', px, py, z + t / 2 + towerProud + 0.0015, 0, s, s, rng.range(0.5, 1.1), [1, rng.range(0.7, 1.3), 1]);
      }
    }
  }
}

/**
 * The map edge: a continuous wall of compound walls, blocked side streets and
 * distant infill so the playable 120 m reads as part of a bigger town.
 */
export function buildPerimeter(A, rng) {
  const R = 58;
  const segs = [
    // [x0,z0,x1,z1] runs of compound wall
    [-R, -R, R, -R],
    [-R, R, R, R],
    [-R, -R, -R, R],
    [R, -R, R, R],
  ];
  for (const [x0, z0, x1, z1] of segs) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz) - Math.PI / 2;
    const n = Math.round(len / 4);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const h = rng.range(3.0, 3.8);
      A.add(
        rng.pick(['plaster_sand', 'plaster_cream', 'concrete']),
        BOX(A),
        LL(IDENT, px, h / 2, pz, ry, len / n + 0.05, h, 0.4),
        { masks: [0.5, 0.7, 0.4] }
      );
      A.add('concrete', BOX_SOFT(A), LL(IDENT, px, h + 0.06, pz, ry, len / n + 0.14, 0.12, 0.54), {
        masks: [0.8, 0.4, 0.15],
      });
    }
  }
  // Blocked cross-streets: rubble barricades and stacked barriers rather than
  // an invisible wall, so the boundary is diegetic.
  const blocks = [
    [0, STREET.zMax + 1.5],
    [0, STREET.zMin - 1.5],
  ];
  for (const [bx, bz] of blocks) {
    for (let i = -1; i <= 1; i++) {
      A.put('jersey', bx + i * 2.1, 0.02, bz, 0.02 + rng.range(-0.05, 0.05), 1, [1, 1.2, 1]);
    }
    rubbleMound(A, rng, bx - 3.4, 0, bz, 2.2, 30);
    rubbleMound(A, rng, bx + 3.6, 0, bz, 2.0, 26);
    for (let i = 0; i < 14; i++) {
      const px = bx + rng.range(-7, 7);
      const pz = bz + rng.range(-2, 2);
      if (Math.abs(px - bx) < 3.2 && Math.abs(pz - bz) < 1.1) continue;
      A.put(
        rng.pick(['brick_a', 'brick_b', 'cinder', 'rock_a', 'slab_shard', 'rebar']),
        px,
        groundY(px, pz) + 0.03,
        pz,
        rng.float() * 6.28,
        rng.range(0.7, 1.3),
        [1, 1.4, 1]
      );
    }
  }
}
