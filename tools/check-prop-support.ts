#!/usr/bin/env bun
/** Inspect authored meshes in level space before the collision bake simplifies them. */
import { parseArgs } from 'node:util';

import * as THREE from 'three';

import { buildWorld } from '#worldgen/build';
import { Assembler } from '#worldgen/builder';
import { GROUND_STONES } from '#worldgen/level/ground-stones';
import { PLACEMENT_ROWS } from '#worldgen/level/placements/index';

import { isMesh } from '../src/core/three-guards.ts';
import { StaticWorld } from '../src/physics/bvh.ts';
import { makeHitRecord } from '../src/physics/math.ts';
import { solidIds } from '../src/physics/solids.ts';
import { LAYER } from '../src/physics/surfaces.ts';

const { values } = parseArgs({
  options: {
    gap: { type: 'string', default: '0.10' },
    json: { type: 'boolean' },
    check: { type: 'boolean' },
  },
});
const minGap = Number(values.gap);
if (!Number.isFinite(minGap) || minGap <= 0)
  throw new Error('--gap must be a positive distance in metres');

// Check ground-seated props and stacks, not mounted lights, cables, trim or foliage.
const candidates = new Set([
  'barrel_blue',
  'barrel_rust',
  'barrel_wood',
  'block_big',
  'block_small',
  'bottle',
  'box_card_a',
  'box_card_b',
  'brick_a',
  'brick_b',
  'bucket',
  'cabinet',
  'can',
  'chair',
  'cinder',
  'crate_a',
  'crate_b',
  'crate_c',
  'crate_flat',
  'gas_bottle',
  'jerry_can',
  'jersey',
  'mattress',
  'pallet',
  'planter',
  'plank_a',
  'plank_b',
  'rebar',
  'rock_a',
  'rock_b',
  'sandbag_a',
  'sandbag_b',
  'sandbag_c',
  'shelf',
  'slab_shard',
  'stall',
  'stool',
  'table',
  'table_small',
  'tyre',
  'tyre_small',
  'water_tank',
]);
const key = (name: string, p: readonly number[]): string =>
  `${name}:${p.map((n): string => n.toFixed(3)).join(',')}`;
const ids = new Map(
  PLACEMENT_ROWS.map(([name, id, p]): [string, string] => [
    key(name, p),
    id.includes('/') ? id : `${name}/${id}`,
  ])
);
for (const [i, [name, x, y, z]] of GROUND_STONES.entries())
  ids.set(key(name, [x, y, z]), `ground-stones/${i + 1} (${name})`);
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const assembler = new Assembler({ materials: { get: (): THREE.Material => material } });
const visible = new THREE.Group();
const canonical = new THREE.Group();
buildWorld(assembler);
assembler.finalize(visible, canonical);
const world = new StaticWorld();
const probe = new THREE.Mesh(new THREE.BufferGeometry(), material);
const matrix = new THREE.Matrix4();
const ray = new THREE.Raycaster();
ray.ray.direction.set(0, 1, 0);
const box = new THREE.Box3();
const hit = makeHitRecord();
const buffer: THREE.Intersection[] = [];
const props: {
  name: string;
  geometry: THREE.BufferGeometry;
  object: number;
  matrix: THREE.Matrix4;
}[] = [];
// Give each instance its own object ID so a ray can ignore the prop under test
// without ignoring neighbours of the same prototype (e.g. a sandbag stack).
const mesh = new THREE.Mesh();
mesh.matrixWorldAutoUpdate = false;
for (const child of canonical.children) {
  if (!isMesh(child)) continue;
  const { geometry } = child;
  if (!(child instanceof THREE.InstancedMesh)) {
    world.addMesh(child, 'concrete');
    continue;
  }
  const name = child.name.slice('prop_'.length);
  const candidate = candidates.has(name);
  if (!candidate && name !== 'tray') continue;
  // The audit owns these meshes. Cache connected components on the shared
  // prototype, while registering separate physics object IDs per instance.
  if (!geometry.hasAttribute('_solid'))
    geometry.setAttribute('_solid', new THREE.BufferAttribute(solidIds(geometry).ids, 1));
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  mesh.geometry = geometry;
  mesh.name = name;
  for (let i = 0; i < child.count; i++) {
    child.getMatrixAt(i, matrix);
    mesh.matrixWorld.copy(matrix);
    const object = world.addMesh(mesh, 'concrete');
    if (object >= 0 && candidate) props.push({ name, geometry, object, matrix: matrix.clone() });
  }
}
world.build();
const results: { name: string; position: number[]; gap: number | null }[] = [];
const overlap = 0.22; // also accept bases deliberately sunk into the ground
const search = Math.max(16, minGap);
for (const prop of props) {
  probe.geometry = prop.geometry;
  probe.matrixWorld.copy(prop.matrix);
  box.copy(prop.geometry.boundingBox!).applyMatrix4(prop.matrix);
  const nx = Math.min(20, Math.max(8, Math.ceil((box.max.x - box.min.x) / 0.04)));
  const nz = Math.min(20, Math.max(8, Math.ceil((box.max.z - box.min.z) / 0.04)));
  let sampled = false;
  let nearest = Infinity;
  for (let ix = 0; ix < nx && nearest >= minGap; ix++) {
    const x = THREE.MathUtils.lerp(box.min.x, box.max.x, (ix + 0.5) / nx);
    for (let iz = 0; iz < nz && nearest >= minGap; iz++) {
      const z = THREE.MathUtils.lerp(box.min.z, box.max.z, (iz + 0.5) / nz);
      ray.ray.origin.set(x, box.min.y - 0.01, z);
      buffer.length = 0;
      ray.intersectObject(probe, false, buffer);
      const underside = buffer[0];
      if (!underside) continue; // outside the actual mesh, not just its bounds
      sampled = true;
      // Allow a small overlap so planted clutter does not read as hovering.
      const y = underside.point.y + overlap;
      if (world.raycast(x, y, z, 0, -1, 0, search + overlap, LAYER.STATIC, hit, prop.object))
        nearest = Math.min(nearest, hit.t - overlap);
    }
  }
  if (!sampled || nearest < minGap) continue;
  const position = new THREE.Vector3().setFromMatrixPosition(prop.matrix).toArray();
  results.push({
    name: ids.get(key(prop.name, position)) ?? prop.name,
    position,
    gap: Number.isFinite(nearest) ? nearest : null,
  });
}
results.sort((a, b): number => (b.gap ?? Infinity) - (a.gap ?? Infinity));
if (values.json)
  console.log(JSON.stringify({ checked: props.length, minGap, candidates: results }, null, 2));
else {
  for (const { name, position, gap } of results)
    console.log(
      `${gap === null ? `>${search} m` : `${gap.toFixed(3)} m`}  ${name}  (${position.map((n): string => n.toFixed(2)).join(', ')})`
    );
  console.log(
    `${results.length} possible floats out of ${props.length} solid props (gap ≥ ${minGap} m)`
  );
}
assembler.dispose();
material.dispose();
if (values.check && results.length) process.exitCode = 1;
