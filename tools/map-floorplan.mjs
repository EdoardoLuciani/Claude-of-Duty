/**
 * Render a floor plan of the map as SVG, straight from the worldgen source.
 *
 * Reads the building/street/alley data in `tools/worldgen/layout.js`, the
 * authored prop transforms in `tools/worldgen/placements/`, and the committed
 * `public/models/world/level.json` metadata (for the exact traversable door
 * openings), and writes a paper-style plan to `docs/images/map-floorplan.svg`.
 *
 * The plan is drawn in LEVEL space (the authored coordinates), i.e. before the
 * WorldSystem applies LEVEL_YAW/LEVEL_TX/LEVEL_TZ. +Z (north street) is up.
 *
 * Usage: node tools/map-floorplan.mjs [outfile]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { STREET, ALLEYS, BUILDINGS, GATE, SET_PIECES } from './worldgen/layout.js';
import { SPAWNS } from './worldgen/config.js';
import { eastSide } from './worldgen/placements/east-side.js';
import { interiors } from './worldgen/placements/interiors.js';
import { market } from './worldgen/placements/market.js';
import { midStreet } from './worldgen/placements/mid-street.js';
import { northStreet } from './worldgen/placements/north-street.js';
import { southStreet } from './worldgen/placements/south-street.js';
import { westSide } from './worldgen/placements/west-side.js';

const PLACEMENTS = [
  ...eastSide, ...interiors, ...market, ...midStreet,
  ...northStreet, ...southStreet, ...westSide,
];

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = process.argv[2] ?? path.join(root, 'docs/images/map-floorplan.svg');

const META = JSON.parse(readFileSync(path.join(root, 'public/models/world/level.json'), 'utf8'));

// ------------------------------------------------------------------ layout --
const S = 13; // px per metre
const MARGIN = 26;
const LEGEND_W = 252;
const X_MIN = -47, X_MAX = 47;
const Z_MIN = -74, Z_MAX = 66;
const W = Math.round((X_MAX - X_MIN) * S) + MARGIN * 2 + LEGEND_W;
const H = Math.round((Z_MAX - Z_MIN) * S) + MARGIN * 2;

// level space -> SVG space (+Z up)
const X = (x) => MARGIN + (x - X_MIN) * S;
const Y = (z) => MARGIN + (Z_MAX - z) * S;

const parts = [];
const push = (s) => parts.push(s);
const esc = (t) => String(t).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Rounded rect in level space. */
function rectLS(x0, z0, x1, z1, attrs) {
  const x = X(Math.min(x0, x1)), y = Y(Math.max(z0, z1));
  const w = Math.abs(x1 - x0) * S, h = Math.abs(z1 - z0) * S;
  push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ${attrs}/>`);
}

/** Line in level space. */
function lineLS(x0, z0, x1, z1, attrs) {
  push(`<line x1="${X(x0).toFixed(1)}" y1="${Y(z0).toFixed(1)}" x2="${X(x1).toFixed(1)}" y2="${Y(z1).toFixed(1)}" ${attrs}/>`);
}

/** Half-extents (hx,hz) along local +X and (dx,dz) along local +Z, in metres.
 * SVG y is flipped, so a level vector (vx,vz) maps to (vx*S, -vz*S). */
function rotPoly(cx, cz, hx, hz, dx, dz, attrs) {
  const px = X(cx), py = Y(cz);
  const ux = hx * S, uy = -hz * S;
  const vx = dx * S, vy = -dz * S;
  const c = [
    [-ux - vx, -uy - vy],
    [ ux - vx,  uy - vy],
    [ ux + vx,  uy + vy],
    [-ux + vx, -uy + vy],
  ];
  const pts = c.map(([ax, ay]) => `${(px + ax).toFixed(1)},${(py + ay).toFixed(1)}`).join(' ');
  push(`<polygon points="${pts}" ${attrs}/>`);
}

/** Rotated rect (centre cx,cz, dims w along local +X, d along local +Z, ry rad).
 * Ry maps local +X to (cos ry, -sin ry) and local +Z to (sin ry, cos ry). */
function rotRect(cx, cz, w, d, ry, attrs) {
  rotPoly(
    cx, cz,
    Math.cos(ry) * w / 2, -Math.sin(ry) * w / 2,
    Math.sin(ry) * d / 2, Math.cos(ry) * d / 2,
    attrs,
  );
}

const DEG = Math.PI / 180;
/** Three.js default Euler order XYZ, matching placements/index.js. */
function eulerXYZ(rx, ry, rz, x, y, z) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x2 = x * cy + z1 * sy;
  const z2 = -x * sy + z1 * cy;
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
}

function placeRect(p, w, d, attrs) {
  const rx = p.rotationDeg[0] * DEG;
  const ry = p.rotationDeg[1] * DEG;
  const rz = p.rotationDeg[2] * DEG;
  const xAxis = eulerXYZ(rx, ry, rz, 1, 0, 0);
  const zAxis = eulerXYZ(rx, ry, rz, 0, 0, 1);
  rotPoly(
    p.position[0], p.position[2],
    xAxis[0] * w / 2, xAxis[2] * w / 2,
    zAxis[0] * d / 2, zAxis[2] * d / 2,
    attrs,
  );
}

/** Centre of a building footprint after any ground-floor setback. */
function floorSpec(spec, f) {
  const sb = spec.setback;
  if (!sb || f < sb.from) return spec;
  const d = sb.depth;
  const side = sb.side ?? spec.streetSide ?? 0;
  const o = { ...spec };
  if (side === 1) { o.x = spec.x - d / 2; o.w = spec.w - d; }
  else if (side === 3) { o.x = spec.x + d / 2; o.w = spec.w - d; }
  else if (side === 0) { o.z = spec.z + d / 2; o.d = spec.d - d; }
  else { o.z = spec.z - d / 2; o.d = spec.d - d; }
  return o;
}

// ------------------------------------------------------------------- defs ---
push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans,Verdana,sans-serif">`);
push(`
<defs>
  <pattern id="ruin" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="7" stroke="#a49a86" stroke-width="1.4"/>
  </pattern>
  <pattern id="gravel" width="6" height="6" patternUnits="userSpaceOnUse">
    <circle cx="1.5" cy="1.5" r="0.8" fill="#b9ad93"/><circle cx="4.5" cy="4" r="0.7" fill="#b9ad93"/>
  </pattern>
</defs>`);

