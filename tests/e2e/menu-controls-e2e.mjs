import { CONTROL_SECTIONS } from '../../src/ui/controls.ts';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForGame } from '../../tools/lib/native-render.mjs';
import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

// Optional screenshot output must be outside the repository (e.g. /tmp/issue372-integration/menu-after).
const out = process.env.MENU_CONTROLS_SCREENSHOTS;
if (out) mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port: 5369 });
const browser = await launchChromium({ headless: true, args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5369/?capture=1&lockstep=1&shot=hud');
  await waitForGame(page, { timeout: 120000 });
  const pump = (frames = 60) => page.evaluate((n) => window.__PUMP__(n), frames);
  // Drive the real pause key consumer, not a UI-only debug state.
  await page.evaluate(() => {
    const input = window.__ENGINE__.ctx.input;
    input.frozen = false;
    input._pendingDown.add('Escape');
  });
  await pump();
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), true);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.time.scale), 0);
  assert.equal(
    await page.locator('.ow-controls dd').count(),
    CONTROL_SECTIONS.flatMap((section) => section.controls).length
  );
  await page.evaluate(() => {
    const e = window.__ENGINE__,
      wp = e.ctx.get('weapons');
    e.input._pendingUp.add('Escape');
    window.__CONTROL_PROBE__ = { fires: 0, cycles: 0 };
    e.ctx.events.on('weapon:fire', (event) => {
      if (event.actor === 'player') window.__CONTROL_PROBE__.fires++;
    });
    const next = wp.nextWeapon.bind(wp);
    wp.nextWeapon = (...args) => {
      window.__CONTROL_PROBE__.cycles++;
      return next(...args);
    };
  });
  await pump(1);
  const assertNoLeak = async () => {
    const state = await page.evaluate(() => {
      const input = window.__ENGINE__.ctx.input;
      return {
        ...window.__CONTROL_PROBE__,
        wheel: input.wheel,
        pendingWheel: input._pendingWheel,
        held: [...input.down],
        pending: [...input._pendingDown],
      };
    });
    assert.deepEqual(
      state,
      { fires: 0, cycles: 0, wheel: 0, pendingWheel: 0, held: [], pending: [] },
      'native menu gestures/return-to-play must not leak shots, wheel or actions'
    );
  };
  await assertNoLeak();
  assert.equal(
    await page.locator('.ow-menu .ow-btn.primary').evaluate((el) => el === document.activeElement),
    true
  );

  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [900, 600],
    [480, 720],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await pump(4);
    const geometry = await page.locator('.ow-menu').evaluate((menu) => {
      const controls = menu.querySelector('.ow-controls');
      return {
        width: menu.clientWidth,
        scrollWidth: menu.scrollWidth,
        referenceWidth: controls.clientWidth,
        referenceScrollWidth: controls.scrollWidth,
        fontSize: parseFloat(getComputedStyle(controls.querySelector('dd')).fontSize),
      };
    });
    assert.ok(
      geometry.scrollWidth <= geometry.width + 1,
      `no horizontal menu overflow at ${width}`
    );
    assert.ok(
      geometry.referenceScrollWidth <= geometry.referenceWidth + 1,
      `no reference overflow at ${width}`
    );
    assert.ok(geometry.fontSize >= 14, `readable reference type at ${width}`);
    await page.locator('.ow-menu').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.locator('.ow-controls').evaluate((el) => {
      el.scrollTop = 0;
    });
    if (out) await page.screenshot({ path: resolve(out, `browser-after-${width}x${height}.png`) });
    const last = page.locator('.ow-controls-note').last();
    await last.scrollIntoViewIfNeeded();
    assert.ok(await last.isVisible(), 'all reference content reachable');
    if (out && width === 1280)
      await page.screenshot({ path: resolve(out, 'browser-after-1280x720-scrolled.png') });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('.ow-controls').focus();
  await page.locator('.ow-controls').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(300);
  assert.ok(
    await page.locator('.ow-controls').evaluate((el) => el.scrollTop > 0),
    'keyboard can scroll reference'
  );
  const scrolled = await page.locator('.ow-controls').evaluate((el) => el.scrollTop);
  await page.keyboard.press('PageUp');
  await page.waitForTimeout(300);
  assert.ok(
    (await page.locator('.ow-controls').evaluate((el) => el.scrollTop)) < scrolled,
    'PageUp scrolls focused reference back up'
  );

  // Unlocked menus preserve native arrows AND PageUp/Down on every real range.
  for (const [label, configKey] of [
    ['Mouse Sensitivity', 'sensitivity'],
    ['Field Of View', 'fov'],
    ['Firing Camera Shake', 'firingShake'],
  ]) {
    const slider = page.getByRole('slider', { name: label, exact: true });
    await slider.focus();
    for (const [decrease, increase] of [
      ['ArrowLeft', 'ArrowRight'],
      ['ArrowDown', 'ArrowUp'],
      ['PageDown', 'PageUp'],
    ]) {
      const valueBefore = Number(await slider.inputValue());
      const settingBefore = await page.evaluate(
        (key) => window.__ENGINE__.ctx.config[key],
        configKey
      );
      await page.keyboard.press(decrease);
      const decreased = Number(await slider.inputValue());
      const configDecreased = await page.evaluate(
        (key) => window.__ENGINE__.ctx.config[key],
        configKey
      );
      assert.ok(decreased < valueBefore, `${label}: ${decrease} decreases focused slider`);
      assert.ok(configDecreased < settingBefore, `${label}: native change updates settings`);
      await page.keyboard.press(increase);
      assert.ok(
        Number(await slider.inputValue()) > decreased,
        `${label}: ${increase} increases focused slider`
      );
      assert.ok(
        (await page.evaluate((key) => window.__ENGINE__.ctx.config[key], configKey)) >
          configDecreased,
        `${label}: ${increase} updates settings`
      );
      await assertNoLeak();
    }
    await page.keyboard.press('Home');
    assert.equal(
      await slider.inputValue(),
      await slider.getAttribute('min'),
      `${label}: native Home`
    );
    await page.keyboard.press('End');
    assert.equal(
      await slider.inputValue(),
      await slider.getAttribute('max'),
      `${label}: native End`
    );
  }
  await page.getByRole('button', { name: 'off', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByRole('button', { name: 'on', exact: true })
      .evaluate((el) => el === document.activeElement),
    true
  );
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page
      .getByRole('button', { name: 'off', exact: true })
      .evaluate((el) => el === document.activeElement),
    true
  );
  await page.getByRole('button', { name: 'on', exact: true }).focus();
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.config.invertY), true);
  await page.getByRole('button', { name: 'off', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.config.invertY), false);
  await page.locator('.ow-controls').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.locator('.ow-controls').hover();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  assert.ok(
    await page.locator('.ow-controls').evaluate((el) => el.scrollTop > 0),
    'native menu wheel scrolls reference'
  );
  await assertNoLeak();
  await pump(2);
  await assertNoLeak();
  await page.locator('.ow-menu .ow-btn.primary').click();
  await page.waitForFunction(() => document.pointerLockElement === window.__ENGINE__.ctx.canvas);
  await pump();
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), false);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.time.scale), 1);
  await assertNoLeak();

  // Shop owns Escape and pointer release: closing it must not expose the pause menu.
  await page.evaluate(() => window.__ENGINE__.ctx.get('market').openShop(1));
  await pump();
  await page.keyboard.press('Escape');
  await pump();
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('market').open), false);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), false);
  await page.evaluate(() => window.__ENGINE__.ctx.get('player').applyDamage(10000, null));
  await pump(400);
  await page.keyboard.press('Escape');
  await pump(2);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), false);
  assert.ok(
    await page.locator('.ow-gameover-button').isVisible(),
    'death screen remains reachable'
  );
  await page.keyboard.press('Enter');
  await pump(4);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('player').dead), false);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').menu.open), false);
  assert.deepEqual(errors, []);

  // Terminal errors retain their native modal above the reference and freeze input.
  await page.evaluate(() => {
    window.__ENGINE__.ctx.get('ui').menu.show();
    window.__ENGINE__.fail(
      'menu-controls-test',
      'validation',
      new Error('intentional terminal error')
    );
  });
  assert.ok(await page.locator('#engine-failure').evaluate((el) => el.matches(':modal')));
  assert.equal(
    await page.locator('#engine-failure button').evaluate((el) => el === document.activeElement),
    true
  );
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.input.enabled), false);
  console.log(
    'menu-controls-e2e: ok (pause/resume no input leakage; native arrows/Home/End/PageUp/PageDown, focus/buttons/wheel, three sliders, five viewports, shop/death/error)'
  );
} finally {
  await browser.close();
  stopViteServer(server);
}
