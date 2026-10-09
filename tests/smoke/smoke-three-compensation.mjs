import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createArmMaterial } from '../../src/weapons/arm-asset.js';
import { createArmBlood } from '../../src/weapons/arm-blood.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(resolve(tmpdir(), 'cod-three-')), root = resolve(scratch, 'three');
const names = ['package.json', 'src/renderers/webgpu/nodes/WGSLNodeBuilder.js'];
const patches = [
  ['"import": "./build/three.module.js"', '"import": "./src/Three.js"'],
  ['"./webgpu": "./build/three.webgpu.js"', '"./webgpu": "./src/Three.WebGPU.js"'],
  ['"./tsl": "./build/three.tsl.js"', '"./tsl": "./src/Three.TSL.js"'],
  ["uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.id;",
    "uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.name;"],
];
const corrected = names.map(name => readFileSync(resolve(project, 'node_modules/three', name), 'utf8'));
for (const [i, text] of corrected.entries()) for (const [before, after] of patches.slice(i === 0 ? 0 : 3, i === 0 ? 3 : 4)) {
  assert(!text.includes(before), `missing TEMP Three compensation: ${names[i]}`);
  assert.equal(text.split(after).length - 1, 1, names[i]);
}
const originals = corrected.map(text => patches.reduce((s, [before, after]) => s.replaceAll(after, before), text));
assert.equal(THREE.REVISION, '187dev');
for (const [specifier, source] of [['three', 'Three.js'], ['three/webgpu', 'Three.WebGPU.js'], ['three/tsl', 'Three.TSL.js']]) {
  assert.equal(fileURLToPath(import.meta.resolve(specifier)), resolve(project, 'node_modules/three/src', source));
}
assert.equal((await import('three/webgpu')).BufferGeometry, THREE.BufferGeometry, 'one shared source core');
const physical = readFileSync(resolve(project, 'node_modules/three/src/nodes/functions/PhysicalLightingModel.js'), 'utf8');
assert(!physical.includes('f0: specularColorBlended, f90: 1, roughness'));
assert.equal(physical.split('f0: specularColorBlended, f90: specularF90, roughness').length - 1, 2, 'upstream fixes both Fresnel paths');
const reset = () => names.forEach((name, i) => {
  const p = resolve(root, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, originals[i]);
});
const run = () => spawnSync(process.execPath, [resolve(project, 'tools/compensate-three.mjs'), root], { encoding: 'utf8' });
const check = () => names.forEach((name, i) => assert.equal(readFileSync(resolve(root, name), 'utf8'), corrected[i]));
try {
  reset(); mkdirSync(resolve(scratch, '.vite'));
  assert.equal(run().status, 0);
  assert(!existsSync(resolve(scratch, '.vite')), 'invalidate pre-compensation Vite bundles');
  check(); mkdirSync(resolve(scratch, '.vite'));
  assert.equal(run().status, 0, 'installation is idempotent');
  assert(existsSync(resolve(scratch, '.vite')), 'no cache churn on a no-op');
  for (const existing of [0, 1]) {
    reset(); writeFileSync(resolve(root, names[existing]), corrected[existing]);
    assert.equal(run().status, 0, 'mixed original/corrected installation'); check();
  }
  reset(); writeFileSync(resolve(root, names[0]), originals[0].replace(...patches[0]));
  assert.equal(run().status, 0, 'partially switched exports are completed'); check();
  mkdirSync(resolve(scratch, '.vite'), { recursive: true });
  for (const fault of ['version', 'manifest-hash', 'export-duplicate', 'builder-hash', 'buffer-duplicate']) {
    reset();
    if (fault === 'version') writeFileSync(resolve(root, names[0]), originals[0].replace('"version": "0.186.0"', '"version": "0.187.0"'));
    else if (fault === 'manifest-hash') writeFileSync(resolve(root, names[0]), `${originals[0]}\n`);
    else if (fault === 'export-duplicate') writeFileSync(resolve(root, names[0]), originals[0].replace('"module":', `${patches[0][1]},\n  "module":`));
    else writeFileSync(resolve(root, names[1]), `${originals[1]}\n${fault === 'buffer-duplicate' ? patches[3][1] : ''}`);
    const untouched = names.map(name => readFileSync(resolve(root, name), 'utf8'));
    const result = run();
    assert.notEqual(result.status, 0, fault);
    assert(result.stderr.includes('TEMP Three compensation'), result.stderr);
    names.forEach((name, i) => assert.equal(readFileSync(resolve(root, name), 'utf8'), untouched[i], 'validate all files before writing any'));
    assert(existsSync(resolve(scratch, '.vite')), 'validation failure must preserve cache');
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }

// Use the actual exported specular contract, not a guessed constant in the adapter.
const glb = readFileSync(resolve(project, 'public/models/player/arms.glb'));
const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
const specular = json.materials.find(m => m.name === 'Olive_ripstop').extensions.KHR_materials_specular.specularFactor;
const source = new THREE.MeshPhysicalMaterial({ specularIntensity: specular, roughness: .88 });
source.map = new THREE.Texture(); source.map.colorSpace = THREE.SRGBColorSpace; source.map.channel = 1;
source.normalScale.set(.85, -.85);
const material = createArmMaterial(source);
assert(material.isMeshPhysicalNodeMaterial);
assert.equal(material.specularIntensity, specular);
assert.equal(material.ior, source.ior);
assert.deepEqual(material.specularColor, source.specularColor);
assert.deepEqual(material.color, source.color);
assert.deepEqual(material.normalScale, source.normalScale);
assert.equal(material.map, source.map, 'preserve owned texture and its UV/color-space metadata');
assert.notEqual(material.color, source.color, 'material values are not aliased');
const blood = createArmBlood(); blood.decorate(material); blood.setHealthFraction(.2);
assert.equal(material.specularIntensity, specular, 'blood does not overwrite authored specular');
assert(material.colorNode && material.roughnessNode);
const standardSource = new THREE.MeshStandardMaterial({ roughness: .7 });
const standard = createArmMaterial(standardSource);
assert(standard.isMeshStandardNodeMaterial && !standard.isMeshPhysicalNodeMaterial);
assert.equal(standard.roughness, .7);
blood.texture.dispose(); source.map.dispose(); source.dispose(); material.dispose(); standardSource.dispose(); standard.dispose();
console.log('TEMP Three compensation: source exports, exact/idempotent installation, upgrade/hash/partial guards and arm material preservation passed');
