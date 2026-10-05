import assert from 'node:assert/strict';

/** Fail on the actual boot dialog, rather than spending the readiness timeout. */
export async function waitForGame(page, { timeout = 120000 } = {}) {
  await page.waitForFunction(() => window.__READY__ === true ||
    !!document.getElementById('engine-failure'), null, { timeout });
  const error = await page.evaluate(() => document.getElementById('engine-failure')?.textContent);
  if (error) throw new Error(error);
  await verifyNative(page);
}

export async function verifyNative(page) {
  const device = await page.evaluate(() => {
    const r = window.__ENGINE__.ctx.get('render').renderer;
    if (!r.backend.isWebGPUBackend) throw new Error('native WebGPU required');
    const a = r.backend.device.adapterInfo;
    window.__NATIVE_BUILDS__ = 0;
    window.__NATIVE_BUILD_INFO__ = [];
    const previous = r.debug.onNodeBuilderCreated;
    r.debug.onNodeBuilderCreated = (...args) => {
      window.__NATIVE_BUILDS__++;
      const [builder, object] = args;
      window.__NATIVE_BUILD_INFO__.push({ material: object.material?.name, type: object.material?.type,
        object: builder.object?.name, scene: object.scene?.name, pass: object.passId });
      previous?.(...args);
    };
    return { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter };
  });
  assert.equal(device.fallback, false);
  if (process.env.MESA_VK_DEVICE_SELECT === '1002:7550!')
    assert.deepEqual(device, { vendor: 'amd', architecture: 'rdna-4', fallback: false });
  console.log('Actual native device:', device);
  return device;
}

/** Read the actual native final output under the normal DOM HUD. Swapchain-only
 * screenshots can be black under headless Vulkan even though rendering works. */
export async function captureNative(page, path, options = {}) {
  await page.evaluate(async () => {
    const r = window.__ENGINE__.ctx.get('render');
    // Use the running renderer's target class; also works in the minified build
    // where development fixture/module URLs do not exist.
    const w = r.screenSize.width, h = r.screenSize.height;
    const target = new r.viewRt.constructor(w, h);
    const previous = r.renderer.getRenderTarget(); let pixels;
    try {
      r.renderer.setRenderTarget(target); r._graph.render();
      pixels = await r.renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
    } finally { r.renderer.setRenderTarget(previous); target.dispose(); }
    const stride = h === 1 ? w * 4 : (pixels.length - w * 4) / (h - 1);
    if (!Number.isInteger(stride) || stride < w * 4) throw new Error('invalid readback stride');
    const packed = new Uint8ClampedArray(w * h * 4);
    let lit = 0;
    for (let y = 0; y < h; y++) packed.set(pixels.subarray(y * stride, y * stride + w * 4), y * w * 4);
    for (let i = 0; i < packed.length; i += 4) if (Math.max(packed[i], packed[i + 1], packed[i + 2]) > 0) lit++;
    if (lit < 32) throw new Error('blank native capture');
    const overlay = document.createElement('canvas');
    overlay.id = 'native-test-capture'; overlay.width = w; overlay.height = h;
    overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none';
    overlay.getContext('2d').putImageData(new ImageData(packed, w, h), 0, 0);
    document.body.append(overlay);
  });
  try { await page.screenshot({ ...options, path }); }
  finally { await page.evaluate(() => document.getElementById('native-test-capture')?.remove()); }
}
