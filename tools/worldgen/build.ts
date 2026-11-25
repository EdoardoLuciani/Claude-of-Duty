import type { Assembler } from './builder.ts';
import type { BuildingInfo } from './buildings.ts';
import { buildBuilding, dressCollapse, exteriorStairBoxes } from './buildings.ts';
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

// Low-triangle groups measured on Survival; keep larger and distance-LOD props separate.
const BATCHED_PROPS = new Set([
  'barrel_blue',
  'block_big',
  'block_small',
  'cabinet',
  'fan',
  'lamp_post',
  'mattress',
  'sign_board',
  'sign_hang',
]);

/**
 * Populate an Assembler with the complete authored level. Each element draws
 * from its own `keyedRng` stream; there is no level-wide random sequence.
 */
export function buildWorld(A: Assembler): BuildingInfo[] {
  registerProps(A, BATCHED_PROPS);
  registerDressingProps(A);
  buildGround(A);

  const buildings = [];
  for (const spec of BUILDINGS) {
    const info = buildBuilding(A, spec);
    buildings.push(info);
    if (spec.collapseDebris) dressCollapse(A, info, ...spec.collapseDebris);
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
