import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const server = await ensureViteServer({ port: 5193, root: process.cwd() });
const browser = await launchChromium({ webgpu: false, headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    window.__WEBGL_REQUESTS__ = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).toLowerCase().includes('webgl')) window.__WEBGL_REQUESTS__++;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto('http://127.0.0.1:5193/');
  await page.waitForFunction(() => document.body.textContent.includes('BOOT FAILURE'));
  const result = await page.evaluate(() => ({
    error: document.body.textContent.includes('WebGPU is required to play'),
    requests: window.__WEBGL_REQUESTS__, started: !!window.__ENGINE__,
  }));
  assert.deepEqual(result, { error: true, requests: 0, started: false });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await stopViteServer(server);
}
