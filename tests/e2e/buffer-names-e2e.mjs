#!/usr/bin/env node
/** Stable WGSL names must reuse pipelines without aliasing object buffers. */
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5397);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/buffer-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' }));
  await page.goto(`http://localhost:${port}/buffer-probe`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'), error => { throw error; });
    const target = new T.RenderTarget(128, 64, { type: T.FloatType, depthBuffer: false });
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 2;
    const scene = new T.Scene(), geometry = new T.PlaneGeometry(0.3, 0.4);
    const material = new T.MeshBasicNodeMaterial({ color: 0xffffff, toneMapped: false });
    const meshes = [new T.InstancedMesh(geometry, material, 2), new T.InstancedMesh(geometry, material, 2)];
    const colors = [[0.8, 0.1, 0.2], [0.1, 0.8, 0.2], [0.1, 0.2, 0.8], [0.8, 0.8, 0.1]];
    const matrix = new T.Matrix4(), color = new T.Color(), builders = [];
    renderer.debug.onNodeBuilderCreated = builder => builders.push(builder);
    for (let i = 0; i < 4; i++) {
      meshes[i >> 1].setMatrixAt(i % 2, matrix.makeTranslation(-0.75 + i * 0.5, 0, 0));
      meshes[i >> 1].setColorAt(i % 2, color.setRGB(...colors[i]));
    }
    scene.add(...meshes);
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const read = async scene => {
      renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 128, 64);
      check(pixels.length === 128 * 64 * 4, 'incomplete float readback');
      return pixels;
    };
    const pixel = (pixels, x, expected, y = 32) => {
      const actual = Array.from(pixels.slice((y * 128 + x) * 4, (y * 128 + x + 1) * 4));
      check(actual.every((v, i) => Number.isFinite(v) && Math.abs(v - expected[i]) < 1e-5),
        `pixel ${x},${y}: ${actual}, expected ${expected}`);
      return actual;
    };
    let buffersMaterial;
    try {
      renderer.setRenderTarget(target); renderer.setClearColor(0, 0);
      const first = await read(scene);
      const samples = colors.map((rgb, i) => pixel(first, 16 + i * 32, [...rgb, 1]));
      check(builders.length === 2, `expected two distinct instanced builders, got ${builders.length}`);
      check(builders[0].vertexShader === builders[1].vertexShader, 'equivalent instanced vertex WGSL must match');
      check(builders[0].fragmentShader === builders[1].fragmentShader, 'equivalent instanced fragment WGSL must match');
      check(renderer._pipelines.caches.size === 1, 'equivalent instanced meshes must reuse one pipeline');

      // Update one instance in one batch; the other batch must keep its buffers.
      meshes[0].setMatrixAt(0, matrix.makeTranslation(-0.4, 0.6, 0));
      meshes[0].setColorAt(1, color.setRGB(0.7, 0.2, 0.6));
      meshes[0].instanceMatrix.needsUpdate = meshes[0].instanceColor.needsUpdate = true;
      const updated = await read(scene);
      pixel(updated, 16, [0, 0, 0, 0]);
      pixel(updated, 38, [...colors[0], 1], 13);
      pixel(updated, 48, [0.7, 0.2, 0.6, 1]);
      pixel(updated, 80, [...colors[2], 1]); pixel(updated, 112, [...colors[3], 1]);
      check(builders.length === 2 && renderer._pipelines.caches.size === 1, 'data updates must not rebuild shaders/pipelines');

      // Multiple UBO/SSBO bindings, including an explicit name, in both stages.
      const a = N.buffer(new Float32Array([0.1, 0.2, 0.3, 0]), 'vec4', 1);
      const b = N.storage(new T.StorageBufferAttribute(new Float32Array([0.02, 0.04, 0.06, 0]), 4), 'vec4', 1).toReadOnly();
      const explicit = N.buffer(new Float32Array([0.03, 0.05, 0.07, 0]), 'vec4', 1).setName('explicitColor');
      const sum = a.element(0).add(b.element(0)).add(explicit.element(0));
      buffersMaterial = new T.NodeMaterial(); buffersMaterial.toneMapped = false;
      buffersMaterial.positionNode = N.positionLocal.add(N.vec3(sum.x, 0, 0));
      buffersMaterial.fragmentNode = N.vec4(sum.rgb, 1);
      const buffersScene = new T.Scene(); buffersScene.add(new T.Mesh(geometry, buffersMaterial));
      const bufferPixel = pixel(await read(buffersScene), 74, [0.15, 0.29, 0.43, 1]);
      check(builders.length === 3, 'multi-buffer material must build');
      const names = {};
      for (const stage of ['vertexShader', 'fragmentShader']) {
        names[stage] = Array.from(builders[2][stage].matchAll(/var<(?:uniform|storage, read)>\s+(NodeBuffer_\w+|explicitColor)\s*:/g), m => m[1]);
        check(names[stage].length === 3 && new Set(names[stage]).size === 3, `${stage}: buffer-name collision/missing declaration`);
        check(names[stage].includes('explicitColor') && names[stage].filter(n => n.startsWith('NodeBuffer_nodeUniform')).length === 2,
          `${stage}: preserve explicit and builder-local names`);
      }
      const info = renderer.backend.device.adapterInfo;
      return { adapter: { vendor: info.vendor, architecture: info.architecture, fallback: info.isFallbackAdapter },
        instanced: { builders: 2, pipelines: 1, samples }, bufferPixel, names };
    } finally {
      renderer.setRenderTarget(null);
      for (const mesh of meshes) mesh.dispose();
      geometry.dispose(); material.dispose(); buffersMaterial?.dispose(); target.dispose(); renderer.dispose();
    }
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally { try { await browser?.close(); } finally { stopViteServer(server); } }
