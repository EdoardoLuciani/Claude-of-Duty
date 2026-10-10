import assert from 'node:assert/strict';
import { trackNodeBuilders } from '../../src/dev/native-builds.js';
import { packedReadback } from './native-readback.js';

/** Fail on the actual boot dialog, rather than spending the readiness timeout. */
export async function waitForGame(page, { timeout = 120000 } = {}) {
  await page.waitForFunction(() => window.__READY__ === true ||
    !!document.getElementById('engine-failure'), null, { timeout });
  const error = await page.evaluate(() => document.getElementById('engine-failure')?.textContent);
  if (error) throw new Error(error);
  await verifyNative(page);
}

export async function verifyNative(page) {
  // Serialize the self-contained observer through Playwright, also on builds
  // which do not serve development module URLs. No runtime renderer interception.
  const device = await page.evaluate(`(() => {
    const trackNodeBuilders = ${trackNodeBuilders.toString()};
    const r = window.__ENGINE__.ctx.get('render').renderer;
    if (!r.backend.isWebGPUBackend) throw new Error('native WebGPU required');
    if (!r.debug) throw new Error('node-builder diagnostics unavailable');
    const a = r.backend.device.adapterInfo;
    window.__NATIVE_BUILDS__ = 0;
    window.__NATIVE_BUILD_INFO__ = [];
    window.__NATIVE_BUILD_OBSERVER__?.dispose();
    window.__NATIVE_BUILD_OBSERVER__ = trackNodeBuilders(r, { onBuild(builder, object) {
      window.__NATIVE_BUILDS__++;
      window.__NATIVE_BUILD_INFO__.push({ material: object.material?.name, type: object.material?.type,
        object: builder.object?.name, scene: object.scene?.name, pass: object.passId });
    } });
    return { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter };
  })()`);
  assert.equal(device.fallback, false);
  if (process.env.MESA_VK_DEVICE_SELECT === '1002:7550!')
    assert.deepEqual(device, { vendor: 'amd', architecture: 'rdna-4', fallback: false });
  console.log('Actual native device:', device);
  return device;
}

/** Read the actual native final output under the normal DOM HUD. Swapchain-only
 * screenshots can be black under headless Vulkan even though rendering works. */
export async function captureNative(page, path, options = {}) {
  await page.evaluate(`(async () => {
    const packedReadback = ${packedReadback.toString()};
    const r = window.__ENGINE__.ctx.get('render');
    // Use the running renderer's target class; also works in the minified build
    // where development fixture/module URLs do not exist.
    const w = r.screenSize.width, h = r.screenSize.height;
    const target = new r.viewRt.constructor(w, h);
    const previous = r.renderer.getRenderTarget();
    const face = r.renderer.getActiveCubeFace(), mip = r.renderer.getActiveMipmapLevel();
    let pixels;
    try {
      r.renderer.setRenderTarget(target); r._graph.render();
      pixels = await r.renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
    } finally { r.renderer.setRenderTarget(previous, face, mip); target.dispose(); }
    const packed = new Uint8ClampedArray(packedReadback(pixels, w, h));
    let lit = 0;
    for (let i = 0; i < packed.length; i += 4) if (Math.max(packed[i], packed[i + 1], packed[i + 2]) > 0) lit++;
    if (lit < 32) throw new Error('blank native capture');
    const overlay = document.createElement('canvas');
    overlay.id = 'native-test-capture'; overlay.width = w; overlay.height = h;
    overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none';
    overlay.getContext('2d').putImageData(new ImageData(packed, w, h), 0, 0);
    document.body.append(overlay);
  })()`);
  try { await page.screenshot({ ...options, path }); }
  finally { await page.evaluate(() => document.getElementById('native-test-capture')?.remove()); }
}
