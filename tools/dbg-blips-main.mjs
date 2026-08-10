import { writeFileSync } from 'node:fs';
import { ensureViteServer, launchChromium } from './lib/browser-harness.mjs';
const PORT = 5199;
const server = await ensureViteServer({ port: PORT, attempts: 160 });
console.error('[dbg] vite up');
const browser = await launchChromium({
  headless: true,
  args: ['--ignore-gpu-blocklist','--disable-frame-rate-limit','--mute-audio','--force-color-profile=srgb','--force-device-scale-factor=1','--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('crash', () => console.error('[dbg] PAGE CRASHED'));
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
console.error('[dbg] goto');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.error('[dbg] wait ready');
await page.waitForFunction('window.__READY__===true', null, { timeout: 90000 });
console.error('[dbg] ready at', await page.evaluate(() => window.__ENGINE__.time.elapsed.toFixed(1)));
await page.evaluate(() => {
  const e = window.__ENGINE__; e.input.enabled = true; e.input.frozen = false;
  e.ctx.peek('player')?.setControlEnabled?.(true);
});
const sample = () => page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai'); const ui = e.ctx.peek('ui');
  const mm = document.querySelector('.ow-minimap canvas');
  const g = mm.getContext('2d');
  const d = g.getImageData(0, 0, mm.width, mm.height).data;
  let red = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 130 && d[i+1] < 120 && d[i+2] < 120) red++;
  return { t: +e.time.elapsed.toFixed(1), frame: e.time.frame, agents: ai.agents.length,
    alive: ai.agents.filter(a=>a.alive).length, blipCount: ui._blipCount,
    blips: ui._blips.slice(0, ui._blipCount).map(b => ({ x:+b.x.toFixed(1), z:+b.z.toFixed(1), kind:b.kind, ghost:b.ghost })),
    redPx: red };
});
let s3=null, s9=null;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 500));
  let s;
  try { s = await sample(); } catch (err) { console.error('[dbg] sample failed:', err.message); break; }
  if (i % 6 === 0) console.error('[dbg]', JSON.stringify({t:s.t, blipCount:s.blipCount, alive:s.alive}));
  if (!s3 && s.t >= 3) s3 = s;
  if (!s9 && s.t >= 9) s9 = s;
  if (s3 && s9) break;
}
console.error('[dbg] t3', JSON.stringify(s3));
console.error('[dbg] t9', JSON.stringify(s9));
const clip = async (name) => {
  try {
    const box = await page.locator('.ow-minimap').boundingBox();
    if (box) writeFileSync(`shots/${name}.png`, await page.screenshot({ clip: box }));
  } catch (err) { console.warn('[dbg] clip fail', err.message); }
};
await clip('dbg-blips-ghost');
const fired = await page.evaluate(() => {
  const e = window.__ENGINE__; const ai = e.ctx.peek('ai');
  const a = ai.agents.find(x => x.alive);
  if (!a) return false;
  ai.onAgentFire(a, a.animator.muzzleWorld, a.animator.muzzleDir);
  return true;
});
console.error('[dbg] fired', fired);
await new Promise(r => setTimeout(r, 400));
const sFire = await sample();
console.error('[dbg] afterFire', JSON.stringify(sFire));
await clip('dbg-blips-live');
console.error('[dbg] errors', JSON.stringify(errs.slice(0,8)));
await browser.close();
if (server) server.kill();
