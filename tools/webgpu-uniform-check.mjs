import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';

const args = parseArgs(), port = Number(args.port ?? 5270);
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
assert.ok(!args.control || ['rooms', 'viewport', 'lights', 'csm-expression', 'shadow-fields', 'pcf-samples', 'pcf-values'].includes(args.control));
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, channel: 'chromium', args: [
  '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--mute-audio',
] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (args.control) {
    const file = ['csm-expression', 'shadow-fields', 'pcf-samples', 'pcf-values'].includes(args.control) ? 'csm-webgpu.js'
      : args.control === 'rooms' ? 'indirect-webgpu.js' : args.control === 'viewport' ? 'webgpu-pipeline.js' : 'index-webgpu.js';
    await page.route(`**/src/render/${file}*`, async route => {
      const response = await route.fetch(), original = await response.text();
      const body = args.control === 'rooms'
        ? original.replace("sharedUniformGroup('owRooms', 1, 'none')", "sharedUniformGroup('owRooms', 1, 'object')")
        : args.control === 'viewport' ? original.replace('.sample(screenCoordinate.div(aoSize))', '.sample(screenUV)')
          : args.control === 'csm-expression' ? original.replace('if (!this._stableOutput ||', 'if (true || !this._stableOutput ||')
            : args.control === 'shadow-fields' ? original.replace('let fields = shadowFields.get(shadow);', 'let fields;')
              : args.control === 'pcf-samples' ? original.replace('mul(1 / 5)', 'mul(1 / 4)')
                : args.control === 'pcf-values' ? original.replace('shadowFields.set(shadow, fields);', 'shadowFields.set(shadow, fields); fields.radius.updateType = "none";')
                  : original.replace('node.setGroup(this._lightPositionGroup);', '/* negative: retain original group */');
      assert.notEqual(body, original, 'negative control marker');
      await route.fulfill({ response, body });
    });
  }
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=combat&q=${args.quality ?? 'high'}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
  const result = await page.evaluate(async () => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer, fill = r.indirect;
    if (!renderer.backend.isWebGPUBackend) throw new Error('native backend required');
    const adapter = renderer.backend.device.adapterInfo;
    if (adapter.vendor !== 'amd' || adapter.architecture !== 'rdna-4' || adapter.isFallbackAdapter !== false)
      throw new Error('RX 9070 XT hardware adapter required');
    if (!fill._roomsReady) throw new Error('rooms must be initialized before graph warmup');
    await window.__PUMP__(60); // same initial settling window as the benchmark
    const shadowTargets = new Set(r.activeSun.shadow.shadowNode._shadowNodes.map(node => node.shadowMap));
    let roomUploads = 0, builders = 0;
    const utils = renderer.backend.bindingUtils, upload = utils.updateBinding;
    utils.updateBinding = function (binding) {
      if (binding.nodeUniform === fill.roomBoxes || binding.nodeUniform === fill.roomHeights) roomUploads++;
      return upload.call(this, binding);
    };
    const debug = renderer.debug.onNodeBuilderCreated;
    renderer.debug.onNodeBuilderCreated = (...values) => { builders++; debug?.(...values); };
    const shadowGroups = new Set(), lightGroups = new Set();
    const coefficients = new Set(), wrapped = new WeakSet();
    let coefficientChecks = 0, pointNode;
    const updateForRender = renderer._bindings.updateForRender;
    renderer._bindings.updateForRender = function (object) {
      if (object.scene === e.ctx.scene) {
        for (const light of object.getNodeBuilderState().updateNodes) {
          if (!light.isAnalyticLightNode) continue;
          if (light.light.isPointLight) pointNode ??= light;
          for (const node of [light.light.colorNode ? null : light.baseColorNode ?? light.colorNode,
            light.cutoffDistanceNode, light.decayExponentNode]) {
            if (node?.isUniformNode) coefficients.add(node);
          }
        }
      }
      return updateForRender.call(this, object);
    };
    const update = renderer._bindings._update;
    renderer._bindings._update = function (group, all) {
      if (group.name === 'render' && shadowTargets.has(renderer.getRenderTarget())) shadowGroups.add(group.id);
      if (group.name === 'owLightPositions' && renderer.getRenderTarget() === r.hdrRt) lightGroups.add(group.id);
      for (const binding of group.bindings) {
        if (!binding.isUniformsGroup || wrapped.has(binding)) continue;
        wrapped.add(binding);
        const compare = binding.update;
        binding.update = function () {
          if (renderer.getRenderTarget() === r.hdrRt) {
            for (const field of this.uniforms) if (coefficients.has(field.nodeUniform.node)) coefficientChecks++;
          }
          return compare.call(this);
        };
      }
      return update.call(this, group, all);
    };
    await window.__PUMP__(12);
    if (roomUploads) throw new Error('immutable room buffers uploaded during steady gameplay');
    if (builders) throw new Error('steady gameplay rebuilt authored shaders');
    if (!lightGroups.size || lightGroups.size > 4) throw new Error('light position bindings must be shared');
    if (!shadowGroups.size || shadowGroups.size > 8) throw new Error('AO viewport fragmented CSM camera bindings');
    const steadyCoefficientChecks = coefficientChecks;
    if (!pointNode || !coefficientChecks || coefficientChecks > coefficients.size * 4 * 12)
      throw new Error('light coefficients still compared per material layout');
    const { RenderTarget, RenderPipeline, FloatType, RGBAFormat, Vector2 } = await import('/node_modules/.vite/deps/three_webgpu.js');
    const { PCFShadowFilter, screenCoordinate, screenUV, uniform, int, vec3, vec4 } = await import('/node_modules/.vite/deps/three_tsl.js');
    const target = new RenderTarget(fill.rooms.length * 2, 1, { type: FloatType, format: RGBAFormat, depthBuffer: false });
    const pipeline = new RenderPipeline(renderer);
    pipeline.outputColorTransform = false;
    const index = int(screenCoordinate.x.mod(fill.rooms.length));
    pipeline.outputNode = screenCoordinate.x.lessThan(fill.rooms.length)
      .select(fill.roomBoxes.element(index), fill.roomHeights.element(index));
    async function read() {
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target); pipeline.render();
        return Array.from(await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, 1)).slice(0, target.width * 4);
      } finally { renderer.setRenderTarget(previous); }
    }
    const initial = await read(), expected = [...fill.rooms, ...fill.roomsY].flatMap(v => v.toArray());
    if (initial.some((v, i) => Math.abs(v - expected[i]) > 1e-5)) throw new Error('GPU room data disagrees with authored volumes');
    const uploadsAfterInit = roomUploads, buildsAfterInit = builders;
    await read(); await read();
    if (roomUploads !== uploadsAfterInit) throw new Error('immutable room probe reuploaded data');
    const x = fill.rooms[0].x;
    fill.rooms[0].x = x + 1; fill.roomBoxes.update(); fill.roomGroup.needsUpdate = true;
    const changed = await read(), uploadsAfterEdit = roomUploads;
    if (Math.abs(changed[0] - x - 1) > 1e-5 || uploadsAfterEdit - uploadsAfterInit !== 2)
      throw new Error('versioned room publication must update each buffer once');
    await read();
    if (roomUploads !== uploadsAfterEdit) throw new Error('versioned edit uploaded more than once per context');
    if (builders !== buildsAfterInit) throw new Error('room publication rebuilt shaders');
    fill.rooms[0].x = x; fill.roomBoxes.update(); fill.roomGroup.needsUpdate = true;
    await read(); pipeline.dispose(); target.dispose();
    await window.__PUMP__(4); // publish restored values to the world context
    // Read the actual native light uniform nodes on the GPU after a real world
    // render. No replacement update callbacks, CPU-only value test, or recompile
    // is allowed to hide a frozen color/intensity/range/decay coefficient.
    const lightTarget = new RenderTarget(2, 1, { type: FloatType, format: RGBAFormat, depthBuffer: false });
    const lightProbe = new RenderPipeline(renderer);
    lightProbe.outputColorTransform = false;
    lightProbe.outputNode = screenCoordinate.x.lessThan(1)
      .select(vec4(pointNode.baseColorNode ?? pointNode.colorNode, 1),
        vec4(pointNode.cutoffDistanceNode, pointNode.decayExponentNode, 0, 1));
    const light = pointNode.light, saved = { color: light.color.clone(), intensity: light.intensity,
      distance: light.distance, decay: light.decay };
    async function readLight() {
      await new Promise(requestAnimationFrame);
      r.render(e.ctx);
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(lightTarget); lightProbe.render();
        return Array.from(await renderer.readRenderTargetPixelsAsync(lightTarget, 0, 0, 2, 1)).slice(0, 8);
      } finally { renderer.setRenderTarget(previous); }
    }
    await readLight(); // create only the probe's variant
    const lightBuilds = builders;
    const lightReads = [];
    try {
      for (const [red, green, blue, intensity, distance, decay] of [
        [0.2, 0.4, 0.6, 3, 17, 1.4], [0.7, 0.3, 0.1, 0.5, 29, 2.2], [1, 0.5, 0.2, 0, 6, 1],
      ]) {
        light.color.setRGB(red, green, blue); light.intensity = intensity;
        light.distance = distance; light.decay = decay;
        const values = await readLight(), expected = [red * intensity, green * intensity,
          blue * intensity, 1, distance, decay, 0, 1];
        if (values.some((v, i) => Math.abs(v - expected[i]) > 1e-5))
          throw new Error('GPU light coefficients stopped following native updates');
        lightReads.push(values);
      }
      if (builders !== lightBuilds) throw new Error('light coefficient edits rebuilt shaders');
    } finally {
      light.color.copy(saved.color); light.intensity = saved.intensity;
      light.distance = saved.distance; light.decay = saved.decay;
      await readLight(); lightProbe.dispose(); lightTarget.dispose();
    }
    // Compare the cached filter directly to pinned Three's stock filter on the
    // GPU, including live radius/map-size/depth edits without shader rebuilds.
    const { stablePCFShadowFilter } = await import('/src/render/csm-webgpu.js');
    const depthTexture = r.activeSun.shadow.shadowNode._shadowNodes[0].shadowMap.depthTexture;
    const pcfTarget = new RenderTarget(128, 128, { type: FloatType, format: RGBAFormat, depthBuffer: false });
    const pcfProbe = new RenderPipeline(renderer), compareDepth = uniform(0.5);
    pcfProbe.outputColorTransform = false;
    const shadow = { mapSize: new Vector2(depthTexture.image.width, depthTexture.image.height), radius: 1 };
    const inputs = { depthTexture, shadowCoord: vec3(screenUV, compareDepth), shadow };
    pcfProbe.outputNode = vec4(PCFShadowFilter(inputs), stablePCFShadowFilter(inputs), 0, 1);
    let pcfCases = 0, filteredPixels = 0, pcfBuilds;
    try {
      for (const scale of [1, 0.5]) for (const radius of [0, 1, 2.5]) for (const depth of [0.25, 0.5, 0.9]) {
        shadow.mapSize.set(depthTexture.image.width * scale, depthTexture.image.height * scale);
        shadow.radius = radius; compareDepth.value = depth;
        const previous = renderer.getRenderTarget();
        let values;
        try {
          renderer.setRenderTarget(pcfTarget); pcfProbe.render();
          values = await renderer.readRenderTargetPixelsAsync(pcfTarget, 0, 0, 128, 128);
        } finally { renderer.setRenderTarget(previous); }
        pcfBuilds ??= builders;
        for (let i = 0; i < 128 * 128 * 4; i += 4) {
          if (values[i] !== values[i + 1] || !Number.isFinite(values[i]))
            throw new Error('cached PCF differs from stock filtering');
          if (values[i] > 0 && values[i] < 1) filteredPixels++;
        }
        pcfCases++;
      }
      if (!filteredPixels) throw new Error('PCF comparison must exercise filtered shadow edges');
      if (builders !== pcfBuilds) throw new Error('PCF numeric edits rebuilt shaders');
    } finally { pcfProbe.dispose(); pcfTarget.dispose(); }
    r.resize(1025, 577);
    await window.__PUMP__(40);
    const uploadsAfterResize = roomUploads, buildsAfterResize = builders;
    await window.__PUMP__(12);
    if (roomUploads !== uploadsAfterResize) throw new Error('resize restored per-frame room uploads');
    if (builders !== buildsAfterResize) throw new Error('resize did not settle shader cache');
    const groups = Array.from(r._lightUniformGroups);
    await e.dispose();
    if (groups.some(([node, group]) => node.groupNode !== group)) throw new Error('dispose did not restore light groups');
    return { adapter: { vendor: adapter.vendor, architecture: adapter.architecture, isFallbackAdapter: adapter.isFallbackAdapter },
      rooms: fill.roomCount.value, steadyRoomUploads: 0, steadyBuilders: 0,
      shadowGroups: shadowGroups.size, lightGroups: lightGroups.size,
      coefficientNodes: coefficients.size, steadyCoefficientChecks, lightReads, pcfCases, filteredPixels,
      versionedEditUploads: uploadsAfterEdit - uploadsAfterInit, resizeSettled: true, restored: true };
  });
  assert.deepEqual(errors, []);
  writeFileSync(String(args.out ?? '/tmp/webgpu-uniform-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); stopViteServer(server); }
