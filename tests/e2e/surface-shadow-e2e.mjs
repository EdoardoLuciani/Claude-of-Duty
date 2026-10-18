#!/usr/bin/env node
/** Compare the specialized surface against its original RGB member, including shadow depth. */
import assert from 'node:assert/strict';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { installDevicePolicy } from '../../tools/lib/native-render.mjs';

const args = parseArgs(),
  port = Number(args.port ?? 5398);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await installDevicePolicy(page);
  await page.route('**/surface-shadow-probe', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' })
  );
  await page.goto(`http://localhost:${port}/surface-shadow-probe`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createSurfaceNodeMaterial } = await import('/src/materials/shader-tsl.ts');
    const { DEFAULT_PARAMS } = await import('/src/materials/params.ts');
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    const scene = new T.Scene(),
      camera = new T.OrthographicCamera(-3, 3, 3, -3, 0.1, 30);
    const light = new T.DirectionalLight(0xffffff, 3);
    light.castShadow = true;
    light.shadow.mapSize.set(64, 64);
    Object.assign(light.shadow.camera, {
      left: -4,
      right: 4,
      top: 4,
      bottom: -4,
      near: 0.1,
      far: 20,
    });
    scene.add(light, light.target, new T.AmbientLight(0xffffff, 0.25));
    const tex = (rgba) => {
      const t = new T.DataTexture(new Uint8Array(rgba), 1, 1);
      t.needsUpdate = true;
      return t;
    };
    const textures = [
      tex([150, 90, 40, 255]),
      tex([128, 128, 255, 255]),
      tex([255, 180, 0, 255]),
      tex([128, 128, 128, 255]),
    ];
    const tint = N.uniform(new T.Color(1, 1, 1));
    const material = createSurfaceNodeMaterial(
      { albedo: textures[0], normal: textures[1], orm: textures[2] },
      {
        ...DEFAULT_PARAMS,
        uvMode: 'mesh',
        detail: [1, 0, 0, 1],
        detailWorld: 0,
        macro: [0.04, 0, 0, 0],
        weather: [0, 0, 0, 0],
        tintNode: tint,
      },
      { detailAlbedo: textures[3], detailNormal: textures[1], macro: textures[3] }
    );
    // Obtain the untouched member from a beauty builder, not a second implementation.
    const builder = new T.NodeBuilder({ material }, renderer, null);
    builder.material = material;
    const reference = material.clone();
    reference.colorNode = material.colorNode.getOutputNode(builder).outputNode;
    const geometry = new T.BoxGeometry(1, 1, 1),
      floorGeometry = new T.PlaneGeometry(8, 8);
    const floorMaterial = new T.MeshStandardNodeMaterial({ color: 0x999999, roughness: 1 });
    const floor = new T.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    floor.receiveShadow = true;
    // Keep each caster's source material stable, including Three's shadow caches.
    const pairs = [
      [new T.Mesh(geometry, material), new T.Mesh(geometry, reference)],
      [new T.InstancedMesh(geometry, material, 2), new T.InstancedMesh(geometry, reference, 2)],
    ];
    const casters = pairs.flat();
    for (const caster of casters) {
      caster.castShadow = true;
      if (caster.isInstancedMesh) {
        caster.setMatrixAt(0, new T.Matrix4().makeTranslation(-1, 0, 0));
        caster.setMatrixAt(1, new T.Matrix4().makeTranslation(1, 0, 0));
      }
    }
    scene.add(floor);
    const target = new T.RenderTarget(64, 64, { type: T.FloatType });
    const depthTarget = new T.RenderTarget(64, 64, { type: T.FloatType, depthBuffer: false });
    const depthMaterial = new T.NodeMaterial(),
      quad = new T.QuadMesh(depthMaterial);
    const check = (ok, message) => {
      if (!ok) throw new Error(message);
    };
    const compare = (a, b, label) => {
      check(a.length === b.length, label + ' size');
      let max = 0;
      for (let i = 0; i < a.length; i++) {
        check(Number.isFinite(a[i]) && Number.isFinite(b[i]), label + ' finite');
        max = Math.max(max, Math.abs(a[i] - b[i]));
      }
      check(max <= 1e-6, `${label}: delta ${max}`);
      return max;
    };
    const read = async (caster) => {
      for (const object of casters) object.visible = object === caster;
      renderer.setRenderTarget(target);
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      renderer.render(scene, camera);
      const color = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64);
      depthMaterial.fragmentNode ??= N.vec4(
        N.textureLoad(light.shadow.map.depthTexture, N.ivec2(N.screenCoordinate.xy)).r,
        0,
        0,
        1
      );
      renderer.setRenderTarget(depthTarget);
      quad.render(renderer);
      const depth = await renderer.readRenderTargetPixelsAsync(depthTarget, 0, 0, 64, 64);
      const samples = depth.filter((_v, i) => i % 4 === 0);
      check(
        Math.max(...samples) - Math.min(...samples) > 0.001,
        'shadow map must contain a caster'
      );
      check(
        color.some((v, i) => i % 4 !== 3 && v > 0.01),
        'beauty must not be blank'
      );
      const shadowObject = [...renderer._objects._renderObjects].find(
        (ro) => ro.object === caster && ro.material.isShadowPassMaterial === true
      );
      check(!!shadowObject?._bindings, 'native shadow bindings must exist');
      const bindings = shadowObject._bindings.reduce((n, group) => n + group.bindings.length, 0);
      return { color, depth, bindings };
    };
    const cases = [];
    try {
      for (const [caster, referenceCaster] of pairs) {
        scene.add(caster, referenceCaster);
        for (let pose = 0; pose < 3; pose++) {
          camera.position.set(pose * 0.3, 3, 5);
          camera.lookAt(0, 0, 0);
          light.position.set(2 - pose, 4, 3 + pose);
          for (const object of [caster, referenceCaster]) {
            object.rotation.y = pose * 0.2;
            object.scale.setScalar(1 + pose * 0.1);
          }
          tint.value.setRGB(1 - pose * 0.1, 0.7 + pose * 0.1, 0.8);
          const a = await read(pose % 2 ? caster : referenceCaster);
          const b = await read(pose % 2 ? referenceCaster : caster);
          const optimized = pose % 2 ? a : b,
            original = pose % 2 ? b : a;
          check(
            optimized.bindings < original.bindings,
            `unused surface dependencies must disappear: ${caster.type} pose ${pose}, ${original.bindings} -> ${optimized.bindings}`
          );
          cases.push({
            bindings: [original.bindings, optimized.bindings],
            instanced: caster.isInstancedMesh === true,
            pose,
            colorDelta: compare(a.color, b.color, `beauty ${caster.type} pose ${pose}`),
            depthDelta: compare(a.depth, b.depth, 'shadow depth'),
          });
        }
        scene.remove(caster, referenceCaster);
      }
      return cases;
    } finally {
      renderer.setRenderTarget(null);
      material.dispose();
      reference.dispose();
      floorMaterial.dispose();
      depthMaterial.dispose();
      geometry.dispose();
      floorGeometry.dispose();
      target.dispose();
      depthTarget.dispose();
      light.shadow.dispose();
      textures.forEach((t) => t.dispose());
      renderer.dispose();
    }
  });
  assert.equal(result.length, 6);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await stopViteServer(server);
}
