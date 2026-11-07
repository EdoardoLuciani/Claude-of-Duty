import { buildBuilding, collapseRoof, exteriorStairBoxes } from './buildings.js';
import {
  registerDressingProps,
  dressStreet,
  dressBuildings,
  buildGate,
  buildPerimeter,
} from './dressing.js';
import { buildGround } from './ground.js';
import { BUILDINGS } from './level/layout.js';
import { clearDoorwayClutter, clearVolumeClutter, placeBaked } from './placement.js';
import { registerProps } from './props.js';
import { keyedRng } from './util.js';

/**
 * Populate an Assembler with the complete authored level. Each element draws
 * from its own `keyedRng` stream; there is no level-wide random sequence.
 */
export function buildWorld(A) {
  registerProps(A);
  registerDressingProps(A);
  buildGround(A);

  const buildings = [];
  for (const spec of BUILDINGS) {
    const info = buildBuilding(A, spec);
    buildings.push(info);
    if (spec.collapse) {
      const rng = keyedRng('collapse', spec.id);
      collapseRoof(A, rng, spec, info, {
        x: spec.x + rng.range(-2, 2),
        z: spec.z + rng.range(-2, 2),
      });
    }
  }

  buildGate(A);
  buildPerimeter(A);

  dressStreet(A);
  dressBuildings(A, buildings);
  placeBaked(A);
  clearDoorwayClutter(
    A,
    buildings.flatMap((building) => building.traversable)
  );
  const wells = BUILDINGS.flatMap((building) =>
    Object.values(building.stairHoles ?? {}).map((hole) => ({
      x0: hole.x0 - 0.1,
      x1: hole.x1 + 0.1,
      z0: hole.z0 - 0.1,
      z1: hole.z1 + 0.1,
    }))
  );
  const runs = buildings.flatMap((building) => exteriorStairBoxes(building.spec, building));
  clearVolumeClutter(A, wells.concat(runs));
  return buildings;
}
