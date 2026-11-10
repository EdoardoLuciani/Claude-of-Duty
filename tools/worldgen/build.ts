import type { Assembler } from './builder.ts';
import type { BuildingInfo } from './buildings.ts';
import { buildBuilding, collapseRoof, exteriorStairBoxes } from './buildings.ts';
import {
  registerDressingProps,
  dressStreet,
  dressBuildings,
  buildGate,
  buildPerimeter,
} from './dressing.ts';
import { buildGround } from './ground.ts';
import { BUILDINGS } from './level/layout.ts';
import type { ClearanceBox } from './placement.ts';
import { clearDoorwayClutter, clearVolumeClutter, placeBaked } from './placement.ts';
import { registerProps } from './props.ts';
import { keyedRng } from './util.ts';

/**
 * Populate an Assembler with the complete authored level. Each element draws
 * from its own `keyedRng` stream; there is no level-wide random sequence.
 */
export function buildWorld(A: Assembler): BuildingInfo[] {
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
    buildings.flatMap((building): BuildingInfo['traversable'] => building.traversable)
  );
  const wells = BUILDINGS.flatMap((building): ClearanceBox[] =>
    Object.values(building.stairHoles ?? {}).map((hole): ClearanceBox => ({
      x0: hole!.x0 - 0.1,
      x1: hole!.x1 + 0.1,
      z0: hole!.z0 - 0.1,
      z1: hole!.z1 + 0.1,
    }))
  );
  const runs = buildings.flatMap((building): ReturnType<typeof exteriorStairBoxes> =>
    exteriorStairBoxes(building.spec, building)
  );
  clearVolumeClutter(A, wells.concat(runs));
  return buildings;
}
