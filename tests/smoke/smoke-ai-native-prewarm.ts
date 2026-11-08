import assert from 'node:assert/strict';

import * as THREE from 'three/webgpu';

import { AiSystem, type AiVariant } from '../../src/ai/index.ts';
import { VARIANTS } from '../../src/ai/soldier.ts';
import type { RenderSystem } from '../../src/render/index-webgpu.ts';
import { createTestContext } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';

const material = new THREE.MeshStandardNodeMaterial(),
  geometry = new THREE.BoxGeometry();
let disposed = 0,
  calls = 0;
geometry.addEventListener('dispose', (): number => disposed++);
material.addEventListener('dispose', (): number => disposed++);
const scene = new THREE.Scene(),
  existing = new THREE.Object3D();
scene.add(existing);
const render = fixture<RenderSystem>({
  renderer: fixture<RenderSystem['renderer']>({}),
  _graph: null,
  patchMaterials(): void {},
  async _warmGraph(): ReturnType<RenderSystem['_warmGraph']> {
    calls++;
    assert.equal(scene.children.length, 2);
    const holder = scene.children[1],
      skins = holder.children.filter((o): o is THREE.SkinnedMesh => o instanceof THREE.SkinnedMesh);
    assert.equal(skins.length, Object.keys(VARIANTS).length);
    for (const mesh of skins) {
      assert.equal(mesh.geometry, geometry, 'borrow actual model geometry');
      assert.equal(mesh.material, material, 'one material draws all surface groups');
      assert(mesh.castShadow && mesh.receiveShadow, 'compile actual receiving/casting variants');
      assert.equal(mesh.frustumCulled, false);
    }
    return { ms: 0, geometries: 0, frameUnchanged: true };
  },
});
const ai = new AiSystem();
ai.ctx = createTestContext({ scene, camera: new THREE.PerspectiveCamera(), providers: { render } });
ai.variant = (): AiVariant => fixture<AiVariant>({ geometry, material });
ai.rng = fixture<AiSystem['rng']>({
  fork: (): never => assert.fail('warmup must not create an Agent or consume RNG'),
});

const early = await ai.prewarmMaterials();
assert.equal(early.ok, false);
assert.equal(ai._prewarmed, null);
assert.equal(calls, 0, 'init must not falsely cache prewarm before native graph creation');
render._graph = fixture<NonNullable<RenderSystem['_graph']>>({});
const warm = await ai.prewarmMaterials();
assert.equal(warm.ok, true);
assert(warm.graphWarm);
assert.equal(warm.graphWarm.frameUnchanged, true);
assert.equal(
  warm.programs,
  null,
  'unavailable WebGL program count must not claim zero native work'
);
assert.equal(await ai.prewarmMaterials(), warm);
assert.equal(calls, 1);
assert.deepEqual(scene.children, [existing]);
assert.equal(disposed, 0);
ai._prewarmed = null;
render._warmGraph = async (): Promise<never> => {
  throw new Error('intentional native warm failure');
};
const failed = await ai.prewarmMaterials();
assert.equal(failed.ok, false);
assert(failed.error);
assert.match(failed.error, /intentional native warm failure/);
assert.deepEqual(scene.children, [existing]);
assert.equal(disposed, 0, 'borrowed assets survive failure');
geometry.dispose();
material.dispose();
console.log('AI native prewarm readiness, exact geometry ownership and failure cleanup passed');
