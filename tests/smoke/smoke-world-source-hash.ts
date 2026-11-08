import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { worldSourceHash } from '../../tools/worldgen/source-hash.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'cod-world-source-hash-'));
try {
  for (const path of ['src', 'tools/worldgen', 'tools/export-world.ts', 'tools/lib/export-glb.ts'])
    cpSync(join(root, path), join(directory, path), { recursive: true });
  const before = worldSourceHash(directory);
  appendFileSync(join(directory, 'src/core/config.ts'), '\n');
  assert.notEqual(
    worldSourceHash(directory),
    before,
    'core config changes invalidate the world bake'
  );
  const afterConfig = worldSourceHash(directory);
  appendFileSync(join(directory, 'tools/lib/export-glb.ts'), '\n');
  assert.notEqual(
    worldSourceHash(directory),
    afterConfig,
    'the shared GLB exporter invalidates the world bake'
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  'world source hash: core config and shared exporter changes invalidate cached products'
);
