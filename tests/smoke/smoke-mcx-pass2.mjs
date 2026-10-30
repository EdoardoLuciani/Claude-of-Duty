// Pass 2 changes draw/finish ownership, never the native triangle surfaces.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { inspectGLB, parseGLB } from '../../tools/lib/glb-fixture.mjs';

const directory = new URL('../../assets/weapons/mcx-virtus/', import.meta.url);
const native = inspectGLB(readFileSync(new URL('mcx-virtus.glb', directory)));
const records = [];
for (const node of native.json.nodes) {
  if (node.mesh === undefined) continue;
  for (const primitive of native.json.meshes[node.mesh].primitives) {
    const attributes = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'JOINTS_0', 'WEIGHTS_0']
      .filter((name) => primitive.attributes[name] !== undefined)
      .map((name) => {
        const index = primitive.attributes[name];
        const accessor = native.json.accessors[index];
        const view = native.json.bufferViews[accessor.bufferView];
        const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        // Blender uses UNSIGNED_BYTE joints, outside the shared fixture's
        // deliberately narrow scalar/float accessor reader.
        const values =
          accessor.componentType === 5121
            ? Float64Array.from(
                { length: accessor.count * 4 },
                (_, i) => native.bin[start + Math.floor(i / 4) * (view.byteStride ?? 4) + (i % 4)]
              )
            : native.accessor(index);
        return { name, values, width: values.length / native.json.accessors[index].count };
      });
    const indices = native.accessor(primitive.indices);
    for (let i = 0; i < indices.length; i += 3) {
      const corners = Array.from(indices.subarray(i, i + 3), (index) =>
        attributes
          .map(
            ({ name, values, width }) =>
              `${name}:${values.subarray(index * width, (index + 1) * width).join(',')}`
          )
          .join(';')
      );
      // Ignore index/primitive order, but retain winding, UV0 repeat, finish ID,
      // exact normals/positions and every mechanical binding/weight.
      const rotations = corners.map((_, start) =>
        [...corners.slice(start), ...corners.slice(0, start)].join('|')
      );
      records.push(`${node.name}:${rotations.sort()[0]}`);
    }
  }
}
const digest = createHash('sha256').update(records.sort().join('\n')).digest('hex');
assert.equal(
  digest,
  '6bdf4749891f9a4242770c652c7e41dc6c1cea1f170729181c7069c8447d784e',
  'all native oriented triangle/control/UV records match pre-pass2'
);
for (const filename of ['mcx-virtus.glb', 'mcx-virtus.runtime.glb']) {
  const gltf = await parseGLB(readFileSync(new URL(filename, directory)));
  const counts = { receiver_mesh: 0, magazine_mesh: 0, magazine_spare_mesh: 0, spent_case_mesh: 0 };
  let triangles = 0;
  gltf.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let owner = mesh;
    while (!(owner.name in counts) && owner.parent) owner = owner.parent;
    assert.ok(owner.name in counts, `known geometry owner: ${owner.name}`);
    counts[owner.name]++;
    triangles += mesh.geometry.index.count / 3;
    assert.ok(!Array.isArray(mesh.material), 'one real primitive, not hidden material groups');
    if (owner.name !== 'receiver_mesh') {
      assert.equal(
        mesh.isSkinnedMesh,
        undefined,
        'magazines/case retain independent rigid ownership'
      );
      assert.equal(
        mesh.material.name,
        'MCX | opaque finishes',
        'no rubber draw even on spent case'
      );
    }
  });
  assert.deepEqual(counts, {
    receiver_mesh: 2,
    magazine_mesh: 1,
    magazine_spare_mesh: 1,
    spent_case_mesh: 1,
  });
  assert.equal(
    triangles,
    filename.includes('.runtime.') ? 53162 : 59860,
    'unchanged native source and fixed-profile cooked triangle count'
  );
}
console.log(
  `MCX pass2: unchanged native surface digest ${digest}; 5 primitive instances, independent magazines/case, 53,162 runtime triangles`
);
