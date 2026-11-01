import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { MODEL_COOKS } from '../../build/models.mjs';

const root = new URL('../../', import.meta.url);
for (const [id, model] of Object.entries(MODEL_COOKS)) {
  if (!model.directory.startsWith('assets/weapons/')) continue;
  const tools = new URL(`tools/blender/${id}/`, root);
  for (const file of ['build.py', 'check.py']) {
    assert(existsSync(new URL(file, tools)), `${id}: ${file} lives with its helpers`);
  }
  if (id === 'mcx') continue; // MCX has no separate hand-calibration stage.
  assert(existsSync(new URL('actions.py', tools)), `${id}: local sparse actions`);
  const calibration = new URL('hand-reference.mjs', tools);
  const source = readFileSync(calibration, 'utf8');
  // Check relocated module-relative imports/inputs/outputs without executing the
  // fitter: normal tests must never overwrite versioned hand calibration.
  const paths = [
    ...source.matchAll(/from '(\.[^']+)'/g),
    ...source.matchAll(/new URL\(\s*'(\.[^']+)',\s*import\.meta\.url\)/g),
  ];
  assert(paths.length >= 2, `${id}: runtime arm import and calibration product URL`);
  for (const [, relative] of paths) {
    assert(existsSync(new URL(relative, calibration)), `${id}: resolves ${relative}`);
  }
}

for (const file of [
  'docs/assets.md',
  'tools/blender/README.md',
  ...['m4', 'mcx', 'mpx', 'evolys'].map((id) => `tools/blender/${id}/README.md`),
]) {
  const url = new URL(file, root);
  const source = readFileSync(url, 'utf8');
  for (const [, relative] of source.matchAll(/\]\((\.[^\s)#]+)(?:#[^)]*)?\)/g)) {
    assert(existsSync(new URL(relative, url)), `${file}: resolves ${relative}`);
  }
}
console.log('Weapon authoring entry points, calibration paths and editing-map links resolve.');
