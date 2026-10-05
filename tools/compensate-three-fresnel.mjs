/** TEMPORARY COMPENSATION for Three.js 0.186.1's native direct-light F90 bug.
 * Remove this script + postinstall hook after validating the upstream release.
 * Exact-version/hash guarded; remove after upstream fixes pass the material oracle.
 * No runtime monkey patch or BRDF fork.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../node_modules/three/', import.meta.url)));
const review = 'TEMP Fresnel compensation: dependency changed; review/remove this compensation when upgrading Three.js';
assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version, '0.186.1', review);
const files = {
  'src/nodes/functions/PhysicalLightingModel.js': '32881464f60b1ce4aaa89dffe4343b77cc0c6a3e1a98fa3982e0cc77c9869a4b',
  'build/three.webgpu.js': '15cfce5c653541704fd9a3463c39d3e8b854bb6265ccd854d7cfe74090625cc6',
  'build/three.webgpu.nodes.js': '58c02e6398af620f8c9edb9022c3555180ded9b904f73995e285529c708d2166',
};
const before = 'f0: specularColorBlended, f90: 1, roughness';
const after = 'f0: specularColorBlended, f90: specularF90, roughness';
// Validate every target before writing any. Accept only pristine or fully
// compensated files; unrelated changes and partial compensation fail closed.
const changes = Object.entries(files).map(([name, hash]) => {
  const path = resolve(root, name), text = readFileSync(path, 'utf8');
  const oldCount = text.split(before).length - 1, newCount = text.split(after).length - 1;
  assert((oldCount === 2 && newCount === 0) || (oldCount === 0 && newCount === 2), `${review}: ${name}`);
  const original = text.replaceAll(after, before);
  assert.equal(createHash('sha256').update(original).digest('hex'), hash, `${review}: ${name}`);
  return { path, text: original.replaceAll(before, after), changed: oldCount === 2 };
});
for (const change of changes) if (change.changed) writeFileSync(change.path, change.text);
if (changes.some(c => c.changed)) rmSync(resolve(root, '../.vite'), { recursive: true, force: true });
console.log('[TEMP Fresnel compensation] Three.js 0.186.1: regular + retroreflective direct-light F90 corrected; remove after upstream upgrade.');
