import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { worldSourceHash } from '../../tools/worldgen/source-hash.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'cod-world-source-hash-'));
try {
  for (const path of [
    'package.json',
    'src',
    'tools/worldgen',
    'tools/lib',
    'tools/export-world.ts',
  ])
    cpSync(join(root, path), join(directory, path), { recursive: true });
  // Direct, `#worldgen` alias, transitive and URL-loaded worker inputs.
  for (const file of [
    'src/core/config.ts',
    'tools/lib/export-glb.ts',
    'src/core/three-guards.ts',
    'src/ai/tuning.ts',
    'src/core/math.ts',
    'src/ai/attachment-worker.ts',
  ]) {
    const before = worldSourceHash(directory);
    appendFileSync(join(directory, file), '\n');
    assert.notEqual(worldSourceHash(directory), before, `${file} invalidates the world bake`);
  }
  const before = worldSourceHash(directory);
  appendFileSync(join(directory, 'src/main.ts'), '\n');
  assert.equal(worldSourceHash(directory), before, 'unrelated runtime code keeps the bake');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('world source hash: every imported world input invalidates cached products');
