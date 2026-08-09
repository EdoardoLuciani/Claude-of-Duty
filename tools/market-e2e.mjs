import { ensureViteServer, launchChromium, stopViteServer } from './lib/browser-harness.mjs';

/**
 * End-to-end market probe:
 *  - wave clear -> grace period countdown (visible, ticking)
 *  - shop auto-opens when the window elapses
 *  - clicking BUY must NOT fire a shot or re-lock the pointer
 *  - ammo refill item: drains -> enables -> refills -> disables
 *  - countdown must not overlap the interaction prompt (ammo crates)
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

// 1. Wave clear arms the grace period. The real game awards the wave bonus
//    from this event (game's wave:complete -> score:change), which the
//    market mirrors into credits.
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
check('countdown visible', countdown.visible && countdown.key === '10' && countdown.txt === 'SUPPLY MARKET IN');
check('scorebar shows SUPPLIES IN', countdown.status === 'SUPPLIES IN 10s');
check('shop not open during grace', countdown.open === false && countdown.marketIn === 10);

// 2. No overlap with the interaction prompt (ammo crates drive it).
const overlap = await page.evaluate(() => {
  const ui = window.__ENGINE__.ctx.get('ui');
  ui.setPrompt({ key: 'F', text: 'Resupply ammunition', sub: '+45 rounds · hold' });
  return true;
});
await pump(30); // let the prompt fade in before measuring
const overlap2 = await page.evaluate(() => {
  const a = document.querySelector('.ow-prompt').getBoundingClientRect();
  const b = document.querySelector('.ow-mkt-count').getBoundingClientRect();
  return {
    promptY: Math.round(a.top), countY: Math.round(b.top),
    intersect: !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top),
  };
});
check('countdown clear of prompt', overlap2.intersect === false && overlap2.promptY > 0,
  `prompt y=${overlap2.promptY} countdown y=${overlap2.countY}`);
await page.screenshot({ path: '/tmp/mkt-countdown2.png', type: 'png' });

// 3. Ticking: advance sim time so 3 s elapse -> key shows 7.
await page.evaluate(() => { window.__ENGINE__.time.elapsed += 3; });
await pump(1);
const ticked = await page.evaluate(() => document.querySelector('.ow-mkt-count-key')?.textContent);
check('countdown ticks (10 -> 7)', ticked === '7', `key=${ticked}`);

// 4. Window elapses -> shop auto-opens, time freezes.
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.get('market');
  window.__ENGINE__.time.elapsed = m._marketAt + 0.1;
});
await pump(1);
const opened = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.get('market');
  return { open: m.open, scale: window.__ENGINE__.time.scale, marketIn: m.getHudState().marketIn };
});
check('shop auto-opens', opened.open === true, JSON.stringify(opened));
check('time frozen on open', opened.scale === 0);
check('countdown cleared', opened.marketIn === 0);
await pump(10);
await page.screenshot({ path: '/tmp/mkt-open3.png', type: 'png' });

// 5. Clicking BUY must not fire a shot, and must not re-lock the pointer.
const clickTest = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const input = e.input;
  window.__FIRES__ = 0;
  window.__LOCK_CALLS__ = 0;
  e.events.on('weapon:fire', () => { window.__FIRES__++; });
  input.requestPointerLock = () => { window.__LOCK_CALLS__++; };
  const btn = document.querySelector('button[data-item="armour"]');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return {};
});
await pump(2);
const clickResult = await page.evaluate(() => ({ fires: window.__FIRES__, locks: window.__LOCK_CALLS__ }));
check('BUY click fires no shot', clickResult.fires === 0, JSON.stringify(clickResult));
check('BUY click does not re-lock pointer', clickResult.locks === 0, JSON.stringify(clickResult));

// 6. The click purchased one plate; row refreshed.
const bought = await page.evaluate(() => ({
  armour: window.__ENGINE__.ctx.get('player').health.armour,
  credits: window.__ENGINE__.ctx.get('market').credits,
  count: document.querySelectorAll('.ow-market-row')[1].querySelector('.ow-market-count').textContent,
}));
check('real click bought a plate', bought.armour === 50 && bought.credits === 0, JSON.stringify(bought));
check('row shows 1/3', bought.count === '1/3', bought.count);

// 7. Ammo refill: drain the rifle, buy, verify full + disabled again.
await page.evaluate(() => {
  window.__ENGINE__.ctx.get('weapons').states.get('rifle').reserve = 6;
  window.__ENGINE__.ctx.get('market').credits = 99999;
});
await pump(1);
const ammoBefore = await page.evaluate(() => {
  const row = document.querySelectorAll('.ow-market-row')[2];
  return { count: row.querySelector('.ow-market-count').textContent, disabled: row.querySelector('button').disabled };
});
check('ammo row shows low % and enables', ammoBefore.disabled === false && ammoBefore.count.endsWith('%'),
  JSON.stringify(ammoBefore));
await page.evaluate(() => {
  document.querySelector('button[data-item="ammo"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await pump(1);
const ammoAfter = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const row = document.querySelectorAll('.ow-market-row')[2];
  const st = e.ctx.get('weapons').states.get('rifle');
  return {
    rifle: st.reserve, rifleMax: st.def.reserve,
    credits: e.ctx.get('market').credits,
    count: row.querySelector('.ow-market-count').textContent,
    disabled: row.querySelector('button').disabled,
  };
});
check('ammo refilled rifle to full', ammoAfter.rifle === ammoAfter.rifleMax, JSON.stringify(ammoAfter));
check('ammo credits deducted (99999-300)', ammoAfter.credits === 99699, JSON.stringify(ammoAfter));
check('ammo row shows 100% and disables', ammoAfter.count === '100%' && ammoAfter.disabled === true,
  JSON.stringify(ammoAfter));
await page.screenshot({ path: '/tmp/mkt-ammo.png', type: 'png' });

// 8. Esc closes; time resumes; pause menu stays closed.
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
