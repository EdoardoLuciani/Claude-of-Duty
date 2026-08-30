/**
 * Render a floor plan of the map as SVG, straight from the worldgen source.
 *
 * Reads the building/street/alley/set-piece data in `tools/worldgen/layout.js`
 * and the committed `public/models/world/level.json` metadata (for the exact
 * traversable door openings), and writes a paper-style plan to
 * `docs/images/map-floorplan.svg`.
 *
 * The plan is drawn in LEVEL space (the authored coordinates), i.e. before the
 * WorldSystem applies LEVEL_YAW/LEVEL_TX/LEVEL_TZ. -Z (the gate vista) is up.
 *
 * Usage: node tools/map-floorplan.mjs [outfile]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { STREET, ALLEYS, BUILDINGS, GATE, SET_PIECES } from './worldgen/layout.js';
import { SPAWNS } from './worldgen/config.js';

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

// level space -> SVG space (-Z up)
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

/** Rotated rect (centre cx,cz, dims w along dirX, d along dirZ, ry rad). */
function rotRect(cx, cz, w, d, ry, attrs) {
  const px = X(cx), py = Y(cz);
  const sx = Math.cos(ry) * w * S / 2, sz = Math.sin(ry) * w * S / 2;
  const dx = Math.cos(ry) * d * S / 2, dz = -Math.sin(ry) * d * S / 2; // SVG y = -z
  const c = [[-sx, -sz], [sx, sz], [sx + dx, sz + dz], [-sx + dx, -sz + dz]];
  const pts = c.map(([ax, az]) => `${(px + ax).toFixed(1)},${(py + az).toFixed(1)}`).join(' ');
  push(`<polygon points="${pts}" ${attrs}/>`);
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
  rectLS(GATE.xL0 - 2.8, gz0, GATE.xL1, gz1, 'fill="#5c574c" stroke="#39352c" stroke-width="1.5"');
  rectLS(GATE.xR0, gz0, GATE.xR1 + 1.6, gz1, 'fill="#5c574c" stroke="#39352c" stroke-width="1.5"');
  rectLS(GATE.xT0 + 1.0, gz0 - GATE.towerProud, GATE.xT1 + 1.6, gz1, 'fill="#6b6558" stroke="#39352c" stroke-width="1.5"');
  push(`<text x="${X((GATE.xL0 - 2.8 + GATE.xT1 + 1.6) / 2)}" y="${Y(GATE.z) + 4}" font-size="10" fill="#efe9dc" text-anchor="middle" font-weight="bold">GATE</text>`);
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
      push(`<text x="${X(cx + dx * D / 2)}" y="${Y(cz + dz * D / 2) - 3}" font-size="8" fill="#6b6255" text-anchor="middle">stairs</text>`);
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
  for (const t of b.traversable) {
    const mx = (t.from[0] + t.to[0]) / 2, mz = (t.from[2] + t.to[2]) / 2;
    const dx = t.to[0] - t.from[0], dz = t.to[2] - t.from[2];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const shop = t.kind === 'shop';
    const half = (shop ? 2.0 : 1.1);
    lineLS(mx - ux * half, mz - uz * half, mx + ux * half, mz + uz * half,
      `stroke="${shop ? '#1f7a8c' : '#1f7a4d'}" stroke-width="${shop ? 5 : 4.5}" stroke-linecap="round"`);
    if (!shop) {
      // door swing arc, hinged at one jamb
      const hx = mx - ux * half, hz = mz - uz * half;
      const r = half * 2 * 0.9;
      const nx = -uz, nz = ux; // left normal
      const px2 = X(hx + nx * r), py2 = Y(hz + nz * r);
      const px3 = X(hx + ux * r), py3 = Y(hz + uz * r);
      // n is always u rotated -90° in screen space, so n -> u is one clockwise
      // quarter turn: sweep flag 1
      push(`<path d="M ${px2.toFixed(1)} ${py2.toFixed(1)} A ${(r * S).toFixed(1)} ${(r * S).toFixed(1)} 0 0 1 ${px3.toFixed(1)} ${py3.toFixed(1)}" fill="none" stroke="#1f7a4d" stroke-width="1" opacity="0.75"/>`);
      lineLS(hx, hz, hx + nx * r, hz + nz * r, 'stroke="#1f7a4d" stroke-width="1" opacity="0.75"');
    }
  }
}

