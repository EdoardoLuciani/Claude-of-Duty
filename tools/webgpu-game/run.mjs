import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataUtils } from 'three/webgpu';
import { PNG } from 'pngjs';
import { ensureViteServer, stopViteServer, launchChromium } from '../lib/browser-harness.mjs';

const port = 5193;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
const shot = process.env.SHOT ?? 'hero';
const quality = process.env.QUALITY ?? 'high';
const width = Number(process.env.WIDTH ?? 480), height = Number(process.env.HEIGHT ?? 270);
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.__WEBGL_REQUESTS__ = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).toLowerCase().startsWith('webgl') || type === 'experimental-webgl')
        window.__WEBGL_REQUESTS__++;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=${shot}&q=${quality}${process.env.NO_PREWARM ? '&prewarm=0' : ''}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const settle = process.env.RELOAD ? 90 : (process.env.EXPOSURE || process.env.INDIRECT || process.env.AO_BLUR) ? 20 : 6;
  await page.evaluate(([name, count]) => window.__APPLY_SHOT__(name, { grabFrame: count }),
    [shot, settle]);
  await page.evaluate((n) => window.__PUMP__(n), settle);
  if (process.env.RELOAD) {
    await page.evaluate(() => {
      const engine = window.__ENGINE__, weapon = engine.ctx.get('weapons');
      weapon.state.mag = 5;
      if (!weapon.reload()) throw new Error('reload test did not start');
      const original = engine.step;
      engine.step = function (...args) {
        this.camera.rotation.y += 0.002;
        return original.apply(this, args);
      };
    });
    await page.evaluate(() => window.__PUMP__(95));
  }
  if (process.env.RESIZE) {
    await page.setViewportSize({ width: width + 64, height: height + 36 });
    await page.evaluate(() => window.__PUMP__(4));
  }
  if (process.env.LIGHT_CYCLE) {
    const shadows = await page.evaluate(async () => {
      const e = window.__ENGINE__, sky = e.ctx.get('sky'), render = e.ctx.get('render');
      const flags = [];
      for (const hour of [12, 0, 12, 0]) {
        sky.setTimeOfDay(hour);
        await window.__PUMP__(1);
        flags.push(render.activeSun.castShadow);
      }
      return flags;
    });
    assert.deepEqual(shadows, [true, true, true, true],
      'cached day/night key must re-enable its CSM shadow');
  }
  if (process.env.HAZE_LIFECYCLE) {
    const phases = await page.evaluate(async () => {
      const e = window.__ENGINE__, render = e.ctx.get('render'), haze = e.ctx.get('fx').hazeSys;
      const { Vector3 } = await import('/node_modules/.vite/deps/three_webgpu.js');
      const point = new Vector3(0, 0, -3).applyMatrix4(e.camera.matrixWorld);
      haze.emit(e.time.raw, point.x, point.y, point.z, 3, 1, 1, 1);
      await window.__PUMP__(1);
      const live = haze._live && haze.uActive.value === 1;
      haze.update(e.time.raw + 2, render.depthTexture, e.camera);
      return { live, inactive: !haze._live && haze.uActive.value === 0,
        idleDraw: haze.render(render.renderer, e.camera) };
    });
    assert.deepEqual(phases, { live: true, inactive: true, idleDraw: false },
      'production haze must render live offsets and suppress them after expiry');
  }
  if (process.env.INDIRECT && ['hero', 'interior'].includes(shot)) {
    const comparison = await page.evaluate(async () => {
      const e = window.__ENGINE__, render = e.ctx.get('render'), fill = render.indirect;
      const { DataUtils } = await import('/node_modules/.vite/deps/three_webgpu.js');
      const rooms = fill.roomCount.value, sky = fill.sky.value.clone(), ground = fill.ground.value.clone();
      const width = render.screenSize.width, height = render.screenSize.height;
      const w = Math.floor(width / 12), h = Math.floor(height * 2 / 9);
      const read = async () => {
        render.renderer.setRenderTarget(null);
        render._graph.render();
        const pixels = await render.renderer.readRenderTargetPixelsAsync(render.hdrRt,
          w, Math.floor(height / 2), w, h);
        const row = (pixels.length - w * 4) / (h - 1);
        let red = 0, blue = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * row + x * 4;
          red += DataUtils.fromHalfFloat(pixels[i]);
          blue += DataUtils.fromHalfFloat(pixels[i + 2]);
        }
        return { red: red / (w * h), blue: blue / (w * h) };
      };
      const readWeapon = async () => {
        const x = Math.floor(width * 0.70), y = Math.floor(height * 0.15);
        const w = Math.floor(width * 0.08), h = Math.floor(height * 0.14);
        const pixels = await render.renderer.readRenderTargetPixelsAsync(render.viewRt, x, y, w, h);
        const row = (pixels.length - w * 4) / (h - 1);
        let red = 0;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++)
          red += DataUtils.fromHalfFloat(pixels[j * row + i * 4]);
        return red / (w * h);
      };
      try {
        const withFill = await read(), viewWithRooms = await readWeapon();
        fill.roomCount.value = 0;
        const noRooms = await read(), viewNoRooms = await readWeapon();
        fill.sky.value.set(0, 0, 0);
        fill.ground.value.set(0, 0, 0);
        const noFill = await read();
        return { rooms, withFill, noRooms, noFill, viewWithRooms, viewNoRooms };
      } finally {
        fill.roomCount.value = rooms;
        fill.sky.value.copy(sky);
        fill.ground.value.copy(ground);
      }
    });
    assert.ok(comparison.rooms > 0, 'world room volumes must reach the TSL lighting gate');
    assert.ok(Math.abs(comparison.viewWithRooms - comparison.viewNoRooms) < 0.002,
      `weapon view must bypass room volume: ${JSON.stringify(comparison)}`);
    if (shot === 'hero') {
      assert.ok(comparison.withFill.blue > comparison.noFill.blue * 1.3,
        `cool sky fill missing from shaded street: ${JSON.stringify(comparison)}`);
    } else {
      assert.ok(comparison.withFill.red < comparison.noRooms.red * 0.8,
        `room indirect gate did not darken the interior: ${JSON.stringify(comparison)}`);
    }
  }
  if (process.env.AO_BLUR) {
    const measured = await page.evaluate(async (shot) => {
      const render = window.__ENGINE__.ctx.get('render'), graph = render._graph;
      if (!graph.aoPass || !graph.aoBlur) throw new Error('high-quality AO blur is absent');
      const w = render.screenSize.width, h = render.screenSize.height;
      const x = Math.floor(w * (shot === 'interior' ? .02 : .073));
      const y = Math.floor(h * (shot === 'interior' ? .12 : .26));
      // R8 readback in r186 needs a four-byte-aligned final row. The ROI is
      // interior, so omitting up to three rightmost raw texels is safe.
      const rw = Math.floor(w * .25 / 4) * 4, rh = Math.floor(h * .34);
      const rawRT = graph.aoPass._aoRenderTarget;
      const blurRT = graph.aoBlur.textureNode.renderTarget;
      const rawWidth = rawRT.width - rawRT.width % 4;
      const raw = await render.renderer.readRenderTargetPixelsAsync(
        rawRT, 0, 0, rawWidth, rawRT.height);
      const blurred = await render.renderer.readRenderTargetPixelsAsync(blurRT, x, y, rw, rh);
      const depthIndex = graph.prePass.renderTarget.textures.findIndex(t => t.name === 'linearDepth');
      const depth = await render.renderer.readRenderTargetPixelsAsync(
        graph.prePass.renderTarget, x, y, rw, rh, depthIndex);
      const { DataUtils } = await import('/node_modules/.vite/deps/three_webgpu.js');
      const row = (depth.length - rw * 4) / (rh - 1);
      const rawRow = (raw.length - rawWidth) / (rawRT.height - 1);
      const blurRow = (blurred.length - rw) / (rh - 1);
      // Match the raw texture's linear upsampling at the full-resolution ROI.
      const sampleRaw = (i, j) => {
        const px = (x + i + .5) * rawRT.width / w - .5;
        const py = (y + j + .5) * rawRT.height / h - .5;
        const ix = Math.floor(px), iy = Math.floor(py), tx = px - ix, ty = py - iy;
        const a = iy * rawRow + ix, b = a + rawRow;
        const top = raw[a] + (raw[a + 1] - raw[a]) * tx;
        const bottom = raw[b] + (raw[b + 1] - raw[b]) * tx;
        return top + (bottom - top) * ty;
      };
      let rawEdge = 0, blurEdge = 0, pairs = 0, sky = 0, skySum = 0;
      let rawNoise = 0, blurNoise = 0, noisePairs = 0;
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
        const k = j * row + i * 4, d = DataUtils.fromHalfFloat(depth[k]);
        if (d <= 0) { sky++; skySum += blurred[j * blurRow + i] / 255; continue; }
        if (i + 1 === rw) continue;
        const next = DataUtils.fromHalfFloat(depth[k + 4]);
        if (next <= 0 || Math.abs(d - next) > .03 * Math.max(1, d)) continue;
        const b = j * blurRow + i;
        rawEdge += Math.abs(sampleRaw(i, j) - sampleRaw(i + 1, j));
        blurEdge += Math.abs(blurred[b] - blurred[b + 1]);
        pairs++;
        if (i + 2 >= rw) continue;
        const last = DataUtils.fromHalfFloat(depth[k + 8]);
        if (last <= 0 || Math.abs(d - last) > .03 * Math.max(1, d)) continue;
        rawNoise += Math.abs(sampleRaw(i, j) - 2 * sampleRaw(i + 1, j) + sampleRaw(i + 2, j));
        blurNoise += Math.abs(blurred[b] - 2 * blurred[b + 1] + blurred[b + 2]);
        noisePairs++;
      }
      return { rawSize: [rawRT.width, rawRT.height], blurSize: [blurRT.width, blurRT.height],
        depthSize: [graph.prePass.renderTarget.width, graph.prePass.renderTarget.height],
        resolutionScale: graph.aoPass.resolutionScale,
        radius: graph.aoPass.radius.value, strength: graph.aoPass.scale.value,
        expected: [w, h], linked: render.aoTexture === blurRT.texture,
        rawEdge: rawEdge / pairs, blurEdge: blurEdge / pairs,
        rawNoise: rawNoise / noisePairs, blurNoise: blurNoise / noisePairs,
        skyPixels: sky, skyMean: sky ? skySum / sky : null };
    }, shot);
    assert.deepEqual(measured.blurSize, measured.expected, 'blur must track drawing resolution');
    assert.equal(measured.resolutionScale, .5, 'GTAO must use the temporary half-resolution setting');
    assert.equal(measured.radius, .25, 'AO radius must remain unchanged');
    assert.equal(measured.strength, 1, 'AO strength must remain unchanged');
    assert.deepEqual(measured.rawSize, measured.expected.map(n => Math.round(n * .5)),
      'raw AO must track half the drawing resolution');
    assert.deepEqual(measured.depthSize, measured.expected, 'prepass must remain full resolution');
    assert.equal(measured.linked, true, 'exposed AO buffer must be the filtered texture');
    // Curvature measures high-frequency variation without counting smooth
    // gradients already produced by linear upsampling as noise.
    assert.ok(measured.rawNoise > .5 && measured.blurNoise < measured.rawNoise * .5,
      `AO blur did not suppress noise on same-depth surfaces: ${JSON.stringify(measured)}`);
    assert.ok(measured.blurEdge <= measured.rawEdge,
      `AO blur increased total variation: ${JSON.stringify(measured)}`);
    if (measured.skyPixels) assert.ok(measured.skyMean > .99,
      `depth-aware blur darkened the sky behind foreground objects: ${JSON.stringify(measured)}`);
    console.log(JSON.stringify({ aoBlur: measured }));
  }
  if (process.env.PRACTICALS) {
    const lights = await page.evaluate(() => {
      const world = window.__ENGINE__.ctx.get('world'), light = world.bulbs[0];
      return { actual: light.intensity, day: light.userData.owDayIntensity,
        night: light.userData.owNightIntensity, mix: world._lampMix };
    });
    const expected = (lights.day + (lights.night - lights.day) * lights.mix) * 0.55;
    assert.ok(Math.abs(lights.actual - expected) < 1e-5,
      `room practical lost the authored gain: ${JSON.stringify(lights)} expected ${expected}`);
  }
  if (process.env.FOG_CAMERA) {
    const bound = await page.evaluate(() => {
      const e = window.__ENGINE__, sky = e.ctx.get('sky'), render = e.ctx.get('render');
      const original = sky.createFogNode;
      let inputs;
      sky.createFogNode = function (args) { inputs = args; return original.call(this, args); };
      try {
        render._releaseGraph(); render._getGraph();
        return { projection: inputs?.invProj?.value === e.camera.projectionMatrixInverse,
          world: inputs?.camWorld?.value === e.camera.matrixWorld,
          position: inputs?.camPos?.value === e.camera.position };
      } finally { sky.createFogNode = original; }
    });
    assert.deepEqual(bound, { projection: true, world: true, position: true },
      'fog must read live gameplay camera uniforms rather than fullscreen camera');
    await page.evaluate(() => window.__ENGINE__.ctx.get('render').render(window.__ENGINE__.ctx));
  }
  const result = await page.evaluate(async () => {
    const engine = window.__ENGINE__, owner = engine.ctx.get('render');
    const renderer = owner.renderer, target = owner.hdrRt;
    const w = owner.screenSize.width, h = owner.screenSize.height;
    const x = Math.max(0, (w >> 1) - 16), y = Math.max(0, (h >> 1) - 16);
    const samples = await renderer.readRenderTargetPixelsAsync(target, x, y, 32, 32);
    const view = await renderer.readRenderTargetPixelsAsync(owner.viewRt, 10, h - 10, 1, 1);
    const haze = engine.ctx.get('fx').hazeSys.rt;
    return { backend: renderer.backend.constructor.name, frame: engine.time.frame,
      hazeSize: haze ? [haze.width, haze.height] : null,
      worldMeshes: engine.ctx.get('world').meshes.length, w, h,
      webglRequests: window.__WEBGL_REQUESTS__, viewCorner: [...view],
      pixels: Array.from(samples) };
  });
  assert.deepEqual(errors, [], `game errors: ${errors.slice(0, 5).join('\n')}`);
  assert.equal(result.backend, 'WebGPUBackend');
  assert.equal(result.webglRequests, 0);
  assert.equal(result.worldMeshes, 211);
  if (process.env.EXPOSURE) {
    const exposure = await page.evaluate(async () => {
      const render = window.__ENGINE__.ctx.get('render');
      await render._meterTask;
      return render._exposure;
    });
    // These are tighter scene-specific bounds after replacing the white ambient
    // and full-strength diffuse PMREM with the authored indirect-light budget.
    // The old targets metered a different HDR scene; keep this numeric regression
    // check alongside INDIRECT's pixel-level on/off tests, not instead of them.
    const bounds = { hero: [3.2, 3.7], interior: [4.8, 5.1],
      weapon: [4.5, 5.1], night: [4.8, 5.1] }[shot];
    if (bounds) assert.ok(exposure >= bounds[0] && exposure <= bounds[1],
      `${shot} scene-wide exposure ${exposure} outside indirect-budget bounds ${bounds}`);
  }
  assert.deepEqual(result.hazeSize, [Math.floor(result.w / 2), Math.floor(result.h / 2)],
    'gameplay haze target must track the internal drawing resolution');
  if (process.env.RESIZE) assert.ok(result.w > width && result.h > height,
    'gameplay resize must update the world and view targets');
  assert.equal(DataUtils.fromHalfFloat(result.viewCorner[3]), 0,
    'empty view pixel must be transparent; opaque clear hides the world');
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < result.pixels.length; i += 4) {
    const n = DataUtils.fromHalfFloat(result.pixels[i]);
    min = Math.min(min, n); max = Math.max(max, n);
  }
  assert.ok(max > 0.01 && max - min > 0.002,
    `world HDR pass is blank: min=${min}, max=${max}`);
  delete result.pixels;
  console.log(JSON.stringify({ ...result, min, max }));
  if (process.env.CAPTURE_DIR) {
    // Headless Chromium can screenshot a black WebGPU swapchain; read back the
    // actual final pipeline into an offscreen LDR target instead.
    const readback = await page.evaluate(async () => {
      const r = window.__ENGINE__.ctx.get('render');
      const { RenderTarget } = await import('/node_modules/.vite/deps/three_webgpu.js');
      const rt = new RenderTarget(r.screenSize.width, r.screenSize.height);
      try {
        r.renderer.setRenderTarget(rt);
        r._graph.render();
        const data = await r.renderer.readRenderTargetPixelsAsync(
          rt, 0, 0, r.screenSize.width, r.screenSize.height);
        return { pixels: Array.from(data), width: r.screenSize.width, height: r.screenSize.height };
      } finally {
        r.renderer.setRenderTarget(null);
        rt.dispose();
      }
    });
    const row = (readback.pixels.length - readback.width * 4) / (readback.height - 1);
    assert.ok(Number.isInteger(row) && row >= readback.width * 4);
    const png = new PNG({ width: readback.width, height: readback.height });
    let lit = 0;
    for (let y = 0; y < readback.height; y++)
      for (let i = 0; i < readback.width * 4; i++) {
        const value = readback.pixels[y * row + i];
        png.data[y * readback.width * 4 + i] = value;
        if (i % 4 !== 3 && value > 20) lit++;
      }
    assert.ok(lit > readback.width * readback.height * 0.1,
      `final composition is blank: ${lit} lit channels`);
    if (shot === 'hero' && !process.env.RESIZE) {
      // At this authored noon pose the centre-upper ray is clear blue sky.
      // Marching fog through cleared-depth sky pixels hides all clouds and
      // collapses the skyline into a uniform neutral grey.
      const i = (((readback.height * .2) | 0) * readback.width +
        ((readback.width * .5) | 0)) * 4;
      assert.ok(png.data[i + 2] > png.data[i] + 20,
        `visible sky was flattened by fog: ${Array.from(png.data.subarray(i, i + 3))}`);
    }
    if (process.env.RELOAD) {
      let white = 0;
      for (let y = (readback.height * .45) | 0; y < readback.height * .82; y++)
        for (let x = (readback.width * .35) | 0; x < readback.width * .65; x++) {
          const i = (y * readback.width + x) * 4;
          if (png.data[i] > 235 && png.data[i + 1] > 220 && png.data[i + 2] > 220) white++;
        }
      assert.ok(white < readback.width * readback.height * .004,
        `two saturated view glints bloomed into ${white} white reload pixels`);
    }
    mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
    writeFileSync(join(process.env.CAPTURE_DIR, `${shot}.png`), PNG.sync.write(png));
  }
  await page.evaluate(() => window.__ENGINE__.dispose());
  assert.deepEqual(errors, [], `disposal errors: ${errors.slice(0, 5).join('\n')}`);
} finally {
  await browser.close();
  await stopViteServer(server);
}
