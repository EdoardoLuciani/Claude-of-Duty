#!/usr/bin/env node
/** Channel separation must preserve pixels, live controls and native ownership. */
import assert from 'node:assert/strict';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { installDevicePolicy } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const server = await ensureViteServer({ port: Number(args.port ?? 5398) });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  collectBrowserErrors(page, errors, { validationMessages: true });
  await installDevicePolicy(page);
  await page.route('**/surface-shadow-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><canvas></canvas>',
    })
  );
  await page.goto(`http://localhost:${Number(args.port ?? 5398)}/surface-shadow-probe`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createSurfaceNodeMaterial: create } = await import('/src/materials/shader-tsl.ts');
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
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-3, 3, 3, -3, 0.1, 30);
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
    const tex = (data) => {
      const t = new T.DataTexture(new Uint8Array(data), 2, 2);
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.minFilter = t.magFilter = T.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    const textures = [
      tex([150, 90, 40, 40, 100, 120, 80, 140, 190, 160, 90, 220, 120, 95, 80, 255]),
      tex([110, 140, 250, 255, 135, 120, 245, 255, 150, 145, 240, 255, 115, 110, 250, 255]),
      tex([200, 140, 50, 255, 180, 180, 110, 255, 230, 210, 70, 255, 150, 120, 90, 255]),
      tex([100, 140, 130, 130, 150, 120, 130, 150, 140, 130, 140, 110, 120, 140, 120, 140]),
      tex([110, 140, 245, 255, 130, 145, 250, 255, 135, 115, 250, 255, 120, 130, 245, 255]),
      tex([100, 140, 100, 110, 130, 120, 140, 150, 140, 130, 140, 150, 120, 140, 120, 140]),
    ];
    const set = { albedo: textures[0], normal: textures[1], orm: textures[2] };
    const shared = {
      detailAlbedo: textures[3],
      detailNormal: textures[4],
      macro: textures[5],
      keyDir: N.uniform(new T.Vector3(0, 1, 0)),
      keyColor: N.uniform(new T.Color(0.8, 0.7, 0.6)),
    };
    const geometry = new T.BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      'color',
      new T.Float32BufferAttribute(
        Array.from(
          { length: geometry.attributes.position.count * 4 },
          (_, i) => [0.65, 0.55, 0.35, 1][i % 4]
        ),
        4
      )
    );
    const floorGeometry = new T.PlaneGeometry(8, 8);
    const floorMaterial = new T.MeshStandardNodeMaterial({ color: 0x999999, roughness: 1 });
    const floor = new T.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    floor.receiveShadow = true;
    scene.add(floor);
    const target = new T.RenderTarget(64, 64, { type: T.FloatType });
    const depthTarget = new T.RenderTarget(64, 64, { type: T.FloatType, depthBuffer: false });
    const depthMaterial = new T.NodeMaterial();
    const quad = new T.QuadMesh(depthMaterial);
    const Channels = N.struct({ color: 'vec3', normal: 'vec3' });
    const variants = [
      ['mesh', { uvMode: 'mesh' }],
      ['planar', {}],
      ['triplanar', { uvMode: 'triplanar' }],
      [
        'complex-planar',
        {
          parallax: 0.035,
          detile: 0.7,
          macroBig: [1, 0.12, 0.03, 0],
          patch: [0.6, 2.6, 0.12, -0.08],
          macroRelief: 0.1,
          cloth: [0.2, 0.8, 0.04, 0],
          vertexMasks: true,
        },
      ],
      ['local-planar', { localSpace: true, parallax: 0.02, vertexMasks: true }],
      [
        'masked-mesh',
        { uvMode: 'mesh', alphaMask: true, vertexMasks: true },
        { physical: true, alphaTest: 0.5 },
      ],
      [
        'physical-mesh',
        { uvMode: 'mesh', detile: 0.5, cloth: [0.2, 0.8, 0, 0], vertexMasks: true },
        { physical: true },
      ],
      ['tint-discard', { uvMode: 'mesh' }],
    ];
    const objects = [],
      materials = [],
      cases = [];
    const ids = new WeakMap();
    let nextId = 1;
    const id = (value) => {
      let result = ids.get(value);
      if (result === undefined) ids.set(value, (result = nextId++));
      return result;
    };
    const check = (ok, message) => {
      if (!ok) throw new Error(message);
    };
    const compare = (a, b) => {
      check(a.length === b.length, 'readback size');
      let max = 0;
      for (let i = 0; i < a.length; i++) {
        check(Number.isFinite(a[i]) && Number.isFinite(b[i]), 'finite readback');
        max = Math.max(max, Math.abs(a[i] - b[i]));
      }
      check(max <= 1e-6, `readback delta ${max}`);
      return max;
    };
    const read = async (caster) => {
      objects.forEach((o) => {
        o.visible = o === caster;
      });
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
      const samples = depth.filter((_, i) => i % 4 === 0);
      check(Math.max(...samples) - Math.min(...samples) > 0.001, 'nonempty shadow');
      check(
        color.some((v, i) => i % 4 !== 3 && v > 0.01),
        'nonblank beauty'
      );
      const ros = [...renderer._objects._renderObjects].filter(
        (ro) => ro.object === caster && ro._bindings
      );
      const shadow = ros.find((ro) => ro.material.isShadowPassMaterial);
      const beauty = ros.find((ro) => ro.material === caster.material);
      if (!shadow?._bindings || !beauty?._bindings)
        throw new Error('native render objects required');
      const bindings = shadow._bindings.flatMap((g) => g.bindings);
      const owned = bindings
        .filter((b) => b.isUniformBuffer && b.groupNode.shared !== true)
        .map((b) => renderer.backend.get(b).buffer)
        .filter(Boolean)
        .map(id);
      check(owned.length > 0, 'owned native buffers required');
      const code = beauty._nodeBuilderState?.fragmentShader;
      if (typeof code !== 'string') throw new Error('completed shader state required');
      return {
        color,
        depth,
        owned,
        bindings: bindings.length,
        normalBound: bindings.some(
          (b) => b.textureNode?.value === set.normal || b.textureNode?.value === shared.detailNormal
        ),
        samples: (code.match(/textureSample\w*\(/g) ?? []).length,
        loops: (code.match(/\bfor\s*\(/g) ?? []).length,
      };
    };
    try {
      // Independent numeric oracle, not just comparison of two graphs built
      // from the same expressions. Neutral maps disable all authored effects.
      const albedo = new T.DataTexture(new Uint8Array([150, 90, 40, 204]), 1, 1);
      const orm = new T.DataTexture(
        new Float32Array([1, 0.7, 0, 1]),
        1,
        1,
        T.RGBAFormat,
        T.FloatType
      );
      const neutral = new T.DataTexture(
        new Float32Array([0.5, 0.5, 1, 0.5]),
        1,
        1,
        T.RGBAFormat,
        T.FloatType
      );
      for (const t of [albedo, orm, neutral]) {
        t.needsUpdate = true;
        textures.push(t);
      }
      const tint = N.uniform(new T.Color(1, 1, 1));
      const flat = create(
        { albedo, normal: textures[1], orm },
        {
          ...DEFAULT_PARAMS,
          uvMode: 'mesh',
          alphaMask: true,
          detail: [1, 0, 0, 1],
          macro: [0.04, 0, 0, 0],
          weather: [0, 0, 0, 0],
          tintNode: tint,
        },
        { detailAlbedo: neutral, detailNormal: textures[4], macro: neutral },
        { dithering: false }
      );
      flat.toneMapped = false;
      materials.push(flat);
      const probe = new T.Mesh(geometry, flat);
      scene.add(probe);
      objects.push(probe);
      floor.visible = false;
      camera.position.set(0, 0, 5);
      camera.lookAt(0, 0, 0);
      const pixel = async () => {
        renderer.setRenderTarget(target);
        await renderer.compileAsync(scene, camera);
        renderer.render(scene, camera);
        renderer.render(scene, camera);
        const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64);
        return data.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 3);
      };
      flat.fragmentNode = N.vec4(flat.colorNode, 1);
      compare(await pixel(), [150 / 255, 90 / 255, 40 / 255]);
      let lateBuilders = 0;
      const previousHook = renderer.debug.onNodeBuilderCreated;
      renderer.debug.onNodeBuilderCreated = () => {
        lateBuilders++;
      };
      try {
        tint.value.setRGB(0.5, 0.75, 0.25);
        compare(await pixel(), [75 / 255, 67.5 / 255, 10 / 255]);
        check(lateBuilders === 0, 'uniform tuning must not rebuild shaders');
      } finally {
        renderer.debug.onNodeBuilderCreated = previousHook;
      }
      flat.fragmentNode = N.vec4(flat.roughnessNode, flat.metalnessNode, flat.aoNode, 1);
      flat.needsUpdate = true;
      compare(await pixel(), [0.7, 0, 1]);
      flat.fragmentNode = N.vec4(flat.opacityNode, 0, 0, 1);
      flat.needsUpdate = true;
      compare(await pixel(), [0.8, 0, 0]);
      probe.visible = false;
      floor.visible = true;
      for (const [name, params, props = {}] of variants) {
        const tint = N.uniform(new T.Color(1, 1, 1)),
          normal = N.uniform(1);
        const weather = N.uniform(new T.Vector4(...DEFAULT_PARAMS.weather));
        const scale = N.uniform(params.uvMode === 'mesh' ? 2 : 0.5);
        const parallax = N.uniform(params.parallax ?? 0),
          ground = N.uniform(0);
        const tintNode =
          name === 'tint-discard'
            ? N.Fn(() => {
                N.uv().x.lessThan(0.3).discard();
                return tint;
              }, 'vec3')()
            : tint;
        const material = create(
          set,
          {
            ...DEFAULT_PARAMS,
            ...params,
            tintNode,
            normalAmpNode: normal,
            weatherNode: weather,
            tileNode: scale,
            parallaxNode: parallax,
            groundNode: ground,
          },
          shared,
          { ...props, side: T.DoubleSide }
        );
        // Same expressions, intentionally coupled in a test-only shader struct.
        // This is not a second surface implementation or a renderer intervention.
        const packed = N.Fn(() => Channels(material.colorNode, material.normalNode))();
        const reference = material.clone();
        reference.colorNode = packed.get('color');
        reference.normalNode = packed.get('normal');
        materials.push(material, reference);
        for (const instanced of [false, true]) {
          const pair = [material, reference].map((m) => {
            const o = instanced ? new T.InstancedMesh(geometry, m, 2) : new T.Mesh(geometry, m);
            o.castShadow = true;
            o.visible = false;
            if (instanced) {
              o.setMatrixAt(0, new T.Matrix4().makeTranslation(-1, 0, 0));
              o.setMatrixAt(1, new T.Matrix4().makeTranslation(1, 0, 0));
            }
            scene.add(o);
            objects.push(o);
            return o;
          });
          let previous;
          for (let pose = 0; pose < 2; pose++) {
            camera.position.set(pose * 0.3, 3, 5);
            camera.lookAt(0, 0, 0);
            light.position.set(2 - pose, 4, 3 + pose);
            pair.forEach((o) => {
              o.rotation.y = pose * 0.2;
              o.scale.setScalar(1 + pose * 0.1);
            });
            tint.value.setRGB(1 - pose * 0.1, 0.7 + pose * 0.1, 0.8);
            normal.value = 1 + pose * 0.2;
            scale.value = (params.uvMode === 'mesh' ? 2 : 0.5) * (1 + pose * 0.1);
            weather.value.set(0.35 + pose * 0.1, 0.3, 0.55, 0.4);
            parallax.value = (params.parallax ?? 0) * (1 - pose * 0.1);
            ground.value = pose * 0.2;
            const a = await read(pair[pose % 2]),
              b = await read(pair[1 - (pose % 2)]);
            const independent = pose % 2 ? b : a,
              coupled = pose % 2 ? a : b;
            check(
              independent.bindings < coupled.bindings,
              'unrelated normal bindings must disappear'
            );
            check(!independent.normalBound && coupled.normalBound, 'shadow channel separation');
            check(
              independent.owned.every((v) => !coupled.owned.includes(v)),
              'native buffers must not alias'
            );
            const current = [independent.owned, coupled.owned];
            if (previous)
              check(
                JSON.stringify(previous) === JSON.stringify(current),
                'buffer identity must survive live changes'
              );
            previous = current;
            check(
              independent.samples === coupled.samples && independent.loops === coupled.loops,
              'shared shader work must not duplicate'
            );
            cases.push({
              name,
              instanced,
              pose,
              bindings: [coupled.bindings, independent.bindings],
              colorDelta: compare(a.color, b.color),
              depthDelta: compare(a.depth, b.depth),
            });
          }
        }
      }
      return cases;
    } finally {
      renderer.setRenderTarget(null);
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      floorMaterial.dispose();
      depthMaterial.dispose();
      geometry.dispose();
      floorGeometry.dispose();
      target.dispose();
      depthTarget.dispose();
      light.shadow.dispose();
      renderer.dispose();
    }
  });
  assert.equal(result.length, 32);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  stopViteServer(server);
}
