import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

// Test the real build configuration without regenerating unrelated model/world assets.
process.env.VITEST = 'true';
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = '/nested-model-test/';
const { output } = await build({
  root,
  base,
  publicDir: false,
  logLevel: 'silent',
  build: {
    write: false,
    rolldownOptions: {
      input: fileURLToPath(new URL('../../src/weapons/p320.ts', import.meta.url)),
      preserveEntrySignatures: 'strict',
    },
  },
});
const code = output
  .filter((file) => file.type === 'chunk')
  .map((file) => file.code)
  .join('\n');
for (const extension of ['js', 'wasm']) {
  const assets = output.filter(
    (file) =>
      file.type === 'asset' &&
      file.fileName.includes('basis_transcoder-') &&
      file.fileName.endsWith(`.${extension}`)
  );
  assert.equal(assets.length, 1, `one npm-provided Basis ${extension} asset`);
  const [asset] = assets;
  assert.deepEqual(
    Buffer.from(asset.source),
    readFileSync(
      new URL(
        `../../node_modules/three/examples/jsm/libs/basis/basis_transcoder.${extension}`,
        import.meta.url
      )
    ),
    'emit the bytes matching the pinned Three loader, not a checked-in duplicate'
  );
  assert(code.includes(base + asset.fileName), 'loader URLs honor the deployment base path');
}
assert(!code.includes('vendor/basis-'), 'no legacy vendored decoder URLs');
const license = output.find((file) => file.type === 'asset' && file.fileName === 'LICENSE.txt');
assert(license, 'distribute third-party notices in the existing LICENSE.txt');
assert.equal(license.source, readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8'));
assert.match(license.source, /Basis Universal transcoder[\s\S]*Apache License/);
console.log(
  'P320 transcoder: Vite emits npm-provided JS/WASM with local base-aware URLs and an Apache notice'
);
