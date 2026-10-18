#!/usr/bin/env node
/** Native readbacks for shared-material texture/storage swaps and disposal. */
import assert from 'node:assert/strict';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { installDevicePolicy } from '../../tools/lib/native-render.mjs';
const args = parseArgs();
const port = Number(args.port ?? 5398);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await installDevicePolicy(page);
  await page.route('**/submission-probe', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' })
  );
  await page.goto(`http://localhost:${port}/submission-probe`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.ts');
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'), (e) => {
      throw e;
    });
    const info = renderer.backend.device.adapterInfo;
    window.__ASSERT_HARDWARE_DEVICE__({
      vendor: info.vendor,
      architecture: info.architecture,
      fallback: info.isFallbackAdapter,
    });
    const target = new T.RenderTarget(128, 64, { type: T.FloatType, depthBuffer: false });
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    const scene = new T.Scene();
    const geometry = new T.PlaneGeometry(0.8, 0.8);
    const allocated = new Set();
    const makeAttribute = (rgb) => {
      const a = new T.StorageBufferAttribute(new Float32Array([...rgb, 0]), 4);
      allocated.add(a);
      return a;
    };
    const makeTexture = (rgb) => {
      const t = new T.DataTexture(new Uint8Array([...rgb, 255]), 1, 1);
      t.minFilter = t.magFilter = T.NearestFilter;
      t.needsUpdate = true;
      allocated.add(t);
      return t;
    };
    const attributes = [makeAttribute([0.1, 0, 0]), makeAttribute([0, 0.2, 0])];
    const textures = [makeTexture([64, 0, 0]), makeTexture([0, 0, 128])];
    const storage = N.storage(attributes[0], 'vec4', 1).toReadOnly();
    const texture = N.texture(textures[0], N.vec2(0.5));
    const color = N.uniform(new T.Color());
    const colors = [
      [0.01, 0.02, 0.03],
      [0.03, 0.02, 0.01],
    ];
    const material = new T.NodeMaterial();
    material.toneMapped = false;
    material.positionNode = N.positionLocal;
    material.fragmentNode = N.vec4(texture.rgb.add(storage.element(0).rgb).add(color), 1);
    for (let i = 0; i < 2; i++) {
      const mesh = new T.Mesh(geometry, material);
      mesh.position.x = i === 0 ? -0.5 : 0.5;
      mesh.onBeforeRender = () => {
        storage.value = attributes[i];
        texture.value = textures[i];
        color.value.setRGB(...colors[i]);
      };
      scene.add(mesh);
    }
    let builds = 0;
    renderer.debug.onNodeBuilderCreated = () => builds++;
    const samples = [];
    const read = async (name) => {
      renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 128, 64);
      const actual = [];
      for (let i = 0; i < 2; i++) {
        const x = i === 0 ? 32 : 96;
        const tex = textures[i].image.data;
        const expected = [0, 1, 2].map((c) => tex[c] / 255 + attributes[i].array[c] + colors[i][c]);
        expected.push(1);
        const rgba = Array.from(pixels.slice((32 * 128 + x) * 4, (32 * 128 + x + 1) * 4));
        if (!rgba.every((v, c) => Number.isFinite(v) && Math.abs(v - expected[c]) < 1e-5))
          throw new Error(`${name} mesh ${i}: ${rgba}; expected ${expected}`);
        actual.push(rgba);
      }
      samples.push({ name, actual, builds, pipelines: renderer._pipelines.caches.size });
    };
    const dispose = (value) => {
      value.dispose();
    };
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0, 0);
      await read('initial shared material, distinct buffers/textures/uniforms');
      const initialBuilds = builds;
      attributes[0].array[0] = 0.35;
      attributes[0].needsUpdate = true;
      await read('buffer content update, right mesh unchanged');
      dispose(attributes[0]);
      await read('buffer dispose/recreate at unchanged attribute version');
      dispose(textures[0]);
      await read('texture dispose/recreate at unchanged texture version');
      if (builds !== initialBuilds) throw new Error('content updates/disposal rebuilt shaders');
      attributes[0] = makeAttribute([0.4, 0, 0.1]);
      await read('different attribute identity, same layout');
      textures[0] = makeTexture([0, 64, 0]);
      await read('different texture identity');
      textures[0] = textures[1];
      await read('same texture, still distinct storage/uniform buffers');
      textures[1].wrapS = T.RepeatWrapping;
      textures[1].needsUpdate = true;
      await read('sampler version change');
      return {
        adapter: {
          vendor: info.vendor,
          architecture: info.architecture,
          fallback: info.isFallbackAdapter,
        },
        samples,
      };
    } finally {
      renderer.setRenderTarget(null);
      for (const value of allocated) value.dispose();
      geometry.dispose();
      material.dispose();
      target.dispose();
      await renderer.dispose();
    }
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
