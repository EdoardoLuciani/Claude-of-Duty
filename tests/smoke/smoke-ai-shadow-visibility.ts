import assert from 'node:assert/strict';

import {
  BufferGeometry,
  Frustum,
  MeshBasicMaterial,
  SkinnedMesh,
  Matrix4,
  PerspectiveCamera,
  Sphere,
  Vector3,
} from 'three';

import { AiSystem } from '../../src/ai/index.ts';
import type { SkySystem } from '../../src/sky/index.ts';
import { makeAgent } from '../lib/agent-fixture.ts';
import { createTestContext } from '../lib/context.ts';
import * as complete from '../lib/fixture-targets.ts';
import { fixture } from '../lib/fixture.ts';

// Record the original relevance sweep, including its finite floor/cap and sample order.
function originalSweep(sphere: Sphere, sun: Vector3): number[][] {
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
        const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
        mesh.position.copy(position);
        mesh.updateMatrixWorld(true);
        const actor = makeAgent({ alive: true, position, height, mesh });
        const calls: number[][] = [];
        const ai = new AiSystem();
        Object.assign(
          ai,
          fixture<Partial<AiSystem>>(
            {
              ctx: createTestContext({
                camera: new PerspectiveCamera(),
                providers: {
                  sky: fixture<SkySystem>({ keyDirection: sun }, new complete.SkySystem()),
                },
              }),
              _sky: null,
              agents: [actor],
              _phys: fixture<NonNullable<AiSystem['_phys']>>(
                {
                  staticWorld: fixture<NonNullable<AiSystem['_phys']>['staticWorld']>(
                    { dirty: false },
                    new complete.StaticWorld()
                  ),
                },
                new complete.PhysicsSystem()
              ),
              _mvp: new Matrix4(),
              _sphere: new Sphere(),
              _sweep: new Sphere(),
              _sun: new Vector3(),
              _lodStats: { irrelevant: 0 },
              stats: {
                get agents(): never {
                  return complete.unavailable('agents');
                },
                get alive(): never {
                  return complete.unavailable('alive');
                },
                get navMs(): never {
                  return complete.unavailable('navMs');
                },
                get coverPts(): never {
                  return complete.unavailable('coverPts');
                },
                get walkable(): never {
                  return complete.unavailable('walkable');
                },
                get friendlyHolds(): never {
                  return complete.unavailable('friendlyHolds');
                },
                get grenadeHolds(): never {
                  return complete.unavailable('grenadeHolds');
                },
                get pathsDeferred(): never {
                  return complete.unavailable('pathsDeferred');
                },
              },
              _frustum: fixture<Frustum>(
                {
                  setFromProjectionMatrix(): Frustum {
                    return new complete.THREE.Frustum();
                  },
                  intersectsSphere(s: Sphere): boolean {
                    calls.push([...s.center.toArray(), s.radius]);
                    return calls.length - 1 === hit;
                  },
                },
                new complete.THREE.Frustum()
              ),
            },
            {}
          )
        );
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
