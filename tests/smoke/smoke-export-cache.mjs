/**
 * Model export cache: hashed authoring inputs must invalidate, and a failed
 * rebuild must not leave a stamp that accepts mixed outputs.
 *
 *   node tests/smoke/smoke-export-cache.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const partsPath = join(root, 'src/weapons/parts.js');
// SMG is the first procedural export; LMG follows it. The authored M4 no
// longer generates public/models/weapons/rifle.glb on a clean checkout.
const smgSrcPath = join(root, 'src/weapons/models/smg.js');
const lmgSrcPath = join(root, 'src/weapons/models/lmg.js');
const smgGlbPath = join(root, 'public/models/weapons/smg.glb');
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
const smgOrig = readFileSync(smgSrcPath, 'utf8');
const lmgOrig = readFileSync(lmgSrcPath, 'utf8');

try {
  let run = exportModels();
  check('warm export succeeds', run.status === 0, run.stderr);
  check('warm wrote a stamp', existsSync(stampPath));
  const warmSmg = digest(smgGlbPath);

  run = exportModels();
  check('unchanged tree is a cache hit', run.status === 0 && /up to date/.test(run.stdout), run.stdout);

  writeFileSync(partsPath, partsOrig + marker);
  run = exportModels();
  check('parts.js change is a cache miss', run.status === 0 && !/up to date/.test(run.stdout), run.stdout);
  writeFileSync(partsPath, partsOrig);

  run = exportModels();
  check('restored parts.js rebuilds', run.status === 0);
  check('smg matches the warm export', digest(smgGlbPath) === warmSmg);

  // Change real geometry before the later LMG throws, so recovery must
  // replace a demonstrably mixed output rather than merely miss the stamp.
  writeFileSync(smgSrcPath, smgOrig.replace('const rRec = 0.0158;', 'const rRec = 0.0168;'));
  writeFileSync(lmgSrcPath, lmgOrig.replace('export function buildLmg() {', 'export function buildLmg() { throw new Error("smoke-export-cache");'));
  run = exportModels();
  check('injected lmg throw fails the export', run.status !== 0);
  check('smg was changed before the failed lmg export', digest(smgGlbPath) !== warmSmg);
  check('failed rebuild cleared the stamp', !existsSync(stampPath));

  writeFileSync(smgSrcPath, smgOrig);
  writeFileSync(lmgSrcPath, lmgOrig);
  run = exportModels();
  check('reverting sources after a failed rebuild is a cache miss', run.status === 0 && !/up to date/.test(run.stdout), run.stdout);
  check('smg restored after the mixed write', digest(smgGlbPath) === warmSmg);
} finally {
  writeFileSync(partsPath, partsOrig);
  writeFileSync(smgSrcPath, smgOrig);
  writeFileSync(lmgSrcPath, lmgOrig);
}

if (failures) process.exit(1);
console.log('smoke-export-cache: ok');
