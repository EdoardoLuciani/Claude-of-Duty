/** Native material regressions: finish policy, integration and borrowed ownership. */
import assert from 'node:assert/strict';

import {
  ensureViteServer,
  stopViteServer,
  launchChromium,
  parseArgs,
} from './lib/browser-harness.mjs';
const args = parseArgs(),
  port = Number(args.port ?? 5397);
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({
    headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: [
      '--ignore-gpu-blocklist',
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
      '--enable-unsafe-webgpu',
    ],
  });
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/material-calibration.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><link rel="icon" href="data:,"><canvas id="game"></canvas>',
    })
  );
  const mutationPath = {
    cache: 'materials/index.ts',
    glass: 'materials/tsl/glass.ts',
    rain: 'materials/shader-tsl.ts',
    local: 'materials/shader-tsl.ts',
    roughness: 'materials/shader-tsl.ts',
    rim: 'ai/textures-tsl.ts',
    clone: 'ai/textures-tsl.ts',
    skin: null,
    factors: 'materials/shader-tsl.ts',
    normal: 'materials/shader-tsl.ts',
    mask: 'materials/shader-tsl.ts',
  };
  let mutationRouteHits = 0,
    mutationApplied = false;
  if (args.negative) assert(Object.hasOwn(mutationPath, args.negative), 'unknown negative control');
  if (mutationPath[args.negative])
    await page.route(`**/src/${mutationPath[args.negative]}`, async (route) => {
      mutationRouteHits++;
      const response = await route.fetch(),
        originalBody = await response.text();
      let body = originalBody;
      const replaceOnce = (needle, replacement, label) => {
        // Vite's TS transform normalizes quoted channel/attribute names.
        if (!body.includes(needle)) needle = needle.replace(/'([^']*)'/g, '"$1"');
        const matches = body.split(needle).length - 1;
        assert.equal(
          matches,
          1,
          `${label}: served TS source must contain one mutation marker, got ${matches}`
        );
        body = body.replace(needle, replacement);
      };
      if (args.negative === 'factors') {
        replaceOnce(
          "channels.get('rough').mul(materialRoughness)",
          "channels.get('rough')",
          'roughness factor'
        );
      } else if (args.negative === 'normal') {
        replaceOnce(
          "mat.normalNode = channels.get('normal');",
          'mat.normalNode = vec3(0, 0, 1);',
          'planar normal'
        );
      } else if (args.negative === 'mask') {
        replaceOnce(
          "hasGeometryAttribute('color') ? vertexColor() : vec4(0)",
          "hasGeometryAttribute('color') ? vertexColor() : vec4(1)",
          'missing mask'
        );
      } else if (args.negative === 'rim') {
        const needle =
          'super.setupOutput(builder, vec4(mix(output.rgb, vec3(0), this.rimNode), output.a))';
        replaceOnce(needle, 'super.setupOutput(builder, output)', 'rim setupOutput');
      } else if (args.negative === 'clone') {
        const needle = 'setupOutput(builder, output) {';
        replaceOnce(
          needle,
          'copy(source) { super.copy(source); this.rimNode = float(0); return this; }\n  ' + needle,
          'clone setupOutput'
        );
      } else if (args.negative === 'roughness') {
        const needle = 'band.mul(vertical).mul(.1).mul(step(1e-4, weather.z))';
        replaceOnce(needle, 'band.mul(vertical).mul(.1)', 'dry roughness');
      } else if (args.negative === 'glass') {
        const needle = 'clamp(c, 0, .5)';
        replaceOnce(needle, 'clamp(c, .02, .5)', 'glass pigment clamp');
      } else if (args.negative === 'cache') {
        const needle = '|${bake.worldSize}|${bake.relief}';
        replaceOnce(needle, '', 'bake cache key');
      } else if (args.negative === 'rain') {
        const needle = 'streak.mulAssign(step(1e-4, weather.y));';
        replaceOnce(needle, '', 'rain runoff gate');
      } else if (args.negative === 'local') {
        const needle = '.select(surfP.xz, vec2(surfP.x.add(surfP.z.mul(.63)), surfP.y));';
        replaceOnce(
          needle,
          '.select(worldP.xz, vec2(worldP.x.add(worldP.z.mul(.63)), worldP.y));',
          'local projection'
        );
      } else throw new Error('unknown negative control');
      await route.fulfill({ response, body });
      mutationApplied = body !== originalBody;
    });
  await page.goto(`http://localhost:${port}/material-calibration.html`);
  const result = await page.evaluate(
    async ({ negative }) => {
      const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
      const { createWebGpuRenderer } = await import('/src/render/webgpu-device.ts');
      const { createSurfaceNodeMaterial } = await import('/src/materials/shader-tsl.ts');
      const { DEFAULT_PARAMS } = await import('/src/materials/params.ts');
      const { MaterialSystemNode } = await import('/src/materials/index.ts');
      const { glassSurface } = await import('/src/materials/tsl/glass.ts');
      const { SURFACE_FIXTURES } = await import('/tools/lib/material-fixtures.ts');
      const { createSoldierNodeMaterial, SoldierMaterialsNode } =
        await import('/src/ai/textures-tsl.ts');
      const { createWeaponMaterial } = await import('/src/weapons/asset-material.ts');
      const { createArmReferenceMaterial } = await import('/tools/lib/arm-material-reference.js');
      const { IndirectFill } = await import('/src/render/indirect-webgpu.ts');
      const { trackNodeBuilders } = await import('/src/dev/native-builds.ts');
      const renderer = await createWebGpuRenderer(document.querySelector('#game'));
      const resources = [],
        scene = new T.Scene(),
        camera = new T.PerspectiveCamera(55, 1, 0.1, 1000);
      const target = new T.RenderTarget(16, 16, { type: T.FloatType, depthBuffer: false });
      const geometry = new T.PlaneGeometry(2, 2),
        mesh = new T.Mesh(geometry, null);
      const masks = new Float32Array(geometry.attributes.position.count * 4);
      for (let i = 0; i < masks.length; i += 4) masks[i + 1] = 1;
      geometry.setAttribute('color', new T.BufferAttribute(masks, 4));
      scene.add(mesh);
      const data = (rgba, size = 1) => {
        const texture = new T.DataTexture(
          new Float32Array(rgba),
          size,
          size,
          T.RGBAFormat,
          T.FloatType
        );
        texture.wrapS = texture.wrapT = T.RepeatWrapping;
        texture.needsUpdate = true;
        resources.push(texture);
        return texture;
      };
      const flatAlbedo = data([0.3, 0.4, 0.5, 1]),
        normal = data([0.5, 0.5, 1, 1]);
      const set = { albedo: flatAlbedo, normal, orm: data([1, 0.5, 1, 1]) };
      const noise = [];
      for (let i = 0; i < 8 * 8; i++)
        noise.push(((i * 17) % 61) / 60, ((i * 13) % 59) / 58, ((i * 11) % 53) / 52, 0.5);
      const shared = {
        macro: data(noise, 8),
        detailAlbedo: data([0.5, 0.5, 0.5, 0.5]),
        detailNormal: normal,
      };
      const p = {
        ...DEFAULT_PARAMS,
        scale: 1,
        uvMode: 'triplanar',
        detail: [1, 0, 0, 1],
        wear: [0, 0, 0, 0],
        vertexMasks: true,
        weather: [0, 0, 0, 0],
        macro: [1, 0, 0, 0],
      };
      const read = async (activeCamera = camera) => {
        renderer.setRenderTarget(target);
        renderer.render(scene, activeCamera);
        return Array.from(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 16, 16));
      };
      const material = (opts, channel = 'color') => {
        const m = createSurfaceNodeMaterial(set, { ...p, ...opts }, shared, { toneMapped: false });
        m.setupOutput = function () {
          return N.vec4(channel === 'roughness' ? N.vec3(this.roughnessNode) : this.colorNode, 1);
        };
        resources.push(m);
        mesh.material = m;
      };
      const move = (x, angle = 0, y = 0) => {
        mesh.position.set(x, y, 0);
        mesh.rotation.y = angle;
        camera.position.set(x + Math.sin(angle) * 3, y, Math.cos(angle) * 3);
        camera.lookAt(mesh.position);
      };
      const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      const check = (ok, message) => {
        if (!ok) throw new Error(message);
      };
      let library;
      try {
        check(
          renderer.backend.isWebGPUBackend &&
            !renderer.backend.device.adapterInfo.isFallbackAdapter,
          'native nonfallback GPU required'
        );
        renderer.setSize(16, 16);
        renderer.setClearColor(0, 1);
        move(0);
        material({ weather: [0, 0, 0, 0] });
        const clear = await read();
        material({ weather: [0, 0, 0, 0.62] });
        const dry = await read();
        const dryDifference = maxDiff(clear, dry);
        check(dryDifference < 1e-6, 'zero rain must disable vertex-seeded runoff');
        material({ weather: [0, 0.5, 0, 0.62] });
        const wet = await read();
        const wetDifference = maxDiff(dry, wet);
        check(wetDifference > 0.01, 'rain positive control must execute runoff');
        const dryRoughness = {};
        for (const cavity of [0, 0.62]) {
          material({ localSpace: true, weather: [0, 0, 0, cavity] }, 'roughness');
          move(0, 0, -3);
          const below = await read();
          move(0, 0, 3);
          const above = await read();
          dryRoughness[cavity ? 'cavity' : 'clear'] = maxDiff(below, above);
        }
        check(
          dryRoughness.clear < 1e-6 && dryRoughness.cavity < 1e-6,
          `dry local roughness must stay anchored through vertical movement: ${JSON.stringify(dryRoughness)}`
        );
        material({ localSpace: true, weather: [0, 0, 0.3, 0] }, 'roughness');
        move(0, 0, -3);
        const splashed = await read();
        move(0, 0, 3);
        const aboveSplash = await read();
        const splashRoughnessDifference = maxDiff(splashed, aboveSplash);
        check(
          splashRoughnessDifference > 0.001,
          'enabled ground splash must still affect roughness'
        );
        const anchoring = {};
        for (const localSpace of [true, false]) {
          material({ localSpace, macro: [1, 0.8, 0.1, 0.1], macroBig: [1.8, 0.1, 0.11, 0] });
          move(0);
          const origin = await read();
          move(11);
          const translated = await read();
          move(11, 0.7);
          const rotated = await read();
          anchoring[localSpace ? 'local' : 'world'] = {
            translation: maxDiff(origin, translated),
            rotation: maxDiff(origin, rotated),
          };
        }
        check(
          anchoring.local.translation < 1e-5 && anchoring.local.rotation < 1e-5,
          'local finish must stay anchored through translation/rotation'
        );
        check(anchoring.world.translation > 0.01, 'world projection positive control must change');
        move(0);
        const glass = new T.MeshBasicNodeMaterial({ toneMapped: false });
        resources.push(glass);
        glass.colorNode = glassSurface(N.uv(), N.float(3)).get('albedo');
        mesh.material = glass;
        const glassPixels = await read();
        check(
          glassPixels.some((v, i) => i % 4 < 3 && v > 0.0001 && v < 0.019),
          'clean glass must retain dark linear pigment below .02'
        );
        // Numerical gates retained from the retired material-node fixture.
        const procedural = { ...p, uvMode: 'planar', vertexMasks: false, roughness: [1, 0, 0.04] };
        const shaderValues = {};
        mesh.rotation.y = Math.PI / 6;
        for (const channel of ['normal', 'factors']) {
          const m = createSurfaceNodeMaterial(set, procedural, shared, {
            roughness: 0.2,
            metalness: 0.12,
            toneMapped: false,
          });
          m.setupOutput = function () {
            return channel === 'normal'
              ? N.vec4(this.normalNode, 1)
              : N.vec4(this.roughnessNode, this.metalnessNode, 0, 1);
          };
          resources.push(m);
          mesh.material = m;
          shaderValues[channel] = (await read()).slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4);
        }
        check(
          shaderValues.normal
            .slice(0, 3)
            .every((v, i) => Math.abs(v - [0.5, 0, Math.cos(Math.PI / 6)][i]) < 0.015),
          'planar flat normal must follow the geometric normal'
        );
        check(
          Math.abs(shaderValues.factors[0] - 0.1) < 0.015 &&
            Math.abs(shaderValues.factors[1] - 0.12) < 0.015,
          'roughness/metalness properties must scale packed ORM'
        );
        move(0);
        // No vertex color is zero wear/grime/AO, including an instanced mesh.
        geometry.deleteAttribute('color');
        material({ vertexMasks: false, wear: [0.4, 0.6, 0.5, 0] });
        const unmasked = await read();
        material({ vertexMasks: true, wear: [0.4, 0.6, 0.5, 0] });
        const missingMask = await read();
        const instanced = new T.InstancedMesh(geometry, mesh.material, 1);
        scene.remove(mesh);
        scene.add(instanced);
        const instancePixels = await read();
        scene.remove(instanced);
        scene.add(mesh);
        instanced.dispose();
        check(
          maxDiff(unmasked, missingMask) < 1e-6 && maxDiff(unmasked, instancePixels) < 1e-6,
          'missing vertex masks must default to zero for plain/instanced geometry'
        );
        geometry.setAttribute('color', new T.BufferAttribute(masks, 4));
        library = new MaterialSystemNode({ renderer });
        await library.init({ config: { quality: 'low', q: { anisotropy: 2 } } });
        const recipeDryRoughness = {};
        for (const name of ['alu', 'polymer', 'steel']) {
          const [surface, opts] = SURFACE_FIXTURES[name],
            m = library.get(surface, opts);
          m.setupOutput = function () {
            return N.vec4(N.vec3(this.roughnessNode), 1);
          };
          mesh.material = m;
          move(0, 0, -3);
          const below = await read();
          move(0, 0, 3);
          const above = await read();
          recipeDryRoughness[name] = maxDiff(below, above);
          check(
            recipeDryRoughness[name] < 1e-6,
            `${name}: dry recipe roughness must stay vertically anchored`
          );
        }
        move(0);
        const [sootSurface, sootOpts] = SURFACE_FIXTURES.steel_soot;
        const soot = library.get(sootSurface, sootOpts);
        soot.setupOutput = function () {
          return N.vec4(this.metalnessNode, 0, 0, 1);
        };
        mesh.material = soot;
        shaderValues.sootMetalness = (await read())[(8 * 16 + 8) * 4];
        check(
          shaderValues.sootMetalness > 0.02 && shaderValues.sootMetalness < 0.121,
          'steel-soot shader must respect its authored metalness multiplier'
        );
        const opts = { bake: { size: 256, seed: 997, relief: 0.02, worldSize: 0.5 } };
        const first = library.getTextureSet('rubber', opts);
        const relief = library.getTextureSet('rubber', { bake: { ...opts.bake, relief: 0.1 } });
        const scale = library.getTextureSet('rubber', { bake: { ...opts.bake, worldSize: 2 } });
        check(first === library.getTextureSet('rubber', opts), 'same bake must reuse textures');
        check(
          first !== relief && first !== scale && relief !== scale,
          'relief/worldSize must distinguish baked texture sets'
        );
        const normals = [];
        for (const s of [first, relief, scale]) {
          const m = new T.MeshBasicNodeMaterial({ toneMapped: false });
          resources.push(m);
          m.colorNode = N.texture(s.normal).rgb;
          mesh.material = m;
          normals.push(await read());
        }
        const bakeDifferences = {
          relief: maxDiff(normals[0], normals[1]),
          worldSize: maxDiff(normals[0], normals[2]),
        };
        check(
          bakeDifferences.relief > 0.001 && bakeDifferences.worldSize > 0.001,
          `bake-key changes must affect actual normal maps: ${JSON.stringify(bakeDifferences)}`
        );
        // Frozen pre-refactor paths are references, never production selectors.
        const legacyCopy = (source, weapon) => {
          const m =
            weapon || source.isMeshPhysicalMaterial
              ? new T.MeshPhysicalNodeMaterial()
              : new T.MeshStandardNodeMaterial();
          (source.isMeshPhysicalMaterial
            ? T.MeshPhysicalMaterial
            : T.MeshStandardMaterial
          ).prototype.copy.call(m, source);
          if (weapon) m.defines.PHYSICAL = '';
          resources.push(m);
          return m;
        };
        const legacyRim = (source, scale) => {
          const m = new T.MeshStandardNodeMaterial().copy(source),
            previous = m.setupOutput;
          m.setupOutput = function (builder, output) {
            const view = N.normalize(N.cameraPosition.sub(N.positionWorld));
            const facing = N.abs(N.dot(view, N.normalize(N.normalWorldGeometry)));
            const rim = N.smoothstep(0.42, 1, N.float(1).sub(facing))
              .pow(1.9)
              .mul(0.62 * scale);
            return previous.call(
              this,
              builder,
              N.vec4(N.mix(output.rgb, N.vec3(0), rim), output.a)
            );
          };
          resources.push(m);
          return m;
        };
        const sphere = new T.SphereGeometry(1, 32, 16);
        resources.push(sphere);
        mesh.geometry = sphere;
        const colors = new Float32Array(sphere.attributes.position.count * 3).fill(1);
        sphere.setAttribute('color', new T.BufferAttribute(colors, 3));
        const light = new T.DirectionalLight(0xffffff, 3);
        light.position.set(2, 3, 4);
        scene.add(light);
        move(0);
        renderer.setClearColor(0, 0);
        const integration = { copies: {}, rim: {}, skinned: { comparisons: [] }, environment: [] };
        for (const physical of [false, true]) {
          const source = physical
            ? new T.MeshPhysicalMaterial({ specularIntensity: 0.16, clearcoat: 0.25 })
            : new T.MeshStandardMaterial();
          source.color.setRGB(0.12, 0.18, 0.24);
          source.map = flatAlbedo;
          source.normalMap = normal;
          source.normalScale.set(0.85, 0.85);
          resources.push(source);
          for (const [name, make] of [
            ['weapon', createWeaponMaterial],
            // Keep the unmerged arm reference as a native-copy calibration control.
            ['arm-reference', createArmReferenceMaterial],
          ]) {
            const m = make(source),
              ref = legacyCopy(source, name === 'weapon');
            resources.push(m);
            mesh.material = ref;
            const expected = await read();
            mesh.material = m;
            const actual = await read();
            const difference = maxDiff(expected, actual);
            integration.copies[`${name}/${physical}`] = difference;
            check(
              actual.some((v, i) => i % 4 < 3 && v > 0.01),
              'copy probe must render a lit surface'
            );
            check(difference < 1e-6, `${name}: public copy must match legacy pixels`);
          }
        }
        const goggles = new SoldierMaterialsNode({}, {}),
          candidates = [
            ['full', createSoldierNodeMaterial(set), 1],
            ['reduced', createSoldierNodeMaterial(set, { rim: 0.2 }), 0.2],
            ['goggles', goggles.glass(), 0.5],
          ];
        for (const [name, m, scale] of candidates) {
          const ref = legacyRim(m, scale),
            clone = m.clone();
          resources.push(m, clone);
          integration.rim[name] = [];
          for (const fogged of [false, true]) {
            scene.fog = fogged ? new T.Fog(0x567890, 0.1, 8) : null;
            for (const v of [m, ref, clone]) {
              v.transparent = fogged;
              v.premultipliedAlpha = fogged;
              v.opacity = fogged ? 0.55 : 1;
              v.needsUpdate = true;
            }
            mesh.material = ref;
            const expected = await read();
            for (const [label, v] of [
              ['original', m],
              ['clone', clone],
            ]) {
              mesh.material = v;
              const actual = await read(),
                difference = maxDiff(expected, actual);
              integration.rim[name].push({ fogged, label, difference });
              check(
                difference < 1e-5,
                `${name}/${label}: rim must match legacy pixels before fog/premultiplication`
              );
            }
          }
        }
        // Real skinned goggles, including clone, camera motion and fog/alpha.
        // Native skeleton updates are cached per renderer frame, not per draw.
        const indices = new Uint16Array((colors.length / 3) * 4),
          weights = new Float32Array(indices.length);
        for (let i = 0; i < sphere.attributes.position.count; i++) {
          indices[i * 4 + 1] = 1;
          const w = (sphere.attributes.position.getY(i) + 1) / 2;
          weights[i * 4] = 1 - w;
          weights[i * 4 + 1] = w;
        }
        sphere.setAttribute('skinIndex', new T.BufferAttribute(indices, 4));
        sphere.setAttribute('skinWeight', new T.BufferAttribute(weights, 4));
        const goggle = candidates[2][1],
          cloned = goggle.clone(),
          reference = legacyRim(goggle, 0.5);
        resources.push(cloned);
        const skinned = new T.SkinnedMesh(sphere, goggle),
          root = new T.Bone(),
          tip = new T.Bone();
        root.add(tip);
        skinned.add(root);
        skinned.bind(new T.Skeleton([root, tip]));
        resources.push(skinned.skeleton);
        mesh.visible = false;
        scene.add(skinned);
        const readSkin = async (m) => {
          await new Promise(requestAnimationFrame);
          skinned.material = m;
          return read();
        };
        for (const fogged of [false, true]) {
          scene.fog = fogged ? new T.Fog(0x567890, 0.1, 8) : null;
          for (const m of [goggle, cloned, reference]) {
            m.transparent = fogged;
            m.premultipliedAlpha = fogged;
            m.opacity = fogged ? 0.55 : 1;
            m.needsUpdate = true;
          }
          for (const angle of [0, 0.45, -0.35]) {
            tip.rotation.z = angle;
            tip.position.x = angle * 0.3;
            camera.position.set(angle * 0.2, 0, 3);
            camera.lookAt(0, 0, 0);
            const expected = await readSkin(reference);
            check(
              expected.some((v, i) => i % 4 < 3 && v > 0.001),
              'skinned reference must render a lit surface'
            );
            for (const [label, m] of [
              ['original', goggle],
              ['clone', cloned],
            ]) {
              const difference = maxDiff(expected, await readSkin(m));
              check(
                difference < 1e-5,
                `skinned/${label}: rim must match legacy pixels before fog/premultiplication`
              );
              integration.skinned.comparisons.push({ fogged, angle, label, difference });
            }
          }
        }
        camera.position.set(0, 0, 3);
        camera.lookAt(0, 0, 0);
        tip.position.x = 0;
        tip.rotation.z = 0;
        const skinBefore = await readSkin(goggle),
          skinBuilds = trackNodeBuilders(renderer);
        let motionDifference = 0;
        try {
          for (let i = 0; i < 8; i++) {
            if (negative !== 'skin') tip.rotation.z = (i + 1) * 0.08;
            motionDifference = Math.max(
              motionDifference,
              maxDiff(skinBefore, await readSkin(goggle))
            );
          }
          check(
            motionDifference > 0.001,
            'animated skinned goggles must change pixels across renderer frames'
          );
          check(skinBuilds.count === 0, 'warmed skinned motion must not create builders');
          Object.assign(integration.skinned, { motionDifference, builders: skinBuilds.count });
        } finally {
          skinBuilds.dispose();
        }
        scene.remove(skinned);
        mesh.visible = true;
        move(0);
        scene.fog = null;
        const env = new T.DataTexture(new Uint8Array(4 * 2 * 4).fill(80), 4, 2);
        resources.push(env);
        env.mapping = T.EquirectangularReflectionMapping;
        env.needsUpdate = true;
        scene.environment = env;
        const worldCamera = camera,
          viewCamera = camera.clone();
        for (const order of [
          [worldCamera, viewCamera],
          [viewCamera, worldCamera],
        ]) {
          // Independent graph identities; never reuse another owner's cached hook.
          const contexts = new Map([
            [worldCamera, N.context({})],
            [viewCamera, N.context({})],
          ]);
          const fill = new IndirectFill({ viewCamera, peek: () => null });
          fill.sky.value.set(0.2, 0.3, 0.4);
          fill.ground.value.set(0.02, 0.01, 0.005);
          fill.viewVisibility.value = 0.12;
          const source = new T.MeshPhysicalMaterial({ color: 0x567890, clearcoat: 0.4 });
          resources.push(source);
          const m = createWeaponMaterial(source),
            ref = legacyCopy(source, true);
          resources.push(m);
          fill.patch(m);
          fill.patch(ref);
          const initial = new Map();
          for (const c of order) {
            renderer.contextNode = contexts.get(c);
            mesh.material = ref;
            const expected = await read(c);
            mesh.material = m;
            const actual = await read(c);
            initial.set(c, actual);
            check(
              maxDiff(expected, actual) < 1e-6,
              'registered environment must preserve legacy sampling'
            );
          }
          const separation = maxDiff(initial.get(worldCamera), initial.get(viewCamera));
          check(separation > 0.001, 'camera-specific environment gate must remain isolated');
          renderer.contextNode = contexts.get(viewCamera);
          mesh.material = m;
          const liveBefore = await read(viewCamera); // Bind the live path after either build order.
          const builds = trackNodeBuilders(renderer);
          let liveDifference;
          try {
            fill.sky.value.multiplyScalar(1.7);
            fill.viewVisibility.value = 0.65;
            renderer.contextNode = contexts.get(viewCamera);
            mesh.material = m;
            liveDifference = maxDiff(liveBefore, await read(viewCamera));
            check(
              liveDifference > 0.001 && builds.count === 0,
              `live environment must update without rebuilding: ${JSON.stringify({ viewFirst: order[0] === viewCamera, liveDifference, builders: builds.count })}`
            );
          } finally {
            builds.dispose();
          }
          integration.environment.push({
            viewFirst: order[0] === viewCamera,
            separation,
            liveDifference,
            builders: builds.count,
          });
        }
        renderer.contextNode = null;
        const a = renderer.backend.device.adapterInfo;
        return {
          device: { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter },
          dryDifference,
          wetDifference,
          dryRoughness,
          splashRoughnessDifference,
          recipeDryRoughness,
          anchoring,
          bakeDifferences,
          shaderValues,
          integration,
        };
      } finally {
        renderer.setRenderTarget(null);
        library?.dispose();
        target.dispose();
        geometry.dispose();
        for (const resource of resources) resource.dispose();
        await renderer.dispose();
      }
    },
    { negative: args.negative ?? null }
  );
  if (args.negative && mutationPath[args.negative]) {
    assert.equal(
      mutationRouteHits,
      1,
      `${args.negative} injection route must be requested exactly once`
    );
    assert.equal(
      mutationApplied,
      true,
      `${args.negative} injection must alter the served TypeScript module`
    );
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
  await page.close();
} finally {
  await browser?.close();
  stopViteServer(server);
}
