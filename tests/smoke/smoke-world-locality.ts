/** World randomness is keyed per element: editing one building never re-rolls another. */
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { buildWorld } from '../../tools/worldgen/build.js';
import { Assembler } from '../../tools/worldgen/builder.js';
import { BUILDINGS } from '../../tools/worldgen/level/layout.js';
import { fixture } from '../lib/fixture.ts';

const box = new THREE.Box3();

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
    materials: { get: (name): THREE.Material => fixture<THREE.Material>({ name }) },
  });
  // Record merged pieces without merging them: nothing reads the batches here.
  A.add = (key, geo, matrix): Assembler => (record(key, geo, matrix), A);
  buildWorld(A);
  // Instances after clutter clearance, so culling differences count too.
  for (const [id, proto] of A._protos) for (const m of proto.matrices) record(id, proto.geo, m);
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
