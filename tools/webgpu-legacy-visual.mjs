/** Matched legacy/native final-frame captures, without HUD or swapchain readback.
 * Native's missing legacy RNG reservation is restored ONLY in this harness.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs(), root = resolve(String(args.root ?? '.'));
const backend = String(args.backend ?? 'webgpu'), out = resolve(String(args.out ?? '/tmp/legacy-visual'));
const width = Number(args.width ?? 1920), height = Number(args.height ?? 1080);
const settle = Number(args.settle ?? 180), port = Number(args.port ?? 5302);
const shots = String(args.shots ?? 'hero,interior,night,detail,weapon,ads,muzzle,combat,reload,hero-repeat,night-repeat').split(',');
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
assert(['webgl', 'webgpu'].includes(backend));
const physicalArm = args['physical-arm'] === '1', f90Control = args['f90-control'] === '1';
if (physicalArm || f90Control) assert.equal(backend, 'webgpu');
mkdirSync(out, { recursive: true });
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const server = await ensureViteServer({ root, port });
let browser;
const results = [];
try {
  browser = await launchChromium({ headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--use-angle=vulkan', '--enable-features=Vulkan',
      '--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-unsafe-webgpu', '--force-color-profile=srgb'],
  });
  for (const name of shots) {
    const shot = name === 'reload' ? 'weapon' : name.replace('-repeat', '');
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      if (physicalArm) await page.route('**/src/weapons/arm-asset.js*', async route => {
        const response = await route.fetch(), body = await response.text();
        assert(body.includes('new MeshStandardNodeMaterial()'), 'arm conversion has changed; revisit this control');
        await route.fulfill({ response, body: body.replaceAll('MeshStandardNodeMaterial', 'MeshPhysicalNodeMaterial')
          .replace('THREE.MeshStandardMaterial.prototype.copy', 'THREE.MeshPhysicalMaterial.prototype.copy') });
      });
      if (f90Control) await page.route('**/node_modules/.vite/deps/three_webgpu.js*', async route => {
        const response = await route.fetch(), body = await response.text();
        const pattern = /(let specularBRDF = BRDF_GGX\(\{\s+lightDirection,\s+f0: specularColorBlended,\s+f90: )1/;
        assert(pattern.test(body), 'pinned native direct-BRDF probe no longer matches');
        await route.fulfill({ response, body: body.replace(pattern, '$1specularF90') });
      });
      if (backend === 'webgpu') await page.route('**/src/render/index-webgpu.js*', async route => {
        const response = await route.fetch(), body = await response.text(), marker = '    this.ctx = ctx;';
        assert.equal(body.split(marker).length, 2);
        assert(!body.includes('ctx.rng.fork('), 'remove the diagnostic reservation once production is fixed');
        await route.fulfill({ response, body: body.replace(marker, `${marker}\n    ctx.rng.fork(); // diagnostic legacy stream reservation`) });
      });
      await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=${shot}&q=high`);
      await page.waitForFunction('window.__READY__===true', null, { timeout: 120000 });
      const device = await page.evaluate(() => {
        const r = window.__ENGINE__.ctx.get('render').renderer;
        if (r.backend) {
          const a = r.backend.device.adapterInfo;
          return { backend: 'webgpu', vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter };
        }
        const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { backend: 'webgl', renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
      });
      assert.equal(device.backend, backend);
      if (backend === 'webgpu') {
        assert.equal(device.vendor, 'amd'); assert.equal(device.architecture, 'rdna-4'); assert.equal(device.fallback, false);
      } else assert.match(device.renderer, /RX 9070 XT|GFX1201/i);
      const captured = await page.evaluate(async ({ shot, name, settle, width, height }) => {
        const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
        const native = !!renderer.backend;
        const T = await import(native ? '/node_modules/.vite/deps/three_webgpu.js' : '/node_modules/.vite/deps/three.js');
        window.__APPLY_SHOT__(shot, { grabFrame: settle });
        await window.__PUMP__(settle - 1);
        if (name === 'reload') {
          await window.__PUMP__(1);
          const w = e.ctx.get('weapons'); w.state.mag = 5;
          if (!w.reload()) throw new Error('reload did not start');
          await window.__PUMP__(69);
        }
        const target = native ? new T.RenderTarget(width, height, { depthBuffer: false }) :
          new T.WebGLRenderTarget(width, height, { depthBuffer: false });
        const setTarget = renderer.setRenderTarget;
        const capture = async (advance) => {
          // Redirect default-framebuffer writes only. Intermediate passes retain
          // their own targets. Both final composites already encode sRGB.
          renderer.setRenderTarget = function (rt, ...rest) { return setTarget.call(this, rt ?? target, ...rest); };
          try { if (advance) await window.__PUMP__(1); else r.render(e.ctx); }
          finally { renderer.setRenderTarget = setTarget; setTarget.call(renderer, null); }
          let raw;
          if (native) raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
          else { raw = new Uint8Array(width * height * 4); renderer.readRenderTargetPixels(target, 0, 0, width, height, raw); }
          const stride = (raw.length - width * 4) / (height - 1);
          if (!Number.isInteger(stride) || stride < width * 4) throw new Error('unexpected readback stride');
          const packed = new Uint8ClampedArray(width * height * 4);
          for (let y = 0; y < height; y++) {
            const sy = native ? y : height - y - 1;
            packed.set(raw.subarray(sy * stride, sy * stride + width * 4), y * width * 4);
          }
          let sum = 0, nonzero = 0;
          for (let i = 0; i < packed.length; i += 4) { sum += packed[i] + packed[i + 1] + packed[i + 2]; if (packed[i] + packed[i + 1] + packed[i + 2] > 6) nonzero++; }
          if (nonzero < width * height * .01) throw new Error('blank final capture');
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          canvas.getContext('2d').putImageData(new ImageData(packed, width, height), 0, 0);
          return { png: canvas.toDataURL('image/png').split(',')[1], meanRGB: sum / (width * height * 3) };
        };
        try {
          const image = await capture(true);
          const w = e.ctx.get('weapons');
          let exposure;
          if (native) exposure = r._graph.exposure.value;
          else {
            const data = new Float32Array(4);
            renderer.readRenderTargetPixels(r.exposure.adapt[r.exposure._flip], 0, 0, 1, 1, data);
            exposure = data[0];
          }
          const state = { frame: e.time.frame, elapsed: e.time.elapsed,
            camera: e.camera.position.toArray(), rotation: e.camera.quaternion.toArray(), fov: e.camera.fov,
            clip: w.viewmodel.clipName, clipTime: w.viewmodel.clipT, mag: w.state.mag,
            exposure, targets: { world: [r.hdrRt.width, r.hdrRt.height], view: [r.viewRt.width, r.viewRt.height] },
            viewSamples: r.viewRt.samples };
          let fixed = null;
          if (['hero', 'interior', 'night'].includes(name)) {
            // Diagnostic only: common exposure, no simulation advance. One extra
            // render updates temporal history; this is not a same-history A/B.
            await r._meterTask;
            if (native) { r.settings.autoExposure = false; r._exposure = 3; }
            else {
              const tex = new T.DataTexture(new Float32Array([3, 0, 0, 1]), 1, 1, T.RGBAFormat, T.FloatType);
              tex.needsUpdate = true;
              const update = r.exposure.update;
              r.exposure.update = () => tex;
              try { fixed = await capture(false); }
              finally { r.exposure.update = update; tex.dispose(); }
            }
            if (native) fixed = await capture(false);
          }
          return { image, fixed, state };
        } finally { target.dispose(); }
      }, { shot, name, settle, width, height });
      writeFileSync(`${out}/${backend}-${name}.png`, Buffer.from(captured.image.png, 'base64'));
      if (captured.fixed) writeFileSync(`${out}/${backend}-${name}-fixed.png`, Buffer.from(captured.fixed.png, 'base64'));
      assert.deepEqual(captured.state.targets.world, [width, height]);
      assert.deepEqual(captured.state.targets.view, [width, height]);
      assert.deepEqual(errors, []);
      results.push({ name, device, ...captured.state, meanRGB: captured.image.meanRGB, errors });
      writeFileSync(`${out}/${backend}.json`, JSON.stringify({ revision, backend, width, height, settle, physicalArm, f90Control, results }, null, 2));
      console.log(JSON.stringify(results.at(-1)));
      await page.evaluate(() => window.__ENGINE__.dispose());
    } finally { await page.close(); }
  }
} finally { await browser?.close(); await stopViteServer(server); }
