import assert from 'node:assert/strict';

import { bool, float, vec4 } from 'three/tsl';
import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  Group,
  Layers,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three/webgpu';

import { SoldierShadowCaster } from '../../src/ai/shadow-caster.ts';
import { SHADOW_ONLY_LAYER } from '../../src/core/layers.ts';

const geometry = new BoxGeometry();
const count = geometry.attributes.position.count;
geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
const weights = new Float32Array(count * 4);
for (let i = 0; i < count; i++) weights[i * 4] = 1;
geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
const material = new MeshStandardNodeMaterial();
const materials = geometry.groups.map(() => material);
const source = new SkinnedMesh(geometry, materials);
const bone = new Bone(),
  skeleton = new Skeleton([bone]),
  parent = new Group();
source.add(bone);
parent.add(source);
source.castShadow = source.receiveShadow = true;
source.bind(skeleton);
const before = source.onBeforeRender,
  after = source.onAfterShadow;
let caster = new SoldierShadowCaster(source),
  proxy = caster.mesh;
assert.equal(source.castShadow, false);
assert.equal(proxy.castShadow, true);
assert.equal(proxy.geometry, geometry);
assert.equal(proxy.material, material);
assert.equal(proxy.skeleton, skeleton);
assert.equal(proxy.parent, source);
assert.equal(proxy.userData.owNoPrepass, true);
assert.equal(proxy.receiveShadow, false);
assert.equal(source.onBeforeRender, before);
assert.equal(source.onAfterShadow, after);
const layers = new Layers();
assert.equal(proxy.layers.test(layers), false, 'absent from beauty');
layers.set(1);
assert.equal(proxy.layers.test(layers), false, 'absent from prepass');
layers.set(SHADOW_ONLY_LAYER);
assert.equal(proxy.layers.test(layers), true);

for (const angle of [0, 0.4, 1.2]) {
  parent.position.set(3, 2, -4);
  parent.rotation.y = angle;
  parent.scale.setScalar(1.025);
  source.position.set(0.1, 0, -0.2);
  bone.rotation.z = angle;
  caster.update(true);
  parent.updateMatrixWorld(true);
  assert(proxy.matrixWorld.equals(source.matrixWorld), 'identity child follows source exactly');
  assert(proxy.bindMatrixInverse.equals(source.bindMatrixInverse));
  assert(proxy.bindMatrix.equals(source.bindMatrix));
  for (const vertex of [0, 4, 7]) {
    assert(
      source
        .getVertexPosition(vertex, new Vector3())
        .equals(proxy.getVertexPosition(vertex, new Vector3()))
    );
  }
}

function fallback(change, restore) {
  const version = material.version;
  change();
  caster.update(true);
  assert.equal(source.castShadow, true, 'native source is the fallback');
  assert.equal(proxy.visible, false);
  assert.equal(proxy.castShadow, false);
  restore();
  caster.update(true);
  if (material.version !== version) {
    assert.equal(proxy.castShadow, false, 'version invalidation stays conservative');
    caster.dispose();
    caster = new SoldierShadowCaster(source);
    proxy = caster.mesh;
  }
  assert.equal(proxy.castShadow, true);
}
fallback(
  () => (material.transparent = true),
  () => (material.transparent = false)
);
fallback(
  () => (material.visible = false),
  () => (material.visible = true)
);
fallback(
  () => (material.alphaTest = 0.5),
  () => (material.alphaTest = 0)
);
fallback(
  () => (material.opacity = 0.5),
  () => (material.opacity = 1)
);
fallback(
  () => (material.maskShadowNode = bool(false)),
  () => (material.maskShadowNode = null)
);
fallback(
  () => (material.depthNode = float(0)),
  () => (material.depthNode = null)
);
fallback(
  () => (material.colorNode = vec4(1, 0, 0, 0)),
  () => (material.colorNode = null)
);
fallback(
  () => (source.onBeforeShadow = () => {}),
  () => (source.onBeforeShadow = source.constructor.prototype.onBeforeShadow)
);
fallback(
  () => geometry.groups[1].start++,
  () => geometry.groups[1].start--
);
fallback(
  () => (geometry.drawRange.start = 1),
  () => (geometry.drawRange.start = 0)
);
caster.update(false);
assert.equal(source.castShadow, false);
assert.equal(proxy.visible, false);
caster.update(true);
source.visible = false;
let visited = false;
source.traverseVisible((object) => {
  if (object === proxy) visited = true;
});
assert.equal(visited, false, 'hidden parents hide the caster');
source.visible = true;
material.needsUpdate = true;
caster.update(true);
assert.equal(source.castShadow, true, 'material version changes invalidate the authored contract');
assert.equal(proxy.visible, false);

let disposed = 0;
geometry.addEventListener('dispose', () => disposed++);
material.addEventListener('dispose', () => disposed++);
caster.dispose();
assert.equal(proxy.parent, null);
assert.equal(source.castShadow, true);
assert.equal(disposed, 0, 'borrowed geometry and materials survive caster disposal');
assert.equal(skeleton.bones[0], bone);

const physical = new MeshPhysicalNodeMaterial({ transmission: 1 });
source.material = materials.map(() => physical);
const transmitting = new SoldierShadowCaster(source);
assert.equal(source.castShadow, true);
assert.equal(transmitting.mesh.visible, false);
transmitting.dispose();
physical.dispose();
skeleton.dispose();
geometry.dispose();
material.dispose();
console.log('Soldier shadow-only skin sharing, layers, transforms, fallbacks and ownership passed');
