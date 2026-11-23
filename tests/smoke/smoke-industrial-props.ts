import assert from 'node:assert/strict';

import * as THREE from 'three';

import { LEDGE_NONE, LEDGE_VAULT, LedgeProbe } from '../../src/player/mantle.ts';
import { STANCE } from '../../src/player/tuning.ts';
import { Assembler } from '../../tools/worldgen/builder.ts';
import { placeBarrier, placePlatform } from '../../tools/worldgen/industrial-props.ts';
import { buildCollision } from '../../tools/worldgen/pack.ts';
import { physicsFor } from '../lib/nav240/fixtures.ts';

const material = new THREE.MeshBasicMaterial();
const assembly = new Assembler({ materials: { get: (): THREE.Material => material } });
placeBarrier(assembly, 0, 0, 0);
placePlatform(assembly, 5, 0, 0, Math.PI / 2);
placePlatform(assembly, 10, 0, 0);
placePlatform(assembly, 10, 0.45, 0);
const visual = new THREE.Group();
const source = new THREE.Group();
assembly.finalize(visual, source);
assert.equal(visual.children.length, 2, 'repeated placements share prototypes');

function close(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 1e-5, `${message}: expected ${expected}, got ${actual}`);
}

for (const [name, maxX, height, maxZ] of [
  ['barrier', 1.2, 0.78, 0.275],
  ['platform', 1.5, 0.45, 1],
] as const) {
  const mesh = visual.getObjectByName(`prop_industrial_${name}`);
  const canonical = source.getObjectByName(`prop_industrial_${name}`);
  assert(mesh instanceof THREE.InstancedMesh && canonical instanceof THREE.InstancedMesh);
  const geometry: unknown = mesh.geometry;
  assert(geometry instanceof THREE.BufferGeometry);
  assert.equal(geometry, canonical.geometry, 'collision uses the visible authored geometry');
  // A collapsed UV triangle makes brushed-steel reflections flash solid white.
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
    assert(Math.abs(area) > 1e-10, `${name} needs a usable tangent basis`);
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  for (const [actual, expected] of [
    [bounds.min.x, -maxX],
    [bounds.min.y, 0],
    [bounds.min.z, -maxZ],
    [bounds.max.x, maxX],
    [bounds.max.y, height],
    [bounds.max.z, maxZ],
  ])
    close(actual, expected, `${name} base-centred dimensions`);
}

const { scene } = await buildCollision(source);
const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 10), material);
floor.position.y = -0.5;
floor.userData.surface = 'concrete';
scene.add(floor);
const physics = physicsFor(scene);

for (const [x, z, y, surface] of [
  [0, 0, 0.78, 'concrete'],
  [5, 1.3, 0.45, 'metal'],
  [10, 0, 0.9, 'metal'],
] as const) {
  const hit = physics.raycast(x, 2, z, 0, -1, 0, 2, physics.MASK.WORLD);
  assert(hit.hit && hit.surface === surface && hit.normal.y > 0.99);
  close(hit.point.y, y, 'cooked walkable top');
}

assert(
  !physics.raycast(0.65, 0.04, 1, 0, 0, -1, 2, physics.MASK.WORLD).hit,
  'barrier fork pocket stays open after simplification'
);
assert(
  !physics.raycast(3.5, 0.07, 0.62, 1, 0, 0, 3, physics.MASK.WORLD).hit,
  'rotated platform fork pocket stays open after simplification'
);

const player = physics.createCharacter();
const ledge = new LedgeProbe(physics);
for (const side of [-1, 1]) {
  player.setPosition(0, 0, side * 0.57);
  assert.equal(ledge.probe(player, 0, -side, STANCE.stand.height), LEDGE_VAULT);
  close(ledge.result.topY, 0.78, 'barrier vault lip');
}
player.setPosition(3.7, 0, 0);
const platformLedge = ledge.probe(player, 1, 0, STANCE.stand.height);
assert(platformLedge !== LEDGE_NONE && platformLedge !== LEDGE_VAULT);
close(ledge.result.landY, 0.45, 'player can land on the rotated platform');
console.log('industrial props: dimensions, canonical collision, vault and stacking');