// background
push(`<rect width="${W}" height="${H}" fill="#efe9dc"/>`);

// ----------------------------------------------------------------- ground ---
// alleys / open ground
for (const a of ALLEYS) {
  const fill = a.surface === 'gravel' ? 'url(#gravel)' : '#e3d8bd';
  rectLS(a.rect[0], a.rect[1], a.rect[2], a.rect[3], `fill="${fill}" stroke="#cfc2a2" stroke-width="0.8"`);
}

// main street asphalt + kerbs
rectLS(-STREET.kerb, STREET.zMin, STREET.kerb, STREET.zMax, 'fill="#94907f" stroke="none"');
lineLS(-STREET.kerb, STREET.zMin, -STREET.kerb, STREET.zMax, 'stroke="#6f6b5d" stroke-width="2.5"');
lineLS(STREET.kerb, STREET.zMin, STREET.kerb, STREET.zMax, 'stroke="#6f6b5d" stroke-width="2.5"');
// centre line
lineLS(0, STREET.zMin, 0, STREET.zMax, 'stroke="#c9c4b2" stroke-width="1.2" stroke-dasharray="8 7"');

// ------------------------------------------------------------------- gate ---
{
  const gz0 = GATE.z - GATE.depth / 2, gz1 = GATE.z + GATE.depth / 2;
  // eastProud / towerProud extend the mass toward +Z (see dressing.buildGate).
  rectLS(GATE.xL0, gz0, GATE.xL1, gz1, 'fill="#5c574c" stroke="#39352c" stroke-width="1.5"');
  rectLS(GATE.xR0, gz0, GATE.xR1, gz1 + GATE.eastProud, 'fill="#5c574c" stroke="#39352c" stroke-width="1.5"');
  rectLS(GATE.xT0, gz0, GATE.xT1, gz1 + GATE.towerProud, 'fill="#6b6558" stroke="#39352c" stroke-width="1.5"');
  push(`<text x="${X((GATE.xL0 + GATE.xR1) / 2)}" y="${Y(GATE.z) + 4}" font-size="10" fill="#efe9dc" text-anchor="middle" font-weight="bold">GATE</text>`);
}

