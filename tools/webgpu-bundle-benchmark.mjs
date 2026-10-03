// Diagnostic-only boot injection. Does not edit production or installed Three.js.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';
async function installBundleExperiment(page, variant) {
  assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
  assert.ok(['stock', 'single', 'chunk'].includes(variant));
  if (variant === 'stock') return;
  await page.addInitScript(({ variant }) => {
    window.__installBundleBenchmark = async r => {
      if (window.__bundles) return;
      const { BundleGroup, Matrix4, Frustum } =
        await import('/node_modules/.vite/deps/three_webgpu.js');
      const scene = r.ctx.scene, world = r.ctx.get('world'), entries = [], grouped = new Map();
      scene.updateMatrixWorld(true);
      for (const mesh of world.meshes) {
        if (!mesh.userData.owStatic || mesh.isSkinnedMesh || mesh.children.length ||
          Array.isArray(mesh.material) || mesh.material.transparent || !mesh.material.visible) continue;
        const parent = mesh.parent;
        if (mesh.isInstancedMesh) { if (!mesh.boundingSphere) mesh.computeBoundingSphere(); }
        else if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        const sphere = (mesh.isInstancedMesh ? mesh.boundingSphere : mesh.geometry.boundingSphere)
          .clone().applyMatrix4(mesh.matrixWorld);
        const key = variant === 'single' ? mesh.uuid : parent.uuid + ':' +
          (Math.floor(sphere.center.x / 24) + ':' + Math.floor(sphere.center.z / 24));
        let entry = grouped.get(key);
        if (!entry) {
          const group = new BundleGroup(); group.name = 'diagnostic:bundle'; group.layers.enableAll();
          group.matrixAutoUpdate = false;
          parent.add(group);
          entry = { group, objects: [], sphere: sphere.clone(), visible: [] };
          grouped.set(key, entry); entries.push(entry);
        } else entry.sphere.union(sphere);
        entry.visible.push(mesh.visible);
        entry.objects.push(mesh); entry.group.add(mesh);
        if (variant === 'chunk') mesh.frustumCulled = false;
      }
      const frustum = new Frustum(), matrix = new Matrix4(), before = scene.onBeforeRender;
      let cullChanges = 0, invalidations = 0, lastKey = r.activeSun, lastEnv = scene.environment;
      let lastWidth = r.screenSize.width, lastHeight = r.screenSize.height;
      window.__bundles = entries;
      window.__bundleWarming = true;
      window.__invalidateBundles = () => { for (const { group } of entries) group.needsUpdate = true; };
      window.__bundleStats = () => ({ variant, groups: entries.length,
        meshes: entries.reduce((n, e) => n + e.objects.length, 0), cullChanges, invalidations });
      scene.onBeforeRender = function(renderer, sceneArg, camera, target) {
        before.call(this, renderer, sceneArg, camera, target);
        if (r.activeSun !== lastKey || scene.environment !== lastEnv || r.screenSize.width !== lastWidth || r.screenSize.height !== lastHeight) {
          window.__invalidateBundles(); invalidations++;
          lastKey = r.activeSun; lastEnv = scene.environment; lastWidth = r.screenSize.width; lastHeight = r.screenSize.height;
        }
        matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(matrix, camera.coordinateSystem, camera.reversedDepth);
        for (const entry of entries) {
          const { group, objects } = entry;
          let changed = false;
          for (let i = 0; i < objects.length; i++) {
            if (entry.visible[i] !== objects[i].visible) { entry.visible[i] = objects[i].visible; changed = true; }
          }
          if (changed) { group.needsUpdate = true; invalidations++; }
          let visible = true;
          if (!window.__bundleWarming && variant === 'single') {
            const mesh = objects[0];
            visible = mesh.visible && mesh.layers.test(camera.layers) &&
              (!mesh.frustumCulled || frustum.intersectsObject(mesh));
          } else if (!window.__bundleWarming && variant === 'chunk') {
            visible = frustum.intersectsSphere(entry.sphere);
          }
          if (group.visible !== visible) cullChanges++;
          group.visible = visible;
        }
      };
      // Keep references for diagnostic culling/state inspection; no per-frame geometry allocation.
      window.__bundleExperiment = { entries };
    };
  }, { variant });
  await page.route('**/src/render/index-webgpu.js*', async route => {
    const response = await route.fetch(); let body = await response.text();
    const edits = [
      ['async _warmGraph() {', 'async _warmGraph() {\n    await window.__installBundleBenchmark(this);'],
      ['if (i === 0) for (const [pass] of passFlags)',
        'if (i === 1) window.__invalidateBundles();\n        if (i === 0) for (const [pass] of passFlags)'],
      ['this.renderer.setRenderTarget(target);\n    }\n    return { ms:',
        'this.renderer.setRenderTarget(target);\n      window.__bundleWarming = false; window.__invalidateBundles();\n    }\n    return { ms:'],
    ];
    for (const [a, b] of edits) { assert.ok(body.includes(a), 'bundle injection marker: ' + a); body = body.replace(a, b); }
    await route.fulfill({ response, body });
  });
}
async function installBundleSpy(page) {
  await page.addInitScript(() => {
    const bundles = new WeakMap();
    window.__bundleTrace = { current: null };
    const create = GPUDevice.prototype.createRenderBundleEncoder;
    GPUDevice.prototype.createRenderBundleEncoder = function(...args) {
      const encoder = create.apply(this, args), counts = { draws: 0, work: 0 };
      for (const method of ['draw', 'drawIndexed']) {
        const original = encoder[method];
        encoder[method] = function(count, instances = 1, ...rest) {
          if (count && instances) { counts.draws++; counts.work += count * instances; }
          return original.call(this, count, instances, ...rest);
        };
      }
      const finish = encoder.finish;
      encoder.finish = function(...a) {
        const bundle = finish.apply(this, a); bundles.set(bundle, counts);
        if (window.__bundleTrace.current) window.__bundleTrace.current.encodes++;
        return bundle;
      };
      return encoder;
    };
    const begin = GPUCommandEncoder.prototype.beginRenderPass;
    GPUCommandEncoder.prototype.beginRenderPass = function(...args) {
      const pass = begin.apply(this, args);
      for (const method of ['draw', 'drawIndexed']) {
        const original = pass[method];
        pass[method] = function(count, instances = 1, ...rest) {
          const c = window.__bundleTrace.current;
          if (c && count && instances) { c.gpuDraws++; c.gpuWork += count * instances; }
          return original.call(this, count, instances, ...rest);
        };
      }
      const execute = pass.executeBundles;
      pass.executeBundles = function(list) {
        const c = window.__bundleTrace.current;
        if (c) for (const bundle of list) {
          const b = bundles.get(bundle);
          if (!b) throw new Error('unmapped render bundle');
          c.gpuDraws += b.draws; c.gpuWork += b.work; c.replays++;
        }
        return execute.call(this, list);
      };
      return pass;
    };
  });
}

