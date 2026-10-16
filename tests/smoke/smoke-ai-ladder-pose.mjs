import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { Animator } from '../../src/ai/animator.ts';
import { RIG } from '../../src/ai/rig.ts';
import { ModelSystem } from '../../src/core/models.ts';

// Load the same exported GLBs/primitive merge and bind used by actual Agents.
// The exporter is cache/lock guarded; no duplicate geometry fixture is retained.
const root = new URL('../../', import.meta.url);
execFileSync(process.execPath, ['tools/export-models.mjs'], { cwd: root, stdio: 'pipe' });
const models = new ModelSystem();
models._soldiers = new Map();
models._loadGLB = async (path) => {
  const bytes = readFileSync(new URL('public/' + path, root));
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ''
  );
};
models._loadJSON = async (path) =>
  JSON.parse(readFileSync(new URL('public/' + path, root), 'utf8'));
for (const name of ['vanguard', 'irregular', 'breacher']) {
  const def = await models.getSoldier(name),
    { bones, skeleton, root: boneRoot } = RIG.createSkeleton();
  assert.deepEqual(def.boneNames, RIG.names);
  const group = new THREE.Group(),
    mesh = new THREE.SkinnedMesh(def.geometry);
  group.add(boneRoot, mesh);
  mesh.bind(skeleton);
  group.scale.setScalar(def.variant.scale);
  const animator = new Animator(RIG, bones, { scale: def.variant.scale, weapon: def.weapon });
  const g = def.geometry,
    pos = g.attributes.position,
    skin = g.attributes.skinIndex,
    weights = g.attributes.skinWeight;
  const hand = RIG.index('HandL'),
    vertices = [],
    point = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    for (let j = 0; j < 4; j++)
      if (skin.array[i * 4 + j] === hand && weights.array[i * 4 + j] > 0) {
        vertices.push(i);
        break;
      }
  }
  assert.ok(
    vertices.length > 500,
    'actual left glove/cuff/knuckle vertices, not just wrist origin'
  );
  let forward = -Infinity;
  for (const direction of ['up', 'down'])
    for (const phase of ['align', 'shaft', 'dismount']) {
      const centers = [];
      for (let k = 0; k <= 120; k++) {
        animator.setClimb(true, k * 0.005, direction, phase);
        animator.update(0, 0);
        group.updateMatrixWorld(true);
        const center = new THREE.Vector3();
        for (const i of vertices) {
          point.fromBufferAttribute(pos, i);
          mesh.applyBoneTransform(i, point);
          mesh.localToWorld(point);
          center.add(point);
          forward = Math.max(forward, point.z);
          // Bounded reach for the .46 m catch inset: keep room for warped plaster
          // and the surface conduit. Native W4/E5 evidence owns actual geometry clearance.
          assert.ok(
            point.z < 0.4,
            `${name}/${direction}/${phase}/${k}/${i}: glove reach ${point.z}`
          );
        }
        centers.push(center.multiplyScalar(1 / vertices.length));
        assert.ok(animator.muzzleDir.y < -0.95, 'unchanged downward rifle carry');
      }
      const low = centers.reduce((a, b) => (a.y < b.y ? a : b));
      const high = centers.reduce((a, b) => (a.y > b.y ? a : b));
      const shaft = phase === 'shaft';
      assert.ok(
        high.y - low.y > (shaft ? 0.2 : 0.04),
        'visible glove lowering, not a fixed overhead pose'
      );
      assert.ok(high.z - low.z > (shaft ? 0.025 : 0.008), 'lowered glove retracts before reaching');
      assert.ok(centers[0].distanceTo(centers[120]) < 1e-6, 'actual glove repeats without a seam');
      for (let k = 0; k < 120; k++) {
        const next = centers[(k + 1) % 120],
          prev = centers[(k + 119) % 120];
        assert.ok(
          next.distanceTo(centers[k]) < 0.018,
          'bounded glove speed through the entire cycle'
        );
        assert.ok(
          next.clone().add(prev).addScaledVector(centers[k], -2).length() < 0.0025,
          'smooth glove acceleration, including the periodic seam'
        );
      }
      if (shaft)
        assert.ok(
          centers.filter((p) => p.y < high.y - 0.15).length > 25,
          'release/reset lasts a readable part of the cycle'
        );
    }
  assert.ok(forward > 0.3, 'hand still reaches toward nearby rungs, not arbitrarily retracted');
  const frozen = bones.map((b) => b.matrix.elements.slice());
  animator.update(2, 1000);
  assert.deepEqual(
    bones.map((b) => b.matrix.elements.slice()),
    frozen,
    'unchanged real travel freezes actual mesh pose'
  );
  skeleton.dispose();
  g.dispose();
  console.log(
    `  ok  ${name}: ${vertices.length} actual left-hand vertices, 5mm full-cycle samples, max reach ${forward.toFixed(6)}m`
  );
}
