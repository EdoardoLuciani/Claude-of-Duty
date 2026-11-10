import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as THREE from 'three';

import { classifySpace } from '../../src/audio/ir.ts';
import { mergePrimitives } from '../../src/core/models.ts';
import { Rng } from '../../src/core/rng.ts';
import { bakeMasks } from '../../src/materials/masks.ts';
import { StaticWorld, bakeMesh } from '../../src/physics/bvh.ts';
import { Ragdoll } from '../../src/physics/ragdoll.ts';
import { solidIds } from '../../src/physics/solids.ts';
import { Noise1 } from '../../src/weapons/mathx.ts';

function triangle(): THREE.BufferGeometry {
  return new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
  );
}

const consumers = [
  (g: THREE.BufferGeometry): unknown => bakeMesh(new THREE.Mesh(g)),
  (g: THREE.BufferGeometry): unknown => solidIds(g),
  (g: THREE.BufferGeometry): unknown => bakeMasks(g),
  (g: THREE.BufferGeometry): unknown => mergePrimitives([new THREE.SkinnedMesh(g)]),
];

test('geometry consumers reject indices that cannot address a vertex', (): void => {
  for (const consume of consumers) {
    for (const index of [
      [0, 1, 3],
      [-1, 1, 2],
      [0, 0.5, 2],
      [0, 1, NaN],
      [0, 1, Infinity],
    ]) {
      const g = triangle().setIndex(new THREE.Float32BufferAttribute(index, 1));
      assert.throws((): unknown => consume(g), /vertex index/);
    }
    const partial = triangle().setIndex([0, 1]);
    assert.throws((): unknown => consume(partial), /complete triangles/);
    const shortPosition = triangle()
      .setIndex([0, 1, 2])
      .setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    assert.throws((): unknown => consume(shortPosition), /position/);
    const partialPosition = triangle()
      .setIndex([0, 1, 2])
      .setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8), 3));
    assert.throws((): unknown => consume(partialPosition), /position/);
    const fractionalStride = triangle()
      .setIndex([0, 1, 2])
      .setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(21), 3.5));
    assert.throws((): unknown => consume(fractionalStride), /position/);
  }
});

test('instance counts cannot read missing matrices or create phantom collision', (): void => {
  const mesh = new THREE.InstancedMesh(triangle(), new THREE.MeshBasicMaterial(), 1);
  mesh.count = 0;
  assert.equal(bakeMesh(mesh), null);
  const world = new StaticWorld();
  assert.equal(world.addMesh(mesh, 'concrete'), -1);
  assert.equal(world.objects.length, 0);
  for (const count of [-1, 0.5, 2, NaN, Infinity]) {
    mesh.count = count;
    assert.throws((): unknown => bakeMesh(mesh), /instance count/);
  }
  mesh.count = 1;
  assert.equal(bakeMesh(mesh)?.count, 1);
});

test('parallel geometry attributes must cover the vertices that will be read', (): void => {
  const g = triangle();
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1], 3));
  assert.throws((): unknown => bakeMasks(g), /normal/);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
  assert.throws((): unknown => bakeMasks(g), /normal/);
  g.setAttribute('_solid', new THREE.Float32BufferAttribute([0, 0], 1));
  assert.throws((): unknown => bakeMesh(new THREE.Mesh(g)), /_solid/);

  const a = triangle().setIndex([0, 1, 2]);
  const b = triangle().setIndex([0, 1, 2]);
  a.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  assert.throws(
    (): unknown => mergePrimitives([new THREE.SkinnedMesh(a), new THREE.SkinnedMesh(b)]),
    /attribute 'uv'/
  );
  b.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0], 2));
  assert.throws(
    (): unknown => mergePrimitives([new THREE.SkinnedMesh(a), new THREE.SkinnedMesh(b)]),
    /attribute 'uv'/
  );
});

