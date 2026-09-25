import { PhysicsSystem } from '../../src/physics/index.js';
import { CoverMap, NavGrid, packNav } from '../../src/ai/nav.js';

/** Sample walkability + cover from a cooked collision scene (export time). */
export function bakeNav(collisionScene, bounds) {
  const phys = new PhysicsSystem();
  collisionScene.updateWorldMatrix(true, true);
  collisionScene.traverse((object) => {
    if (!object.isMesh) return;
    const surface = object.userData?.surface;
    if (!surface) return;
    phys.addStatic(object, surface);
  });
  const tBvh = performance.now();
  phys.rebuildStatic();
  const bvhMs = performance.now() - tBvh;

  const expanded = bounds.clone().expandByScalar(2);
  const grid = new NavGrid(phys, { bounds: expanded, cell: 0.8 });
  grid.build();
  const cover = new CoverMap(grid, phys);
  cover.build({ step: 1, reach: 1.3 });
  return { buffer: packNav(grid, cover), grid, cover, bvhMs };
}
