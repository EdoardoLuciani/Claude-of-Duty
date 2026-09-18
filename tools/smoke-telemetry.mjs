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
  schema: 3,
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
check('schema 3 run reports no freezes', summary.freezes === null, JSON.stringify(summary.freezes));

// Schema 4: the freeze log. A hitch is booked against the frame that ENDED the
// gap, and the long task that overlaps it in wall time names the blocking code.
const schema4Path = join(dir, 'run4.json');
writeFileSync(schema4Path, JSON.stringify({
  schema: 4,
  meta: { observers: 'long-animation-frame' },
  summary: { duration: 12, rawDuration: 10, hitches: 1, longTasks: 1 },
  events: [
    { t: 4.9, raw: 4.8, frame: 299, type: 'weapon:fire', shooter: 'player', weapon: 'm4' },
  ],
  playerSamples: [{
    t: 4.9, raw: 4.8, frame: 298, state: 'fire', stance: 'stand', weapon: 'm4',
    health: 80, actions: ['fire'], wave: 2, marketOpen: false,
    renderCalls: 700, triangles: 1500000,
  }],
  enemySamples: [{ t: 4.9, raw: 4.8, frame: 298, alive: 7, enemies: [], squads: [] }],
  markers: [{ t: 5, raw: 4.5, wall: 5.5, frame: 300, label: 'manual', note: 'froze when i fired' }],
  hitches: [{
    wall: 5, wallMs: 900, gameDtMs: 100, frame: 299, t: 4.9, suspended: false,
    render: { dPrograms: 3, dGeometries: 0, dTextures: 0 }, dHeapMb: 4,
  }],
  longTasks: [{
    kind: 'loaf', wall: 4.95, ms: 880, blockingMs: 800,
    scripts: [{ ms: 800, fn: 'WebGLRenderer.compile', url: '/src/render/index.js' }],
  }],
}));
const freezeRun = analyze(schema4Path);
check('analyzer accepts schema 4', freezeRun.status === 0, freezeRun.stderr);
const freeze = freezeRun.status === 0 ? JSON.parse(freezeRun.stdout) : {};
check('hitch counted', freeze.freezes?.hitches === 1, JSON.stringify(freeze.freezes?.causes));
check('hitch classified', freeze.freezes?.worst?.[0]?.cause === 'shader-compile', freeze.freezes?.worst?.[0]?.cause);
check(
  'blocking script named',
  freeze.freezes?.worst?.[0]?.scripts?.includes('WebGLRenderer.compile @ /src/render/index.js'),
  JSON.stringify(freeze.freezes?.worst?.[0]?.scripts),
);
check(
  'game clock stayed clamped inside the freeze',
  freeze.freezes?.worst?.[0]?.gameDtMs === 100,
  String(freeze.freezes?.worst?.[0]?.gameDtMs),
);
check(
  'hitch joins the nearest sample',
  freeze.freezes?.worst?.[0]?.player?.state === 'fire'
    && freeze.freezes?.worst?.[0]?.alive === 7
    && freeze.freezes?.worst?.[0]?.sampleDt === 0,
  JSON.stringify(freeze.freezes?.worst?.[0]?.player),
);
check(
  'mark finds the freeze before it',
  freeze.markers?.[0]?.nearbyHitches?.[0]?.wallMs === 900,
  JSON.stringify(freeze.markers?.[0]?.nearbyHitches),
);
check('events on the freeze frame', freeze.freezes?.worst?.[0]?.events?.includes('weapon:fire'));

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
