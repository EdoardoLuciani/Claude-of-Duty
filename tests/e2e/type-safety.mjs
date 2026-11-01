import assert from 'node:assert/strict';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5311);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({
    headless: true,
    webgpu: false,
    ...(args.executable ? { executablePath: String(args.executable) } : {}),
  });
  const page = await browser.newPage();
  const errors = [];
  collectBrowserErrors(page, errors);
  const url = `http://127.0.0.1:${port}/type-safety-fixture`;
  // Keep a same-origin page for importing production code, without booting FPS/GPU.
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
  );
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const { isImageBitmap } = await import('/src/core/guards.ts');
    const plain = { width: 1, height: 1, close() {} };
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable');
    let rejected = false;
    try {
      context.drawImage(plain, 0, 0);
    } catch (error) {
      rejected = error instanceof TypeError;
    }
    const bitmap = await createImageBitmap(
      new ImageData(new Uint8ClampedArray([13, 27, 49, 255]), 1, 1)
    );
    try {
      const accepted = isImageBitmap(bitmap);
      if (accepted) context.drawImage(bitmap, 0, 0);
      return {
        plainAccepted: isImageBitmap(plain),
        canvasRejectedPlain: rejected,
        realAccepted: accepted,
        pixel: Array.from(context.getImageData(0, 0, 1, 1).data),
      };
    } finally {
      bitmap.close();
    }
  });
  assert.deepEqual(result, {
    plainAccepted: false,
    canvasRejectedPlain: true,
    realAccepted: true,
    pixel: [13, 27, 49, 255],
  });
  assert.deepEqual(errors, []);
  console.log(
    'Browser image guard: plain lookalike rejected; native ImageBitmap accepted and drawn'
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
