import assert from 'node:assert/strict';
import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from './lib/browser-harness.mjs';
import { installDevicePolicy } from './lib/native-render.mjs';
const port = 5360,
  server = await ensureViteServer({ port });
let browser;
const url = `http://127.0.0.1:${port}`;
const guard = `const info = this.renderer.backend.device.adapterInfo;
  window.__ASSERT_HARDWARE_DEVICE__({ vendor: info.vendor, architecture: info.architecture, fallback: info.isFallbackAdapter });`;
const loss = `this.renderer.onDeviceLost({ api: 'WebGPU', reason: 'unknown', message: 'review injected device loss' });`;
try {
  browser = await launchChromium({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--mute-audio'],
  });
  // Both unsupported paths must reject before touching WebGL.
  for (const noAdapter of [false, true]) {
    const context = await browser.newContext();
    try {
      await context.addInitScript((refuse) => {
        Object.defineProperty(navigator, 'gpu', {
          value: refuse ? { requestAdapter: async () => null } : undefined,
          configurable: true,
        });
        window.__WEBGL_REQUESTS__ = 0;
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          if (kind.startsWith('webgl')) window.__WEBGL_REQUESTS__++;
          return getContext.call(this, kind, ...args);
        };
      }, noAdapter);
      const p = await context.newPage();
      await p.route('**/unsupported', (r) =>
        r.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' })
      );
      await p.goto(url + '/unsupported');
      const rejected = await p.evaluate(async () => {
        const { createWebGpuRenderer } = await import('/src/render/webgpu-device.ts');
        try {
          await createWebGpuRenderer(document.querySelector('canvas'));
          return null;
        } catch (error) {
          return { error: error.message, webgl: window.__WEBGL_REQUESTS__ };
        }
      });
      assert.match(
        rejected.error,
        noAdapter ? /Unable to create WebGPU adapter/ : /WebGPU is required/
      );
      assert.equal(rejected.webgl, 0);
    } finally {
      await context.close();
    }
  }
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors = [];
  collectBrowserErrors(page, errors);
  await installDevicePolicy(page);
  await page.route('**/__fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' })
  );
  // TRAA now owns its depth/history cleanup upstream. Keep negatives at that
  // ownership boundary rather than requiring the removed r186 workarounds.
  if (['taa-depth', 'taa-history'].includes(process.env.REVIEW_NEGATIVE))
    await page.route('**/*TRAANode*.js*', async (route) => {
      const response = await route.fetch(),
        body = await response.text();
      const marker =
        process.env.REVIEW_NEGATIVE === 'taa-depth'
          ? /this\._previousDepthNode = texture\(\s*this\._historyRenderTarget\.depthTexture\s*\)/g
          : /this\._historyRenderTarget\.dispose\(\);/g;
      assert.equal([...body.matchAll(marker)].length, 1, 'upstream TRAA negative must execute');
      const replacement =
        process.env.REVIEW_NEGATIVE === 'taa-depth'
          ? 'this._previousDepthNode = texture( new DepthTexture( 1, 1 ) )'
          : '';
      await route.fulfill({ response, body: body.replace(marker, replacement) });
    });
  if (['ownership', 'callbacks'].includes(process.env.REVIEW_NEGATIVE))
    await page.route('**/src/render/webgpu-pipeline.ts', async (route) => {
      const response = await route.fetch(),
        body = await response.text();
      const marker = {
        ownership: 'for (const node of intermediates) node.dispose();',
        callbacks: 'if (viewScene.onBeforeRender === beforeView) ',
      }[process.env.REVIEW_NEGATIVE];
      assert(body.includes(marker));
      await route.fulfill({ response, body: body.replace(marker, '') });
    });
  if (process.env.REVIEW_NEGATIVE === 'pass-state')
    await page.route('**/src/render/index-webgpu.ts', async (route) => {
      const response = await route.fetch(),
        body = await response.text();
      const marker = 'Object.assign(this.renderer, rendererState);';
      assert(body.includes(marker));
      await route.fulfill({ response, body: body.replace(marker, '') });
    });
  await page.goto(`${url}/__fixture`);
  const lifetime = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.ts');
    const { createWorldViewPipeline } = await import('/src/render/webgpu-pipeline.ts');
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'));
    const info = renderer.backend.device.adapterInfo;
    window.__ASSERT_HARDWARE_DEVICE__({
      vendor: info.vendor,
      architecture: info.architecture,
      fallback: info.isFallbackAdapter,
    });
    renderer.setSize(480, 270);
    const liveTextures = new Set();
    const createTexture = renderer.info.createTexture.bind(renderer.info);
    const destroyTexture = renderer.info.destroyTexture.bind(renderer.info);
    renderer.info.createTexture = (t) => {
      liveTextures.add(t);
      createTexture(t);
    };
    renderer.info.destroyTexture = (t) => {
      liveTextures.delete(t);
      destroyTexture(t);
    };
    const scene = new T.Scene(),
      view = new T.Scene();
    const camera = new T.PerspectiveCamera(),
      viewCamera = new T.PerspectiveCamera();
    scene.background = new T.Color(0x123456);
    const rows = [];
    for (const mode of ['warp', 'post', 'ssr-fog', 'compute-fog', 'taa-build', 'taa'])
      for (let i = 0; i < 3; i++) {
        const owned = [],
          disposed = [];
        let borrowed;
        const watch = (node) => {
          if (!node.isRTTNode) return node.sample(N.screenUV).mul(1);
          const index = owned.length;
          owned.push(node);
          disposed.push(0);
          node.renderTarget.addEventListener('dispose', () => disposed[index]++);
          return node.sample(N.screenUV).mul(1);
        };
        const graph = createWorldViewPipeline(renderer, scene, camera, view, viewCamera, {
          gtao: false,
          taa: mode.startsWith('taa'),
          bloomStrength: 0,
          ssrEnabled: mode === 'ssr-fog',
          fogCompute: mode === 'compute-fog',
          fog: ({ color, uv = N.screenUV }) => {
            if (mode === 'compute-fog') {
              borrowed = color;
              return color.sample(uv).rgb;
            }
            if (color.isRTTNode) return watch(color);
            borrowed = color;
            return color;
          },
          warp: watch,
          postPasses: mode === 'post' ? [{ asNode: watch }] : [],
        });
        graph.render();
        await renderer.backend.device.queue.onSubmittedWorkDone();
        if (mode === 'taa') {
          await new Promise(requestAnimationFrame);
          graph.render();
          await new Promise(requestAnimationFrame);
          graph.render();
        }
        if (mode === 'compute-fog')
          for (const [w, h] of [
            [481, 271],
            [480, 270],
          ]) {
            renderer.setSize(w, h);
            await new Promise(requestAnimationFrame);
            graph.render();
          }
        const before = disposed.slice(),
          during = renderer.info.memory.textures;
        const history = graph.taaPass
          ? {
              id: graph.taaPass._historyRenderTarget.texture.id,
              size: graph.taaPass._historyRenderTarget.width,
              depth: graph.taaPass._previousDepthNode.value.id,
            }
          : null;
        graph.dispose();
        rows.push({
          mode,
          during,
          after: renderer.info.memory.textures,
          events: disposed.map((count, index) => count - before[index]),
          history,
          retained: [...liveTextures].map((t) => ({
            id: t.id,
            name: t.name,
            width: t.image?.width,
            height: t.image?.height,
            depth: !!t.isDepthTexture,
          })),
          borrowedIsWorldOutput:
            !borrowed ||
            borrowed.value === graph.worldPass.getTextureNode().value ||
            borrowed.value === graph.taaPass?.getTextureNode().value,
        });
      }
    const { RenderSystem } = await import('/src/render/index-webgpu.ts');
    const make = () =>
      createWorldViewPipeline(renderer, scene, camera, view, viewCamera, {
        gtao: false,
        taa: false,
        bloomStrength: 0,
      });
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const owner = { _graph: make(), _metering: true, _meterTask: pending };
    owner._graph.render();
    RenderSystem.prototype._releaseGraph.call(owner);
    const next = make(),
      activeHook = view.onBeforeRender;
    finish();
    await pending;
    const hookPreserved = view.onBeforeRender === activeHook;
    next.render();
    const rgba = await renderer.readRenderTargetPixelsAsync(next.viewPass.renderTarget, 0, 0, 1, 1);
    next.dispose();
    const rebuild = {
      hookPreserved,
      alpha: T.DataUtils.fromHalfFloat(rgba[3]),
      textures: renderer.info.memory.textures,
    };
    // Throw from an actual native prepass after its global state is installed.
    const warm = new RenderSystem(),
      graph = make(),
      override = new T.MeshBasicNodeMaterial();
    const keys = [
      'autoClear',
      'autoClearColor',
      'autoClearDepth',
      'autoClearStencil',
      'opaque',
      'transparent',
      'lighting',
      'contextNode',
      'toneMapping',
      'outputColorSpace',
    ];
    const state = keys.map((key) => renderer[key]),
      mrt = renderer.getMRT();
    const before = scene.onBeforeRender,
      mask = camera.layers.mask;
    warm.ctx = {
      scene,
      viewScene: view,
      camera,
      viewCamera,
      time: { frame: 0 },
      engine: { fail() {} },
    };
    warm.renderer = renderer;
    warm._graph = graph;
    warm._warmAbort = new AbortController();
    warm._tagPrepassMesh = warm._tagViewMesh = () => {};
    graph.prePass.name = 'throwing prepass';
    graph.prePass.overrideMaterial = override;
    scene.onBeforeRender = () => {
      if (renderer.getRenderTarget() === graph.prePass.renderTarget)
        throw Error('injected native prepass failure');
    };
    let failure;
    try {
      await warm._warmGraph();
    } catch (error) {
      failure = error.message;
    }
    const warmFailure = {
      failure,
      rendererRestored: keys.every((key, i) => renderer[key] === state[i]),
      mrtRestored: renderer.getMRT() === mrt,
      maskRestored: camera.layers.mask === mask,
      sceneRestored: scene.name === '' && scene.overrideMaterial === null,
      targetRestored: renderer.getRenderTarget() === null,
      clock: warm.ctx.time.frame,
    };
    scene.onBeforeRender = before;
    graph.dispose();
    override.dispose();
    await renderer.dispose();
    // Actual render-owner depth and resize gates, not only a standalone graph.
    const { createConfig } = await import('/src/core/config.ts');
    const ownerCamera = new T.PerspectiveCamera(72, 160 / 96, 0.05, 100);
    ownerCamera.position.z = 3;
    const ownerViewCamera = new T.PerspectiveCamera(60, 160 / 96, 0.005, 12);
    const geometry = new T.BoxGeometry(1, 1, 1),
      material = new T.MeshStandardNodeMaterial({ color: 0xc46b49 });
    const ownerScene = new T.Scene();
    ownerScene.add(new T.Mesh(geometry, material));
    const sun = new T.DirectionalLight(0xffe8c4, 4.3),
      moon = new T.DirectionalLight(0xffffff, 0);
    sun.position.set(-42, 46, 26);
    const sky = {
      keyLight: sun,
      sunLight: sun,
      moonLight: moon,
      keyDirection: sun.position.clone().normalize(),
      ambientColor: { r: 0.0645, g: 0.10033, b: 0.17917 },
    };
    const ctx = {
      canvas: document.querySelector('canvas'),
      scene: ownerScene,
      camera: ownerCamera,
      viewScene: new T.Scene(),
      viewCamera: ownerViewCamera,
      config: createConfig({ quality: 'high' }),
      time: { frame: 0, elapsed: 0, dt: 1 / 60 },
      get: () => sky,
      peek: (id) => (id === 'sky' ? sky : null),
    };
    const render = new RenderSystem();
    let ownerProbe;
    try {
      await render.init(ctx);
      render.resize(160, 96);
      render.render(ctx);
      const pixel = await render.renderer.readRenderTargetPixelsAsync(render.hdrRt, 80, 48, 1, 1);
      render.resize(112, 72);
      for (const c of [ownerCamera, ownerViewCamera]) {
        c.aspect = 112 / 72;
        c.updateProjectionMatrix();
      }
      await new Promise(requestAnimationFrame);
      render.render(ctx);
      const graph = render._graph,
        rt = graph.prePass.renderTarget,
        index = rt.textures.findIndex((t) => t.name === 'linearDepth');
      const depth = await render.renderer.readRenderTargetPixelsAsync(rt, 56, 36, 1, 1, index);
      const resized = await render.renderer.readRenderTargetPixelsAsync(render.hdrRt, 56, 36, 1, 1);
      ownerProbe = {
        depth: T.DataUtils.fromHalfFloat(depth[0]),
        pixel: pixel[0],
        resized: resized[0],
        size: [render.screenSize.width, render.screenSize.height],
        backend: render.renderer.backend.constructor.name,
        samples: [graph.worldPass.renderTarget.samples, graph.viewPass.renderTarget.samples],
      };
    } finally {
      material.dispose();
      geometry.dispose();
      await render.dispose();
    }
    return { rows, rebuild, warmFailure, ownerProbe };
  });
  assert.deepEqual(errors, []);
  console.log('lifetime', JSON.stringify(lifetime));
  for (const row of lifetime.rows) {
    assert.equal(row.after, 0, `${row.mode}: graph leaked textures`);
    assert(
      row.events.every((n) => n === 1),
      'each owned intermediate disposed once'
    );
    assert.equal(row.borrowedIsWorldOutput, true);
  }
  assert.deepEqual(
    lifetime.rebuild,
    { hookPreserved: true, alpha: 0, textures: 0 },
    'deferred disposal changed view callback/alpha ownership'
  );
  assert(
    lifetime.ownerProbe.depth > 2 && lifetime.ownerProbe.depth < 4,
    'soft-FX depth must be view metres'
  );
  assert(
    lifetime.ownerProbe.pixel > 0 && lifetime.ownerProbe.resized > 0,
    'render owner must survive resize'
  );
  assert.deepEqual(lifetime.ownerProbe.size, [112, 72]);
  assert.deepEqual(lifetime.ownerProbe.samples, [0, 0]);
  assert.equal(lifetime.ownerProbe.backend, 'WebGPUBackend');
  assert.deepEqual(lifetime.warmFailure, {
    failure: 'injected native prepass failure',
    rendererRestored: true,
    mrtRestored: true,
    maskRestored: true,
    sceneRestored: true,
    targetRestored: true,
    clock: 0,
  });
  await page.close();

  // Real ordinary boot, public loss notification injection, not a driver reset.
  for (const phase of (process.env.LOSS_PHASES ?? 'ready,init,prewarm').split(',')) {
    const p = await browser.newPage({ viewport: { width: 480, height: 270 } });
    await installDevicePolicy(p);
    await p.addInitScript(() => {
      window.__BOOT_ABORTED__ = false;
      const aborted = (message) => {
        if (/review injected device loss|Native warmup timed out/.test(String(message)))
          window.__BOOT_ABORTED__ = true;
      };
      addEventListener('unhandledrejection', (event) => aborted(event.reason));
      addEventListener('error', (event) => aborted(event.message));
    });
    await p.route('**/src/render/index-webgpu.ts', async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      const marker = 'this.renderer.setClearColor(0, 0);';
      assert.equal(body.split(marker).length, 2);
      body = body.replace(
        marker,
        `${guard}\nwindow.__BOOT_ENGINE__ = ctx.engine;\n${phase === 'init' ? loss : ''}\n${marker}`
      );
      if (phase === 'timeout') {
        const timeout = /const WARM_GRAPH_TIMEOUT_MS = (?:120000|12e4);/g;
        assert.equal([...body.matchAll(timeout)].length, 1);
        body = body.replace(timeout, 'const WARM_GRAPH_TIMEOUT_MS = 1;');
      }
      if (phase === 'prewarm') {
        const start = 'async prewarmMaterials() {';
        assert.equal(body.split(start).length, 2);
        body = body.replace(start, `${start}\n${loss}`);
      }
      await route.fulfill({ response, body });
    });
    if (process.env.REVIEW_NEGATIVE === 'device')
      await p.route('**/src/render/webgpu-device.ts', async (route) => {
        const response = await route.fetch(),
          body = await response.text();
        const marker = 'onDeviceLost?.(lost);';
        assert(body.includes(marker));
        await route.fulfill({ response, body: body.replace(marker, '') });
      });
    await p.goto(url);
    if (phase === 'ready') {
      await p.waitForFunction('window.__READY__ === true', null, { timeout: 180000 });
      const ignored = await p.evaluate(() => {
        const e = window.__ENGINE__,
          r = e.ctx.get('render').renderer;
        r.onDeviceLost({ api: 'WebGPU', reason: 'destroyed' });
        return { error: e.error, lost: r._isDeviceLost };
      });
      assert.equal(ignored.error, null);
      assert.equal(ignored.lost, false);
      await p.evaluate(() =>
        window.__ENGINE__.ctx.get('render').renderer.onDeviceLost({
          api: 'WebGPU',
          reason: 'unknown',
          message: 'review injected device loss',
        })
      );
    } else await p.waitForFunction('window.__BOOT_ABORTED__', null, { timeout: 180000 });
    const snapshot = () =>
      p.evaluate(() => {
        const e = window.__BOOT_ENGINE__;
        return {
          error: e.error,
          elapsed: e.time.elapsed,
          frame: e.time.frame,
          running: e._running,
          ready: !!window.__READY__,
          enabled: e.input.enabled,
          dialogs: document.querySelectorAll('#engine-failure[open]').length,
        };
      });
    const before = await snapshot();
    await p.waitForTimeout(1000);
    const after = await snapshot();
    assert.deepEqual(after, before, 'no invisible simulation after loss');
    assert.equal(after.error.system, 'render');
    assert.equal(after.error.method, phase === 'timeout' ? 'prewarm' : 'deviceLost');
    assert.equal(after.running, false);
    assert.equal(after.enabled, false);
    assert.equal(after.dialogs, 1);
    if (phase !== 'ready') assert.equal(after.ready, false, 'lost boot cannot claim readiness');
    console.log('terminal boot/lifetime', phase, JSON.stringify(after));
    await p.close();
  }
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
