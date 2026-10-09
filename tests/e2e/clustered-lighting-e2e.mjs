#!/usr/bin/env node
/** Production graph: world-only clusters, pre-draw resizing and owned storage cleanup. */
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5445);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  if (args.negative) await page.route('**/src/render/webgpu-pipeline.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = { resize: 'worldLights.setSize(clusterSize.x, clusterSize.y);',
      dispose: 'worldLights.dispose();' }[args.negative];
    assert(marker && body.split(marker).length === 2, 'negative must mutate exactly one ownership boundary');
    await route.fulfill({ response, body: body.replace(marker, '') });
  });
  await page.route('**/cluster-probe', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(`http://localhost:${port}/cluster-probe`);
  const result = await page.evaluate(async () => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { createWorldViewPipeline } = await import('/src/render/webgpu-pipeline.js');
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'), error => { throw error; });
    const device = renderer.backend.device, info = device.adapterInfo;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    check(renderer.backend.isWebGPUBackend && !info.isFallbackAdapter, 'native WebGPU required');
    const resources = [], destroyed = new Map(), gpuErrors = [], rows = [];
    device.addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
    const originalDestroy = GPUBuffer.prototype.destroy;
    GPUBuffer.prototype.destroy = function () {
      destroyed.set(this, (destroyed.get(this) ?? 0) + 1); return originalDestroy.call(this);
    };
    // Track every allocation, not only the current attribute: stale attributes can be recreated.
    const originalCreate = renderer.backend.createStorageAttribute;
    renderer.backend.createStorageAttribute = function (attribute, ...args) {
      const result = originalCreate.call(this, attribute, ...args);
      if (attribute.array instanceof Int32Array && attribute.itemSize === 4) resources.push(this.get(attribute).buffer);
      return result;
    };
    let comparisons = 0, maxDifference = 0;
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const scene = new T.Scene(), view = new T.Scene();
        const camera = new T.PerspectiveCamera(65, 1, 0.1, 60), viewCamera = camera.clone(); camera.position.z = 4;
        const geometry = new T.PlaneGeometry(20, 20), material = new T.MeshStandardNodeMaterial({ color: 0xcccccc, roughness: 0.7 });
        scene.add(new T.Mesh(geometry, material));
        for (let i = 0; i < 24; i++) {
          const light = new T.PointLight(i % 2 ? 0xff7744 : 0x4477ff, 2, 3, 2);
          light.position.set(i % 6 - 2.5, (Math.floor(i / 6) - 1.5) * 0.7, 1); scene.add(light);
        }
        const make = () => createWorldViewPipeline(renderer, scene, camera, view, viewCamera,
          { gtao: false, bloomStrength: 0 });
        const reference = make(); reference.worldPass.lighting = new T.Lighting();
        const graph = make(), node = graph.worldPass.lighting.getNode(scene);
        check(Array.isArray(node.clusteredLights) && !graph.prePass.lighting.enabled && graph.viewPass.lighting === null,
          'clustered lighting must remain world-only');
        check(node.maxLights >= 24 && node.maxLightsPerCluster >= 24, 'all fixture lights fit even in one cluster');
        for (const [width, height, dpr] of [[320,192,1],[320,192,1],[512,320,1],[256,160,1],[512,320,1],[320,192,2],[320,180,1],[1280,720,1],[320,192,1]]) {
          renderer.setPixelRatio(dpr); renderer.setSize(width, height);
          camera.aspect = width / height; camera.updateProjectionMatrix();
          for (let frame = 0; frame < 3; frame++) {
            await new Promise(requestAnimationFrame); device.pushErrorScope('validation');
            reference.render(); graph.render(); await device.queue.onSubmittedWorkDone();
            const error = await device.popErrorScope(); if (error) gpuErrors.push(error.message);
            check(node._lightsCount.value === 24, 'all point lights uploaded');
            if (cycle === 0 && frame !== 1) {
              const a = await renderer.readRenderTargetPixelsAsync(reference.worldPass.renderTarget, 0, 0, width*dpr, height*dpr);
              const b = await renderer.readRenderTargetPixelsAsync(graph.worldPass.renderTarget, 0, 0, width*dpr, height*dpr);
              check(a.length === b.length && a.length === width*height*dpr*dpr*4, 'complete readbacks');
              let lit = 0;
              for (let i = 0; i < a.length; i++) {
                const x = T.DataUtils.fromHalfFloat(a[i]), y = T.DataUtils.fromHalfFloat(b[i]);
                check(Number.isFinite(x) && Number.isFinite(y), 'finite pixels');
                if (i % 4 !== 3 && x > 0.01) lit++;
                maxDifference = Math.max(maxDifference, Math.abs(x-y));
              }
              check(lit > width*height*dpr*dpr, 'nonblank reference'); comparisons++;
            }
          }
        }
        graph.dispose(); reference.dispose(); material.dispose(); geometry.dispose();
        rows.push(resources.filter(buffer => !destroyed.has(buffer)).length);
        check(renderer.info.memory.textures === 1, 'only shared renderer texture remains');
        // Never-rendered graphs must also be safe to dispose.
        const unused = make(); unused.dispose();
      }
      const doubleDestroyed = resources.filter(buffer => destroyed.get(buffer) > 1).length;
      check(resources.length > 0, 'storage allocation instrumentation executed');
      return { adapter: { vendor: info.vendor, architecture: info.architecture }, rows, gpuErrors,
        allocations: resources.length, doubleDestroyed, comparisons, maxDifference };
    } finally { await renderer.dispose(); GPUBuffer.prototype.destroy = originalDestroy; }
  });
  console.log(JSON.stringify(result));
  assert.deepEqual(errors, []); assert.deepEqual(result.gpuErrors, []);
  assert.deepEqual(result.rows, [0, 0, 0], 'graph retained clustered storage');
  assert.equal(result.doubleDestroyed, 0); assert.equal(result.comparisons, 18);
  assert(result.maxDifference < 0.001, 'first/settled resize frames differ from standard lighting');
} finally { await browser?.close(); stopViteServer(server); }
