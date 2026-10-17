import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from './browser-harness.mjs';
import { waitForGame, captureNative } from './native-render.mjs';

/** Shared native browser lifetime; scenarios and weapon-specific assertions stay in each test. */
export async function openGameReview({
  port,
  out,
  viewport = { width: 1280, height: 720 },
  args = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
}) {
  mkdirSync(out, { recursive: true });
  const server = await ensureViteServer({ port });
  let browser;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      stopViteServer(server);
    }
  };
  try {
    browser = await launchChromium({ webgpu: true, headless: true, args });
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [],
      warnings = [];
    collectBrowserErrors(page, errors, { warnings });
    page.on('console', (message) => {
      if (
        message.type() === 'warning' &&
        /GPUValidationError|validation error|Error while parsing WGSL/i.test(message.text())
      )
        errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    const pump = (n) => page.evaluate((n) => window.__PUMP__(n), n);
    const capture = async (name) => {
      await page.evaluate(() => window.__PRESENT__(2));
      await captureNative(page, `${out}/${name}.png`);
    };
    const boot = async (timeout = 120000) => {
      await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForGame(page, { timeout });
    };
    return { page, errors, warnings, pump, capture, boot, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function setWeaponMode(page, review, mode) {
  await page.evaluate(
    ({ review, mode }) => {
      window[review].w.debugMode = mode;
    },
    { review, mode }
  );
}

export async function requestReload(page, review, state) {
  assert(
    await page.evaluate(
      ({ review, state }) => {
        const w = window[review].w;
        Object.assign(w.state, state);
        return w.reload();
      },
      { review, state }
    ),
    'reload accepted'
  );
}

/** One event and casing per accepted shot, including the final scheduled ejection. */
export async function checkFireBurst(page, pump, capture, review, frames = 6) {
  const counts = () =>
    page.evaluate((review) => {
      const { shots, shells } = window[review];
      return { shots, shells };
    }, review);
  const before = await counts();
  for (let i = 0; i < 8; i++) {
    assert(await page.evaluate((review) => window[review].w.tryFire(), review));
    await pump(frames);
  }
  await capture('fire');
  const after = await counts();
  assert.equal(after.shots - before.shots, 8);
  assert.equal(after.shells - before.shells, 8);
  return after;
}