// -------------------------------------------------------------- set pieces --
for (const [x, z, ry, w] of SET_PIECES.stalls) {
  rotRect(x, z, w, 1.1, ry, 'fill="#d9862f" stroke="#9c5c14" stroke-width="0.9"');
}
for (const [x, z, ry] of SET_PIECES.jerseys) {
  rotRect(x, z, 2.6, 0.7, ry, 'fill="#c2c2ba" stroke="#7e7e76" stroke-width="0.9"');
}
for (const [x, z, ry, len] of SET_PIECES.sandbagWalls) {
  rotRect(x, z, len, 0.8, ry, 'fill="#8a8749" stroke="#5f5c2e" stroke-width="0.9"');
}
for (const [x, z, ry] of SET_PIECES.wrecks) {
  rotRect(x, z, 4.4, 1.9, ry, 'fill="#8a3b2e" stroke="#5c231a" stroke-width="1" rx="6"');
}
for (const [x, z, sc] of SET_PIECES.palms) {
  push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="${(1.6 * (sc ?? 1) * S / 2).toFixed(1)}" fill="#4c8a4c" stroke="#2f5c2f" stroke-width="0.9" opacity="0.9"/>`);
}
for (const [x, z] of SET_PIECES.lamps) {
  push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="2.4" fill="#3c3a34"/>`);
}
for (const [x, z, r] of SET_PIECES.rubble) {
  push(`<circle cx="${X(x).toFixed(1)}" cy="${Y(z).toFixed(1)}" r="${(r * S).toFixed(1)}" fill="none" stroke="#9a9078" stroke-width="1" stroke-dasharray="3 3"/>`);
}
for (const [x, z, n] of SET_PIECES.tyres) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    push(`<circle cx="${X(x + Math.cos(a) * 0.5).toFixed(1)}" cy="${Y(z + Math.sin(a) * 0.5).toFixed(1)}" r="2.1" fill="none" stroke="#3c3a34" stroke-width="1.1"/>`);
  }
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
  push(`<text x="${tx}" y="${y}" font-size="16" font-weight="bold" fill="#2b2823">Claude of Duty — map plan</text>`); y += 16;
  push(`<text x="${tx}" y="${y}" font-size="10.5" fill="#7d7462">level space · -Z (gate) is up</text>`); y += 20;
  const bx = (tx, ty) => `<rect x="${tx}" y="${ty}" width="18" height="12"`;
  item((x, y) => `${bx(x, y)} fill="#f8f4e9" stroke="#3a3630" stroke-width="2"/>`, 'enterable building');
  item((x, y) => `${bx(x, y)} fill="#ccc5b2" stroke="#8d8672" stroke-width="1.6"/>`, 'background block');
  item((x, y) => `${bx(x, y)} fill="url(#ruin)" stroke="#8d8672"/>`, 'ruin / collapsed');
  item((x, y) => `<line x1="${x}" y1="${y + 6}" x2="${x + 18}" y2="${y + 6}" stroke="#1f7a4d" stroke-width="4.5" stroke-linecap="round"/><path d="M ${x + 18} ${y + 6} A 11 11 0 0 1 ${x + 29} ${y + 17}" fill="none" stroke="#1f7a4d" stroke-width="1"/>`, 'door + swing');
  item((x, y) => `<line x1="${x}" y1="${y + 6}" x2="${x + 18}" y2="${y + 6}" stroke="#1f7a8c" stroke-width="5" stroke-linecap="round"/>`, 'open shopfront');
  item((x, y) => `<line x1="${x}" y1="${y + 6}" x2="${x + 18}" y2="${y + 6}" stroke="#6b6255" stroke-width="1.6"/>`, 'interior partition / stairs');
  item((x, y) => `${bx(x, y)} fill="#d9862f" stroke="#9c5c14"/>`, 'market stall');
  item((x, y) => `${bx(x, y)} fill="#c2c2ba" stroke="#7e7e76"/>`, 'jersey barrier');
  item((x, y) => `${bx(x, y)} fill="#8a8749" stroke="#5f5c2e"/>`, 'sandbags');
  item((x, y) => `<rect x="${x}" y="${y + 1}" width="18" height="10" fill="#8a3b2e" stroke="#5c231a" rx="4"/>`, 'wrecked vehicle');
  item((x, y) => `<circle cx="${x + 9}" cy="${y + 6}" r="6" fill="#4c8a4c" stroke="#2f5c2f"/>`, 'palm');
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
  push(`<text x="${tx}" y="${y + 14}" font-size="9.5" fill="#7d7462">from tools/worldgen/layout.js + level.json</text>`);
}

// frame + compass
push(`<rect x="${MARGIN - 4}" y="${MARGIN - 4}" width="${W - LEGEND_W - MARGIN * 2 + 4}" height="${H - MARGIN * 2 + 4}" fill="none" stroke="#b3a88c" stroke-width="1.5"/>`);
const cx0 = MARGIN + 22, cy0 = MARGIN + 22;
push(`<path d="M ${cx0} ${cy0 - 14} L ${cx0 + 6} ${cy0 + 8} L ${cx0} ${cy0 + 3} L ${cx0 - 6} ${cy0 + 8} Z" fill="#2b2823"/>`);
push(`<text x="${cx0}" y="${cy0 - 18}" font-size="11" font-weight="bold" fill="#2b2823" text-anchor="middle">-Z</text>`);

push('</svg>');
writeFileSync(outFile, parts.join('\n') + '\n');
console.log(`wrote ${outFile} (${W}x${H})`);
