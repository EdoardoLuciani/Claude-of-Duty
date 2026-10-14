// Production bundling relocates/removes source script attributes. Verify the
// HTML-owned failure boundary against the real emitted entry and import graph.
import assert from 'node:assert/strict';
import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(),
  port = Number(args.port ?? 5396);
const server = await ensureViteServer({ port, preview: true });
let browser;
try {
  browser = await launchChromium({ headless: true });
  for (const failure of ['entry', 'import', 'entry-dependency']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    try {
      const page = await context.newPage();
      let release,
        hits = 0;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const target =
        failure === 'entry'
          ? /\/assets\/index-[^/]+\.js$/
          : failure === 'import'
            ? /\/assets\/main-[^/]+\.js$/
            : /\/assets\/preload-helper-[^/]+\.js$/;
      await page.route('**/assets/*.js', async (route) => {
        if (!target.test(route.request().url())) {
          await route.continue();
          return;
        }
        hits++;
        await gate;
        await route.abort('failed');
      });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });
      await page.locator('#startup-status').waitFor();
      assert.equal(await page.locator('#startup').isVisible(), true);
      assert.equal(await page.locator('#startup-status').innerText(), 'Initializing…');
      assert.equal(await page.locator('script[src^="/assets/"]').count(), 1);
      // Check the HTML-first state on a narrow viewport too, before entry runs.
      await page.setViewportSize({ width: 320, height: 640 });
      const title = await page.locator('#startup-title').boundingBox();
      assert(title.x >= 0 && title.x + title.width <= 320, 'title fits the viewport');
      await page.setViewportSize({ width: 1280, height: 720 });
      release();
      await page.waitForFunction(() =>
        document.getElementById('startup').hasAttribute('data-failed')
      );
      assert(hits > 0, `${failure} request was actually aborted`);
      assert.equal(await page.locator('#startup-status').innerText(), 'Startup failed');
      assert.equal(await page.locator('.startup-dots').isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Reload game' }).isVisible(), true);
      assert.equal(await page.evaluate(() => window.__READY__ === true), false);
      if (args.out)
        await page.screenshot({ path: `${args.out}/production-failure-${failure}.png` });
      console.log(`production HTML-first ${failure} abort: readable failure/reload, no readiness`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  stopViteServer(server);
}
