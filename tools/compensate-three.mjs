/** TEMPORARY Three.js dev packaging correction.
 * Use the pinned ESM source: Git's committed bundles can lag behind its source.
 * Exact-commit/hash guarded; review/remove on the next dependency upgrade.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../node_modules/three/', import.meta.url)));
const review = 'TEMP Three compensation: dependency changed; review/remove these corrections when upgrading Three.js';
const commit = '313f1f582b61af64f76ffaa4f23b3abb3ff298a1';
const project = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
assert.equal(project.dependencies.three, `github:mrdoob/three.js#${commit}`, review);
assert.equal(lock.packages['node_modules/three'].resolved, `git+ssh://git@github.com/mrdoob/three.js.git#${commit}`, review);
assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version, '0.186.0', review);
const files = {
  'package.json': {
    hash: '50e651ded364f9b1d0325bec5af816e2fd83679b9122ba58b4f009862bd4cd0c', patches: [
      { before: '"import": "./build/three.module.js"', after: '"import": "./src/Three.js"', count: 1 },
      { before: '"./webgpu": "./build/three.webgpu.js"', after: '"./webgpu": "./src/Three.WebGPU.js"', count: 1 },
      { before: '"./tsl": "./build/three.tsl.js"', after: '"./tsl": "./src/Three.TSL.js"', count: 1 },
    ] },
  // #34872 now owns stable buffer names and declaration collision handling.
  // Verify the reviewed source unchanged; only the package exports need editing.
  'src/renderers/webgpu/nodes/WGSLNodeBuilder.js': {
    hash: '7d8899df43f18fc6dc59504f15b9f3fe63f19b12410a36671816666b15fa0480', patches: [] },
};
// Validate every target before writing. Normalize only known changes, allowing
// idempotent installation and recovery from a previously interrupted install.
const changes = Object.entries(files).map(([name, { hash, patches }]) => {
  const path = resolve(root, name), text = readFileSync(path, 'utf8');
  let original = text;
  for (const { before, after, count } of patches) {
    const oldCount = text.split(before).length - 1, newCount = text.split(after).length - 1;
    assert((oldCount === count && newCount === 0) || (oldCount === 0 && newCount === count), `${review}: ${name}`);
    original = original.replaceAll(after, before);
  }
  assert.equal(createHash('sha256').update(original).digest('hex'), hash, `${review}: ${name}`);
  let corrected = original;
  for (const { before, after } of patches) corrected = corrected.replaceAll(before, after);
  return { path, text: corrected, changed: corrected !== text };
});
for (const change of changes) if (change.changed) writeFileSync(change.path, change.text);
if (changes.some(c => c.changed)) rmSync(resolve(root, '../.vite'), { recursive: true, force: true });
console.log(`[TEMP Three compensation] ${commit}: ESM source exports; upstream WGSL buffer names verified. Review/remove on upstream upgrade.`);
