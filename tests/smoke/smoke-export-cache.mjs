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
// Shotgun is the remaining procedural weapon; soldier exports follow it.
const firstSrcPath = join(root, 'src/weapons/models/shotgun.js');
const laterSrcPath = join(root, 'src/ai/soldier.js');
const firstGlbPath = join(root, 'public/models/weapons/shotgun.glb');
const retiredPaths = ['rifle', 'lmg', 'smg', 'sniper'].flatMap(id => ['glb', 'json'].map(ext => join(root, 'public/models/weapons', `${id}.${ext}`)));
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
const firstOrig = readFileSync(firstSrcPath, 'utf8');
const laterOrig = readFileSync(laterSrcPath, 'utf8');

try {
  let run = exportModels();
  check('warm export succeeds', run.status === 0, run.stderr);
  check('warm wrote a stamp', existsSync(stampPath));
  check('export does not generate retired authored-weapon outputs', retiredPaths.every(file => !existsSync(file)));
  const warmFirst = digest(firstGlbPath);

  for (const id of ['lmg', 'smg', 'sniper']) for (const ext of ['glb', 'json']) writeFileSync(join(root, 'public/models/weapons', `${id}.${ext}`), 'legacy ignored output');
  run = exportModels();
  check('unchanged tree is a cache hit', run.status === 0 && /up to date/.test(run.stdout), run.stdout);
  check('cache hit cleans retired LMG/SMG/sniper outputs and does not generate retired M4 outputs', retiredPaths.every(file => !existsSync(file)));

  writeFileSync(partsPath, partsOrig + marker);
  run = exportModels();
  check('parts.js change is a cache miss', run.status === 0 && !/up to date/.test(run.stdout), run.stdout);
  writeFileSync(partsPath, partsOrig);

  run = exportModels();
  check('restored parts.js rebuilds', run.status === 0);
  check('shotgun matches the warm export', digest(firstGlbPath) === warmFirst);

  // Change actual shotgun geometry before the later soldier export throws.
  check('geometry injection matches authoring source', firstOrig.includes('const recW = 0.029;'));
  writeFileSync(firstSrcPath, firstOrig.replace('const recW = 0.029;', 'const recW = 0.031;'));
  const soldierEntry = 'export function buildSoldier(name, { rng, materials }) {';
  check('failure injection matches soldier source', laterOrig.includes(soldierEntry));
  writeFileSync(laterSrcPath, laterOrig.replace(soldierEntry, soldierEntry + ' throw new Error("smoke-export-cache");'));
  run = exportModels();
  check('injected soldier throw fails the export', run.status !== 0);
  check('shotgun was changed before the failed soldier export', digest(firstGlbPath) !== warmFirst);
  check('failed rebuild cleared the stamp', !existsSync(stampPath));

  writeFileSync(firstSrcPath, firstOrig);
  writeFileSync(laterSrcPath, laterOrig);
  run = exportModels();
  check('reverting sources after a failed rebuild is a cache miss', run.status === 0 && !/up to date/.test(run.stdout), run.stdout);
  check('shotgun restored after the mixed write', digest(firstGlbPath) === warmFirst);
} finally {
  writeFileSync(partsPath, partsOrig);
  writeFileSync(firstSrcPath, firstOrig);
  writeFileSync(laterSrcPath, laterOrig);
}

if (failures) process.exit(1);
console.log('smoke-export-cache: ok');
