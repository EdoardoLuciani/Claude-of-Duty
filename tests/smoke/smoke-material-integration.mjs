import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MeshPhysicalMaterial, MeshStandardMaterial, Plane, Texture, Vector3, SkinnedMesh, RenderObjectRefreshType } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { texture } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createArmMaterial } from '../../src/weapons/arm-asset.js';
import { createWeaponMaterial } from '../../src/weapons/asset-material.js';
import { createSoldierNodeMaterial, SoldierMaterialsNode } from '../../src/ai/textures-tsl.js';
import { IndirectFill } from '../../src/render/indirect-webgpu.js';
import NodeMaterialObserver from 'three/src/materials/nodes/manager/NodeMaterialObserver.js';

const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'iridescenceMap',
  'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularColorMap',
  'specularIntensityMap', 'transmissionMap', 'thicknessMap', 'anisotropyMap'];
const factors = ['roughness', 'metalness', 'opacity', 'alphaTest', 'transparent', 'premultipliedAlpha',
  'side', 'depthWrite', 'depthTest', 'envMapIntensity', 'aoMapIntensity', 'emissiveIntensity',
  'ior', 'clearcoat', 'clearcoatRoughness', 'iridescence', 'iridescenceIOR', 'sheen',
  'sheenRoughness', 'specularIntensity', 'transmission', 'thickness', 'attenuationDistance',
  'dispersion', 'anisotropy', 'anisotropyRotation'];
const vectors = ['color', 'normalScale', 'emissive', 'clearcoatNormalScale', 'sheenColor',
  'specularColor', 'attenuationColor'];
function preserved(source, dest) {
  for (const key of factors) if (source[key] !== undefined) assert.equal(dest[key], source[key], key);
  for (const key of vectors) if (source[key] !== undefined) {
    assert.deepEqual(dest[key], source[key], key); assert.notEqual(dest[key], source[key], `${key}: value-owned`);
  }
  for (const key of maps) if (source[key] !== undefined) assert.equal(dest[key], source[key], `${key}: borrowed`);
  assert.deepEqual(dest.userData, source.userData); assert.notEqual(dest.userData, source.userData);
  assert.notEqual(dest.defines, source.defines, 'adapter must own mutable definitions');
  if (source.iridescenceThicknessRange) {
    assert.deepEqual(dest.iridescenceThicknessRange, source.iridescenceThicknessRange);
    assert.notEqual(dest.iridescenceThicknessRange, source.iridescenceThicknessRange);
  }
}
for (const Source of [MeshStandardMaterial, MeshPhysicalMaterial]) {
  const source = new Source({ roughness: .38, metalness: .7, opacity: .55,
    transparent: true, premultipliedAlpha: true, alphaTest: .03, depthWrite: false });
  if (source.isMeshPhysicalMaterial) Object.assign(source, { ior: 1.45, clearcoat: .25,
    iridescence: .65, iridescenceIOR: 1.35, iridescenceThicknessRange: [150, 520], sheen: .2,
    specularIntensity: .16, transmission: .8, thickness: .07, dispersion: .2, anisotropy: .3 });
  source.normalScale.set(.8, -.8); source.userData = { authored: { version: 3 } };
  source.clippingPlanes = [new Plane(new Vector3(1, 0, 0), 2)];
  for (const key of maps) if (key in source) source[key] = new Texture();
  source.defines = Object.freeze({ ...source.defines });
  let textureDisposals = 0;
  for (const key of maps) source[key]?.addEventListener('dispose', () => textureDisposals++);
  for (const make of [createWeaponMaterial, createArmMaterial]) {
    const dest = make(source); preserved(source, dest);
    assert(dest.isNodeMaterial && dest.isMeshStandardNodeMaterial);
    assert.equal(!!dest.isMeshPhysicalNodeMaterial, make === createWeaponMaterial || !!source.isMeshPhysicalMaterial);
    assert.deepEqual(dest.clippingPlanes, source.clippingPlanes);
    assert.notEqual(dest.clippingPlanes[0], source.clippingPlanes[0]);
    dest.defines.DESTINATION_ONLY = ''; assert(!('DESTINATION_ONLY' in source.defines));
    dest.dispose(); assert.equal(textureDisposals, 0, 'material disposal cannot dispose borrowed textures');
  }
  for (const key of maps) source[key]?.dispose(); source.dispose();
}

