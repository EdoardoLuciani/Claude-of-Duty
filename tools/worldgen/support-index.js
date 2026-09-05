import * as THREE from 'three';

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const AB = new THREE.Vector3();
const AC = new THREE.Vector3();

export function heightAt(triangle, x, z) {
  const v0x = triangle.bx - triangle.ax;
  const v0z = triangle.bz - triangle.az;
  const v1x = triangle.cx - triangle.ax;
  const v1z = triangle.cz - triangle.az;
  const v2x = x - triangle.ax;
  const v2z = z - triangle.az;
  const den = v0x * v1z - v1x * v0z;
  if (Math.abs(den) < 1e-9) return null;
  const u = (v2x * v1z - v1x * v2z) / den;
  const v = (v0x * v2z - v2x * v0z) / den;
  if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) return null;
  return triangle.ay + u * (triangle.by - triangle.ay) + v * (triangle.cy - triangle.ay);
}

/** Spatial hash of upward-facing static triangles used by prop validation. */
export class SupportIndex {
  constructor() {
    this.cells = new Map();
    this.triangles = 0;
  }

  addGeometry(geometry, matrix, role = null, source = null, owner = null, winding = 1) {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!position) return;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      A.fromBufferAttribute(position, ia);
      B.fromBufferAttribute(position, ib);
      C.fromBufferAttribute(position, ic);
      if (matrix) {
        A.applyMatrix4(matrix);
        B.applyMatrix4(matrix);
        C.applyMatrix4(matrix);
      }
      AB.subVectors(B, A);
      AC.subVectors(C, A);
      AB.cross(AC);
      const length = AB.length();
      if (length < 1e-7 || AB.y * winding / length < 0.35) continue;
      const minX = Math.min(A.x, B.x, C.x);
      const maxX = Math.max(A.x, B.x, C.x);
      const minZ = Math.min(A.z, B.z, C.z);
      const maxZ = Math.max(A.z, B.z, C.z);
      const triangle = {
        ax: A.x, ay: A.y, az: A.z,
        bx: B.x, by: B.y, bz: B.z,
        cx: C.x, cy: C.y, cz: C.z,
        role,
        source,
        owner,
        normalY: AB.y * winding / length,
      };
      const x0 = Math.floor(minX);
      const x1 = Math.floor(maxX);
      const z0 = Math.floor(minZ);
      const z1 = Math.floor(maxZ);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`;
          let cell = this.cells.get(key);
          if (!cell) this.cells.set(key, (cell = []));
          cell.push(triangle);
        }
      }
      this.triangles++;
    }
  }

  /** All intersected surfaces, including instances, for contact/gap evidence.
   * Keep distinct heights: a shelf top must not hide a nearby lower contact. */
  surfacesAt(x, z, minY, maxY, excludeOwner = null) {
    const cell = this.cells.get(`${Math.floor(x)},${Math.floor(z)}`) ?? [];
    const hits = new Map();
    for (const triangle of cell) {
      if (excludeOwner != null && triangle.owner === excludeOwner) continue;
      const y = heightAt(triangle, x, z);
      if (y == null || y < minY || y > maxY) continue;
      const key = `${triangle.owner}|${triangle.role}|${triangle.source}|${y.toFixed(5)}`;
      if (!hits.has(key)) hits.set(key, {
        y, role: triangle.role, source: triangle.source,
        owner: triangle.owner, normalY: triangle.normalY,
      });
    }
    return [...hits.values()];
  }

}