// -------------------------------------------------------------- buildings ---
const T = 0.34; // exterior wall thickness (matches buildings.js)
for (const spec of BUILDINGS) {
  const id = spec.id;
  const enterable = !!spec.enterable;
  const ruin = !!spec.ruin;
  const plan = spec.rooms?.[0];
  const fill = enterable ? '#f8f4e9' : '#ccc5b2';
  const stroke = enterable ? '#3a3630' : '#8d8672';
  rectLS(spec.x - spec.w / 2, spec.z - spec.d / 2, spec.x + spec.w / 2, spec.z + spec.d / 2,
    `fill="${fill}" stroke="${stroke}" stroke-width="${enterable ? 2.2 : 1.6}"`);
  if (ruin) {
    rectLS(spec.x - spec.w / 2, spec.z - spec.d / 2, spec.x + spec.w / 2, spec.z + spec.d / 2,
      `fill="url(#ruin)" stroke="none"`);
  }

  // interior partitions (ground floor) with door gaps
  if (enterable) {
    const fs = floorSpec(spec, 0);
    const iw = fs.w - T * 2, id_ = fs.d - T * 2;
    const x0 = fs.x - iw / 2, z0 = fs.z - id_ / 2;
    for (const wall of plan?.walls ?? []) {
      const [ax, az, bx, bz, doorAt] = wall;
      const wx0 = x0 + ax * iw, wz0 = z0 + az * id_;
      const wx1 = x0 + bx * iw, wz1 = z0 + bz * id_;
      const len = Math.hypot(wx1 - wx0, wz1 - wz0);
      if (doorAt === undefined || doorAt === null || len < 0.1) {
        lineLS(wx0, wz0, wx1, wz1, 'stroke="#6b6255" stroke-width="1.6"');
      } else {
        const t0 = Math.max(0, doorAt - 0.55 / len), t1 = Math.min(1, doorAt + 0.55 / len);
        lineLS(wx0, wz0, wx0 + (wx1 - wx0) * t0, wz0 + (wz1 - wz0) * t0, 'stroke="#6b6255" stroke-width="1.6"');
        lineLS(wx0 + (wx1 - wx0) * t1, wz0 + (wz1 - wz0) * t1, wx1, wz1, 'stroke="#6b6255" stroke-width="1.6"');
      }
    }
    // furnish labels
    for (const f of plan?.furnish ?? []) {
      const cx = x0 + ((f.x0 + f.x1) / 2) * iw, cz = z0 + ((f.z0 + f.z1) / 2) * id_;
      push(`<text x="${X(cx).toFixed(1)}" y="${Y(cz).toFixed(1)}" font-size="9.5" fill="#8a7f6c" text-anchor="middle" font-style="italic">${esc(f.kind)}</text>`);
    }

    // stair voids (upper floor slabs) — dashed outline
    for (const hole of Object.values(spec.stairHoles ?? {})) {
      rectLS(hole.x0, hole.z0, hole.x1, hole.z1, 'fill="none" stroke="#6b6255" stroke-width="1.1" stroke-dasharray="4 3"');
      push(`<text x="${X((hole.x0 + hole.x1) / 2)}" y="${Y((hole.z0 + hole.z1) / 2) - 2}" font-size="8" fill="#6b6255" text-anchor="middle">void</text>`);
    }
    // stair flights (ground floor), anchor + run direction
    for (const fl of spec.stairFlights ?? []) {
      if (fl.floor !== 0) continue;
      const sw = fl.w ?? 1.2;
      const run = 0.275, climb = 3.05;
      const steps = Math.max(6, Math.round(climb / 0.19));
      const D = steps * run;
      const cx = x0 + fl.x * iw, cz = z0 + fl.z * id_;
      const ry = fl.ry ?? 0;
      const dx = Math.sin(ry), dz = Math.cos(ry);
      rotRect(cx + dx * D / 2, cz + dz * D / 2, sw, D, ry,
        'fill="#efe7d2" stroke="#6b6255" stroke-width="1.1"');
      // arrow up the flight
      const ax2 = cx + dx * (D - 0.5), az2 = cz + dz * (D - 0.5);
      const ax1 = cx + dx * 0.6, az1 = cz + dz * 0.6;
      push(`<defs><marker id="ah${spec.id}" markerWidth="7" markerHeight="7" refX="3" refY="3.5" orient="auto"><path d="M0,0 L6,3.5 L0,7 z" fill="#6b6255"/></marker></defs>`);
      lineLS(ax1, az1, ax2, az2, `stroke="#6b6255" stroke-width="1.4" marker-end="url(#ah${spec.id})"`);
      push(`<text x="${X(cx)}" y="${Y(cz) + 20}" font-size="8" fill="#6b6255" text-anchor="middle">stairs</text>`);
    }
  }

  // label
  const lcx = spec.x, lcz = spec.z;
  push(`<text x="${X(lcx)}" y="${Y(lcz) + (enterable && plan ? 26 : 4)}" font-size="13" font-weight="bold" fill="#2b2823" text-anchor="middle">${esc(id)}</text>`);
  push(`<text x="${X(lcx)}" y="${Y(lcz) + (enterable && plan ? 38 : 16)}" font-size="9.5" fill="#7d7462" text-anchor="middle">${spec.floors}F${ruin ? ' · ruin' : ''}${spec.collapse ? ' · collapsed' : ''}</text>`);
}

