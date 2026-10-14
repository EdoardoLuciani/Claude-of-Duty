// HTML-first shell plus actual native init/prewarm/first-gameplay-render boundaries.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collectBrowserErrors, ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
import { installDevicePolicy, verifyNative, captureNative } from '../../tools/lib/native-render.mjs';

const args = parseArgs(), port = Number(args.port ?? 5394);
const failure = args.failure ?? null;
assert([null, 'entry', 'import', 'bootstrap', 'init', 'prewarm', 'render'].includes(failure));
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await installDevicePolicy(page);
  const errors = [], warnings = [];
  // Match existing startup gates: retain general TSL warnings as evidence, but
  // never permit actual GPU validation/WGSL errors even at warning severity.
  collectBrowserErrors(page, errors, { warnings });
  page.on('console', message => {
    if (message.type() === 'warning' && /GPUValidationError|validation error|Error while parsing WGSL/i.test(message.text()))
      errors.push(message.text());
  });
  const out = args.out ? resolve(String(args.out)) : null;
  if (out) await mkdir(out, { recursive: true });
  const screenshot = async name => { if (out) await page.screenshot({ path: resolve(out, `${name}.png`) }); };
  let releaseEntry;
  const entryGate = new Promise(resolveGate => { releaseEntry = resolveGate; });
  await page.route('**/src/bootstrap.ts', async route => {
    await entryGate;
    if (failure === 'entry') await route.abort('failed');
    else await route.continue();
  });
  if (failure === 'import') await page.route('**/src/main.ts', route => route.abort('failed'));
  if (failure === 'bootstrap') await page.route('**/src/main.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `throw Error('controlled bootstrap evaluation failure');\n${await response.text()}` });
  });
  await page.route('**/src/core/engine.ts', async route => {
    const response = await route.fetch();
    let body = await response.text();
    assert(body.includes('async init() {'));
    body = body.replace('async init() {', `async init() {
      window.__BOOT_ENGINE__ = this;
      window.__INIT_STAGE__ = document.getElementById('startup-status').textContent;
      await new Promise(resolve => window.__CONTINUE_INIT__ = resolve);
      ${failure === 'init' ? 'throw Error("controlled initialization failure");' : ''}`);
    const marker = 'renderSystem.render(this.ctx);';
    assert(body.includes(marker));
    body = body.replace(marker, `
      window.__FIRST_ATTEMPT__ ??= { frame: this.time.frame, visible: !document.getElementById('startup').hidden,
        stage: document.getElementById('startup-status').textContent, input: this.input.enabled };
      ${failure === 'render' ? 'throw Error("controlled first render failure");' : marker}`);
    assert(body.includes('complete();'));
    body = body.replace('complete();', `complete();
      window.__FIRST_COMPLETE__ = { frame: this.time.frame, hidden: document.getElementById('startup').hidden };`);
    await route.fulfill({ response, body });
  });
  await page.route('**/src/core/prewarm.ts', async route => {
    const response = await route.fetch();
    let body = await response.text();
    const marker = /export\s+async\s+function\s+prewarm\s*\(/;
    assert(marker.test(body));
    body = body.replace(marker, 'async function observedPrewarm(') + `
      export async function prewarm(engine) {
        const panel = document.getElementById('startup');
        window.__WARM_START__ = { visible: !panel.hidden, frame: engine.time.frame,
          stage: document.getElementById('startup-status').textContent, ready: window.__READY__ === true };
        ${failure === 'prewarm' ? 'throw Error("controlled prewarm failure");' : ''}
        const result = await observedPrewarm(engine);
        window.__WARM_END__ = { visible: !panel.hidden, frame: engine.time.frame, ok: result.ok };
        await new Promise(resolve => window.__CONTINUE_WARM__ = resolve);
        return result;
      }`;
    await route.fulfill({ response, body });
  });
  // DCL does not await the delayed entry. The shell must already be usable.
  await page.goto(`http://127.0.0.1:${port}/${args.normal ? '' : '?capture=1&lockstep=1'}`, { waitUntil: 'commit' });
  await page.locator('#startup-status').waitFor();
  assert.equal(await page.locator('#startup-status').innerText(), 'Initializing…');
  assert.equal(await page.locator('#startup').isVisible(), true);
  assert.equal(await page.evaluate(() => !!window.__ENGINE__), false);
  assert.equal(await page.locator('#startup-status').getAttribute('role'), 'status');
  const animation = () => page.locator('.startup-dots span').first().evaluate(el => getComputedStyle(el).animationName);
  assert.equal(await animation(), 'startup-pulse');
  await screenshot('after-html-first');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await animation(), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  releaseEntry();

  const assertInputBlocked = async () => {
    await page.mouse.click(640, 360);
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyW');
    await page.evaluate(() => document.getElementById('game').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    assert.deepEqual(await page.evaluate(() => ({ locked: !!document.pointerLockElement,
      keys: window.__BOOT_ENGINE__.input._pendingDown.size, enabled: window.__BOOT_ENGINE__.input.enabled })),
    { locked: false, keys: 0, enabled: false });
  };
  const waitFailure = async pattern => {
    await page.waitForFunction(() => !!document.getElementById('engine-failure') || document.getElementById('startup').hasAttribute('data-failed'), null, { timeout: 180000 });
    const modal = page.locator('#engine-failure');
    if (await modal.count()) {
      assert.equal(await modal.isVisible(), true);
      assert.equal(await page.locator('#startup').isVisible(), false, 'terminal dialog takes precedence');
      assert.match(await modal.innerText(), pattern);
    } else {
      assert.equal(await page.locator('#startup-status').innerText(), 'Startup failed');
      assert.equal(await page.locator('.startup-dots').isVisible(), false);
      assert.match(await page.locator('#startup-detail').innerText(), pattern);
    }
    assert.equal(await page.evaluate(() => window.__READY__ === true), false);
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    const reload = page.getByRole('button', { name: 'Reload game', exact: true });
    assert.equal(await reload.isVisible(), true);
    assert.equal(await reload.evaluate(el => el === document.activeElement), true);
    await screenshot(`failure-${failure}`);
    // Exercise the real action without doing a second GPU boot.
    const navigation = page.waitForRequest(r => r.isNavigationRequest());
    await page.route('**/*', route => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: 'text/html', body: '<p>Reload requested</p>' }) : route.continue());
    await reload.click();
    await navigation;
    console.log(JSON.stringify({ failure, actionable: true, ready: false, errors, warnings }));
  };
  if (failure === 'entry' || failure === 'import' || failure === 'bootstrap') {
    await waitFailure(failure === 'entry' ? /Unable to load/
      : failure === 'bootstrap' ? /controlled bootstrap evaluation failure/ : /import|fetch/i);
  } else {
    await page.waitForFunction(() => !!window.__CONTINUE_INIT__, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__INIT_STAGE__), 'Loading world and assets…');
    // Real DOM events, including targeted canvas events, cannot queue gameplay.
    await assertInputBlocked();
    await screenshot('after-loading-assets');
    await page.evaluate(() => window.__CONTINUE_INIT__());
    if (failure === 'init') await waitFailure(/controlled initialization failure/);
    else if (failure === 'prewarm') await waitFailure(/controlled prewarm failure/);
    else {
      await page.waitForFunction(() => !!window.__CONTINUE_WARM__ || !!document.getElementById('engine-failure'), null, { timeout: 180000 });
      const warm = await page.evaluate(() => ({ start: window.__WARM_START__, end: window.__WARM_END__ }));
      assert.deepEqual(warm.start, { visible: true, frame: 0, stage: 'Preparing graphics…', ready: false });
      assert.deepEqual(warm.end, { visible: true, frame: 0, ok: true });
      await assertInputBlocked(); // Input and UI handlers are now really attached.
      await screenshot('after-preparing-graphics');
      await page.evaluate(() => window.__CONTINUE_WARM__());
      if (failure === 'render') await waitFailure(/controlled first render failure/);
      else {
        await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 60000 });
        const device = await verifyNative(page);
        assert.deepEqual(await page.evaluate(() => window.__FIRST_ATTEMPT__),
          { frame: 1, visible: true, stage: 'Preparing graphics…', input: false });
        assert.deepEqual(await page.evaluate(() => window.__FIRST_COMPLETE__), { frame: 1, hidden: true });
        assert.equal(await page.locator('#startup').isVisible(), false);
        const readyFrame = await page.evaluate(() => window.__ENGINE__.time.frame);
        if (!args.normal) assert.equal(readyFrame, 3, 'capture handshake is unchanged');
        else assert(readyFrame >= 3, 'ordinary rAF readiness remains gated');
        assert.equal(await page.evaluate(() => window.__ENGINE__.input.enabled), true);
        assert.deepEqual(errors, []);
        if (out) await captureNative(page, resolve(out, 'after-gameplay-native.png'));
        console.log(JSON.stringify({ device, warm, firstRender: 1, readyFrame, normal: !!args.normal, errors, warnings }));
        await page.evaluate(() => window.__ENGINE__.dispose());
      }
    }
  }
} finally {
  try { await browser?.close(); } finally { stopViteServer(server); }
}
