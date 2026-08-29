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
import { clearDoorwayClutter, placeBaked } from './placements/index.js';

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
  return buildings;
}
