/** Isolated HUD layout/compositor regression; no world or GPU performance claim. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5496);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, webgpu: false, args: ['--disable-gpu'] });
const out = args.out ? resolve(String(args.out)) : null;
if (out) await mkdir(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route('**/__hud-regression', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><style>
        body { margin:0; background:linear-gradient(135deg,#52666b,#1d282c); }
        canvas#game { width:100vw; height:100vh; display:block; }
      </style><canvas id="game"></canvas><script type="module">
        import { UiSystem } from '/src/ui/index.ts';
        import { installStyles } from '/src/ui/style.ts';
        import { HealthFx } from '/src/ui/health.ts';
        import { Compass, ScoreBar } from '/src/ui/compass.ts';
        import { Minimap } from '/src/ui/minimap.ts';
        import { AmmoPanel } from '/src/ui/ammo.ts';
        import { Crosshair } from '/src/ui/crosshair.ts';
        import { Rng } from '/src/core/rng.ts';
        installStyles();
        const root = document.createElement('div');
        root.className = 'ow-hud';
        document.body.append(root);
        const ui = Object.create(UiSystem.prototype);
        Object.assign(ui, { root, crosshair:new Crosshair(root), compass:new Compass(root),
          minimap:new Minimap(root,new Rng(17)) });
        const health = new HealthFx(root), ammo = new AmmoPanel(root), score = new ScoreBar(root);
        score.update({ score:1200, wave:3, credits:850, enemiesRemaining:6 });
        ammo.update(1/60,{ ammo:28,magSize:30,reserve:210,weaponName:'M4A1',bandages:2 });
        window.health = health;
        window.resizeHud = () => {
          ui.resize(innerWidth,innerHeight);
          ui.compass.update(0,[],0);
          ui.minimap.draw({ heading:0 });
        };
        addEventListener('resize', window.resizeHud);
        window.resizeHud();
        window.__HUD_READY__ = true;
      </script>`,
    })
  );
  await page.goto(`http://127.0.0.1:${port}/__hud-regression`);
  await page.waitForFunction(() => window.__HUD_READY__);
  for (const [width, height] of [
    [1920, 1080],
    [800, 900],
    [1280, 720],
    [2560, 1080],
    [640, 480],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, [width, height]);
    // Allow the actual browser resize event to reach the HUD.
    await page.waitForTimeout(100);
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      return {
        k: Number(getComputedStyle(document.querySelector('.ow-hud')).getPropertyValue('--k')),
        map: rect('.ow-minimap'),
        compass: rect('.ow-compass'),
        vitals: rect('.ow-vitals'),
        ammo: rect('.ow-ammo'),
      };
    });
    assert(Math.abs(layout.k - Math.min(width / 1920, height / 1080, 2.4)) < 0.0001);
    assert(Math.abs(layout.map.width - layout.map.height) < 0.1, 'square minimap');
    assert(layout.map.right < layout.compass.x, 'narrowing must not overlap map and compass');
    for (const rect of [layout.map, layout.compass, layout.vitals, layout.ammo]) {
      assert(rect.x >= 0 && rect.y >= 0 && rect.right <= width + 1 && rect.bottom <= height + 1);
    }
    if (out && width === 800) await page.screenshot({ path: resolve(out, 'narrow-hud.png') });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    for (let i = 0; i < 120; i++)
      window.health.update(1 / 60, { health: 20, hurt: 0.8, pulse: 0.9 });
  });
  {
    const filters = await page
      .locator('.ow-blood, .ow-blood *, .ow-lowbeat, .ow-hitflash, .ow-desat')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const css = getComputedStyle(node);
          return [css.filter, css.backdropFilter, css.mixBlendMode];
        })
      );
    for (const [filter, backdrop, blend] of filters) {
      assert.equal(filter, 'none');
      assert.equal(backdrop, 'none');
      assert.equal(blend, 'normal');
    }
    assert(await page.locator('.ow-vitals').evaluate((node) => node.classList.contains('crit')));
  }
  if (out) await page.screenshot({ path: resolve(out, 'low-health.png') });
  assert.deepEqual(errors, []);
  console.log(
    'ui-resize-health-e2e: passed (live width/height resize, layout, low-health compositor)'
  );
} finally {
  await browser.close();
  stopViteServer(server);
}
