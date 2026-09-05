import * as THREE from 'three';
import { heightAt } from './support-index.js';

const massCache = new WeakMap();

// Some closed authored lathe prototypes (notably tyres) are wound inside-out.
// Signed volume recovers their orientation without prototype-name exceptions.
// This is for closed prop meshes, not open static floors or decorative planes.
export function massProperties(geometry) {
  if (massCache.has(geometry)) return massCache.get(geometry);
  const positions = geometry.getAttribute('position'), index = geometry.getIndex();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
  let volume = 0;
  const weighted = new THREE.Vector3(), sum = new THREE.Vector3(), cross = new THREE.Vector3();
  for (let i = 0; i < (index ? index.count : positions.count); i += 3) {
    a.fromBufferAttribute(positions, index ? index.getX(i) : i).sub(centre);
    b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1).sub(centre);
    c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2).sub(centre);
    const v = a.dot(cross.crossVectors(b, c));
    volume += v;
    weighted.addScaledVector(sum.copy(a).add(b).add(c), v / 4);
  }
  const massCentre = Math.abs(volume) > 1e-9 ? weighted.divideScalar(volume).add(centre) : centre;
  const result = {
    winding: volume < -1e-9 ? -1 : 1,
    centre: geometry.boundingBox.containsPoint(massCentre) ? massCentre : centre,
  };
  massCache.set(geometry, result);
  return result;
}

// Offline analysis only. Sample the transformed lower envelope, not the world
// AABB or a band around the single lowest vertex. This retains raised feet on
// stairs and the underside of tilted props, while leaving torus holes empty.
export function contactPoints(geometry, matrix, box) {
  const positions = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : positions.count;
  const winding = massProperties(geometry).winding * Math.sign(matrix.determinant());
  const nx = Math.max(8, Math.min(32, Math.ceil((box.max.x - box.min.x) / 0.035)));
  const nz = Math.max(8, Math.min(32, Math.ceil((box.max.z - box.min.z) / 0.035)));
  const dx = Math.max(1e-6, (box.max.x - box.min.x) / nx);
  const dz = Math.max(1e-6, (box.max.z - box.min.z) / nz);
  const grid = new Map();
  const fallback = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(matrix);
    b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
    c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
    ab.subVectors(b, a); ac.subVectors(c, a); ab.cross(ac);
    if (ab.y * winding >= -1e-9) continue;
    const triangle = { ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z };
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - box.min.x) / dx));
    const x1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - box.min.x) / dx));
    const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - box.min.z) / dz));
    const z1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - box.min.z) / dz));
    let sampled = false;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const x = box.min.x + (ix + 0.5) * dx, z = box.min.z + (iz + 0.5) * dz;
        const y = heightAt(triangle, x, z);
        if (y == null) continue;
        const key = ix + iz * nx;
        if (!grid.has(key) || y < grid.get(key).y) grid.set(key, { x, y, z });
        sampled = true;
      }
    }
    // Thin feet/splinters can fall between grid rays. Keep an actual face point,
    // never move it towards an AABB centre (which can move it off the mesh).
    if (!sampled) {
      const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3;
      const key = Math.min(nx - 1, Math.floor((x - box.min.x) / dx)) + Math.min(nz - 1, Math.floor((z - box.min.z) / dz)) * nx;
      if (!fallback.has(key) || y < fallback.get(key).y) fallback.set(key, { x, y, z });
    }
  }
  for (const [key, point] of fallback) {
    if (!grid.has(key) || point.y < grid.get(key).y) grid.set(key, point);
  }
  return [...grid.values()];
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/** Approximate static stability, not a rigid-body/friction simulation. */
export function footprintMargin(points, box, centre = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 }) {
  if (points.length < 3) return -Infinity;
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const hull = [];
  for (const point of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
    hull.push(point);
  }
  const lower = hull.length;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const point = sorted[i];
    while (hull.length > lower && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
    hull.push(point);
  }
  hull.pop();
  if (hull.length < 3) return -Infinity;
  let margin = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    margin = Math.min(margin, cross(a, b, centre) / Math.hypot(b.x - a.x, b.z - a.z));
  }
  return margin;
}

export function supportFootprint(points, box, centre) {
  // Numerical tolerance only; do not inflate a one-corner contact into a seat.
  return footprintMargin(points, box, centre) >= -1e-7;
}