// ------------------------------------------------- doors (from level.json) ---
for (const b of META.buildings) {
  const id = b.spec.id;
  if (!id || !b.spec.enterable) continue;
  const bx = b.spec.x, bz = b.spec.z; // building centre: doors swing away from it
  for (const t of b.traversable) {
    const mx = (t.from[0] + t.to[0]) / 2, mz = (t.from[2] + t.to[2]) / 2;
    const ddx = t.to[0] - t.from[0], ddz = t.to[2] - t.from[2];
    const len = Math.hypot(ddx, ddz) || 1;
    const ux = ddx / len, uz = ddz / len; // through-wall direction
    const wx = -uz, wz = ux;              // facade direction
    const shop = t.kind === 'shop';
    const dw = t.w ?? 1.8;                // leaf width
    // opening gap drawn IN the wall line
    lineLS(mx - wx * dw / 2, mz - wz * dw / 2, mx + wx * dw / 2, mz + wz * dw / 2,
      `stroke="${shop ? '#1f7a8c' : '#1f7a4d'}" stroke-width="${shop ? 6 : 5}" stroke-linecap="round"`);
    if (shop) continue;
    // quarter-circle swing: leaf hinged at one jamb, opening away from indoors
    const inSign = (bx - mx) * ux + (bz - mz) * uz >= 0 ? 1 : -1;
    const hx = mx + wx * dw / 2, hz = mz + wz * dw / 2;            // hinge jamb
    const tx = hx + ux * inSign * dw, tz = hz + uz * inSign * dw;  // open leaf tip
    const jx = hx - wx * dw, jz = hz - wz * dw;                    // far jamb
    lineLS(hx, hz, tx, tz, 'stroke="#1f7a4d" stroke-width="1.2"');
    // sweep flag from the screen-space cross product (y is flipped)
    const ax1 = X(tx), ay1 = Y(tz), ax2 = X(jx), ay2 = Y(jz);
    const acx = X(hx), acy = Y(hz);
    const cross = (ax1 - acx) * (ay2 - acy) - (ay1 - acy) * (ax2 - acx);
    push(`<path d="M ${ax1.toFixed(1)} ${ay1.toFixed(1)} A ${(dw * S).toFixed(1)} ${(dw * S).toFixed(1)} 0 0 ${cross > 0 ? 1 : 0} ${ax2.toFixed(1)} ${ay2.toFixed(1)}" fill="none" stroke="#1f7a4d" stroke-width="1" opacity="0.75"/>`);
  }
}

