import { BUILDINGS } from './layout.js';
import { buildGround } from './ground.js';
import { buildBuilding, collapseRoof } from './buildings.js';
import { registerProps } from './props.js';
import {
  registerDressingProps,
  dressStreet,
  dressBuildings,
  scatterDebris,
  buildGate,
  buildPerimeter,
} from './dressing.js';

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
  scatterDebris(A, rng);
  return buildings;
}
