import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

const project = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(resolve(tmpdir(), 'cod-three-')),
  root = resolve(scratch, 'three');
const names = ['package.json', 'src/renderers/webgpu/nodes/WGSLNodeBuilder.js'];
const patches = [
  ['"import": "./build/three.module.js"', '"import": "./src/Three.js"'],
  ['"./webgpu": "./build/three.webgpu.js"', '"./webgpu": "./src/Three.WebGPU.js"'],
  ['"./tsl": "./build/three.tsl.js"', '"./tsl": "./src/Three.TSL.js"'],
];
const corrected = names.map((name) =>
  readFileSync(resolve(project, 'node_modules/three', name), 'utf8')
);
for (const [before, after] of patches) {
  assert(!corrected[0].includes(before), `missing TEMP Three compensation: ${names[0]}`);
  assert.equal(corrected[0].split(after).length - 1, 1, names[0]);
}
assert(
  !corrected[1].includes("uniformNode.name = name ? name : 'NodeBuffer_'"),
  'upstream owns builder-local buffer names'
);
assert(
  corrected[1].includes('getDeclarationName( node )'),
  'upstream checks buffer declaration collisions'
);
const originals = corrected.map((text) =>
  patches.reduce((s, [before, after]) => s.replaceAll(after, before), text)
);
assert.equal(THREE.REVISION, '187dev');
for (const [specifier, source] of [
  ['three', 'Three.js'],
  ['three/webgpu', 'Three.WebGPU.js'],
  ['three/tsl', 'Three.TSL.js'],
]) {
  assert.equal(
    fileURLToPath(import.meta.resolve(specifier)),
    resolve(project, 'node_modules/three/src', source)
  );
}
assert.equal(
  (await import('three/webgpu')).BufferGeometry,
  THREE.BufferGeometry,
  'one shared source core'
);
const physical = readFileSync(
  resolve(project, 'node_modules/three/src/nodes/functions/PhysicalLightingModel.js'),
  'utf8'
);
assert(!physical.includes('f0: specularColorBlended, f90: 1, roughness'));
assert.equal(
  physical.split('f0: specularColorBlended, f90: specularF90, roughness').length - 1,
  2,
  'upstream fixes both Fresnel paths'
);
const reset = () =>
  names.forEach((name, i) => {
    const p = resolve(root, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, originals[i]);
  });
const run = () =>
  spawnSync(process.execPath, [resolve(project, 'tools/compensate-three.mjs'), root], {
    encoding: 'utf8',
  });
const check = () =>
  names.forEach((name, i) => assert.equal(readFileSync(resolve(root, name), 'utf8'), corrected[i]));
try {
  reset();
  mkdirSync(resolve(scratch, '.vite'));
  assert.equal(run().status, 0);
  assert(!existsSync(resolve(scratch, '.vite')), 'invalidate pre-compensation Vite bundles');
  check();
  mkdirSync(resolve(scratch, '.vite'));
  assert.equal(run().status, 0, 'installation is idempotent');
  assert(existsSync(resolve(scratch, '.vite')), 'no cache churn on a no-op');
  for (const existing of [0, 1]) {
    reset();
    writeFileSync(resolve(root, names[existing]), corrected[existing]);
    assert.equal(run().status, 0, 'mixed original/corrected installation');
    check();
  }
  reset();
  writeFileSync(resolve(root, names[0]), originals[0].replace(...patches[0]));
  assert.equal(run().status, 0, 'partially switched exports are completed');
  check();
  mkdirSync(resolve(scratch, '.vite'), { recursive: true });
  for (const fault of [
    'version',
    'manifest-hash',
    'export-duplicate',
    'builder-hash',
    'buffer-regression',
  ]) {
    reset();
    if (fault === 'version')
      writeFileSync(
        resolve(root, names[0]),
        originals[0].replace('"version": "0.186.0"', '"version": "0.187.0"')
      );
    else if (fault === 'manifest-hash') writeFileSync(resolve(root, names[0]), `${originals[0]}\n`);
    else if (fault === 'export-duplicate')
      writeFileSync(
        resolve(root, names[0]),
        originals[0].replace('"module":', `${patches[0][1]},\n  "module":`)
      );
    else
      writeFileSync(
        resolve(root, names[1]),
        `${originals[1]}\n${fault === 'buffer-regression' ? "uniformNode.name = name ? name : 'NodeBuffer_' + uniformNode.id;" : ''}`
      );
    const untouched = names.map((name) => readFileSync(resolve(root, name), 'utf8'));
    const result = run();
    assert.notEqual(result.status, 0, fault);
    assert(result.stderr.includes('TEMP Three compensation'), result.stderr);
    names.forEach((name, i) =>
      assert.equal(
        readFileSync(resolve(root, name), 'utf8'),
        untouched[i],
        'validate all files before writing any'
      )
    );
    assert(existsSync(resolve(scratch, '.vite')), 'validation failure must preserve cache');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(
  'TEMP Three compensation: source exports, exact/idempotent installation and upgrade/hash/partial guards passed'
);
