import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VARIANTS } from '../../src/ai/soldier.ts';
import { SOLDIER_STEP } from '../../tools/build-assets.ts';

const directory = mkdtempSync(join(tmpdir(), 'cod-asset-output-cache-'));
try {
  const output = join(directory, 'assets/soldiers');
  mkdirSync(output, { recursive: true });
  const expected = [
    'manifest.json',
    ...Object.keys(VARIANTS).flatMap((name): string[] => [`${name}.glb`, `${name}.json`]),
  ].map((file): string => join(output, file));
  const products = SOLDIER_STEP.outputs.map((file): string => join(directory, file));
  assert.deepEqual(products.slice().sort(), expected.sort(), 'recipe checks every staging input');

  const complete = (): boolean => products.every((file): boolean => existsSync(file));
  for (const file of products) writeFileSync(file, 'generated product');
  assert(complete(), 'a complete family is eligible for cache reuse without editable blends');
  for (const file of products) {
    rmSync(file);
    assert(!complete(), `${file} must invalidate the output-presence gate`);
    writeFileSync(file, 'regenerated product');
    assert(complete(), 'restoring the missing product permits reuse again');
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('asset cache: every soldier GLB, metadata file and manifest is required for reuse');
