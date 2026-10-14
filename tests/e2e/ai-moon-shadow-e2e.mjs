// Native pixels for the elevated moonlit-caster regression from PR #404.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PNG } from 'pngjs';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { verifyPreviewNative } from '../../tools/lib/native-render.mjs';
import { capturePreview } from '../../tools/lib/webgpu-preview-shot.mjs';

const args = parseArgs(),
  port = Number(args.port ?? 5496),
  out = resolve(args.out ?? '/tmp/cod-moon-shadow');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
let browser;
const errors = [],
  report = {};
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  collectBrowserErrors(page, errors);
  await page.route('**/__moon_shadow', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}</style><canvas></canvas>',
    })
  );
  await page.goto(`http://127.0.0.1:${port}/__moon_shadow`);
  report.setup = await page.evaluate(async () => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.ts');
    const { Celestial } = await import('/src/sky/celestial.ts');
    const { AiSystem } = await import('/src/ai/index.ts');
    const celestial = new Celestial().setHour(1.5),
      key = celestial.moon.clone();
    const r = await createWebGpuRenderer(document.querySelector('canvas'));
    r.setSize(256, 256);
    r.shadowMap.enabled = true;
    r.toneMapping = T.AgXToneMapping;
    r.toneMappingExposure = 100;
    const scene = new T.Scene(),
      caster = new T.Mesh(new T.BoxGeometry(1, 2, 1), new T.MeshStandardNodeMaterial());
    caster.geometry.computeBoundingSphere();
    caster.position.set(0, 20, 0);
    caster.updateMatrixWorld(true);
    const receiver = caster.position.clone().addScaledVector(key, -20 / key.y);
    const floor = new T.Mesh(
      new T.PlaneGeometry(40, 40),
      new T.MeshStandardNodeMaterial({ color: new T.Color(0.4, 0.4, 0.4) })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(receiver);
    floor.receiveShadow = true;
    const moon = new T.DirectionalLight(0xaabbff, 0.03);
    moon.castShadow = true;
    moon.position.copy(receiver).addScaledVector(key, 100);
    moon.target.position.copy(receiver);
    Object.assign(moon.shadow.camera, {
      left: -40,
      right: 40,
      top: 40,
      bottom: -40,
      near: 0.1,
      far: 200,
    });
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.bias = -0.0001;
    scene.add(caster, floor, moon, moon.target, new T.AmbientLight(0xaabbff, 0.003));
    const camera = new T.PerspectiveCamera(40, 1, 0.1, 200);
    camera.position.copy(receiver).add(new T.Vector3(0, 3, 8));
    camera.lookAt(receiver);
    camera.updateMatrixWorld(true);
    const sky = { keyDirection: key, sunDirection: celestial.sun };
    const ai = Object.assign(Object.create(AiSystem.prototype), {
      agents: [{ mesh: caster }],
      ctx: { peek: () => sky },
      _sun: new T.Vector3(),
      _frustum: new T.Frustum(),
      _mvp: new T.Matrix4(),
      _sphere: new T.Sphere(),
      _sweep: new T.Sphere(),
      _lodStats: {},
      stats: {},
    });
    window.fixture = { ai, r, scene, camera, sky, key, caster };
    window.__PREVIEW_RENDERER__ = r;
    window.__PREVIEW_DRAW__ = () => r.render(scene, camera);
    return { hour: 1.5, receiver: receiver.toArray(), key: key.toArray() };
  });
  report.device = await verifyPreviewNative(page);
  for (const mode of ['before', 'after']) {
    const casts = await page.evaluate(async (mode) => {
      const f = window.fixture;
      const direction = f.ai._sunDirection;
      if (mode === 'before') f.ai._sunDirection = () => f.sky.sunDirection;
      f.ai._updateRelevance({ camera: f.camera });
      f.ai._sunDirection = direction;
      await new Promise(requestAnimationFrame);
      window.__PREVIEW_DRAW__();
      return f.caster.castShadow;
    }, mode);
    assert.equal(
      casts,
      mode === 'after',
      `${mode}: off-screen caster must follow the rendered moon`
    );
    await capturePreview(page, `${out}/${mode}.png`);
  }
  const before = PNG.sync.read(readFileSync(`${out}/before.png`)).data;
  const after = PNG.sync.read(readFileSync(`${out}/after.png`)).data;
  let darkened = 0,
    max = 0;
  for (let i = 0; i < before.length; i += 4) {
    const delta =
      before[i] + before[i + 1] + before[i + 2] - after[i] - after[i + 1] - after[i + 2];
    if (delta > 15) darkened++;
    max = Math.max(max, delta);
  }
  report.pixels = { darkened, max };
  assert.ok(darkened > 100, 'relevant elevated caster must darken actual moonlit receiver pixels');
  await page.evaluate(async () => {
    await window.fixture.r.dispose();
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, errors }, null, 2));
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
