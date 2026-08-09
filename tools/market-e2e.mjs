import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

/**
 * End-to-end market probe v2:
 *  - wave clear -> grace period countdown (visible, ticking)
 *  - shop auto-opens when the window elapses
 *  - clicking BUY must NOT re-lock the pointer (input fix)
 *  - real button click purchases; Esc closes; time resumes
 *
 *   node tools/market-e2e.mjs
 */
const server = await ensureViteServer({ port: 8087 });
const browser = await launchChromium({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--force-color-profile=srgb',
         '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

console.log('boot...');
await page.goto('http://127.0.0.1:8087/?capture=1&lockstep=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
const pump = (n) => page.evaluate((k) => window.__PUMP__(k), n);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// 1. Wave clear arms the grace period.
await page.evaluate(() => {
  window.__ENGINE__.ctx.events.emit('wave:complete', { wave: 1, nextWave: 2, delay: 20 });
});
await pump(4);
const countdown = await page.evaluate(() => ({
  key: document.querySelector('.ow-mkt-count-key')?.textContent,
  txt: document.querySelector('.ow-mkt-count-txt')?.textContent,
  visible: getComputedStyle(document.querySelector('.ow-mkt-count')).display !== 'none',
  status: document.querySelector('.ow-scorebar .status')?.textContent,
  marketIn: window.__ENGINE__.ctx.get('market').getHudState().marketIn,
  open: window.__ENGINE__.ctx.get('market').open,
}));
console.log('countdown state:', JSON.stringify(countdown));
check('countdown visible', countdown.visible && countdown.key === '10' && countdown.txt === 'SUPPLY MARKET IN');
check('scorebar shows SUPPLIES IN', countdown.status === 'SUPPLIES IN 10s');
check('shop not open during grace', countdown.open === false && countdown.marketIn === 10);
await page.screenshot({ path: '/tmp/mkt-countdown.png', type: 'png' });

// 2. Ticking: advance sim time so 3 s elapse -> key shows 7.
await page.evaluate(() => { window.__ENGINE__.time.elapsed += 3; });
await pump(1);
const ticked = await page.evaluate(() => document.querySelector('.ow-mkt-count-key')?.textContent);
check('countdown ticks (10 -> 7)', ticked === '7', `key=${ticked}`);

// 3. Window elapses -> shop auto-opens, time freezes.
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.get('market');
  window.__ENGINE__.time.elapsed = m._marketAt + 0.1;
});
await pump(1);
const opened = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.get('market');
  return { open: m.open, scale: window.__ENGINE__.time.scale, marketIn: m.getHudState().marketIn,
           credits: m.credits };
});
check('shop auto-opens', opened.open === true, JSON.stringify(opened));
check('time frozen on open', opened.scale === 0);
check('countdown cleared', opened.marketIn === 0);
await pump(10);
await page.screenshot({ path: '/tmp/mkt-open2.png', type: 'png' });

// 4. Pointer-lock fix: clicking a BUY button must not re-lock.
const lockTest = await page.evaluate(() => {
  const input = window.__ENGINE__.input;
  window.__LOCK_CALLS__ = 0;
  input.requestPointerLock = () => { window.__LOCK_CALLS__++; };
  const btn = document.querySelector('button[data-item="armour"]');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const afterButton = window.__LOCK_CALLS__;
  // Clicking the game canvas is the legitimate re-lock path.
  document.getElementById('game').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  return { afterButton, afterCanvas: window.__LOCK_CALLS__ };
});
check('BUY click does not re-lock pointer', lockTest.afterButton === 0, JSON.stringify(lockTest));
check('canvas click still re-locks', lockTest.afterCanvas === 1, JSON.stringify(lockTest));

// 5. The click purchased one plate (credits 250 -> 0); the row refreshes on
//    the next pumped frame.
await pump(1);
const bought = await page.evaluate(() => ({
  armour: window.__ENGINE__.ctx.get('player').health.armour,
  credits: window.__ENGINE__.ctx.get('market').credits,
  count: document.querySelectorAll('.ow-market-row')[1].querySelector('.ow-market-count').textContent,
}));
check('real click bought a plate', bought.armour === 50 && bought.credits === 0, JSON.stringify(bought));
check('row shows 1/3', bought.count === '1/3', bought.count);
await page.screenshot({ path: '/tmp/mkt-bought2.png', type: 'png' });

// 6. Esc closes; time resumes; countdown stays gone.
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
});
await pump(2);
const closed = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.get('market');
  const ui = window.__ENGINE__.ctx.get('ui');
  return { open: m.open, scale: window.__ENGINE__.time.scale, menu: ui.menu.open };
});
check('Esc closes the shop', closed.open === false, JSON.stringify(closed));
check('time resumed', closed.scale === 1);
check('pause menu stayed closed', closed.menu === false);

console.log('page errors:', errors.length ? errors.slice(0, 3) : 'none');
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
await page.close();
await browser.close();
stopViteServer(server);
process.exit(failures || errors.length ? 1 : 0);
