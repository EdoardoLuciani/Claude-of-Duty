import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { extractTar } from '../src/dev/telemetry.js';
import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

/**
 * End-to-end telemetry mark: screenshot + note + tgz export.
 *
 *   node tools/telemetry-e2e.mjs
 */
const server = await ensureViteServer({ port: 8088 });
const browser = await launchChromium({
  headless: true,
  args: [
    '--ignore-gpu-blocklist', '--force-color-profile=srgb',
    '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio',
    '--disable-frame-rate-limit',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

console.log('boot...');
await page.goto('http://127.0.0.1:8088/?capture=1&lockstep=1&telemetry=1', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForFunction('window.__READY__ === true && window.__TELEMETRY__', null, { timeout: 120000 });
const pump = (n) => page.evaluate((k) => window.__PUMP__(k), n);
await pump(2);

const marked = await page.evaluate(() => {
  const m = window.__TELEMETRY__.mark('manual');
  return { t: m?.t, label: m?.label, note: m?.note };
});
check('mark created', marked?.label === 'manual', JSON.stringify(marked));

await page.waitForSelector('input[placeholder^="note"]', { timeout: 5000 });
await page.fill('input[placeholder^="note"]', 'enemy stuck behind crate');
await page.keyboard.press('Enter');
await pump(2);
const afterEnter = await page.evaluate(() => ({
  menu: window.__ENGINE__.ctx.get('ui').menu.open,
  note: window.__TELEMETRY__.snapshot().markers[0]?.note,
}));
check('enter keeps the note', afterEnter.note === 'enemy stuck behind crate');
check('enter does not pause', afterEnter.menu === false);

await page.evaluate(() => window.__TELEMETRY__.mark('manual'));
await page.waitForSelector('input[placeholder^="note"]', { timeout: 5000 });
await page.fill('input[placeholder^="note"]', 'keep me');
await page.keyboard.press('Escape');
await pump(2);
const afterEsc = await page.evaluate(() => ({
  menu: window.__ENGINE__.ctx.get('ui').menu.open,
  marks: window.__TELEMETRY__.snapshot().markers.length,
  note: window.__TELEMETRY__.snapshot().markers[1]?.note,
}));
check('esc keeps the mark', afterEsc.marks === 2);
check('esc does not save yet', afterEsc.note === '');
check('esc does not pause', afterEsc.menu === false);
await page.keyboard.press('Enter');
await pump(2);
const afterKeep = await page.evaluate(() => window.__TELEMETRY__.snapshot().markers[1]?.note);
check('enter after esc keeps typed note', afterKeep === 'keep me');

// Tier 1: block the main thread between two hand-pumped frames. The game clock
// cannot see it — clamped to 100 ms per frame in play (src/core/engine.js) and
// pinned to a fixed 1/60 s step by the capture harness — so the recorder's own
// wall clock has to. Assert on the hitch recorded AFTER the spin, by index: the
// boot hitch is longer, and asserting on the worst one would pass even if the
// probe ignored this block. Note this block is CDP-injected, so Chromium
// attributes no long task to it; script attribution is covered by the boot hitch.
const before = await page.evaluate(() => window.__TELEMETRY__.snapshot().hitches.length);
check('boot hitch already recorded', before >= 1, String(before));
await page.evaluate(() => {
  const start = performance.now();
  while (performance.now() - start < 260) { /* freeze the main thread */ }
});
await pump(2);
const injected = await page.evaluate(
  (n) => window.__TELEMETRY__.snapshot().hitches[n] ?? null, before,
);
check('injected freeze recorded', injected?.wallMs >= 240, JSON.stringify(injected?.wallMs));
check(
  'game clock does not see the freeze',
  injected?.gameDtMs <= 100.5,
  String(injected?.gameDtMs),
);
check(
  'hitch carries resource deltas',
  ['dPrograms', 'dGeometries', 'dTextures'].every((k) => Number.isFinite(injected?.render?.[k])),
  JSON.stringify(injected?.render),
);

const dir = mkdtempSync(join(tmpdir(), 'cod-telemetry-e2e-'));
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.evaluate(() => window.__TELEMETRY__.download()),
]);
const out = join(dir, download.suggestedFilename());
await download.saveAs(out);
check('download is tgz', out.endsWith('.tgz'), download.suggestedFilename());

const raw = readFileSync(out);
check('file is gzip', raw[0] === 0x1f && raw[1] === 0x8b);
const files = extractTar(gunzipSync(raw));
const json = files['telemetry.json']
  ? JSON.parse(Buffer.from(files['telemetry.json']).toString('utf8'))
  : null;
check('archive has telemetry.json', !!json);
check('schema is 4', json?.schema === 4);
check('freeze log in the archive', (json?.hitches?.length ?? 0) >= 1, JSON.stringify(json?.summary?.hitches));
check(
  'samples left for the analyzer to join',
  (json?.playerSamples?.length ?? 0) > 0 && (json?.enemySamples?.length ?? 0) > 0,
  `${json?.playerSamples?.length}/${json?.enemySamples?.length}`,
);
check(
  'worst hitch survived export',
  (json?.hitches ?? []).some((h) => h.wallMs >= 240),
  JSON.stringify((json?.hitches ?? []).map((h) => h.wallMs)),
);
check(
  'observer running',
  ['long-animation-frame', 'longtask'].includes(json?.meta?.observers ?? ''),
  String(json?.meta?.observers),
);
check('long tasks recorded', (json?.longTasks?.length ?? 0) >= 1, JSON.stringify(json?.longTasks?.length));
check('two markers', json?.markers?.length === 2);
check('note saved', json?.markers?.[0]?.note === 'enemy stuck behind crate');
check('second note saved', json?.markers?.[1]?.note === 'keep me');
const mark = json?.markers?.[0];
check('pose is world-space', Array.isArray(mark?.pose?.feet) && mark.pose.feet.length === 3 && Array.isArray(mark?.pose?.forward));
check('meta has transform', Array.isArray(json?.meta?.transform) && json.meta.transform.length === 16);
check('aim probe present', !!mark?.aim);
check('fit probe present', !!mark?.fit?.stand && !!mark?.fit?.opening);
check('near probe present', Array.isArray(mark?.near?.instances));
const shot = json?.markers?.[0]?.screenshot;
check('screenshot path set', shot === 'marks/001.jpg', String(shot));
const jpeg = shot ? files[shot] : null;
check('screenshot in archive', !!jpeg && jpeg.byteLength > 100);
check('screenshot is jpeg', !!jpeg && jpeg[0] === 0xff && jpeg[1] === 0xd8, jpeg ? `${jpeg[0]} ${jpeg[1]}` : 'missing');
const shot2 = json?.markers?.[1]?.screenshot;
const jpeg2 = shot2 ? files[shot2] : null;
check('second screenshot present', !!jpeg2 && jpeg2[0] === 0xff && jpeg2[1] === 0xd8);
check('no page errors', errors.length === 0, errors.join(' | '));

// The clamp that justifies all of this, in the mode the game is actually played:
// a free-running page (?telemetry=1, no lockstep) with the freeze inside a real
// rAF callback, where the engine's own clock must land on the 100 ms ceiling
// while the recorder's wall clock sees the whole thing.
const play = await browser.newPage({ viewport: { width: 1280, height: 720 } });
play.on('pageerror', (e) => errors.push(`play: ${e.message}`));
await play.goto('http://127.0.0.1:8088/?telemetry=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await play.waitForFunction(
  'window.__TELEMETRY__ && window.__PREWARM__ !== undefined', null, { timeout: 120000 },
);
const playFreeze = await play.evaluate(() => new Promise((resolve) => {
  let i = 0;
  const frame = () => {
    if (++i < 3) return requestAnimationFrame(frame);
    const start = performance.now();
    while (performance.now() - start < 700) { /* play-mode freeze */ }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
  };
  requestAnimationFrame(frame);
}));
check('play-mode freeze ran', playFreeze === null);
const playHitch = await play.evaluate(() =>
  window.__TELEMETRY__.snapshot().hitches.sort((a, b) => b.wallMs - a.wallMs)[0] ?? null);
check('play-mode freeze recorded', playHitch?.wallMs >= 600, JSON.stringify(playHitch?.wallMs));
check(
  'play-mode game clock clamped to 100 ms',
  playHitch?.gameDtMs <= 100.5,
  `wall ${playHitch?.wallMs} ms vs game ${playHitch?.gameDtMs} ms`,
);
await play.close();

await browser.close();
await stopViteServer(server);

if (failures) {
  console.error(`${failures} telemetry e2e checks failed`);
  process.exit(1);
}
console.log('telemetry e2e ok');
