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

await page.waitForSelector('input[placeholder*="what happened"]', { timeout: 5000 });
await page.fill('input[placeholder*="what happened"]', 'enemy stuck behind crate');
await page.keyboard.press('Enter');
await pump(2);
const afterEnter = await page.evaluate(() => ({
  menu: window.__ENGINE__.ctx.get('ui').menu.open,
  note: window.__TELEMETRY__.snapshot().markers[0]?.note,
}));
check('enter keeps the note', afterEnter.note === 'enemy stuck behind crate');
check('enter does not pause', afterEnter.menu === false);

await page.evaluate(() => window.__TELEMETRY__.mark('manual'));
await page.waitForSelector('input[placeholder*="what happened"]', { timeout: 5000 });
await page.fill('input[placeholder*="what happened"]', 'should be discarded');
await page.keyboard.press('Escape');
await pump(2);
const afterEsc = await page.evaluate(() => ({
  menu: window.__ENGINE__.ctx.get('ui').menu.open,
  note: window.__TELEMETRY__.snapshot().markers[1]?.note,
}));
check('esc skips the note', afterEsc.note === '');
check('esc does not pause', afterEsc.menu === false);

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
check('schema is 2', json?.schema === 2);
check('two markers', json?.markers?.length === 2);
check('note saved', json?.markers?.[0]?.note === 'enemy stuck behind crate');
check('esc note empty', json?.markers?.[1]?.note === '');
const shot = json?.markers?.[0]?.screenshot;
check('screenshot path set', shot === 'marks/001.jpg', String(shot));
const jpeg = shot ? files[shot] : null;
check('screenshot in archive', !!jpeg && jpeg.byteLength > 100);
check('screenshot is jpeg', !!jpeg && jpeg[0] === 0xff && jpeg[1] === 0xd8, jpeg ? `${jpeg[0]} ${jpeg[1]}` : 'missing');
const shot2 = json?.markers?.[1]?.screenshot;
const jpeg2 = shot2 ? files[shot2] : null;
check('second screenshot present', !!jpeg2 && jpeg2[0] === 0xff && jpeg2[1] === 0xd8);
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
await stopViteServer(server);

if (failures) {
  console.error(`${failures} telemetry e2e checks failed`);
  process.exit(1);
}
console.log('telemetry e2e ok');
