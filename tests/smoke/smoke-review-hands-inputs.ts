import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { Transpiler } from 'bun';

import { GLTFPACK_FLAGS, GLTFPACK_VERSION, MODEL_COOKS } from '../../build/models.ts';

const transpiler = new Transpiler({ loader: 'ts', target: 'bun' });

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(join(root, 'tools/build-assets.ts'), 'utf8');
// Exercise the real cook-step/input-hash functions without launching asset builds.
const definitions = source.slice(
  source.indexOf('const SHARED_TOOLS'),
  source.indexOf('let blenderChecked')
);
assert(definitions.includes('function cookStep') && definitions.includes('function inputHash'));
function hash(id: string, changed = ''): string {
  const result: unknown = runInNewContext(
    `${transpiler.transformSync(definitions)}\ninputHash(cookStep(${JSON.stringify(id)}, []));`,
    {
      ROOT: root,
      RECIPE: 'test',
      MODEL_COOKS,
      GLTFPACK_FLAGS,
      GLTFPACK_VERSION,
      // Calibration and arm salts are independent of the tooling dependency under test.
      authoredJson: (): string[] => [],
      blender: (script: string): string[] => ['blender', script],
      bun: (...args: string[]): string[] => ['bun', ...args],
      createHash,
      join,
      relative,
      sep,
      statSync,
      readdirSync,
      canonicalText: (bytes: Buffer): Buffer => bytes,
      readFileSync: (path: string): Buffer => {
        const bytes = readFileSync(path);
        return path === join(root, changed)
          ? Buffer.concat([bytes, Buffer.from('\n# change')])
          : bytes;
      },
    }
  );
  assert(typeof result === 'string');
  return result;
}

const shared = 'tools/blender/review_hands.py';
for (const id of ['evolys', 'mpx']) {
  assert.notEqual(hash(id), hash(id, shared), `${id} rebuilds when shared review-arm code changes`);
  const actions = readFileSync(join(root, `tools/blender/${id}/actions.py`), 'utf8');
  assert.match(actions, /from review_hands import author_review_hands/);
}
assert.equal(hash('m4'), hash('m4', shared), 'M4 does not depend on this shared helper');
assert.equal(
  hash('mpx'),
  hash('mpx', 'tools/blender/evolys/actions.py'),
  'EVOLYS-local action changes no longer invalidate MPX'
);
assert.doesNotMatch(
  readFileSync(join(root, 'tools/blender/mpx/actions.py'), 'utf8'),
  /from evolys\b|import evolys\b/
);
console.log('review arms: shared helper invalidates its consumers, not unrelated weapon tooling');