// Preserve the actual arm GLB factors/extensions; only browser image decode is stubbed.
const bytes = readFileSync(new URL('../../public/models/player/arms.glb', import.meta.url));
const loader = new GLTFLoader().register(() => ({ name: 'SMOKE_TEXTURE', loadTexture: () => Promise.resolve(new Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const sources = new Set(); gltf.scene.traverse(o => { if (o.isMesh) sources.add(o.material); });
assert.equal(sources.size, 5);
for (const source of sources) { const dest = createArmMaterial(source); preserved(source, dest); dest.dispose(); source.dispose(); }

const t = new Texture(), set = { albedo: t, normal: t, orm: t };
const materials = new SoldierMaterialsNode({ cloth: set }, {});
for (const source of [materials.get('cloth', { rim: .2 }), materials.get('cloth'), materials.glass()]) {
  const clone = source.clone();
  assert.equal(clone.constructor, source.constructor);
  assert.equal(clone.setupOutput, source.setupOutput, 'cloning preserves the class output hook');
  assert(!Object.hasOwn(source, 'setupOutput'), 'no per-instance method replacement');
  assert(source.rimNode?.isNode); assert.equal(clone.rimNode, source.rimNode);
  assert.equal(clone.customProgramCacheKey(), source.customProgramCacheKey(), 'clone reuses declarative graph identity');
  assert.equal(clone.colorNode, source.colorNode); assert.equal(clone.normalNode, source.normalNode);
  clone.dispose();
}
// Read-only pinned observer check: skinned cloth/goggles were already FULL.
for (const current of [materials.get('cloth'), materials.glass()]) {
  const legacy = new MeshStandardNodeMaterial().copy(current);
  assert.equal(!!legacy.rimNode, false, 'legacy output closure is not a declarative node');
  for (const material of [legacy, current, current.clone()]) {
    const object = new SkinnedMesh(undefined, material);
    const observer = new NodeMaterialObserver({ object, material, context: {} });
    assert.equal(observer.hasAnimation, true);
    assert.equal(observer.needsRefresh({ object }, {}), RenderObjectRefreshType.FULL,
      'declarative rim must not change actual skinned refresh classification');
    if (current === materials.glass()) assert.equal(observer.hasNode, material !== legacy);
    material.dispose();
  }
}
const full = createSoldierNodeMaterial(set), reduced = full.clone(), low = createSoldierNodeMaterial(set, { rim: .2 });
reduced.rimNode = low.rimNode;
assert.notEqual(full.customProgramCacheKey(), reduced.customProgramCacheKey(), 'rim graph must distinguish shader cache keys');

// Environment integration is render-owned registration, not cloned material state.
const worldCamera = {}, viewCamera = {}, fill = new IndirectFill({ viewCamera, peek: () => null });
const env = texture(t), original = full.setupEnvironment;
fill.patch(full); const hook = full.setupEnvironment, version = full.version;
fill.patch(full); assert.equal(full.setupEnvironment, hook); assert.equal(full.version, version);
for (const camera of [worldCamera, viewCamera]) {
  const node = full.setupEnvironment({ camera, environmentNode: env });
  assert.equal(node.envNode, env); assert.equal(node.fill, fill); assert.equal(node.view, camera === viewCamera);
}
const clone = full.clone(); assert.equal(clone.setupEnvironment, original);
fill.patch(clone); assert.equal(clone.setupEnvironment({ camera: viewCamera, environmentNode: env }).fill, fill);
const excluded = new MeshStandardNodeMaterial(); excluded.userData.owNoPatch = true;
const excludedHook = excluded.setupEnvironment; fill.patch(excluded); assert.equal(excluded.setupEnvironment, excludedHook);
for (const m of [full, reduced, low, clone, excluded]) m.dispose(); materials.dispose();
console.log('Material integration: public copy, actual arms, borrowed ownership, clone/cache-safe rim and camera-specific registration passed');
