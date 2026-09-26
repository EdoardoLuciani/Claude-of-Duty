import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer, REPO_ROOT } from '../lib/browser-harness.mjs';
const out = process.argv[2];
if (!out) throw new Error('Specify screenshot directory');
mkdirSync(out, { recursive: true });
const root = process.argv[3] ?? REPO_ROOT;
const expected = JSON.parse(readFileSync(resolve(root, 'public/models/world/level.json')));
const server = await ensureViteServer({ port: 5190, root, attempts: 120 });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto('http://127.0.0.1:5190/?capture=1', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
  const meta = await page.evaluate(async () => (await window.__ENGINE__.ctx.get('models').worldPrefetch).meta);
  assert.deepEqual(meta.assets, expected.assets, 'capture server must serve the requested worktree assets');
  writeFileSync(resolve(out, 'assets.json'), JSON.stringify({ root, sourceHash: meta.sourceHash, assets: meta.assets }, null, 2));
  for (const [name, eye, target] of [
    ['W5', [-16.9, 5.0, 31.7], [-17.62, 3.3, 30.35]],
    ['W2', [-19.7, 5.0, -.3], [-20.55, 3.3, -1.65]],
    ['W2-terrace', [-7.3, 5.2, -3.125], [-9.7, 3.65, -3.125]],
    ['W2-shelf', [-13.88, 5.1, -5.2], [-13.88, 4.2, -2.2]],
    ['E1', [16.0, 5.0, 16.0], [17.15, 3.3, 14.58]],
  ]) {
    await page.evaluate(({ eye, target }) => {
      const e = window.__ENGINE__, w = e.ctx.get('world'), p = e.ctx.get('player');
      e.input.frozen = true; e.input.enabled = false; p.setControlEnabled(false);
      e.camera.position.copy(w.levelToWorld(...eye)); e.camera.lookAt(w.levelToWorld(...target));
      e.camera.fov = 65; e.camera.updateProjectionMatrix(); p.teleport(e.camera.position, e.camera.rotation);
    }, { eye, target });
    await page.evaluate(() => new Promise(done => {
      let n = 0; const frame = () => ++n === 30 ? done() : requestAnimationFrame(frame); requestAnimationFrame(frame);
    }));
    await page.screenshot({ path: resolve(out, `${name}.png`) });
  }
} finally { await browser.close(); stopViteServer(server); }
