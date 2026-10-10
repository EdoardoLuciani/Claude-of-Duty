/** Native material regressions: finish policy, integration and borrowed ownership. */
import assert from 'node:assert/strict';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5397);
const server = await ensureViteServer({ port }); let browser;
try {
  browser = await launchChromium({ headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/material-calibration.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><link rel="icon" href="data:,"><canvas id="game"></canvas>' }));
  const mutationPath = { cache: 'materials/index.js', glass: 'materials/tsl/glass.js',
    rain: 'materials/shader-tsl.js', local: 'materials/shader-tsl.js', roughness: 'materials/shader-tsl.js',
    rim: 'ai/textures-tsl.js', clone: 'ai/textures-tsl.js' };
  if (args.negative) assert(Object.hasOwn(mutationPath, args.negative), 'unknown negative control');
  if (args.negative) await page.route(`**/src/${mutationPath[args.negative]}`, async route => {
    const response = await route.fetch(); let body = await response.text();
    if (args.negative === 'rim') {
      const needle = 'super.setupOutput(builder, vec4(mix(output.rgb, vec3(0), this.rimNode), output.a))';
      assert.equal(body.split(needle).length - 1, 1); body = body.replace(needle, 'super.setupOutput(builder, output)');
    } else if (args.negative === 'clone') {
      const needle = 'setupOutput(builder, output) {';
      assert.equal(body.split(needle).length - 1, 1);
      body = body.replace(needle, 'copy(source) { super.copy(source); this.rimNode = float(0); return this; }\n  ' + needle);
    } else if (args.negative === 'roughness') {
      const needle = 'band.mul(vertical).mul(0.10).mul(step(0.0001, weather.z))';
      assert.equal(body.split(needle).length - 1, 1); body = body.replace(needle, 'band.mul(vertical).mul(0.10)');
    } else if (args.negative === 'glass') {
      const needle = 'clamp(c, 0, 0.5)';
      assert.equal(body.split(needle).length - 1, 1); body = body.replace(needle, 'clamp(c, 0.02, 0.5)');
    } else if (args.negative === 'cache') {
      const needle = '|${bake.worldSize}|${bake.relief}';
      assert.equal(body.split(needle).length - 1, 1); body = body.replace(needle, '');
    } else if (args.negative === 'rain') {
      const needle = 'streak.mulAssign(step(0.0001, weather.y));';
      assert.equal(body.split(needle).length - 1, 1); body = body.replace(needle, '');
    } else if (args.negative === 'local') {
      const needle = '.select(surfP.xz, vec2(surfP.x.add(surfP.z.mul(0.63)), surfP.y));';
      assert.equal(body.split(needle).length - 1, 1);
      body = body.replace(needle, '.select(worldP.xz, vec2(worldP.x.add(worldP.z.mul(0.63)), worldP.y));');
    } else throw new Error('unknown negative control');
    await route.fulfill({ response, body });
  });
  await page.goto(`http://localhost:${port}/material-calibration.html`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { createSurfaceNodeMaterial } = await import('/src/materials/shader-tsl.js');
    const { DEFAULT_PARAMS } = await import('/src/materials/params.js');
    const { MaterialSystemNode } = await import('/src/materials/index.js');
    const { glassSurface } = await import('/src/materials/tsl/glass.js');
    const { WEAPON_MATERIALS } = await import('/src/weapons/materials.js');
    const { createSoldierNodeMaterial, SoldierMaterialsNode } = await import('/src/ai/textures-tsl.js');
    const { createWeaponMaterial } = await import('/src/weapons/asset-material.js');
    const { createArmMaterial } = await import('/src/weapons/arm-asset.js');
    const { IndirectFill } = await import('/src/render/indirect-webgpu.js');
    const renderer = await createWebGpuRenderer(document.querySelector('#game'));
    const resources = [], scene = new T.Scene(), camera = new T.PerspectiveCamera(55, 1, .1, 1000);
    const target = new T.RenderTarget(16, 16, { type: T.FloatType, depthBuffer: false });
    const geometry = new T.PlaneGeometry(2, 2), mesh = new T.Mesh(geometry, null);
    const masks = new Float32Array(geometry.attributes.position.count * 4);
    for (let i = 0; i < masks.length; i += 4) masks[i + 1] = 1;
    geometry.setAttribute('color', new T.BufferAttribute(masks, 4)); scene.add(mesh);
    const data = (rgba, size = 1) => {
      const texture = new T.DataTexture(new Float32Array(rgba), size, size, T.RGBAFormat, T.FloatType);
      texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.needsUpdate = true;
      resources.push(texture); return texture;
    };
    const flatAlbedo = data([.3, .4, .5, 1]), normal = data([.5, .5, 1, 1]);
    const set = { albedo: flatAlbedo, normal, orm: data([1, .5, 1, 1]) };
    const noise = [];
    for (let i = 0; i < 8 * 8; i++) noise.push(((i * 17) % 61) / 60, ((i * 13) % 59) / 58, ((i * 11) % 53) / 52, .5);
    const shared = { macro: data(noise, 8), detailAlbedo: data([.5, .5, .5, .5]), detailNormal: normal };
    const p = { ...DEFAULT_PARAMS, scale: 1, uvMode: 'triplanar', detail: [1, 0, 0, 1],
      wear: [0, 0, 0, 0], vertexMasks: true, weather: [0, 0, 0, 0], macro: [1, 0, 0, 0] };
    const read = async (activeCamera = camera) => {
      renderer.setRenderTarget(target); renderer.render(scene, activeCamera);
      return Array.from(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 16, 16));
    };
    const material = (opts, channel = 'color') => {
      const m = createSurfaceNodeMaterial(set, { ...p, ...opts }, shared, { toneMapped: false });
      m.setupOutput = function () { return N.vec4(channel === 'roughness' ? N.vec3(this.roughnessNode) : this.colorNode, 1); };
      resources.push(m); mesh.material = m;
    };
    const move = (x, angle = 0, y = 0) => {
      mesh.position.set(x, y, 0); mesh.rotation.y = angle;
      camera.position.set(x + Math.sin(angle) * 3, y, Math.cos(angle) * 3);
      camera.lookAt(mesh.position);
    };
    const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    let library;
    try {
      check(renderer.backend.isWebGPUBackend && !renderer.backend.device.adapterInfo.isFallbackAdapter, 'native nonfallback GPU required');
      renderer.setSize(16, 16); renderer.setClearColor(0, 1);
      move(0); material({ weather: [0, 0, 0, 0] }); const clear = await read();
      material({ weather: [0, 0, 0, .62] }); const dry = await read();
      const dryDifference = maxDiff(clear, dry);
      check(dryDifference < 1e-6, 'zero rain must disable vertex-seeded runoff');
      material({ weather: [0, .5, 0, .62] }); const wet = await read();
      const wetDifference = maxDiff(dry, wet);
      check(wetDifference > .01, 'rain positive control must execute runoff');
      const dryRoughness = {};
      for (const cavity of [0, .62]) {
        material({ localSpace: true, weather: [0, 0, 0, cavity] }, 'roughness');
        move(0, 0, -3); const below = await read(); move(0, 0, 3); const above = await read();
        dryRoughness[cavity ? 'cavity' : 'clear'] = maxDiff(below, above);
      }
      check(dryRoughness.clear < 1e-6 && dryRoughness.cavity < 1e-6,
        `dry local roughness must stay anchored through vertical movement: ${JSON.stringify(dryRoughness)}`);
      material({ localSpace: true, weather: [0, 0, .3, 0] }, 'roughness');
      move(0, 0, -3); const splashed = await read(); move(0, 0, 3); const aboveSplash = await read();
      const splashRoughnessDifference = maxDiff(splashed, aboveSplash);
      check(splashRoughnessDifference > .001, 'enabled ground splash must still affect roughness');
      const anchoring = {};
      for (const localSpace of [true, false]) {
        material({ localSpace, macro: [1, .8, .1, .1], macroBig: [1.8, .1, .11, 0] });
        move(0); const origin = await read(); move(11); const translated = await read();
        move(11, .7); const rotated = await read();
        anchoring[localSpace ? 'local' : 'world'] = { translation: maxDiff(origin, translated), rotation: maxDiff(origin, rotated) };
      }
      check(anchoring.local.translation < 1e-5 && anchoring.local.rotation < 1e-5, 'local finish must stay anchored through translation/rotation');
      check(anchoring.world.translation > .01, 'world projection positive control must change');
      move(0);
      const glass = new T.MeshBasicNodeMaterial({ toneMapped: false }); resources.push(glass);
      glass.colorNode = glassSurface(N.uv(), N.float(3)).get('albedo'); mesh.material = glass;
      const glassPixels = await read();
      check(glassPixels.some((v, i) => i % 4 < 3 && v > .0001 && v < .019), 'clean glass must retain dark linear pigment below .02');
      library = new MaterialSystemNode({ renderer });
      await library.init({ config: { quality: 'low', q: { anisotropy: 2 } } });
      const recipeDryRoughness = {};
      for (const name of ['alu', 'polymer', 'steel']) {
        const [surface, opts] = WEAPON_MATERIALS[name], m = library.get(surface, opts);
        m.setupOutput = function () { return N.vec4(N.vec3(this.roughnessNode), 1); };
        mesh.material = m;
        move(0, 0, -3); const below = await read(); move(0, 0, 3); const above = await read();
        recipeDryRoughness[name] = maxDiff(below, above);
        check(recipeDryRoughness[name] < 1e-6, `${name}: dry recipe roughness must stay vertically anchored`);
      }
      move(0);
      const opts = { bake: { size: 256, seed: 997, relief: .02, worldSize: .5 } };
      const first = library.getTextureSet('rubber', opts);
      const relief = library.getTextureSet('rubber', { bake: { ...opts.bake, relief: .1 } });
      const scale = library.getTextureSet('rubber', { bake: { ...opts.bake, worldSize: 2 } });
      check(first === library.getTextureSet('rubber', opts), 'same bake must reuse textures');
      check(first !== relief && first !== scale && relief !== scale, 'relief/worldSize must distinguish baked texture sets');
      const normals = [];
      for (const s of [first, relief, scale]) {
        const m = new T.MeshBasicNodeMaterial({ toneMapped: false }); resources.push(m);
        m.colorNode = N.texture(s.normal).rgb; mesh.material = m; normals.push(await read());
      }
      const bakeDifferences = { relief: maxDiff(normals[0], normals[1]), worldSize: maxDiff(normals[0], normals[2]) };
      check(bakeDifferences.relief > .001 && bakeDifferences.worldSize > .001, `bake-key changes must affect actual normal maps: ${JSON.stringify(bakeDifferences)}`);
      // Frozen pre-refactor paths are references, never production selectors.
      const legacyCopy = (source, weapon) => {
        const m = weapon || source.isMeshPhysicalMaterial ? new T.MeshPhysicalNodeMaterial() : new T.MeshStandardNodeMaterial();
        (source.isMeshPhysicalMaterial ? T.MeshPhysicalMaterial : T.MeshStandardMaterial).prototype.copy.call(m, source);
        if (weapon) m.defines.PHYSICAL = '';
        resources.push(m); return m;
      };
      const legacyRim = (source, scale) => {
        const m = new T.MeshStandardNodeMaterial().copy(source), previous = m.setupOutput;
        m.setupOutput = function (builder, output) {
          const view = N.normalize(N.cameraPosition.sub(N.positionWorld));
          const facing = N.abs(N.dot(view, N.normalize(N.normalWorldGeometry)));
          const rim = N.smoothstep(.42, 1, N.float(1).sub(facing)).pow(1.9).mul(.62 * scale);
          return previous.call(this, builder, N.vec4(N.mix(output.rgb, N.vec3(0), rim), output.a));
        };
        resources.push(m); return m;
      };
      const sphere = new T.SphereGeometry(1, 32, 16); resources.push(sphere); mesh.geometry = sphere;
      const colors = new Float32Array(sphere.attributes.position.count * 3).fill(1);
      sphere.setAttribute('color', new T.BufferAttribute(colors, 3));
      const light = new T.DirectionalLight(0xffffff, 3); light.position.set(2, 3, 4); scene.add(light);
      move(0); renderer.setClearColor(0, 0);
      const integration = { copies: {}, rim: {}, environment: [] };
      for (const physical of [false, true]) {
        const source = physical ? new T.MeshPhysicalMaterial({ specularIntensity: .16, clearcoat: .25 }) : new T.MeshStandardMaterial();
        source.color.setRGB(.12, .18, .24); source.map = flatAlbedo;
        source.normalMap = normal; source.normalScale.set(.85, .85); resources.push(source);
        for (const [name, make] of [['weapon', createWeaponMaterial], ['arm', createArmMaterial]]) {
          const m = make(source), ref = legacyCopy(source, name === 'weapon'); resources.push(m);
          mesh.material = ref; const expected = await read(); mesh.material = m; const actual = await read();
          const difference = maxDiff(expected, actual); integration.copies[`${name}/${physical}`] = difference;
          check(actual.some((v, i) => i % 4 < 3 && v > .01), 'copy probe must render a lit surface');
          check(difference < 1e-6, `${name}: public copy must match legacy pixels`);
        }
      }
      const goggles = new SoldierMaterialsNode({}, {}), candidates = [
        ['full', createSoldierNodeMaterial(set), 1], ['reduced', createSoldierNodeMaterial(set, { rim: .2 }), .2],
        ['goggles', goggles.glass(), .5],
      ];
      for (const [name, m, scale] of candidates) {
        const ref = legacyRim(m, scale), clone = m.clone(); resources.push(m, clone);
        integration.rim[name] = [];
        for (const fogged of [false, true]) {
          scene.fog = fogged ? new T.Fog(0x567890, .1, 8) : null;
          for (const v of [m, ref, clone]) { v.transparent = fogged; v.premultipliedAlpha = fogged; v.opacity = fogged ? .55 : 1; v.needsUpdate = true; }
          mesh.material = ref; const expected = await read();
          for (const [label, v] of [['original', m], ['clone', clone]]) {
            mesh.material = v; const actual = await read(), difference = maxDiff(expected, actual);
            integration.rim[name].push({ fogged, label, difference });
            check(difference < 1e-5, `${name}/${label}: rim must match legacy pixels before fog/premultiplication`);
          }
        }
      }
      scene.fog = null;
      const env = new T.DataTexture(new Uint8Array(4 * 2 * 4).fill(80), 4, 2); resources.push(env);
      env.mapping = T.EquirectangularReflectionMapping; env.needsUpdate = true; scene.environment = env;
      const worldCamera = camera, viewCamera = camera.clone();
      for (const order of [[worldCamera, viewCamera], [viewCamera, worldCamera]]) {
        // Independent graph identities; never reuse another owner's cached hook.
        const contexts = new Map([[worldCamera, N.context({})], [viewCamera, N.context({})]]);
        const fill = new IndirectFill({ viewCamera, peek: () => null });
        fill.sky.value.set(.2, .3, .4); fill.ground.value.set(.02, .01, .005); fill.viewVisibility.value = .12;
        const source = new T.MeshPhysicalMaterial({ color: 0x567890, clearcoat: .4 }); resources.push(source);
        const m = createWeaponMaterial(source), ref = legacyCopy(source, true); resources.push(m);
        fill.patch(m); fill.patch(ref); const initial = new Map();
        for (const c of order) {
          renderer.contextNode = contexts.get(c); mesh.material = ref; const expected = await read(c);
          mesh.material = m; const actual = await read(c); initial.set(c, actual);
          check(maxDiff(expected, actual) < 1e-6, 'registered environment must preserve legacy sampling');
        }
        const separation = maxDiff(initial.get(worldCamera), initial.get(viewCamera));
        check(separation > .001, 'camera-specific environment gate must remain isolated');
        renderer.contextNode = contexts.get(viewCamera); mesh.material = m;
        const liveBefore = await read(viewCamera); // Bind the live path after either build order.
        let builders = 0; const previous = renderer.debug.onNodeBuilderCreated;
        renderer.debug.onNodeBuilderCreated = (...args) => { builders++; previous?.(...args); };
        let liveDifference;
        try {
          fill.sky.value.multiplyScalar(1.7); fill.viewVisibility.value = .65;
          renderer.contextNode = contexts.get(viewCamera); mesh.material = m;
          liveDifference = maxDiff(liveBefore, await read(viewCamera));
          check(liveDifference > .001 && builders === 0, `live environment must update without rebuilding: ${JSON.stringify({ viewFirst: order[0] === viewCamera, liveDifference, builders })}`);
        } finally { renderer.debug.onNodeBuilderCreated = previous; }
        integration.environment.push({ viewFirst: order[0] === viewCamera, separation, liveDifference, builders });
      }
      renderer.contextNode = null;
      const a = renderer.backend.device.adapterInfo;
      return { device: { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter },
        dryDifference, wetDifference, dryRoughness, splashRoughnessDifference,
        recipeDryRoughness, anchoring, bakeDifferences, integration };
    } finally {
      renderer.setRenderTarget(null); library?.dispose(); target.dispose(); geometry.dispose();
      for (const resource of resources) resource.dispose(); await renderer.dispose();
    }
  });
  assert.deepEqual(errors, []); console.log(JSON.stringify(result, null, 2));
  await page.close();
} finally { await browser?.close(); stopViteServer(server); }
