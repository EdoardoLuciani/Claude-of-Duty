import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';

// Diagnostic only: records actual GPU attachment/bind-group/copy edges, not
// just logical TSL nodes. Deep interception is NOT a performance benchmark.
const args = parseArgs();
const quality = String(args.quality ?? 'high'), shot = String(args.shot ?? 'hero');
const frames = Number(args.frames ?? 24), port = Number(args.port ?? 5244);
const out = String(args.out ?? '/tmp/webgpu-graph-audit.json');
assert.ok(['high', 'medium', 'low', 'ultra'].includes(quality));
assert.ok(!args.variant || args.variant === 'direct-taa');
assert.ok(Number.isInteger(frames) && frames > 0 && frames <= 24);
const server = await ensureViteServer({ root: process.cwd(), port });
const browser = await launchChromium({ headless: true,
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan',
    '--use-angle=vulkan', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (args.variant === 'direct-taa') {
    // Diagnostic prototype only; production keeps the audited graph unchanged.
    await page.route('**/src/render/webgpu-pipeline.js*', async route => {
      const response = await route.fetch(), body = await response.text();
      assert.ok(body.includes('taaPass.a) : taaPass;'));
      await route.fulfill({ response,
        body: body.replace('taaPass.a) : taaPass;', 'taaPass.a) : taaPass.getTextureNode();') });
    });
  }
  await page.addInitScript(() => {
    const textures = new WeakMap(), views = new WeakMap(), groups = new WeakMap();
    const passes = [], copies = [], resources = [], shaders = [];
    let frame = -1, active = null, slot = 0, querySet = null;
    function info(texture) {
      let record = textures.get(texture);
      if (!record) {
        record = { id: resources.length, label: texture.label, width: texture.width,
          height: texture.height, format: texture.format, samples: texture.sampleCount };
        resources.push(record); textures.set(texture, record);
      }
      return record.id;
    }
    const createTexture = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (desc) {
      const texture = createTexture.call(this, desc); info(texture); return texture;
    };
    const createView = GPUTexture.prototype.createView;
    GPUTexture.prototype.createView = function (...a) {
      const view = createView.apply(this, a); views.set(view, info(this)); return view;
    };
    const createGroup = GPUDevice.prototype.createBindGroup;
    GPUDevice.prototype.createBindGroup = function (desc) {
      const group = createGroup.call(this, desc);
      groups.set(group, desc.entries.filter(e => views.has(e.resource))
        .map(e => views.get(e.resource)));
      return group;
    };
    const begin = GPUCommandEncoder.prototype.beginRenderPass;
    GPUCommandEncoder.prototype.beginRenderPass = function (desc) {
      if (frame < 0) return begin.call(this, desc);
      const record = { frame, stage: active, colors: desc.colorAttachments.filter(Boolean)
        .map(a => ({ texture: views.get(a.view), resolve: views.get(a.resolveTarget), load: a.loadOp })),
        depth: desc.depthStencilAttachment ? views.get(desc.depthStencilAttachment.view) : null,
        reads: new Set(), draws: 0, slot: slot };
      if (querySet) {
        assertSlots(slot + 2 <= querySet.count);
        desc = { ...desc, timestampWrites: { querySet,
          beginningOfPassWriteIndex: slot, endOfPassWriteIndex: slot + 1 } };
        slot += 2;
      }
      const encoder = begin.call(this, desc); passes.push(record);
      const bind = encoder.setBindGroup.bind(encoder);
      encoder.setBindGroup = (index, group, ...a) => {
        for (const texture of groups.get(group) ?? []) record.reads.add(texture);
        return bind(index, group, ...a);
      };
      for (const method of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) {
        const draw = encoder[method].bind(encoder);
        encoder[method] = (...a) => { record.draws++; return draw(...a); };
      }
      return encoder;
    };
    function assertSlots(valid) { if (!valid) throw new Error('audit timestamp slots exhausted'); }
    const copy = GPUCommandEncoder.prototype.copyTextureToTexture;
    GPUCommandEncoder.prototype.copyTextureToTexture = function (src, dst, size) {
      if (frame >= 0) copies.push({ frame, stage: active, source: info(src.texture),
        destination: info(dst.texture), size: Array.isArray(size) ? [...size] : { ...size } });
      return copy.call(this, src, dst, size);
    };
    window.__GRAPH_AUDIT__ = { resources, passes, copies, shaders,
      setFrame(value) { frame = value; }, setStage(value) { active = value; },
      setQueries(value) { querySet = value; }, getSlots() { return slot; } };
  });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=${shot}&q=${quality}`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 240000 });
  const report = await page.evaluate(async ({ frames, hurt }) => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
    const audit = window.__GRAPH_AUDIT__, nativeRender = renderer.render;
    const shaderIds = new Set();
    // Private cache reads are diagnostic only; do not alter renderer/builder state.
    const draw = renderer.backend.draw;
    renderer.backend.draw = function (object, ...a) {
      if (object.object.isQuadMesh && !shaderIds.has(object.material.id)) {
        shaderIds.add(object.material.id);
        const target = renderer.getRenderTarget();
        audit.shaders.push({ materialId: object.material.id, name: object.object.name,
          textureId: target?.texture.id ?? null,
          shader: renderer._nodes.get(object).nodeBuilderState.fragmentShader });
      }
      return draw.call(this, object, ...a);
    };
    renderer.render = function (scene, camera) {
      const rt = this.getRenderTarget();
      const stage = { name: scene.name || scene.material?.name || 'scene',
        textureId: rt?.texture.id ?? null, textureName: rt?.texture.name ?? 'display',
        width: rt?.width ?? this.domElement.width, height: rt?.height ?? this.domElement.height,
        fullscreen: !!scene.isQuadMesh };
      const previous = window.__AUDIT_STAGE__;
      window.__AUDIT_STAGE__ = stage; audit.setStage(stage);
      try { return nativeRender.call(this, scene, camera); } finally {
        window.__AUDIT_STAGE__ = previous; audit.setStage(previous);
      }
    };
    const render = r.render;
    r.render = function (ctx) {
      if (hurt) e.ctx.get('player').lowHealthPass.state.value.set(.6, .4, .3);
      return render.call(this, ctx);
    };
    const device = renderer.backend.device;
    const queries = device.features.has('timestamp-query') ?
      device.createQuerySet({ type: 'timestamp', count: frames * 128 }) : null;
    audit.setQueries(queries);
    try {
      for (let i = 0; i < frames; i++) { audit.setFrame(i); await window.__PUMP__(1); }
      audit.setFrame(-1);
      if (queries) {
        const count = audit.getSlots(), bytes = count * 8;
        const resolve = device.createBuffer({ size: bytes,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        const read = device.createBuffer({ size: bytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.resolveQuerySet(queries, 0, count, resolve, 0);
        encoder.copyBufferToBuffer(resolve, 0, read, 0, bytes);
        device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
        const times = new BigUint64Array(read.getMappedRange());
        for (const pass of audit.passes) {
          pass.startNs = String(times[pass.slot]); pass.endNs = String(times[pass.slot + 1]);
          pass.gpuMs = Number(times[pass.slot + 1] - times[pass.slot]) / 1e6;
        }
        read.unmap(); read.destroy(); resolve.destroy();
      }
      return { quality: e.config.quality, size: [r.screenSize.width, r.screenSize.height],
        backend: renderer.backend.constructor.name, hazeActive: e.ctx.get('fx').hazeSys.uActive.value,
        hazeLive: e.ctx.get('fx').hazeSys._live, engineFrame: e.time.frame,
        lowHealth: e.ctx.get('player').lowHealthPass.state.value.toArray(),
        resources: audit.resources, passes: audit.passes.map(p => ({ ...p, reads: [...p.reads] })),
        copies: audit.copies, shaders: audit.shaders };
    } finally {
      queries?.destroy(); renderer.render = nativeRender; renderer.backend.draw = draw; r.render = render;
    }
  }, { frames, hurt: args.hurt === '1' });
  assert.equal(report.backend, 'WebGPUBackend');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(report.passes.length > 0, 'audit must observe actual GPU submissions');
  for (const pass of report.passes) {
    assert.ok(pass.colors.every(a => Number.isInteger(a.texture)), 'unmapped GPU attachment');
    if (pass.gpuMs !== undefined) assert.ok(Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0);
  }
  writeFileSync(out, JSON.stringify({ ...report, variant: args.variant ?? 'stock', errors }, null, 2));
  console.log(JSON.stringify({ quality, shot, frames, passes: report.passes.length,
    copies: report.copies.length, out }));
} finally { await browser.close(); await stopViteServer(server); }
