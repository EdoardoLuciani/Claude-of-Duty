import assert from 'node:assert/strict';

import * as THREE from 'three';

import { Assembler } from '#worldgen/builder';
import { buildBuilding } from '#worldgen/buildings';
import { BUILDINGS } from '#worldgen/level/layout';
import { registerProps } from '#worldgen/props';

// E3's keyed cornice runoff used to hang from y=3.29 down to y=1.60,
// spanning the usable doorway at x=6.488, z=-18.65. A stain must stay
// on the wall even when it is visual-only.
const assembler = new Assembler({
  materials: { get: (name): THREE.Material => Object.assign(new THREE.Material(), { name }) },
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
// A stain and its solid wall can share a visual palette/draw without sharing
// the collision bake. Decorative instances must also stay out of that source.
const A = new Assembler({
  materials: { get: (): THREE.Material => new THREE.MeshBasicMaterial() },
});
const box = new THREE.BoxGeometry();
const offset = new THREE.Matrix4().makeTranslation(3, 0, 0);
A.add('plaster_sand', box);
A.add('plaster_sand', box, offset, { visualOnly: true });
A.proto('detail', { key: 'plaster_sand', geo: box.clone(), visualOnly: true });
A.place('detail', new THREE.Matrix4().makeTranslation(6, 0, 0));
const visible = new THREE.Group();
const physical = new THREE.Group();
A.finalize(visible, physical);
visible.updateMatrixWorld(true);
physical.updateMatrixWorld(true);
for (const x of [0, 3, 6]) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 2, 0), new THREE.Vector3(0, -1, 0));
  assert(ray.intersectObject(visible).length, 'every piece renders');
  assert.equal(ray.intersectObject(physical).length > 0, x === 0, 'only the wall collides');
}
box.dispose();
A.dispose();
console.log('ok doorway runoff: stains stay on masonry and out of the collision bake');
