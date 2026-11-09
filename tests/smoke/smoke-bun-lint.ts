import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { isRecord } from '../../src/core/guards.ts';

const root = resolve(import.meta.dirname, '../..');
const pkg: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert(isRecord(pkg) && isRecord(pkg.scripts) && typeof pkg.scripts.lint === 'string');
const directory = mkdtempSync(join(tmpdir(), 'cod-bun-lint-'));
try {
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ scripts: { lint: pkg.scripts.lint } })
  );
  const bin = join(directory, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  const log = join(directory, 'calls.jsonl');
  writeFileSync(
    join(bin, 'oxlint'),
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const typed = process.argv.includes('--type-aware');
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ bun: process.versions.bun, typed }) + '\\n');
if (typed && process.env.COD_LINT_FAIL_TYPED === '1') process.exit(7);
`,
    { mode: 0o755 }
  );
  writeFileSync(
    join(directory, 'node'),
    `#!${process.execPath}
throw new Error('lint must not execute Node');
`,
    { mode: 0o755 }
  );
  const env = {
    ...process.env,
    COD_LINT_FAIL_TYPED: '0',
    PATH: `${directory}${delimiter}${dirname(process.execPath)}`,
  };
  const result = spawnSync(process.execPath, ['run', 'lint'], {
    cwd: directory,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line): boolean => {
      const call: unknown = JSON.parse(line);
      assert(isRecord(call) && typeof call.bun === 'string' && typeof call.typed === 'boolean');
      return call.typed;
    });
  assert.deepEqual(
    calls,
    [false, true],
    'both passes use Bun despite the package binary Node shebang'
  );
  const failed = spawnSync(process.execPath, ['run', 'lint'], {
    cwd: directory,
    env: { ...env, COD_LINT_FAIL_TYPED: '1' },
    encoding: 'utf8',
  });
  assert.equal(failed.status, 7, 'type-aware lint failures propagate');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log('lint: both package-bin passes run under Bun and preserve failure exits');
