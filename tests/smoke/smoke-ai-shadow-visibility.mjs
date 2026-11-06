import assert from 'node:assert/strict';

import { BufferGeometry, Matrix4, Mesh, PerspectiveCamera, Sphere, Vector3 } from 'three';

import { AiSystem } from '../../src/ai/index.ts';

// Record the original relevance sweep, including its finite floor/cap and sample order.
function originalSweep(sphere, sun) {
  const probes = [[...sphere.center.toArray(), sphere.radius]];
  const max = Math.min(320, (sphere.center.y - -6) / Math.max(0.06, sun.y));
  const step = Math.max(2, sphere.radius * 0.9);
  for (let t = step; t <= max; t += step) {
    const center = sphere.center.clone().addScaledVector(sun, -t);
    probes.push([...center.toArray(), sphere.radius]);
  }
  return probes;
}

let cases = 0;
for (const height of [0.2, 1, 1.78]) {
  for (const y of [-12, 0, 20, 400]) {
    for (const direction of [
      [0, 1, 0],
      [1, 0.01, 0],
      [-1, 0.5, 1],
    ]) {
      const sun = new Vector3(...direction).normalize();
      const position = new Vector3(3, y, -2);
      const sphere = new Sphere(position.clone().add(new Vector3(0, height / 2, 0)), height + 4);
      const expected = originalSweep(sphere, sun.clone().normalize());
      for (const hit of [-1, 0, Math.min(1, expected.length - 1), expected.length - 1]) {
        const geometry = new BufferGeometry();
        geometry.boundingSphere = new Sphere(new Vector3(0, height / 2, 0), height);
        const mesh = new Mesh(geometry);
        mesh.position.copy(position);
        mesh.updateMatrixWorld(true);
        const actor = { alive: true, position, height, mesh };
        const calls = [];
        const ai = Object.assign(new AiSystem(), {
          ctx: {
            camera: new PerspectiveCamera(),
            peek: () => ({ keyDirection: sun }),
          },
          agents: [actor],
          _phys: { staticWorld: { dirty: false } },
          _mvp: new Matrix4(),
          _sphere: new Sphere(),
          _sweep: new Sphere(),
          _sun: new Vector3(),
          _lodStats: {},
          stats: {},
          _frustum: {
            setFromProjectionMatrix() {},
            intersectsSphere(s) {
              calls.push([...s.center.toArray(), s.radius]);
              return calls.length - 1 === hit;
            },
          },
        });
        const trace = hit < 0 ? expected : expected.slice(0, hit + 1);
        ai._updateRelevance(ai.ctx);
        assert.deepEqual(calls, trace, 'relevance preserves the original query order/geometry');
        assert.equal(actor.lodIrrelevant, hit < 0);
        assert.equal(mesh.castShadow, hit >= 0);
        assert.equal(ai.stats.lodIrrelevant, hit < 0 ? 1 : 0);
        calls.length = 0;
        assert.equal(ai.canRollback(actor, position), hit < 0);
        assert.deepEqual(
          calls,
          hit < 0 ? [...expected, ...expected] : trace,
          'rollback checks both endpoints with identical conservative visibility probes'
        );
        geometry.dispose();
        mesh.material.dispose();
        cases++;
      }
    }
  }
}
console.log(`AI shadow visibility: ${cases} relevance/rollback trace comparisons`);
