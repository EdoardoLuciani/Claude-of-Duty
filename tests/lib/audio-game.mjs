import assert from 'node:assert/strict';

import {
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

export async function openAudioGame(port, shot = 'hero') {
  const server = await ensureViteServer({ port });
  assert(server, 'Audio integration test requires an unused port');
  let browser;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      stopViteServer(server);
    }
  };
  try {
    browser = await launchChromium({
      headless: true,
      args: [
        '--ignore-gpu-blocklist',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=${shot}`);
    await waitForGame(page, { timeout: 180000 });
    return { page, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}
