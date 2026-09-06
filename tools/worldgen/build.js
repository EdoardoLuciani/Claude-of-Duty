import { BUILDINGS } from './layout.js';
import { buildGround } from './ground.js';
import { buildBuilding, collapseRoof } from './buildings.js';
import { registerProps } from './props.js';
import {
  registerDressingProps,
  dressStreet,
  dressBuildings,
  buildGate,
  buildPerimeter,
} from './dressing.js';
import { clearDoorwayClutter, clearVolumeClutter, placeBaked } from './placements/index.js';

/** Populate an Assembler with the complete authored level. */
export function buildWorld(A, rng) {
  registerProps(A, rng);
  registerDressingProps(A, rng);
  buildGround(A, rng);

  const buildings = [];
  for (const spec of BUILDINGS) {
    const info = buildBuilding(A, rng, spec);
    buildings.push(info);
    if (spec.collapse) {
      collapseRoof(A, rng, spec, info, {
        x: spec.x + rng.range(-2, 2),
        z: spec.z + rng.range(-2, 2),
      });
    }
  }

  buildGate(A, rng);
  buildPerimeter(A, rng);

  dressStreet(A, rng);
  dressBuildings(A, rng, buildings);
  placeBaked(A);
  clearDoorwayClutter(A, buildings.flatMap((building) => building.traversable));
  const w2 = BUILDINGS.find((building) => building.id === 'W2');
  const wells = Object.values(w2?.stairHoles ?? {}).map((hole) => ({
    x0: hole.x0 - 0.1,
    x1: hole.x1 + 0.1,
    z0: hole.z0 - 0.1,
    z1: hole.z1 + 0.1,
    y0: -0.5,
    y1: 8,
  }));
  clearVolumeClutter(A, wells);
  return buildings;
}