test('primitive merging rejects absent or empty indexed inputs before allocating', (): void => {
  assert.throws((): unknown => mergePrimitives([]), /primitive/);
  assert.throws((): unknown => mergePrimitives([new THREE.SkinnedMesh(triangle())]), /index/);
  const empty = triangle().setIndex([]);
  assert.throws((): unknown => mergePrimitives([new THREE.SkinnedMesh(empty)]), /index/);
  const g = triangle().setIndex([0, 1, 2]);
  const merged = mergePrimitives([new THREE.SkinnedMesh(g), new THREE.SkinnedMesh(g)]);
  assert.deepEqual(Array.from(merged.getIndex()?.array ?? []), [0, 1, 2, 3, 4, 5]);
  assert.equal(merged.getAttribute('position').count, 6);

  // Each primitive references a different slice of the same accessor buffer.
  const shared = [9, 9, 9, 0, 0, 0, 1, 0, 0, 0, 1, 0, 8, 8, 8];
  const primitive = (index: number[]): THREE.SkinnedMesh =>
    new THREE.SkinnedMesh(
      new THREE.BufferGeometry()
        .setAttribute('position', new THREE.Float32BufferAttribute(shared, 3))
        .setIndex(index)
    );
  const sliced = mergePrimitives([primitive([1, 2, 3]), primitive([2, 3, 4])]);
  assert.deepEqual(Array.from(sliced.getIndex()?.array ?? []), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(sliced.getAttribute('position').array), [
    ...shared.slice(3, 12),
    ...shared.slice(6, 15),
  ]);
});

test('ragdoll parent indices are checked before conversion to Int32', (): void => {
  const head: [number, number, number] = [0, 0, 0];
  const tail: [number, number, number] = [0, 1, 0];
  const bone = { name: 'root', head, tail };
  for (const parent of [1, 0.5, NaN, Infinity, 2 ** 32]) {
    assert.throws((): Ragdoll => new Ragdoll(null, { bones: [{ ...bone, parent }] }), /parent/);
  }
  assert.equal(new Ragdoll(null, { bones: [bone] }).boneCount, 1);
});

test('noise table sizes must be positive integers without consuming RNG on rejection', (): void => {
  for (const size of [0, -1, 1.5, NaN, Infinity]) {
    const rng = new Rng(624);
    assert.throws((): Noise1 => new Noise1(rng, size), /noise.*size/i);
    assert.equal(rng.u32(), new Rng(624).u32());
  }
  const one = new Noise1(new Rng(624), 1);
  assert.equal(one.at(-3), one.at(4));

  const rng = new Rng(624);
  const noise = new Noise1(rng);
  const values = [
    ...noise.t,
    ...[-1025.3, -1, 0, 0.125, 511.9, 12345.67].flatMap((x): number[] => [
      noise.at(x),
      noise.fbm(x),
    ]),
    rng.u32(),
  ];
  assert.equal(
    createHash('sha256').update(JSON.stringify(values)).digest('hex'),
    'eff6b5f6bfbca5cd506cb5e50a491c8ef0f53f370706bbf0d424723c27058d82'
  );
});

test('space classification requires a horizon and fits its fixed median scratch', (): void => {
  for (const length of [0, 1, 18, 34]) {
    assert.throws((): unknown => classifySpace(new Float64Array(length), 40), /probe/);
  }
  const hits = Float64Array.from({ length: 17 }, (_, i): number => i + 1);
  assert.equal(classifySpace(hits, 40).median, 8.5);
  assert.deepEqual(classifySpace(new Float64Array(9).fill(40), 40), {
    tight: 0,
    room: 0,
    street: 0,
    tunnel: 0,
    open: 1,
    enclosure: 0,
    meanFree: 40,
    ceiling: 40,
    closeSides: 0,
    median: 40,
  });
});

test('valid mask bytes and RNG order retain their pre-audit characterization', (): void => {
  const g = new THREE.BoxGeometry();
  bakeMasks(g, { rng: new Rng(624) });
  const colors = g.getAttribute('color').array;
  assert.equal(
    createHash('sha256')
      .update(new Uint8Array(colors.buffer, colors.byteOffset, colors.byteLength))
      .digest('hex'),
    'a5a3c3ea80303a000f3a696dbaf6b19472b9fba042998aaa676c8745ee6b6fdf'
  );
});
