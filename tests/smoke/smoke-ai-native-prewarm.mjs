import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { AiSystem } from '../../src/ai/index.js';
import { VARIANTS } from '../../src/ai/soldier.js';

const material = new THREE.MeshStandardNodeMaterial(), geometry = new THREE.BoxGeometry();
let disposed = 0, calls = 0;
geometry.addEventListener('dispose', () => disposed++);
material.addEventListener('dispose', () => disposed++);
const scene = new THREE.Scene(), existing = new THREE.Object3D(); scene.add(existing);
const render = { renderer: {}, _graph: null, patchMaterials() {},
  async _warmGraph() {
    calls++;
    assert.equal(scene.children.length, 2);
    const holder = scene.children[1], skins = holder.children.filter(o => o.isSkinnedMesh);
    assert.equal(skins.length, Object.keys(VARIANTS).length);
    for (const mesh of skins) {
      assert.equal(mesh.geometry, geometry, 'borrow actual model geometry');
      assert.equal(mesh.material[0], material);
      assert(mesh.castShadow && mesh.receiveShadow, 'compile actual receiving/casting variants');
      assert.equal(mesh.frustumCulled, false);
    }
    return { frameUnchanged: true };
  },
};
const ai = Object.assign(Object.create(AiSystem.prototype), {
  ctx: { scene, camera: new THREE.PerspectiveCamera(), peek: () => render },
  materials: { get: () => material, glass: () => material },
  variant: () => ({ geometry, materials: [material] }),
  rng: { fork: () => assert.fail('warmup must not create an Agent or consume RNG') },
});
const early = await ai.prewarmMaterials();
assert.equal(early.ok, false); assert.equal(ai._prewarmed, null);
assert.equal(calls, 0, 'init must not falsely cache prewarm before native graph creation');
render._graph = {};
const warm = await ai.prewarmMaterials();
assert.equal(warm.ok, true); assert.equal(warm.graphWarm.frameUnchanged, true);
assert.equal(warm.programs, null, 'unavailable WebGL program count must not claim zero native work');
assert.equal(await ai.prewarmMaterials(), warm); assert.equal(calls, 1);
assert.deepEqual(scene.children, [existing]); assert.equal(disposed, 0);
ai._prewarmed = null;
render._warmGraph = async () => { throw new Error('intentional native warm failure'); };
const failed = await ai.prewarmMaterials();
assert.equal(failed.ok, false); assert.match(failed.error, /intentional native warm failure/);
assert.deepEqual(scene.children, [existing]); assert.equal(disposed, 0, 'borrowed assets survive failure');
geometry.dispose(); material.dispose();
console.log('AI native prewarm readiness, exact geometry ownership and failure cleanup passed');
