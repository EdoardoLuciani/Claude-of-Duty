// Bounded multilayer-grid prototype, NOT a second production navigator.
import * as THREE from 'three';
import { PROFILE } from './fixtures.mjs';
import { canConnect } from './harness.mjs';
import { makeHitRecord } from '../../src/physics/math.js';

export function layeredGrid(physics, bounds, cell = 0.4) {
  const start = performance.now();
  const minX = Math.floor(bounds.min.x / cell) * cell, minZ = Math.floor(bounds.min.z / cell) * cell;
  const nx = Math.ceil((bounds.max.x - minX) / cell), nz = Math.ceil((bounds.max.z - minZ) / cell);
  const columns = Array.from({ length: nx * nz }, () => []);
  const points = [], adjacency = [];
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), hit = makeHitRecord();
  const mask = physics.MASK.CHARACTER;
  const fit = (x, y, z) => physics.checkCapsule(
    p0.set(x, y + PROFILE.step + 0.015 + PROFILE.radius, z),
    p1.set(x, y + PROFILE.step + 0.015 + PROFILE.height - PROFILE.radius, z), PROFILE.radius, mask);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const wx = minX + x * cell, wz = minZ + z * cell;
    let top = bounds.max.y + 2;
    for (let layer = 0; layer < 64 && top > bounds.min.y; layer++) {
      const down = physics.raycast(wx, top, wz, 0, -1, 0, top - bounds.min.y, mask);
      if (!down.hit) break;
      const y = down.point.y;
      if (down.frontFace && down.normal.y >= Math.cos(PROFILE.slope * Math.PI / 180) && fit(wx, y, wz)) {
        columns[z * nx + x].push(points.length);
        points.push(new THREE.Vector3(wx, y, wz));
        adjacency.push([]);
      }
      top = y - 0.025;
    }
  }
  const sampleMs = performance.now() - start;
  // Conservative raised capsule sweep plus sampled support. This is not a
  // substitute for the production controller tests below (notably on stairs).
  function segment(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (!d) return Math.abs(a.y - b.y) < 0.05;
    let y = a.y;
    const steps = Math.ceil(d / 0.1);
    for (let s = 1; s <= steps; s++) {
      const x = a.x + dx * s / steps, z = a.z + dz * s / steps;
      const ray = physics.raycast(x, y + PROFILE.step + 0.02, z, 0, -1, 0, PROFILE.step * 2 + 0.04, mask);
      if (!ray.hit || Math.abs(ray.point.y - y) > PROFILE.step + 0.01) return false;
      y = ray.point.y;
    }
    if (Math.abs(y - b.y) > 0.1) return false;
    const high = Math.max(a.y, b.y) + PROFILE.step + 0.015;
    return !physics.staticWorld.sweepCapsule(a.x, high + PROFILE.radius, a.z,
      a.x, high + PROFILE.height - PROFILE.radius, a.z,
      PROFILE.radius, dx / d, 0, dz / d, d, mask, hit);
  }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || xx >= nx || zz >= nz) continue;
      for (const i of columns[z * nx + x]) for (const j of columns[zz * nx + xx]) {
        if (Math.abs(points[i].y - points[j].y) > PROFILE.step) continue;
        if (!segment(points[i], points[j]) || !segment(points[j], points[i])) continue;
        adjacency[i].push(j); adjacency[j].push(i);
      }
    }
  }
  const components = new Int32Array(points.length).fill(-1);
  let componentCount = 0;
  for (let i = 0; i < points.length; i++) {
    if (components[i] >= 0) continue;
    const queue = [i]; components[i] = componentCount;
    for (let k = 0; k < queue.length; k++) for (const j of adjacency[queue[k]]) {
      if (components[j] < 0) { components[j] = componentCount; queue.push(j); }
    }
    componentCount++;
  }
  const edges = adjacency.reduce((n, a) => n + a.length, 0);
  // Explicit portable data estimate: points, CSR edges, component ids, columns.
  const packed = Buffer.alloc(points.length * 20 + edges * 4 + (columns.length + 1) * 4 + points.length * 4);
  let o = 0;
  const uint = (v) => { packed.writeUInt32LE(v, o); o += 4; };
  for (const p of points) for (const v of [p.x, p.y, p.z]) { packed.writeFloatLE(v, o); o += 4; }
  let edgeOff = 0;
  for (let i = 0; i < points.length; i++) { uint(edgeOff); edgeOff += adjacency[i].length; uint(components[i]); }
  for (const a of adjacency) for (const j of a) uint(j);
  let colOff = 0;
  for (const c of columns) { uint(colOff); colOff += c.length; }
  uint(colOff);
  for (const c of columns) for (const i of c) uint(i);

  function resolve(p, goal = false) {
    const x = Math.round((p.x - minX) / cell), z = Math.round((p.z - minZ) / cell);
    const candidates = [], rings = Math.ceil(1.2 / cell);
    for (let dz = -rings; dz <= rings; dz++) for (let dx = -rings; dx <= rings; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
      for (const i of columns[zz * nx + xx]) {
        if (Math.abs(points[i].y - p.y) <= PROFILE.step && points[i].distanceTo(p) <= 1.2) candidates.push(i);
      }
    }
    candidates.sort((a, b) => points[a].distanceToSquared(p) - points[b].distanceToSquared(p) || a - b);
    for (const i of candidates.slice(0, 8)) if (goal ? canConnect(physics, points[i], p) : canConnect(physics, p, points[i])) return i;
    return -1;
  }
  // Float64 scores and stale-entry rejection; benchmark rather than expanding
  // the old grid's 6000-pop budget. Heap allocations are spike-only.
  const costs = new Float64Array(points.length), parents = new Int32Array(points.length);
  function query(from, to) {
    const a = resolve(from), b = resolve(to, true);
    if (a < 0 || b < 0) return { outcome: 'invalid', points: [] };
    if (components[a] !== components[b]) return { outcome: 'unreachable', points: [] };
    costs.fill(Infinity); parents.fill(-1); costs[a] = 0;
    const heap = [];
    const push = (i, g) => {
      const entry = { i, g, f: g + points[i].distanceTo(points[b]) };
      let k = heap.length; heap.push(entry);
      while (k && heap[(k - 1) >> 1].f > entry.f) { heap[k] = heap[(k - 1) >> 1]; k = (k - 1) >> 1; }
      heap[k] = entry;
    };
    const pop = () => {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let k = 0;
        while (k * 2 + 1 < heap.length) {
          let child = k * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
          if (heap[child].f >= last.f) break;
          heap[k] = heap[child]; k = child;
        }
        heap[k] = last;
      }
      return first;
    };
    push(a, 0);
    let expanded = 0, stale = 0, found = false;
    while (heap.length && expanded < 6000) {
      const cur = pop();
      if (cur.g !== costs[cur.i]) { stale++; continue; }
      if (cur.i === b) { found = true; break; }
      expanded++;
      for (const j of adjacency[cur.i]) {
        const g = cur.g + points[cur.i].distanceTo(points[j]);
        if (g >= costs[j]) continue;
        costs[j] = g; parents[j] = cur.i; push(j, g);
      }
    }
    if (!found) return { outcome: heap.length ? 'search-limit' : 'unreachable', points: [], expanded, stale };
    const raw = [];
    for (let i = b; i >= 0; i = parents[i]) raw.push(points[i]);
    raw.reverse();
    const out = [points[a]];
    for (let i = 0; i < raw.length - 1;) {
      let j = Math.min(raw.length - 1, i + 24);
      for (; j > i + 1 && !segment(raw[i], raw[j]); j--);
      out.push(raw[j]); i = j;
    }
    out.push(to.clone());
    return { outcome: 'success', points: out, expanded, stale };
  }
  return { name: `layers-${cell}`, query, resolve, points, packed, components,
    metrics: { cell, nodes: points.length, edges, componentCount, sampleMs, bakeMs: performance.now() - start,
      workingBytes: costs.byteLength + parents.byteLength, packedBytes: packed.length } };
}
