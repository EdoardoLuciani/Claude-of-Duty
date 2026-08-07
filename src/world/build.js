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

/**
 * Populate an Assembler with the complete deterministic level. This function is
 * used by the offline GLB exporter and by the opt-in procedural comparison path.
 */
export function buildWorld(A, rng) {
  registerProps(A, rng);
  registerDressingProps(A, rng);
  buildGround(A, rng);

  const infos = [];
  for (const spec of BUILDINGS) {
    const info = buildBuilding(A, rng, spec);
    infos.push(info);
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
  dressBuildings(A, rng, infos);
  scatterDebris(A, rng);
  return infos;
}
