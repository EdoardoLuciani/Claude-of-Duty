import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { format } from 'oxfmt';

const config = JSON.parse(readFileSync(new URL('../../.oxfmtrc.json', import.meta.url)));
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
assert.equal(config.sortPackageJson, true);
assert.equal(config.sortImports.partitionByComment, true);
assert.equal(config.sortImports.sortSideEffects, false);
assert(!config.ignorePatterns.includes('package.json'));
for (const script of ['format', 'format:check'])
  assert(packageJson.scripts[script].split(' ').includes('package.json'));

async function formatted(file, source) {
  const result = await format(file, source, config);
  assert.deepEqual(result.errors, []);
  assert.equal((await format(file, result.code, config)).code, result.code);
  return result.code;
}

const source = [
  "import { z } from './z';",
  "import './effect-z';",
  "import './effect-a';",
  "import { b } from './b';",
  "import { a } from './a';",
].join('\n');
// Bare imports retain their relative order, not a barrier for bound imports.
assert.equal(
  await formatted('sorting-probe.ts', source),
  [
    "import { a } from './a';",
    "import './effect-z';",
    "import './effect-a';",
    "import { b } from './b';",
    "import { z } from './z';",
    '',
  ].join('\n')
);
for (const boundary of ['// Intentional evaluation partition', 'const ready = true;']) {
  const result = await formatted(
    'sorting-probe.ts',
    `import { z } from './z';\n${boundary}\nimport { b } from './b';\nimport { a } from './a';`
  );
  assert(result.indexOf("from './z'") < result.indexOf(boundary));
  assert(result.indexOf(boundary) < result.indexOf("from './a'"));
  assert(result.indexOf("from './a'") < result.indexOf("from './b'"));
}

const manifest = {
  engines: { node: '24.x' },
  exports: {
    '.': { default: './default.js', node: { import: './node.mjs', default: './node.js' } },
    './z': './z.js',
    './a': './a.js',
  },
  imports: { '#z': { default: './z.js', node: './z-node.js' }, '#a': './a.js' },
  scripts: { test: 'vitest', build: 'vite build' },
  name: 'sorting-probe',
};
const sorted = JSON.parse(await formatted('package.json', JSON.stringify(manifest)));
assert.deepEqual(sorted, manifest);
assert.equal(Object.keys(sorted)[0], 'name');
for (const field of ['exports', 'imports', 'scripts'])
  assert.equal(JSON.stringify(sorted[field]), JSON.stringify(manifest[field]));
console.log('formatting: import boundaries and package conditional precedence preserved');
