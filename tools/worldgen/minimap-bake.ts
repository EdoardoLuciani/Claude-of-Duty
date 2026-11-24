import { PNG } from 'pngjs';
import { Matrix4, Vector3 } from 'three';
import type { Box3 } from 'three';

import { clamp01, lerp } from '../../src/core/math.ts';
import type { WorldMinimap } from '../../src/core/model-metadata.ts';
import type { StaticWorld } from '../../src/physics/bvh.ts';
import { makeHitRecord } from '../../src/physics/math.ts';
import { MASK, surfaceIndex } from '../../src/physics/surfaces.ts';
import type { BuildMetadata } from './metadata.ts';

const LONG_EDGE = 1024;
const RISE = 0.65; // metres: ignore kerbs and minor ground relief
const PLATE = [27, 35, 42];
const SAND = [67, 77, 87];
const STREET = [99, 113, 126];
const MASS_LO = [50, 59, 68];
const MASS_HI = [68, 79, 90];
const WALL = [36, 45, 53];
const SAND_SURFACE = surfaceIndex('sand');

export function minimapSize({ minX, minZ, maxX, maxZ }: Omit<WorldMinimap, 'labels'>): {
  width: number;
  height: number;
} {
  const spanX = maxX - minX,
    spanZ = maxZ - minZ,
    ppm = LONG_EDGE / Math.max(spanX, spanZ);
  return {
    width: Math.max(1, Math.round(spanX * ppm)),
    height: Math.max(1, Math.round(spanZ * ppm)),
  };
}

/** Sample pixel centres in world X/Z, with -Z at the top (north). */
export function bakeMinimap(
  world: StaticWorld,
  bounds: Box3,
  map: BuildMetadata
): { png: Buffer; metadata: WorldMinimap } {
  const { x: minX, z: minZ } = bounds.min,
    { x: maxX, z: maxZ } = bounds.max;
  if (minX >= maxX || minZ >= maxZ) throw new Error('[minimap bake] empty world rectangle');
  const metadata: WorldMinimap = { minX, minZ, maxX, maxZ, labels: [] };
  const { width, height } = minimapSize(metadata);
  const image = new PNG({ width, height });
  const heights = new Float32Array(width * height).fill(-Infinity);
  const stepX = (maxX - minX) / width,
    stepZ = (maxZ - minZ) / height;
  const matrix = new Matrix4().fromArray(map.transform);
  const groundY = matrix.elements[13]; // World Y of the level origin.
  const top = Math.max(bounds.max.y, world.aabb.maxy) + 1;
  const depth = top - bounds.min.y + 1;
  const hit = makeHitRecord();
  for (let row = 0; row < height; row++) {
    const z = minZ + (row + 0.5) * stepZ;
    for (let col = 0; col < width; col++) {
      const x = minX + (col + 0.5) * stepX,
        i = row * width + col;
      let color = PLATE;
      let raised = 0;
      if (world.raycast(x, top, z, 0, -1, 0, depth, MASK.WORLD, hit)) {
        heights[i] = hit.py;
        raised = hit.py - groundY;
        if (hit.ny < 0.55) color = WALL;
        else if (raised > RISE) color = MASS_LO;
        else color = hit.surface === SAND_SURFACE ? SAND : STREET;
      }
      const t = clamp01(raised / 14);
      for (let ch = 0; ch < 3; ch++)
        image.data[i * 4 + ch] =
          color === MASS_LO ? Math.round(lerp(color[ch], MASS_HI[ch], t)) : color[ch];
      image.data[i * 4 + 3] = 255;
    }
  }
  // Vertical faces rarely intersect a vertical ray. Ink the high side of height steps.
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      if (
        heights[i] >
        Math.min(
          col > 0 ? heights[i - 1] : heights[i],
          col + 1 < width ? heights[i + 1] : heights[i],
          row > 0 ? heights[i - width] : heights[i],
          row + 1 < height ? heights[i + width] : heights[i]
        ) +
          RISE
      )
        image.data.set(WALL, i * 4);
    }
  }

  const point = new Vector3();
  for (const { spec } of map.buildings ?? []) {
    point.set(spec.x, 0, spec.z).applyMatrix4(matrix);
    const kind = spec.ruin ? 'ruin' : spec.rooms?.[0]?.furnish?.[0]?.id;
    metadata.labels.push({
      x: point.x,
      z: point.z,
      w: spec.w * Math.abs(matrix.elements[0]) + spec.d * Math.abs(matrix.elements[8]),
      code: spec.id,
      text: spec.enterable && kind ? kind.toUpperCase() : null,
    });
  }
  return { png: PNG.sync.write(image), metadata };
}
