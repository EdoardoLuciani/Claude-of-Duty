import * as THREE from 'three';

import type { Assembler } from './builder.ts';
import { barrierMesh } from './industrial-props-meshes.ts';
import { paintMasks } from './util.ts';

function authoredGeometry({
  positions,
  triangles,
}: {
  positions: number[];
  triangles: number[];
}): THREE.BufferGeometry {
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      positions.map((p): number => p / 1000),
      3
    )
  );
  indexed.setIndex(triangles);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  // The Blender recipe exports triangles only. Give each flat face a non-degenerate
  // UV basis for the material's normal map.
  const pos = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const side = nx > ny && nx > nz;
    uv.setXY(i, side ? pos.getZ(i) : pos.getX(i), !side && ny >= nz ? pos.getZ(i) : pos.getY(i));
  }
  geometry.setAttribute('uv', uv);
  return paintMasks(geometry, (_x, y, _z, nx, ny, nz, masks): void => {
    const bed = 1 - Math.min(1, y / 0.2);
    const bevel = 1 - Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    masks[0] = 0.12 + bevel * 1.5;
    masks[1] = 0.12 + bed * 0.38;
    masks[2] = bed * 0.18 + Math.max(0, -ny) * 0.18;
  });
}

/** Place a precast barrier by its base centre in level space; yaw is in radians. */
export function placeBarrier(A: Assembler, x: number, y: number, z: number, yaw = 0): void {
  const id = 'industrial_barrier';
  if (!A.has(id)) A.proto(id, { geo: authoredGeometry(barrierMesh), key: 'concrete_prop' });
  A.put(id, x, y, z, yaw);
}
