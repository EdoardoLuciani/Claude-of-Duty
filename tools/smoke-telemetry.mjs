/**
 * Node smoke test for telemetry archives and the analyzer — no browser.
 *
 *   node tools/smoke-telemetry.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { extractTar, packTgz } from '../src/dev/telemetry.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cod-telemetry-'));
let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const json = new TextEncoder().encode(JSON.stringify({
  schema: 2,
  events: [{ t: 1, type: 'session:start' }],
  markers: [{
    t: 2, raw: 2, frame: 10, label: 'manual',
    note: 'enemy stuck behind crate', screenshot: 'marks/001.jpg',
    player: [1, 0, 2],
  }],
  playerSamples: [],
  enemySamples: [],
}));
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

const tgz = await packTgz([
  { name: 'telemetry.json', data: json },
  { name: 'marks/001.jpg', data: jpeg },
]);
check('tgz is gzip', tgz[0] === 0x1f && tgz[1] === 0x8b);
const fromGz = extractTar(gunzipSync(tgz));
check('tgz roundtrip json', Buffer.from(fromGz['telemetry.json']).equals(Buffer.from(json)));
check('tgz roundtrip jpeg', Buffer.from(fromGz['marks/001.jpg']).equals(Buffer.from(jpeg)));

const tgzPath = join(dir, 'run.tgz');
writeFileSync(tgzPath, tgz);
const jsonPath = join(dir, 'run.json');
writeFileSync(jsonPath, json);
const schema1Path = join(dir, 'old.json');
writeFileSync(schema1Path, JSON.stringify({ schema: 1, events: [] }));

const analyze = (file) => spawnSync('node', [join(root, 'tools/analyze-telemetry.mjs'), file], {
  encoding: 'utf8',
});

const fromArchive = analyze(tgzPath);
check('analyzer reads tgz', fromArchive.status === 0, fromArchive.stderr);
const summary = fromArchive.status === 0 ? JSON.parse(fromArchive.stdout) : {};
check('analyzer keeps note', summary.markers?.[0]?.note === 'enemy stuck behind crate');
check('analyzer keeps screenshot path', summary.markers?.[0]?.screenshot === 'marks/001.jpg');

const fromJson = analyze(jsonPath);
check('analyzer reads json', fromJson.status === 0, fromJson.stderr);

const rejected = analyze(schema1Path);
check('analyzer rejects schema 1', rejected.status !== 0);
check(
  'schema 1 error names schema',
  (rejected.stderr + rejected.stdout).includes('schema 1'),
);

if (failures) {
  console.error(`${failures} telemetry smoke checks failed`);
  process.exit(1);
}
console.log('telemetry smoke ok');
