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
const names = ['src/nodes/functions/PhysicalLightingModel.js', 'build/three.webgpu.js', 'build/three.webgpu.nodes.js',
  'src/renderers/webgpu/nodes/WGSLNodeBuilder.js'];
const before = 'f0: specularColorBlended, f90: 1, roughness';
const after = 'f0: specularColorBlended, f90: specularF90, roughness';
const bufferBefore = "uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.id;";
const bufferAfter = "uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.name;";
const originals = names.map((name, i) => {
  const installed = readFileSync(resolve(project, 'node_modules/three', name), 'utf8');
  assert(!installed.includes(before) && !installed.includes(bufferBefore), `missing TEMP Three compensation: ${name}`);
  assert.equal(installed.split(after).length - 1, i === 3 ? 0 : 2, name);
  assert.equal(installed.split(bufferAfter).length - 1, i === 0 ? 0 : 1, name);
  return installed.replaceAll(after, before).replaceAll(bufferAfter, bufferBefore);
});
const reset = () => {
  names.forEach((name, i) => { const p = resolve(root, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, originals[i]); });
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ version: '0.186.1' }));
};
const run = () => spawnSync(process.execPath, [resolve(project, 'tools/compensate-three.mjs'), root], { encoding: 'utf8' });
try {
  reset(); mkdirSync(resolve(scratch, '.vite'));
  assert.equal(run().status, 0);
  assert(!existsSync(resolve(scratch, '.vite')), 'invalidate pre-compensation Vite bundles');
  const check = () => names.forEach((name, i) => assert.equal(readFileSync(resolve(root, name), 'utf8'),
    originals[i].replaceAll(before, after).replaceAll(bufferBefore, bufferAfter)));
  check();
  mkdirSync(resolve(scratch, '.vite'));
  assert.equal(run().status, 0, 'installation is idempotent');
  assert(existsSync(resolve(scratch, '.vite')), 'no cache churn on a no-op');
  // Upgrade a checkout that already has only the previous Fresnel correction.
  reset();
  names.forEach((name, i) => writeFileSync(resolve(root, name), originals[i].replaceAll(before, after)));
  assert.equal(run().status, 0); check();
  mkdirSync(resolve(scratch, '.vite'));
  for (const fault of ['version', 'modified', 'partial', 'builder-hash', 'buffer-duplicate']) {
    reset();
    if (fault === 'version') writeFileSync(resolve(root, 'package.json'), '{"version":"0.186.2"}');
    else if (fault === 'builder-hash') writeFileSync(resolve(root, names[3]), `${originals[3]}\n`);
    else if (fault === 'buffer-duplicate') writeFileSync(resolve(root, names[3]), `${originals[3]}\n${bufferAfter}`);
    else writeFileSync(resolve(root, names[2]), fault === 'modified' ? `${originals[2]}\n` : originals[2].replace(before, after));
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
console.log('TEMP Three compensation: exact/idempotent installation, upgrade/hash/partial guards and arm material preservation passed');
