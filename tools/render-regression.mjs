#!/usr/bin/env node
// One sequential entry point; each suite retains its independent oracles/negatives.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/browser-harness.mjs';

const args = parseArgs();
const suites = {
  composition: 'webgpu-correctness-check.mjs',
  lifetime: 'webgpu-review-check.mjs',
  effects: 'webgpu-final-check.mjs',
  projection: 'webgpu-projection-check.mjs',
  uniforms: 'webgpu-uniform-check.mjs',
};
const selected = args.suite ?? 'all';
assert(selected === 'all' || Object.hasOwn(suites, selected), 'known render suite');
const negative = args.negative ?? args.control;
assert(selected !== 'all' || !negative, 'choose a suite for a negative control');
const forwarded = process.argv.slice(2).filter((arg) => !/^--(suite|negative|control)=/.test(arg));
for (const [name, script] of Object.entries(suites)) {
  if (selected !== 'all' && selected !== name) continue;
  console.log('Render regression:', name);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL(script, import.meta.url)),
      ...forwarded,
      ...(negative && name !== 'lifetime'
        ? [`--${name === 'uniforms' ? 'control' : 'negative'}=${negative}`]
        : []),
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(name === 'lifetime' && negative ? { REVIEW_NEGATIVE: String(negative) } : {}),
      },
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
