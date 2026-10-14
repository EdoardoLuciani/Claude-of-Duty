import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Vec2 = [number, number];
type Vec3 = [number, number, number];
interface ExtrudeOptions {
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
  steps?: number;
  holes?: number[][][];
}
interface Transform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

/**
 * Procedural hard-surface geometry kit for the weapons.
 *
 * Ground rules that come out of the quality bar:
 *
 *  - There is no such thing as a 90-degree edge on a real firearm. Every box
 *    here is a RoundedBoxGeometry with a 0.3-1.5 mm chamfer, every extrusion is
 *    bevelled, every tube end gets a crowned lathe profile. That single fact is
 *    what separates "modelled" from "blocked out": chamfers catch a specular
 *    line and give the silhouette its read.
 *  - Parts are authored in metres at real scale, in weapon-local space:
 *    +X right, +Y up, -Z toward the muzzle (the camera convention), origin at
 *    the shooting hand's anchor point (web of the thumb, top-rear of the grip).
 *  - Everything funnels through `Assembly`, which transforms each piece into
 *    weapon space, buckets it by material and merges the buckets. A whole rifle
 *    lands in 6-8 draw calls.
 */

/** Axial primitives are authored along +Z, which is *rearward*, then mirrored. */
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

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
export function blob(
  w: number,
  h: number,
  d: number,
  radius = 0.006,
  seg = 3
): THREE.BufferGeometry {
  return box(w, h, d, radius, seg);
}

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

function flipWinding(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = geo.getIndex();
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i];
      a[i] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const n = geo.getAttribute('normal');
  if (n) {
    const a = n.array;
    for (let i = 0; i < a.length; i++) a[i] = -a[i];
    n.needsUpdate = true;
  }
  return geo;
}

/**
 * Tube along Z with a real wall: outer surface, inner bore, and crowned ends.
 * Used for barrels, optic tubes, suppressors, buffer tubes.
 */
export function tubeZ(
  rOuter: number,
  rInner: number,
  len: number,
  seg = 24,
  crown = 0.0006
): THREE.BufferGeometry {
  const z0 = -len / 2;
  const z1 = len / 2;
  const c = Math.min(crown, (rOuter - rInner) * 0.4);
  return latheZ(
    [
      [z0 + c, rInner],
      [z0, rInner + c],
      [z0, rOuter - c],
      [z0 + c, rOuter],
      [z1 - c, rOuter],
      [z1, rOuter - c],
      [z1, rInner + c],
      [z1 - c, rInner],
    ],
    seg
  );
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

/** Sphere-ish detail blob (buttons, bosses, knuckle pads). */
export function dome(r: number, seg = 16, cut = 0.6): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(
    r,
    seg,
    Math.max(4, Math.round(seg * 0.5)),
    0,
    Math.PI * 2,
    0,
    Math.PI * cut
  );
  g.rotateX(Math.PI / 2);
  return normalizeAttributes(g);
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

/** A rounded rectangle outline, for extruded plates that need soft corners. */
export function roundRect(w: number, h: number, r: number, seg = 3): Vec2[] {
  const pts: Vec2[] = [];
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const corners = [
    [hw, hh, 0],
    [-hw, hh, Math.PI / 2],
    [-hw, -hh, Math.PI],
    [hw, -hh, -Math.PI / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
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

/**
 * Hex-socket cap screw, axis +Z, head at z=0 facing -Z.
 * The socket is a genuine counterbore (annular head + a plug at the bottom) so
 * it reads as a hole instead of a painted dot.
 */
export function screw(
  rHead: number,
  rShank: number,
  headH: number,
  shankL: number,
  seg = 12
): THREE.BufferGeometry {
  const rSocket = rHead * 0.52;
  const g = [];
  g.push(
    latheZ(
      [
        [0, rSocket],
        [0, rHead - 0.0002],
        [0.0002, rHead],
        [headH, rHead],
        [headH, rShank],
        [headH + shankL, rShank],
        [headH + shankL, 0],
      ],
      seg
    )
  );
  // counterbore wall + floor
  const bore = latheZ(
    [
      [headH * 0.62, 0],
      [headH * 0.62, rSocket],
      [0, rSocket],
    ],
    6
  );
  g.push(bore);
  return mergeAll(g)!;
}

/* ========================================================================== */
/*  assembly                                                                  */
/* ========================================================================== */

/**
 * Collects transformed geometry per material, then merges each bucket into one
 * mesh. Also carries the named attachment nodes (muzzle, sight axis, grips,
 * moving parts) the animation rig drives.
 */
export interface AssemblyNode {
  pos: Vec3;
  rot: Vec3;
}
export class Assembly {
  name: string;
  buckets: Map<string, THREE.BufferGeometry[]>;
  nodes: Map<string, AssemblyNode>;

  constructor(name: string) {
    this.name = name;
    this.buckets = new Map(); // matKey -> geometry[]
    this.nodes = new Map(); // name -> { pos:[x,y,z], rot:[x,y,z] }
  }

  /**
   * @param {THREE.BufferGeometry} geo    consumed (cloned internally)
   * @param {string} mat                  material key
   * @param {object} t   { x,y,z, rx,ry,rz, sx,sy,sz, mirror }
   */
  add(geo: THREE.BufferGeometry, mat: string, t: Transform | null = null): this {
    const g = geo.clone();
    if (t) {
      _v.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
      _e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'XYZ');
      _q.setFromEuler(_e);
      _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
      _m4.compose(_v, _q, _s);
      g.applyMatrix4(_m4);
      if ((t.sx ?? 1) * (t.sy ?? 1) * (t.sz ?? 1) < 0) flipWinding(g);
    }
    normalizeAttributes(g);
    let list = this.buckets.get(mat);
    if (!list) this.buckets.set(mat, (list = []));
    list.push(g);
    return this;
  }

  node(name: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    this.nodes.set(name, { pos: [x, y, z], rot: [rx, ry, rz] });
    return this;
  }

  /** @returns Map<matKey, THREE.BufferGeometry> */
  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [mat, list] of this.buckets) {
      const merged = mergeAll(list);
      if (merged) out.set(mat, merged);
    }
    this.buckets.clear();
    return out;
  }
}

/** Merge a list of geometries, tolerating mixed indexed/non-indexed input. */
export function mergeAll(
  list: readonly (THREE.BufferGeometry | null | undefined)[]
): THREE.BufferGeometry | null {
  const clean = list.filter((geo): geo is THREE.BufferGeometry => Boolean(geo));
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  const nonIndexed = clean.map((g) => (g.getIndex() ? g.toNonIndexed() : g));
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
