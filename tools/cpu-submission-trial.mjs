#!/usr/bin/env node
/** Serial offline prototypes; always restore sources AND the production build. */
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs, REPO_ROOT } from './lib/browser-harness.mjs';
import { cpuSubmissionTrial, pristineHashes } from './lib/cpu-submission-trials.mjs';

const args = parseArgs();
assert(
  Object.keys(args).every((key) =>
    [
      'trial',
      'out',
      'id',
      'w',
      'h',
      'cpu',
      'capture',
      'validate',
      'submission',
      'cpu-core',
      'gpu',
    ].includes(key)
  ),
  'unknown option'
);
assert(args.out, '--out required');
const out = resolve(String(args.out));
assert(out !== REPO_ROOT && !out.startsWith(REPO_ROOT + '/'), 'evidence must be outside checkout');
const id = String(args.id ?? args.trial ?? 'base');
assert(/^[a-zA-Z0-9-]+$/.test(id), 'invalid id');
const trial = String(args.trial ?? 'base');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const lock = readFileSync(resolve(REPO_ROOT, 'package-lock.json'));
assert.equal(
  JSON.parse(lock).packages['node_modules/three'].resolved.split('#')[1],
  '0978e2b62e53654ebe1a2c3032ebee0a4981c701'
);
const original = Object.fromEntries(
  Object.keys(pristineHashes).map((path) => [path, readFileSync(resolve(REPO_ROOT, path), 'utf8')])
);
for (const [path, content] of Object.entries(original))
  assert.equal(sha(content), pristineHashes[path], `source drift: ${path}; npm ci / restore first`);
const changed = cpuSubmissionTrial({ ...original }, trial);
const paths = Object.keys(changed).filter((path) => changed[path] !== original[path]);
mkdirSync(out, { recursive: true });
const command = (cmd, argv, log) => {
  const result = spawnSync(cmd, argv, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(resolve(out, log), (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.status, 0, `${cmd} failed: ${log}; ${result.error ?? ''}`);
};
const manifest = {
  trial,
  id,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
  width: Number(args.w ?? 1280),
  height: Number(args.h ?? 720),
  cpuSampled: !!args.cpu,
  submissionDiagnostic: !!args.submission,
  refreshDiagnostic: trial.includes('census'),
  gpuDiagnostic: !!args.gpu,
  cpuCore: args['cpu-core'] !== undefined ? Number(args['cpu-core']) : null,
  started: new Date().toISOString(),
  completed: null,
  lockSha256: sha(lock),
  toolSha256: Object.fromEntries(
    [
      'tools/profile.mjs',
      'tools/lib/refresh-census.mjs',
      'tools/lib/cpu-submission-trials.mjs',
    ].map((path) => [path, sha(readFileSync(resolve(REPO_ROOT, path)))])
  ),
  sources: Object.fromEntries(
    Object.keys(changed).map((path) => [
      path,
      { original: sha(original[path]), trial: sha(changed[path]) },
    ])
  ),
  note: 'Fresh production browser/server per run. Never run trials concurrently. After forced termination recover sources, npm ci, npm run build.',
};
const manifestPath = resolve(out, `${id}.manifest.json`);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
try {
  for (const path of paths) writeFileSync(resolve(REPO_ROOT, path), changed[path]);
  rmSync(resolve(REPO_ROOT, 'node_modules/.vite'), { recursive: true, force: true });
  command('npm', ['run', args.cpu ? 'build:sourcemap' : 'build'], `${id}.build.log`);
  manifest.buildHtmlSha256 = sha(readFileSync(resolve(REPO_ROOT, 'dist/index.html')));
  if (args.cpu) {
    const maps = resolve(out, `${id}-maps`);
    mkdirSync(maps, { recursive: true });
    for (const file of readdirSync(resolve(REPO_ROOT, 'dist/assets')).filter((f) =>
      f.endsWith('.map')
    ))
      copyFileSync(resolve(REPO_ROOT, 'dist/assets', file), resolve(maps, file));
  }
  command(
    process.execPath,
    [
      'tools/profile.mjs',
      '--port=5389',
      '--production=1',
      '--frames=1800',
      '--warmup=120',
      `--w=${manifest.width}`,
      `--h=${manifest.height}`,
      '--dpr=1',
      '--quality=high',
      `--out=${resolve(out, `${id}.json`)}`,
      ...(args.cpu ? [`--cpu-profile=${resolve(out, `${id}.cpuprofile`)}`] : []),
      ...(args.submission ? ['--submission=1'] : []),
      ...(trial.includes('census') ? ['--refresh=1'] : []),
      ...(args.gpu ? ['--gpu=1'] : []),
      ...(args['cpu-core'] !== undefined ? [`--cpu-core=${args['cpu-core']}`] : []),
    ],
    `${id}.log`
  );
  if (args.capture)
    command(
      process.execPath,
      [
        'tools/capture.mjs',
        '--port=5390',
        '--shot=hero',
        `--w=${manifest.width}`,
        `--h=${manifest.height}`,
        `--out=${resolve(out, `${id}.png`)}`,
      ],
      `${id}.capture.log`
    );
  if (args.validate) {
    const checks = [
      ['tests/e2e/buffer-names-e2e.mjs'],
      ['tests/e2e/submission-resources-e2e.mjs'],
      ...['low', 'high', 'ultra'].map((q) => ['tests/e2e/startup-e2e.mjs', `--quality=${q}`]),
      ['tools/render-regression.mjs'],
      ['tools/arm-material-audit.mjs', '--strict=1'],
    ];
    for (let i = 0; i < checks.length; i++)
      command(process.execPath, checks[i], `${id}.check-${i}.log`);
  }
  manifest.completed = new Date().toISOString();
} finally {
  for (const path of paths) writeFileSync(resolve(REPO_ROOT, path), original[path]);
  rmSync(resolve(REPO_ROOT, 'node_modules/.vite'), { recursive: true, force: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  command('npm', ['run', 'build'], `${id}.restore-build.log`);
}
console.log(JSON.stringify(manifest, null, 2));
