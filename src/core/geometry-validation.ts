import type { BufferGeometry } from 'three';

/** Establish triangle/vertex bounds once, before geometry kernels follow indices. */
export function validateTriangleGeometry(geometry: BufferGeometry, label: string): void {
  if (!geometry.hasAttribute('position'))
    throw new Error(`${label}: position must contain complete xyz vertices`);
  const position = geometry.getAttribute('position');
  if (
    !Number.isInteger(position.itemSize) ||
    position.itemSize < 3 ||
    !Number.isInteger(position.count)
  )
    throw new Error(`${label}: position must contain complete xyz vertices`);

  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  if (!Number.isInteger(count) || count % 3 !== 0)
    throw new Error(`${label}: geometry must contain complete triangles`);
  if (!index) return;
  if (index.itemSize !== 1 || index.normalized)
    throw new Error(`${label}: triangle index must contain unnormalized scalar indices`);
  for (let i = 0; i < index.count; i++) {
    const vertex = index.getX(i);
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count)
      throw new Error(`${label}: vertex index ${vertex} at ${i} is outside the position attribute`);
  }
}