const args = parseArgs(), variant = String(args.variant ?? 'stock'), mode = String(args.mode ?? 'plain');
const frames = Number(args.frames ?? 900), warmup = Number(args.warmup ?? 60);
const port = Number(args.port ?? 5256), out = String(args.out ?? `/tmp/cod-bundle-${variant}`);
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!', 'RX9070XT only');
assert.ok(['stock', 'single', 'chunk'].includes(variant));
assert.ok(['plain', 'light'].includes(mode));
assert.ok(Number.isInteger(frames) && frames > warmup && frames <= 1800);
assert.ok(Number.isInteger(warmup) && warmup >= 0);
const server = await ensureViteServer({ root: process.cwd(), port });
const browser = await launchChromium({ headless: true,
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  args: ['--ignore-gpu-blocklist', '--mute-audio', '--use-angle=vulkan', '--enable-features=Vulkan',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (mode === 'light') await installBundleSpy(page);
  await installBundleExperiment(page, variant);
  await page.goto(`http://localhost:${port}/?capture=1&shot=hero&q=high`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const result = await page.evaluate(async ({ frames, warmup, mode }) => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
    if (renderer.backend.constructor.name !== 'WebGPUBackend') throw new Error('WebGPU required');
    const metadata = { userAgent: navigator.userAgent, backend: renderer.backend.constructor.name,
      adapter: renderer.backend.device.adapterInfo?.description,
      viewport: [innerWidth, innerHeight], internal: [r.screenSize.width, r.screenSize.height],
      quality: e.config.quality, prewarm: e.__prewarmHooks };
    const player = e.ctx.get('player'); e.input.enabled = true; e.input.frozen = false;
    player.setControlEnabled(true); e.ctx.peek('ai')?.debugStage?.('firefight');
    let current = null, builds = 0, writes = 0, bytes = 0;
    const debug = renderer.debug.onNodeBuilderCreated;
    renderer.debug.onNodeBuilderCreated = function(...a) {
      if (current && current.i >= warmup) builds++; debug?.(...a);
    };
    if (mode === 'light') {
      const q = renderer.backend.device.queue, write = q.writeBuffer;
      q.writeBuffer = function(buffer, offset, data, dataOffset = 0, size) {
        writes++; bytes += size === undefined ? data.byteLength - dataOffset * (data.BYTES_PER_ELEMENT ?? 1) :
          size * (data.BYTES_PER_ELEMENT ?? 1);
        return write.call(this, buffer, offset, data, dataOffset, size);
      };
    }
    const records = [], step = e.step; let i = 0, last = performance.now();
    await new Promise(done => {
      e.step = function(now) {
        if (i) records[i - 1].dt = now - last; last = now;
        if (i >= frames) { e.stop(); e.step = step; done(); return; }
        e.input._rawLook.x -= .006 / e.config.sensitivity; e.input.down.add('KeyW');
        if (i % 90 < 30) e.input.down.add('Mouse0'); else e.input.down.delete('Mouse0');
        const rec = { i, dt: null, gpuDraws: 0, gpuWork: 0, encodes: 0, replays: 0 };
        records.push(rec); current = rec;
        if (window.__bundleTrace) window.__bundleTrace.current = rec;
        const w = writes, b = bytes, start = performance.now();
        try { return step.call(this, now); }
        finally {
          rec.wall = performance.now() - start; rec.writes = writes - w; rec.bytes = bytes - b;
          current = null; if (window.__bundleTrace) window.__bundleTrace.current = null; i++;
        }
      };
    });
    return { metadata, records, builds, bundles: window.__bundleStats?.() };
  }, { frames, warmup, mode });
  const distribution = values => {
    const a = values.filter(Number.isFinite).sort((a, b) => a - b);
    const p = n => a[Math.min(a.length - 1, Math.floor(a.length * n))];
    return { count: a.length, mean: a.reduce((s, n) => s + n, 0) / a.length,
      p50: p(.5), p95: p(.95), p99: p(.99) };
  };
  const steady = result.records.slice(warmup), report = { variant, mode, frames, warmup,
    metadata: result.metadata, bundles: result.bundles, lateBuilders: result.builds, errors };
  for (const key of (mode === 'plain' ? ['dt', 'wall'] :
    ['dt', 'wall', 'writes', 'bytes', 'gpuDraws', 'gpuWork', 'encodes', 'replays']))
    report[key] = distribution(steady.map(r => r[key]));
  writeFileSync(out + '.json', JSON.stringify(report, null, 2));
  writeFileSync(out + '-raw.json', JSON.stringify(result));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
} finally { await browser.close(); await stopViteServer(server); }
