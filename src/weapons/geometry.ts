import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface ExtrudeOptions {
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
  steps?: number;
  holes?: number[][][];
}
/** Offline grenade geometry and viewmodel optic primitives, in metres. */
const KEEP_ATTRS = ['position', 'normal', 'uv'];

/** Strip everything merge cannot reconcile; keep P/N/UV only. */
function normalizeAttributes(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    if (!KEEP_ATTRS.includes(name)) geo.deleteAttribute(name);
  }
  if (!geo.getAttribute('uv')) {
    const n = geo.getAttribute('position').count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

/* ========================================================================== */
/*  primitives                                                                */
/* ========================================================================== */

/**
 * Chamfered box. `chamfer` is the bevel radius in metres; `seg` 1 gives a hard
 * 45-degree chamfer, 2-3 gives a rounded fillet.
 */
export function box(
  w: number,
  h: number,
  d: number,
  chamfer = 0.0012,
  seg = 1
): THREE.BufferGeometry {
  const r = Math.min(chamfer, Math.min(w, Math.min(h, d)) * 0.49);
  if (r <= 1e-5) return normalizeAttributes(new THREE.BoxGeometry(w, h, d));
  return normalizeAttributes(new RoundedBoxGeometry(w, h, d, seg, r));
}

/** A softly rounded block — grips, palm swells, butt pads. */
/**
 * Lathe around the Z axis. `profile` is a flat list of [axialZ, radius] pairs
 * from rear to front (or any order); radius 0 closes the form.
 */
export function latheZ(
  profile: readonly number[][],
  seg = 24,
  phiStart = 0,
  phiLength = Math.PI * 2
): THREE.BufferGeometry {
  const pts = [];
  for (let i = 0; i < profile.length; i++) {
    pts.push(new THREE.Vector2(Math.max(1e-5, profile[i][1]), profile[i][0]));
  }
  const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
  // Lathe spins around +Y; a +90 deg rotation about X maps (r, a) -> (r, 0, a),
  // so the axis becomes +Z and the axial coordinates survive untouched.
  g.rotateX(Math.PI / 2);
  return normalizeAttributes(g);
}

/** Solid cylinder along Z with chamfered rims. */
export function rodZ(
  r0: number,
  r1: number,
  len: number,
  seg = 20,
  chamfer = 0.0008
): THREE.BufferGeometry {
  const z0 = -len / 2;
  const z1 = len / 2;
  const c = Math.min(chamfer, len * 0.4, Math.min(r0, r1) * 0.5);
  return latheZ(
    [
      [z0, 0],
      [z0, r0 - c],
      [z0 + c, r0],
      [z1 - c, r1],
      [z1, r1 - c],
      [z1, 0],
    ],
    seg
  );
}

/**
 * Extrude a 2-D outline (in XY) along Z with a real bevel on both faces.
 * `pts` is a flat array of [x, y]; it is closed automatically.
 */
export function extrude(
  pts: readonly number[][],
  depth: number,
  opts: ExtrudeOptions = {}
): THREE.BufferGeometry {
  const bevel = opts.bevel ?? 0.0008;
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  if (opts.holes) {
    for (const hole of opts.holes) {
      const p = new THREE.Path();
      p.moveTo(hole[0][0], hole[0][1]);
      for (let i = 1; i < hole.length; i++) p.lineTo(hole[i][0], hole[i][1]);
      p.closePath();
      shape.holes.push(p);
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - bevel * 2),
    bevelEnabled: bevel > 1e-6,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: opts.bevelSegments ?? 1,
    curveSegments: opts.curveSegments ?? 6,
    steps: opts.steps ?? 1,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  // ExtrudeGeometry is non-indexed with correct flat normals; weld the exact
  // duplicates (keeping hard edges, since welding compares normals too) and
  // leave the normals alone.
  const merged = mergeVertices(normalizeAttributes(g), 1e-6);
  if (merged !== g) g.dispose();
  return normalizeAttributes(merged);
}

/** Torus in the XY plane (sling loops, trigger guard bows, QD rings). */
export function ring(
  radius: number,
  thickness: number,
  seg = 20,
  rings = 8,
  arc = Math.PI * 2
): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, thickness, rings, seg, arc);
  return normalizeAttributes(g);
}

/** Merge a list of geometries, tolerating mixed indexed/non-indexed input. */
export function mergeAll(
  list: readonly (THREE.BufferGeometry | null | undefined)[]
): THREE.BufferGeometry | null {
  const clean = list.filter((geo): geo is THREE.BufferGeometry => Boolean(geo));
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  const nonIndexed = clean.map(
    (g): THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap> =>
      g.getIndex() ? g.toNonIndexed() : g
  );
  for (const g of nonIndexed) normalizeAttributes(g);
  const merged = mergeGeometries(nonIndexed, false);
  for (let i = 0; i < clean.length; i++) {
    if (nonIndexed[i] !== clean[i]) nonIndexed[i].dispose();
    clean[i].dispose();
  }
  if (!merged) return null;
  const welded = mergeVertices(merged, 1e-6);
  if (welded !== merged) merged.dispose();
  return normalizeAttributes(welded);
}

/** Triangle count of a finished geometry, for the budget log. */
export function triCount(geo: THREE.BufferGeometry): number {
  const idx = geo.getIndex();
  return (idx ? idx.count : geo.getAttribute('position').count) / 3;
}

/** Re-exported so dev probes can reach the same THREE instance. */
export { THREE };
