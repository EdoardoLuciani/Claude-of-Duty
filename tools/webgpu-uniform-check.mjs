import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';

const args = parseArgs(), port = Number(args.port ?? 5270);
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
assert.ok(!args.control || ['rooms', 'viewport', 'lights'].includes(args.control));
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
    const file = args.control === 'rooms' ? 'indirect-webgpu.js' : args.control === 'viewport' ? 'webgpu-pipeline.js' : 'index-webgpu.js';
    await page.route(`**/src/render/${file}*`, async route => {
      const response = await route.fetch(), original = await response.text();
      const body = args.control === 'rooms'
        ? original.replace("sharedUniformGroup('owRooms', 1, 'none')", "sharedUniformGroup('owRooms', 1, 'object')")
        : args.control === 'viewport' ? original.replace('.sample(screenCoordinate.div(aoSize))', '.sample(screenUV)')
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
    const update = renderer._bindings._update;
    renderer._bindings._update = function (group, all) {
      if (group.name === 'render' && shadowTargets.has(renderer.getRenderTarget())) shadowGroups.add(group.id);
      if (group.name === 'owLightPositions' && renderer.getRenderTarget() === r.hdrRt) lightGroups.add(group.id);
      return update.call(this, group, all);
    };
    await window.__PUMP__(12);
    if (roomUploads) throw new Error('immutable room buffers uploaded during steady gameplay');
    if (builders) throw new Error('steady gameplay rebuilt authored shaders');
    if (!lightGroups.size || lightGroups.size > 4) throw new Error('light position bindings must be shared');
    if (!shadowGroups.size || shadowGroups.size > 8) throw new Error('AO viewport fragmented CSM camera bindings');
    const { RenderTarget, RenderPipeline, FloatType, RGBAFormat } = await import('/node_modules/.vite/deps/three_webgpu.js');
    const { screenCoordinate, int } = await import('/node_modules/.vite/deps/three_tsl.js');
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
      versionedEditUploads: uploadsAfterEdit - uploadsAfterInit, resizeSettled: true, restored: true };
  });
  assert.deepEqual(errors, []);
  writeFileSync(String(args.out ?? '/tmp/webgpu-uniform-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); await stopViteServer(server); }
