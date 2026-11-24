import assert from 'node:assert/strict';

import * as THREE from 'three';

import { LEDGE_VAULT, LedgeProbe } from '../../src/player/mantle.ts';
import { STANCE } from '../../src/player/tuning.ts';
import { Assembler } from '../../tools/worldgen/builder.ts';
import { placeBarrier } from '../../tools/worldgen/industrial-props.ts';
import { buildCollision } from '../../tools/worldgen/pack.ts';
import { physicsFor } from '../lib/nav240/fixtures.ts';

const material = new THREE.MeshBasicMaterial();
const assembly = new Assembler({ materials: { get: (): THREE.Material => material } });
placeBarrier(assembly, 0, 0, 0);
placeBarrier(assembly, 5, 0, 0, Math.PI / 2);
const visual = new THREE.Group();
const source = new THREE.Group();
assembly.finalize(visual, source);
assert.equal(visual.children.length, 1, 'repeated placements share a prototype');

function close(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-5, `${message}: expected ${expected}, got ${actual}`);
}

const mesh = visual.getObjectByName('prop_industrial_barrier');
const canonical = source.getObjectByName('prop_industrial_barrier');
assert(mesh instanceof THREE.InstancedMesh && canonical instanceof THREE.InstancedMesh);
const geometry: unknown = mesh.geometry;
assert(geometry instanceof THREE.BufferGeometry);
assert.equal(geometry, canonical.geometry, 'collision uses the visible authored geometry');
// A collapsed UV triangle breaks the normal map's tangent basis.
const uv: unknown = geometry.getAttribute('uv');
assert(uv instanceof THREE.BufferAttribute);
const index = geometry.getIndex()!;
for (let i = 0; i < index.count; i += 3) {
  const a = index.getX(i),
    b = index.getX(i + 1),
    c = index.getX(i + 2);
  const area: number =
    (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) -
    (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
  assert(Math.abs(area) > 1e-10, 'barrier needs a usable tangent basis');
}
geometry.computeBoundingBox();
const bounds = geometry.boundingBox!;
for (const [actual, expected] of [
  [bounds.min.x, -1.2],
  [bounds.min.y, 0],
  [bounds.min.z, -0.275],
  [bounds.max.x, 1.2],
  [bounds.max.y, 0.78],
  [bounds.max.z, 0.275],
])
  close(actual, expected, 'barrier base-centred dimensions');

const { scene } = await buildCollision(source);
const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 10), material);
floor.position.y = -0.5;
floor.userData.surface = 'concrete';
scene.add(floor);
const physics = physicsFor(scene);

for (const [x, z] of [
  [0, 0],
  [5, 1],
] as const) {
  const hit = physics.raycast(x, 2, z, 0, -1, 0, 2, physics.MASK.WORLD);
  assert(hit.hit && hit.surface === 'concrete' && hit.normal.y > 0.99);
  close(hit.point.y, 0.78, 'cooked walkable top');
}

assert(
  !physics.raycast(0.65, 0.04, 1, 0, 0, -1, 2, physics.MASK.WORLD).hit,
  'barrier fork pocket stays open after simplification'
);

const player = physics.createCharacter();
const ledge = new LedgeProbe(physics);
for (const side of [-1, 1]) {
  player.setPosition(0, 0, side * 0.57);
  assert.equal(ledge.probe(player, 0, -side, STANCE.stand.height), LEDGE_VAULT);
  close(ledge.result.topY, 0.78, 'barrier vault lip');
}
console.log('industrial props: dimensions, canonical collision and vault');
