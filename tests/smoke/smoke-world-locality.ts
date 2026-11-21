/** World randomness is keyed per element: editing one building never re-rolls another. */
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { buildWorld } from '#worldgen/build';
import { Assembler } from '#worldgen/builder';
import { BUILDINGS } from '#worldgen/level/layout';

const box = new THREE.Box3();
const identity = new THREE.Matrix4();
const down = new THREE.Vector3(0, -1, 0);
const seatProbes = [
  new THREE.Vector3(-9.984, 3.62, -8.674), // W2 bucket
  new THREE.Vector3(5.611, 3.62, 16.262), // E1 bucket
  new THREE.Vector3(-4.041, 9.72, -48.289), // BS3 carton
];

/** Every merged piece and surviving instance as `key min max` -> { n, x, z }. */
type Piece = { n: number; x: number; z: number };
function emitted(): Map<string, Piece> {
  const out = new Map<string, Piece>();
  const record = (key: string, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4 | null): void => {
    if (!geo.boundingBox) geo.computeBoundingBox();
    assert(geo.boundingBox);
    box.copy(geo.boundingBox);
    if (matrix) box.applyMatrix4(matrix);
    const k = `${key} ${box.min
      .toArray()
      .map((v): string => v.toFixed(4))
      .join(',')} ${box.max
      .toArray()
      .map((v): string => v.toFixed(4))
      .join(',')}`;
    const e = out.get(k) ?? { n: 0, x: box.min.x, z: box.min.z };
    e.n++;
    out.set(k, e);
  };
  const A = new Assembler({
    materials: { get: (name): THREE.Material => Object.assign(new THREE.Material(), { name }) },
  });
  // Record merged pieces without merging them: nothing reads the batches here.
  const unsupported = new Set(
    seatProbes.map((origin): THREE.Raycaster => new THREE.Raycaster(origin, down, 0, 0.06))
  );
  const seat = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial());
  A.add = (key, geo, matrix): Assembler => {
    record(key, geo, matrix);
    seat.geometry = geo;
    seat.matrixWorld.copy(matrix ?? identity);
    for (const probe of unsupported) {
      if (
        box.max.y >= probe.ray.origin.y - probe.far &&
        probe.ray.intersectsBox(box) &&
        probe.intersectObject(seat, false).length
      )
        unsupported.delete(probe);
    }
    return A;
  };
  buildWorld(A);
  seat.material.dispose();
  assert.equal(unsupported.size, 0, 'baked balcony props keep a physical seat');
  // Instances after clutter clearance, so culling differences count too.
  for (const [id, proto] of A._protos) {
    assert(proto.geo, 'unfinalized prototypes retain their geometry');
    for (const m of proto.matrices) record(id, proto.geo, m);
  }
  return out;
}

// W2 has facades, an interior stair, furnished rooms, a ladder and roof dressing.
const spec = BUILDINGS.find((building): boolean => building.id === 'W2');
assert(spec);
const before = emitted();
const damage = spec.damage;
spec.damage = (damage ?? 0.2) + 0.25; // changes the draw count of every W2 facade
const after = emitted();
spec.damage = damage;

const near = ({ x, z }: Piece): boolean =>
  Math.abs(x - spec.x) < spec.w / 2 + 3 && Math.abs(z - spec.z) < spec.d / 2 + 3;
let local = 0;
const leaked: string[] = [];
for (const k of new Set([...before.keys(), ...after.keys()])) {
  const a = before.get(k);
  const b = after.get(k);
  if (a?.n === b?.n) continue;
  const piece = a ?? b;
  assert(piece);
  if (near(piece)) local++;
  else leaked.push(k);
}
assert.ok(local > 0, 'the edit changes W2 itself');
assert.deepEqual(leaked.slice(0, 5), [], `${leaked.length} pieces changed outside W2`);