// ------------------------------------------ set pieces (authored placements)
// Prototype sizes match tools/worldgen/props.js (stall / jerseyBarrier / burntCar).
const STALL_W = 2.3, STALL_D = 1.05;
const JERSEY_W = 0.6, JERSEY_D = 1.9;
const WRECK_W = 1.78, WRECK_D = 4.35;
for (const p of PLACEMENTS) {
  const [x, y, z] = p.position;
  const sx = p.scale[0], sz = p.scale[2];
  if (p.prototype === 'stall') {
    placeRect(p, STALL_W * sx, STALL_D * sz, 'fill="#d9862f" stroke="#9c5c14" stroke-width="0.9"');
  } else if (p.prototype === 'jersey') {
    placeRect(p, JERSEY_W * sx, JERSEY_D * sz, 'fill="#c2c2ba" stroke="#7e7e76" stroke-width="0.9"');
  } else if (p.prototype === 'wreck') {
    placeRect(p, WRECK_W * sx, WRECK_D * sz, 'fill="#8a3b2e" stroke="#5c231a" stroke-width="1"');
  } else if (p.prototype === 'palm_trunk') {
    push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="${(0.8 * sx * S).toFixed(1)}" fill="#4c8a4c" stroke="#2f5c2f" stroke-width="0.9" opacity="0.9"/>`);
  } else if (p.prototype === 'lamp_post') {
    push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="2.4" fill="#3c3a34"/>`);
  } else if ((p.prototype === 'tyre' || p.prototype === 'tyre_small') && y < 2.3) {
    const r = (p.prototype === 'tyre' ? 0.33 : 0.26) * sx;
    push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="${(r * S).toFixed(1)}" fill="none" stroke="#3c3a34" stroke-width="1.1"/>`);
  }
}
for (const [x, z, ry, len] of SET_PIECES.sandbagWalls) {
  rotRect(x, z, len, 0.8, ry, 'fill="#8a8749" stroke="#5f5c2e" stroke-width="0.9"');
}
for (const [x, z, r] of SET_PIECES.rubble) {
  push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="${(r * S).toFixed(1)}" fill="none" stroke="#9a9078" stroke-width="1" stroke-dasharray="3 3"/>`);
}

