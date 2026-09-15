/**
 * Model export cache: hashed authoring inputs must invalidate, and a failed
 * rebuild must not leave a stamp that accepts mixed outputs.
 *
 *   node tools/smoke-export-cache.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const partsPath = join(root, 'src/weapons/parts.js');
const rifleSrcPath = join(root, 'src/weapons/models/rifle.js');
const smgSrcPath = join(root, 'src/weapons/models/smg.js');
const rifleGlbPath = join(root, 'public/models/weapons/rifle.glb');
const stampPath = join(root, 'node_modules/.cache/claude-of-duty-models.hash');
const marker = '\n/* smoke-export-cache */\n';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);

const exportModels = () =>
  spawnSync(process.execPath, [join(root, 'tools/export-models.mjs')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
  });

const partsOrig = readFileSync(partsPath, 'utf8');
const rifleOrig = readFileSync(rifleSrcPath, 'utf8');
const smgOrig = readFileSync(smgSrcPath, 'utf8');

try {
  let run = exportModels();
  check('warm export succeeds', run.status === 0, run.stderr);
  check('warm wrote a stamp', existsSync(stampPath));
  const warmRifle = digest(rifleGlbPath);

  run = exportModels();
  check('unchanged tree is a cache hit', run.status === 0 && /up to date/.test(run.stdout), run.stdout);

  writeFileSync(partsPath, partsOrig + marker);
  run = exportModels();
  check('parts.js change is a cache miss', run.status === 0 && !/up to date/.test(run.stdout), run.stdout);
  writeFileSync(partsPath, partsOrig);

  run = exportModels();
  check('restored parts.js rebuilds', run.status === 0);
  check('rifle matches the warm export', digest(rifleGlbPath) === warmRifle);

  writeFileSync(rifleSrcPath, rifleOrig + marker);
  writeFileSync(smgSrcPath, smgOrig.replace('export function buildSmg() {', 'export function buildSmg() { throw new Error("smoke-export-cache");'));
  run = exportModels();
  check('injected smg throw fails the export', run.status !== 0);
  check('failed rebuild cleared the stamp', !existsSync(stampPath));

  writeFileSync(rifleSrcPath, rifleOrig);
  writeFileSync(smgSrcPath, smgOrig);
  run = exportModels();
  check('reverting sources after a failed rebuild is a cache miss', run.status === 0 && !/up to date/.test(run.stdout), run.stdout);
  check('rifle restored after the mixed write', digest(rifleGlbPath) === warmRifle);
} finally {
  writeFileSync(partsPath, partsOrig);
  writeFileSync(rifleSrcPath, rifleOrig);
  writeFileSync(smgSrcPath, smgOrig);
}

if (failures) process.exit(1);
console.log('smoke-export-cache: ok');
