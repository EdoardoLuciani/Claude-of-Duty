import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Assembler } from '../../tools/worldgen/builder.js';
import { buildBuilding } from '../../tools/worldgen/buildings.js';
import { BUILDINGS } from '../../tools/worldgen/level/layout.js';
import { registerProps } from '../../tools/worldgen/props.js';

// E3's keyed cornice runoff used to hang from y=3.29 down to y=1.60,
// spanning the usable doorway at x=6.488, z=-18.65. Flat stain geometry
// enters the same collision bake as masonry; it must avoid the opening.
const assembler = new Assembler({ materials: { get: (name) => ({ name }) } });
registerProps(assembler);
const patches = [];
assembler.add = (key, geometry, matrix) => {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (key.startsWith('plaster') && bounds.max.z - bounds.min.z < 1e-8 && matrix) {
    patches.push(bounds.clone().applyMatrix4(matrix));
  }
  return assembler;
};
const building = buildBuilding(
  assembler,
  BUILDINGS.find((spec) => spec.id === 'E3')
);
const door = building.traversable.find((opening) => opening.kind === 'door');
assert(door);
const opening = new THREE.Box3(
  new THREE.Vector3(6.47, 0.6, door.from[2] - door.w / 2),
  new THREE.Vector3(6.5, 2.7, door.from[2] + door.w / 2)
);
assert(patches.length > 0, 'retain facade weathering outside the opening');
assert.equal(patches.filter((patch) => patch.intersectsBox(opening)).length, 0);
assembler.releaseCache();
for (const proto of assembler._protos.values()) proto.geo.dispose();
console.log('ok doorway runoff: facade stains do not bridge the E3 traversal opening');
