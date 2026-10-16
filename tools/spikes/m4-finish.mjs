// #432 diagnostic only: one fixed receiver finish, never installed by gameplay.
// Run from the repository root with MESA_VK_DEVICE_SELECT and CHROMIUM_PATH set.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ensureViteServer, stopViteServer, launchChromium } from '../lib/browser-harness.mjs';
import { installDevicePolicy, waitForGame } from '../lib/native-render.mjs';

const out = resolve(process.argv[2] ?? '/tmp/issue432'),
  port = Number(process.env.PORT ?? 5460);
mkdirSync(out, { recursive: true });
const revision =
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() +
  (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ? '+dirty' : '');
const server = await ensureViteServer({ port });
let browser;
const errors = [],
  warnings = [];
try {
  browser = await launchChromium({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await installDevicePolicy(page);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=weapon&q=high`);
  const device = await waitForGame(page);
  const report = await page.evaluate(
    async ({ revision }) => {
      if (window.__BUILD_REVISION__ !== revision) throw Error('wrong build revision');
      const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
      const e = window.__ENGINE__,
        ctx = e.ctx,
        r = ctx.get('render'),
        renderer = r.renderer;
      const w = ctx.get('weapons'),
        vm = w.viewmodel;
      w.setWeaponImmediate('rifle');
      await window.__PUMP__(30);
      const width = 1280,
        height = 720;
      const display = new T.RenderTarget(width, height, { depthBuffer: false });
      const view = new T.RenderTarget(width, height, {
        type: T.FloatType,
        minFilter: T.NearestFilter,
        magFilter: T.NearestFilter,
      });
      const images = {},
        cases = [],
        meshes = [];
      vm.active.group.traverse((o) => {
        if (o.isMesh) meshes.push(o);
      });
      const receiver = meshes.filter(
        (o) =>
          o.material.name === '01 | black anodized receiver' &&
          (o.name.startsWith('receiver_mesh') || o.parent?.name === 'receiver_mesh')
      );
      if (receiver.length !== 1)
        throw Error(
          `receiver primitive count ${receiver.length}: ${meshes.map((o) => `${o.name}:${o.material.name}`).join(',')}`
        );
      const mesh = receiver[0],
        base = mesh.material,
        variant = base.clone();
      variant.name = 'SPIKE432 | rough dielectric coat over effective anodized substrate';
      variant.clearcoat = 1;
      variant.clearcoatRoughness = 0.5;
      variant.clearcoatRoughnessMap = base.roughnessMap;
      variant.clearcoatNormalMap = base.normalMap;
      variant.clearcoatNormalScale.copy(base.normalScale);
      r.indirect.patch(variant);
      const select = (name) => {
        mesh.material = name === 'variant' ? variant : base;
      };
      const inventory = (m) => ({
        name: m.name,
        color: m.color.toArray(),
        roughness: m.roughness,
        metalness: m.metalness,
        ior: m.ior,
        specularIntensity: m.specularIntensity,
        specularColor: m.specularColor.toArray(),
        normalScale: m.normalScale.toArray(),
        clearcoat: m.clearcoat,
        clearcoatRoughness: m.clearcoatRoughness,
        maps: Object.fromEntries(
          [
            'map',
            'roughnessMap',
            'metalnessMap',
            'normalMap',
            'aoMap',
            'clearcoatRoughnessMap',
            'clearcoatNormalMap',
          ].map((k) => [
            k,
            m[k]
              ? {
                  uuid: m[k].uuid,
                  colorSpace: m[k].colorSpace,
                  width: m[k].image.width,
                  height: m[k].image.height,
                  channel: m[k].channel,
                  flipY: m[k].flipY,
                }
              : null,
          ])
        ),
      });
      const initial = meshes.map((o) => [o, o.material]);
      const snapshot = () =>
        JSON.stringify({
          frame: e.time.frame,
          elapsed: e.time.elapsed,
          camera: ctx.camera.matrixWorld.elements,
          viewCamera: ctx.viewCamera.projectionMatrix.elements,
          exposure: r._exposure,
          graphExposure: r._graph.exposure.value,
          settings: r.settings,
          transforms: meshes.map((o) => [
            o.name,
            o.matrixWorld.elements,
            o.castShadow,
            o.receiveShadow,
          ]),
          lights: ctx.viewScene.children
            .filter((o) => o.isLight)
            .map((o) => [o.id, o.color.toArray(), o.intensity, o.position.toArray(), o.castShadow]),
        });
      const png = (pixels) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas
          .getContext('2d')
          .putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      };
      const game = async (name) => {
        // Hold the temporal sample, not the TAA algorithm/settings, for matched A/B.
        if (r._graph.taaPass) r._graph.taaPass._jitterIndex = 0;
        renderer.setRenderTarget(display);
        r._graph.render();
        const pixels = await renderer.readRenderTargetPixelsAsync(display, 0, 0, width, height);
        renderer.setRenderTarget(null);
        images[name] = png(pixels);
        const target = r._graph.worldPass.renderTarget;
        const world = await renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          target.width,
          target.height
        );
        return { pixels, world };
      };
      const drawView = () => {
        renderer.setClearColor(0, 0);
        renderer.setRenderTarget(view);
        renderer.render(ctx.viewScene, ctx.viewCamera);
        renderer.setRenderTarget(null);
      };
      const readView = async () => {
        drawView();
        return renderer.readRenderTargetPixelsAsync(view, 0, 0, width, height);
      };
      const difference = (a, b, mask = null) => {
        let sum = 0,
          max = 0,
          count = 0,
          changed = 0;
        for (let i = 0; i < a.length; i++)
          if (!mask || mask[Math.floor(i / 4)]) {
            const delta = Math.abs(a[i] - b[i]);
            sum += delta;
            max = Math.max(max, delta);
            count++;
            if (delta) changed++;
          }
        return { meanAbsolute: sum / count, max, changed, values: count };
      };
      const stats = (pixels, mask) => {
        const values = [];
        for (let i = 0; i < mask.length; i++)
          if (mask[i])
            values.push(
              0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]
            );
        values.sort((a, b) => a - b);
        return {
          pixels: values.length,
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          p10: values[Math.floor(values.length * 0.1)],
          p50: values[Math.floor(values.length * 0.5)],
          p90: values[Math.floor(values.length * 0.9)],
          p99: values[Math.floor(values.length * 0.99)],
        };
      };
      // Diagnostic shaders never replace shipping-view screenshots or timing draws.
      const channels = async () => {
        const saved = [];
        for (const object of [...meshes, ...vm.armL.root.children, ...vm.armR.root.children]) {
          // Weapon-only replacement; arms remain depth-occluding and are excluded by ID.
          if (!object.isMesh || !meshes.includes(object)) continue;
          const material = object.material,
            clone = material.clone();
          const id =
            object === mesh ? 0.25 : material.name === '03 | moulded black furniture' ? 0.5 : 0.75;
          clone.setupOutput = () => N.vec4(N.float(id), N.roughness, N.metalness, 1);
          clone.customProgramCacheKey = () => `issue432-factors-${id}-${material.clearcoat}`;
          r.indirect.patch(clone);
          object.material = clone;
          saved.push([object, material, clone, id]);
        }
        const pixels = await readView();
        const mask = (id) =>
          Array.from(
            { length: width * height },
            (_, i) => Math.abs(pixels[i * 4] - id) < 0.00001 && pixels[i * 4 + 3] > 0.99
          );
        const receiverMask = mask(0.25),
          polymerMask = mask(0.5);
        const rows = [];
        for (const [name, selected] of [
          ['receiver', receiverMask],
          ['polymer', polymerMask],
        ]) {
          const rough = [],
            metal = [];
          for (let i = 0; i < selected.length; i++)
            if (selected[i]) {
              rough.push(pixels[i * 4 + 1]);
              metal.push(pixels[i * 4 + 2]);
            }
          const range = (a) => ({
            count: a.length,
            min: Math.min(...a),
            max: Math.max(...a),
            mean: a.reduce((s, v) => s + v, 0) / a.length,
          });
          rows.push({ name, roughness: range(rough), metalness: range(metal) });
        }
        for (const [, material, clone, id] of saved) {
          clone.setupOutput = () => N.vec4(N.specularColorBlended, N.float(id));
          clone.customProgramCacheKey = () => `issue432-f0-${id}-${material.clearcoat}`;
          clone.needsUpdate = true;
        }
        const f0 = await readView();
        for (const [index, id] of [0.25, 0.5].entries()) {
          let count = 0;
          const sum = [0, 0, 0];
          for (let i = 0; i < f0.length; i += 4)
            if (Math.abs(f0[i + 3] - id) < 0.00001) {
              count++;
              for (let k = 0; k < 3; k++) sum[k] += f0[i + k];
            }
          rows[index].baseLayerF0 = {
            pixels: count,
            mean: count ? sum.map((v) => v / count) : null,
          };
        }
        for (const [, material, clone, id] of saved) {
          clone.setupOutput = () =>
            N.vec4(
              N.float(id),
              N.float(material.clearcoat),
              material.clearcoat > 0 ? N.clearcoatRoughness : N.float(0),
              1
            );
          clone.customProgramCacheKey = () => `issue432-coat-${id}-${material.clearcoat}`;
          clone.needsUpdate = true;
        }
        const coat = await readView();
        for (const [index, id] of [0.25, 0.5].entries()) {
          let count = 0,
            sum = 0,
            min = Infinity,
            max = -Infinity;
          for (let i = 0; i < coat.length; i += 4)
            if (Math.abs(coat[i] - id) < 0.00001 && coat[i + 3] > 0.99) {
              count++;
              const v = coat[i + 2];
              sum += v;
              min = Math.min(min, v);
              max = Math.max(max, v);
            }
          rows[index].coatRoughness = {
            pixels: count,
            mean: count ? sum / count : null,
            min: count ? min : null,
            max: count ? max : null,
          };
        }
        for (const [object, material, clone] of saved) {
          object.material = material;
          clone.dispose();
        }
        return { receiverMask, polymerMask, rows };
      };
      const gpu = async () => {
        if (!renderer.backend.device.features.has('timestamp-query'))
          return { unavailable: 'timestamp-query' };
        const tracked = renderer.backend.trackTimestamp,
          autoReset = renderer.info.autoReset;
        renderer.backend.trackTimestamp = true;
        renderer.info.autoReset = false;
        const samples = [],
          counts = [];
        try {
          for (const name of ['baseline', 'variant']) {
            select(name);
            for (let i = 0; i < 4; i++) drawView();
            await renderer.resolveTimestampsAsync('render');
          }
          for (let i = 0; i < 40; i++) {
            const name = ['baseline', 'variant', 'variant', 'baseline'][i % 4];
            select(name);
            const before = renderer.info.render.drawCalls;
            drawView();
            const frame = renderer.info.frame;
            const ms = await renderer.resolveTimestampsAsync('render');
            const measuredFrame = renderer.backend.getTimestampFrames('render').at(-1);
            if (measuredFrame !== frame) throw Error('GPU timestamp frame mismatch');
            samples.push({ name, ms, frame, measuredFrame });
            counts.push({ name, draws: renderer.info.render.drawCalls - before });
          }
        } finally {
          renderer.backend.trackTimestamp = tracked;
          renderer.info.autoReset = autoReset;
          select('baseline');
        }
        return {
          scope:
            'warmed isolated first-person render pass; excludes world, queue wait and presentation',
          samples,
          counts,
        };
      };
      const materialInventory = {
        baseline: inventory(base),
        variant: inventory(variant),
        polymer: meshes
          .filter((o) => o.material.name === '03 | moulded black furniture')
          .map((o) => ({ mesh: o.name, ...inventory(o.material) })),
        selectedMesh: mesh.name,
        extraTextures: 0,
        extraGeometry: 0,
        extraDrawsExpected: 0,
      };
      for (const scene of ['outdoor', 'indoor'])
        for (const pose of ['hip', 'ads']) {
          select('baseline');
          window.__APPLY_SHOT__(scene === 'outdoor' ? 'weapon' : 'interior');
          w.debugPose(pose === 'hip' ? 'idle' : 'ads');
          ctx.camera.fov = pose === 'hip' ? 80 : 49.6;
          ctx.camera.updateProjectionMatrix();
          await window.__PUMP__(180);
          await r._meterTask;
          r.render(ctx);
          for (let i = 0; i < 32; i++) {
            if (r._graph.taaPass) r._graph.taaPass._jitterIndex = 0;
            renderer.setRenderTarget(display);
            r._graph.render();
            await renderer.readRenderTargetPixelsAsync(display, 0, 0, 1, 1);
          }
          renderer.setRenderTarget(null);
          const key = `${scene}-${pose}`,
            state = snapshot();
          const a = await game(`${key}-baseline`);
          select('variant');
          const b = await game(`${key}-variant`);
          if (snapshot() !== state) throw Error(`${key}: pair changed non-material state`);
          select('baseline');
          const restored = await game(`${key}-restored`);
          const hdrA = await readView();
          select('variant');
          const hdrB = await readView();
          select('baseline');
          const diagnostic = await channels();
          select('variant');
          const variantChannels = await channels();
          select('baseline');
          const worldDifference = difference(a.world, b.world);
          if (worldDifference.max !== 0)
            throw Error(`${key}: world changed ${JSON.stringify(worldDifference)}`);
          const restoration = difference(a.pixels, restored.pixels);
          if (restoration.meanAbsolute > 0.25 || restoration.max > 16)
            throw Error(`${key}: unstable restoration control`);
          if (difference(hdrA, hdrB, diagnostic.polymerMask).max !== 0)
            throw Error('polymer HDR changed');
          cases.push({
            scene,
            pose,
            exposure: r._exposure,
            state: JSON.parse(state),
            worldDifference,
            restoration,
            evaluated: {
              baseline: diagnostic.rows,
              variant: variantChannels.rows,
              nativeCoatF0: [0.04, 0.04, 0.04],
            },
            receiver: {
              baseline: stats(hdrA, diagnostic.receiverMask),
              variant: stats(hdrB, diagnostic.receiverMask),
              displayDifference: difference(a.pixels, b.pixels, diagnostic.receiverMask),
            },
            polymer: {
              baseline: stats(hdrA, diagnostic.polymerMask),
              variant: stats(hdrB, diagnostic.polymerMask),
              displayDifference: difference(a.pixels, b.pixels, diagnostic.polymerMask),
            },
            gpu: await gpu(),
          });
          if (initial.some(([object, material]) => object.material !== material))
            throw Error('unrestored source material');
        }
      variant.dispose();
      display.dispose();
      view.dispose();
      return { revision, materialInventory, cases, images, prewarm: window.__PREWARM__ };
    },
    { revision }
  );
  for (const [name, data] of Object.entries(report.images))
    writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'));
  delete report.images;
  writeFileSync(
    `${out}/report.json`,
    JSON.stringify({ ...report, device, errors, warnings }, null, 2)
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    JSON.stringify(
      {
        revision,
        device,
        cases: report.cases.map((c) => ({
          scene: c.scene,
          pose: c.pose,
          receiver: c.receiver,
          polymer: c.polymer,
          world: c.worldDifference,
          restoration: c.restoration,
        })),
        errors,
        warnings,
      },
      null,
      2
    )
  );
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally {
  await browser?.close();
  stopViteServer(server);
}
