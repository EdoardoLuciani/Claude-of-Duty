import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Assembler } from '#worldgen/builder';
import { buildBuilding } from '#worldgen/buildings';
import { BUILDINGS } from '#worldgen/level/layout';
import { registerProps } from '#worldgen/props';

import { fixture } from '../lib/fixture.ts';

// E3's keyed cornice runoff used to hang from y=3.29 down to y=1.60,
// spanning the usable doorway at x=6.488, z=-18.65. Flat stain geometry
// enters the same collision bake as masonry; it must avoid the opening.
const assembler = new Assembler({
  materials: { get: (name): THREE.Material => fixture<THREE.Material>({ name }) },
});
registerProps(assembler);
const patches: THREE.Box3[] = [];
assembler.add = (key, geometry, matrix): Assembler => {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  assert(bounds);
  if (key.startsWith('plaster') && bounds.max.z - bounds.min.z < 1e-8 && matrix) {
    patches.push(bounds.clone().applyMatrix4(matrix));
  }
  return assembler;
};
const spec = BUILDINGS.find((spec): boolean => spec.id === 'E3');
assert(spec);
const building = buildBuilding(assembler, spec);
const door = building.traversable.find((opening): boolean => opening.kind === 'door');
assert(door);
const opening = new THREE.Box3(
  new THREE.Vector3(6.47, 0.6, door.from[2] - door.w / 2),
  new THREE.Vector3(6.5, 2.7, door.from[2] + door.w / 2)
);
assert(patches.length > 0, 'retain facade weathering outside the opening');
assert.equal(patches.filter((patch): boolean => patch.intersectsBox(opening)).length, 0);
assembler.releaseCache();
for (const proto of assembler._protos.values()) {
  assert(proto.geo, 'unfinalized prototypes retain their geometry');
  proto.geo.dispose();
}
console.log('ok doorway runoff: facade stains do not bridge the E3 traversal opening');
