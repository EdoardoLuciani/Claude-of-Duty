import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import * as WebGPU from 'three/webgpu';

const project = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => readFileSync(resolve(project, name), 'utf8');
const manifest = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const installed = JSON.parse(read('node_modules/three/package.json'));
assert.equal(manifest.dependencies.three, '0.187.0');
assert.equal(manifest.devDependencies['@types/three'], '0.187.0');
assert.equal(installed.version, '0.187.0');
assert.equal(THREE.REVISION, '187');
assert.equal(WebGPU.REVISION, THREE.REVISION);
for (const name of ['three', '@types/three']) {
  const entry = lock.packages[`node_modules/${name}`];
  assert.equal(entry.version, '0.187.0');
  assert(entry.resolved.startsWith('https://registry.npmjs.org/'), 'published release, not Git');
  assert(entry.integrity.startsWith('sha512-'), 'lockfile verifies the published package');
}
for (const [specifier, bundle] of [
  ['three', 'three.module.js'],
  ['three/webgpu', 'three.webgpu.js'],
  ['three/tsl', 'three.tsl.js'],
]) {
  assert.equal(
    fileURLToPath(import.meta.resolve(specifier)),
    resolve(project, 'node_modules/three/build', bundle),
    'use unmodified release exports, not the retired dev packaging correction'
  );
}
assert.equal(WebGPU.BufferGeometry, THREE.BufferGeometry, 'one shared release core');
assert(new WebGPU.Mesh() instanceof THREE.Mesh, 'runtime guards share class identity');

// Keep the upstream correctness guards; check the shipped WebGPU bundle as
// well as source now that the stale Git bundles no longer need bypassing.
const bundle = read('node_modules/three/build/three.webgpu.js');
for (const builder of [
  read('node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js'),
  bundle,
]) {
  assert(
    !builder.includes("uniformNode.name = name ? name : 'NodeBuffer_'"),
    'upstream owns builder-local buffer names'
  );
  assert(builder.includes('getDeclarationName( node )'), 'buffer declaration collision checks');
}
for (const physical of [
  read('node_modules/three/src/nodes/functions/PhysicalLightingModel.js'),
  bundle,
]) {
  assert(!physical.includes('f0: specularColorBlended, f90: 1, roughness'));
  assert.equal(
    physical.split('f0: specularColorBlended, f90: specularF90, roughness').length - 1,
    2,
    'upstream fixes both Fresnel paths'
  );
}
console.log(
  'Three.js r187: published pins, unmodified bundles, shared core and upstream fixes passed'
);