// ------------------------------------------------------------------ spawns --
for (const [x, z, , tag] of SPAWNS) {
  push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="4.5" fill="#2456a8" stroke="#fff" stroke-width="1.4"/>`);
  push(`<text x="${(X(x) + 7).toFixed(1)}" y="${(Y(z) + 3.5).toFixed(1)}" font-size="10" font-weight="bold" fill="#2456a8">${esc(tag)}</text>`);
}

// --------------------------------------------------------------- street tag -
push(`<text x="${X(0)}" y="${Y(4)}" font-size="15" fill="#5d594d" text-anchor="middle" letter-spacing="6" transform="rotate(-90 ${X(0)} ${Y(4)})">MAIN STREET</text>`);

// ----------------------------------------------------------------- legend ---
{
  const lx = W - LEGEND_W - 6, ly = MARGIN;
  push(`<rect x="${lx}" y="${ly - 14}" width="${LEGEND_W}" height="${H - MARGIN * 2 + 20}" rx="8" fill="#f6f1e4" stroke="#cfc4a8" stroke-width="1.2"/>`);
  const tx = lx + 16;
  let y = ly + 18;
  const item = (swatch, label, dy = 19) => {
    push(swatch(tx, y - 6));
    push(`<text x="${tx + 26}" y="${y}" font-size="11.5" fill="#2b2823">${esc(label)}</text>`);
    y += dy;
  };
  push(`<text x="${tx}" y="${y}" font-size="15" font-weight="bold" fill="#2b2823">Claude of Duty — map plan</text>`); y += 16;
  push(`<text x="${tx}" y="${y}" font-size="10.5" fill="#7d7462">level space · +Z (north) is up</text>`); y += 13;
  push(`<text x="${tx}" y="${y}" font-size="10.5" fill="#7d7462">gate vista at the bottom</text>`); y += 17;
  const bx = (tx, ty) => `<rect x="${tx}" y="${ty}" width="18" height="12"`;
  item((x, y) => `${bx(x, y)} fill="#f8f4e9" stroke="#3a3630" stroke-width="2"/>`, 'enterable building');
  item((x, y) => `${bx(x, y)} fill="#ccc5b2" stroke="#8d8672" stroke-width="1.6"/>`, 'background block');
  item((x, y) => `${bx(x, y)} fill="url(#ruin)" stroke="#8d8672"/>`, 'ruin / collapsed');
  item((x, y) => `<line x1="${x}" y1="${y + 6}" x2="${x + 4}" y2="${y + 6}" stroke="#3a3630" stroke-width="2"/><rect x="${x + 4}" y="${y + 3.5}" width="13" height="5" fill="#1f7a4d"/><line x1="${x + 4}" y1="${y + 6}" x2="${x + 4}" y2="${y + 19}" stroke="#1f7a4d" stroke-width="1.2"/><path d="M ${x + 4} ${y + 19} A 13 13 0 0 0 ${x + 17} ${y + 6}" fill="none" stroke="#1f7a4d" stroke-width="1"/>`, 'door + swing');
  item((x, y) => `<line x1="${x}" y1="${y + 6}" x2="${x + 18}" y2="${y + 6}" stroke="#1f7a8c" stroke-width="5" stroke-linecap="round"/>`, 'open shopfront');
  item((x, y) => `<line x1="${x}" y1="${y + 6}" x2="${x + 18}" y2="${y + 6}" stroke="#6b6255" stroke-width="1.6"/>`, 'interior partition / stairs');
  item((x, y) => `${bx(x, y)} fill="#d9862f" stroke="#9c5c14"/>`, 'market stall');
  item((x, y) => `${bx(x, y)} fill="#c2c2ba" stroke="#7e7e76"/>`, 'jersey barrier');
  item((x, y) => `${bx(x, y)} fill="#8a8749" stroke="#5f5c2e"/>`, 'sandbags');
  item((x, y) => `<rect x="${x}" y="${y + 1}" width="18" height="10" fill="#8a3b2e" stroke="#5c231a" rx="4"/>`, 'wrecked vehicle');
  item((x, y) => `<circle cx="${x + 9}" cy="${y + 6}" r="6" fill="#4c8a4c" stroke="#2f5c2f"/>`, 'palm');
  item((x, y) => `<circle cx="${x + 9}" cy="${y + 6}" r="6" fill="none" stroke="#9a9078" stroke-width="1" stroke-dasharray="3 3"/>`, 'rubble pile');
  item((x, y) => `<circle cx="${x + 4}" cy="${y + 6}" r="2.6" fill="none" stroke="#3c3a34" stroke-width="1.1"/><circle cx="${x + 9}" cy="${y + 6}" r="2.6" fill="none" stroke="#3c3a34" stroke-width="1.1"/><circle cx="${x + 14}" cy="${y + 6}" r="2.6" fill="none" stroke="#3c3a34" stroke-width="1.1"/>`, 'tyre');
  item((x, y) => `<circle cx="${x + 9}" cy="${y + 6}" r="3" fill="#3c3a34"/>`, 'street lamp');
  item((x, y) => `<circle cx="${x + 9}" cy="${y + 6}" r="4.5" fill="#2456a8" stroke="#fff" stroke-width="1.4"/>`, 'spawn point');
  y += 8;
  // scale bar: 10 m
  const barW = 10 * S;
  push(`<rect x="${tx}" y="${y}" width="${barW}" height="6" fill="#2b2823"/>`);
  push(`<rect x="${tx + barW}" y="${y}" width="${barW / 2}" height="6" fill="#2b2823" stroke="#2b2823" stroke-width="1"/>`);
  push(`<text x="${tx}" y="${y + 20}" font-size="10.5" fill="#2b2823">0</text>`);
  push(`<text x="${tx + barW}" y="${y + 20}" font-size="10.5" fill="#2b2823" text-anchor="middle">10 m</text>`);
  push(`<text x="${tx + barW + barW / 2}" y="${y + 20}" font-size="10.5" fill="#2b2823" text-anchor="middle">15 m</text>`);
  y += 40;
  push(`<text x="${tx}" y="${y}" font-size="9.5" fill="#7d7462">generated by tools/map-floorplan.mjs</text>`);
  push(`<text x="${tx}" y="${y + 14}" font-size="9.5" fill="#7d7462">from layout.js + placements + level.json</text>`);
}

// frame + compass
push(`<rect x="${MARGIN - 4}" y="${MARGIN - 4}" width="${W - LEGEND_W - MARGIN * 2 + 4}" height="${H - MARGIN * 2 + 4}" fill="none" stroke="#b3a88c" stroke-width="1.5"/>`);
const cx0 = MARGIN + 22, cy0 = MARGIN + 22;
push(`<path d="M ${cx0} ${cy0 - 14} L ${cx0 + 6} ${cy0 + 8} L ${cx0} ${cy0 + 3} L ${cx0 - 6} ${cy0 + 8} Z" fill="#2b2823"/>`);
push(`<text x="${cx0}" y="${cy0 - 18}" font-size="11" font-weight="bold" fill="#2b2823" text-anchor="middle">+Z</text>`);

push('</svg>');
writeFileSync(outFile, parts.join('\n') + '\n');
console.log(`wrote ${outFile} (${W}x${H})`);
