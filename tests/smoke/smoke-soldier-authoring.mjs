import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ASSET_ROOT,
  SOURCE_INPUTS,
  loadCommittedSoldiers,
  soldierInputHash,
  soldierProductPaths,
} from '../../tools/blender/soldiers/export.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cod-soldier-contract-'));
const originalPath = process.env.PATH;
const originalBlender = process.env.BLENDER;
const hash = (data) => createHash('sha256').update(data).digest('hex');
try {
  // Normal preparation must not execute Blender, even on a clean machine.
  process.env.BLENDER = '/missing/blender';
  process.env.PATH = '/missing';
  const products = loadCommittedSoldiers();
  assert.deepEqual(
    products.map((p) => p.name),
    ['vanguard', 'irregular', 'breacher']
  );

  const copiedSources = path.join(temporary, 'source');
  for (const file of SOURCE_INPUTS) {
    const target = path.join(copiedSources, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r?\n/g, '\r\n');
    fs.writeFileSync(target, text);
  }
  assert.equal(
    soldierInputHash(copiedSources),
    soldierInputHash(),
    'paths and LF/CRLF are portable'
  );
  fs.appendFileSync(path.join(copiedSources, SOURCE_INPUTS[0]), '\n# changed recipe\n');
  assert.notEqual(
    soldierInputHash(copiedSources),
    soldierInputHash(),
    'recipe changes invalidate products'
  );

  const catalog = path.join(temporary, 'catalog');
  fs.mkdirSync(catalog);
  // Deliberately omit blends: ordinary builds only require runtime products.
  for (const file of soldierProductPaths())
    fs.copyFileSync(file, path.join(catalog, path.basename(file)));
  const manifestPath = path.join(catalog, 'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  for (const product of products) {
    const file = path.join(catalog, product.name + '.json');
    fs.writeFileSync(file, product.json.toString('utf8').replace(/\n/g, '\r\n'));
  }
  const copy = loadCommittedSoldiers(catalog);
  for (let i = 0; i < products.length; i++) {
    assert(copy[i].glb.equals(products[i].glb));
    assert(copy[i].json.equals(products[i].json), 'metadata line endings are canonical');
  }
  const first = products[0];
  const glbPath = path.join(catalog, first.name + '.glb');
  fs.rmSync(glbPath);
  assert.throws(
    () => loadCommittedSoldiers(catalog),
    /Regenerate:/,
    'missing GLB fails, no public fallback'
  );
  const corrupt = Buffer.from(first.glb);
  corrupt[20] ^= 1;
  fs.writeFileSync(glbPath, corrupt);
  assert.throws(() => loadCommittedSoldiers(catalog), /GLB hash/);
  fs.writeFileSync(glbPath, first.glb);

  const meta = structuredClone(first.meta);
  meta.weapon.muzzle[0] = null;
  const json = Buffer.from(JSON.stringify(meta));
  fs.writeFileSync(path.join(catalog, first.name + '.json'), json);
  manifest.files[first.name + '.json'] = hash(json);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => loadCommittedSoldiers(catalog),
    /finite float32/,
    'socket validation beyond checksums'
  );
  fs.writeFileSync(path.join(catalog, first.name + '.json'), first.json);

  manifest.files[first.name + '.json'] = hash(first.json);
  manifest.inputHash = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadCommittedSoldiers(catalog), /stale source input hash/);
  fs.writeFileSync(manifestPath, manifestBytes);
  fs.rmSync(manifestPath);
  assert.throws(() => loadCommittedSoldiers(catalog), /Regenerate:/, 'missing manifest fails');
  assert.throws(() => loadCommittedSoldiers(path.join(temporary, 'missing')), /Regenerate:/);
  assert(fs.existsSync(path.join(ASSET_ROOT, 'manifest.json')), 'canonical family untouched');
  console.log(
    '  ok  Blender-free soldier catalog, portable hashes and missing/corrupt/stale boundaries'
  );
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalBlender === undefined) delete process.env.BLENDER;
  else process.env.BLENDER = originalBlender;
  fs.rmSync(temporary, { recursive: true, force: true });
}
