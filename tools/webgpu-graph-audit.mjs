import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';

// Diagnostic only: records actual GPU attachment/bind-group/copy edges, not
// just logical TSL nodes. Deep interception is NOT a performance benchmark.
const args = parseArgs();
const quality = String(args.quality ?? 'high'), shot = String(args.shot ?? 'hero');
const frames = Number(args.frames ?? 24), port = Number(args.port ?? 5244);
const width = Number(args.w ?? 960), height = Number(args.h ?? 540), warmup = Number(args.warmup ?? 0);
const out = String(args.out ?? '/tmp/webgpu-graph-audit.json');
assert.ok(['high', 'medium', 'low', 'ultra'].includes(quality));
assert.ok(!args.variant || ['materialized', 'taa-copy', 'post-copy'].includes(args.variant));
assert.ok(Number.isInteger(frames) && frames > 0 && frames <= 24);
assert.ok([width, height].every(n => Number.isInteger(n) && n > 0));
assert.ok(Number.isInteger(warmup) && warmup >= 0 && warmup <= 600);
const server = await ensureViteServer({ root: process.cwd(), port });
const browser = await launchChromium({ headless: true,
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan',
    '--use-angle=vulkan', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (args.variant) {
    // Negative control only: restore both removed boundaries, not a runtime toggle.
    await page.route('**/src/render/webgpu-pipeline.js*', async route => {
      const response = await route.fetch(); let body = await response.text();
      const changes = [];
      if (args.variant !== 'post-copy')
        changes.push(['taaPass.a) : taaPass.getTextureNode();', 'taaPass.a) : taaPass;']);
      if (args.variant !== 'taa-copy')
        changes.push(['post.asColorNode ? post.asColorNode(composite, exposure) :\n      post.asNode(asTexture(composite), exposure)', 'post.asNode(asTexture(composite), exposure)']);
      for (const [a, b] of changes) { assert.ok(body.includes(a)); body = body.replace(a, b); }
      await route.fulfill({ response, body });
    });
  }
  await page.addInitScript(() => {
    const textures = new WeakMap(), views = new WeakMap(), groups = new WeakMap();
    const passes = [], computePasses = [], copies = [], resources = [], shaders = [];
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
      const encoder = begin.call(this, withTimestamps(desc)); passes.push(record);
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
    const beginCompute = GPUCommandEncoder.prototype.beginComputePass;
    GPUCommandEncoder.prototype.beginComputePass = function (desc = {}) {
      if (frame < 0) return beginCompute.call(this, desc);
      const record = { frame, stage: active, slot, dispatches: 0 };
      const encoder = beginCompute.call(this, withTimestamps(desc));
      computePasses.push(record);
      const dispatch = encoder.dispatchWorkgroups.bind(encoder);
      encoder.dispatchWorkgroups = (...a) => { record.dispatches++; return dispatch(...a); };
      return encoder;
    };
    function withTimestamps(desc) {
      if (!querySet) return desc;
      if (slot + 2 > querySet.count) throw new Error('audit timestamp slots exhausted');
      const timestampWrites = { querySet,
        beginningOfPassWriteIndex: slot, endOfPassWriteIndex: slot + 1 };
      slot += 2;
      return { ...desc, timestampWrites };
    }
    const copy = GPUCommandEncoder.prototype.copyTextureToTexture;
    GPUCommandEncoder.prototype.copyTextureToTexture = function (src, dst, size) {
      if (frame >= 0) copies.push({ frame, stage: active, source: info(src.texture),
        destination: info(dst.texture), size: Array.isArray(size) ? [...size] : { ...size } });
      return copy.call(this, src, dst, size);
    };
    window.__GRAPH_AUDIT__ = { resources, passes, computePasses, copies, shaders,
      setFrame(value) { frame = value; }, setStage(value) { active = value; },
      setQueries(value) { querySet = value; }, getSlots() { return slot; } };
  });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=${shot}&q=${quality}`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 240000 });
  const report = await page.evaluate(async ({ frames, warmup, hurt, resample, parity }) => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
    let pointwiseParity = null;
    if (parity) {
      const { RenderPipeline, RenderTarget, HalfFloatType, DataUtils } =
        await import('/node_modules/.vite/deps/three_webgpu.js');
      const { screenUV, texture, uniform, vec2, vec4 } = await import('/node_modules/.vite/deps/three_tsl.js');
      const { LowHealthPass } = await import('/src/player/lowhealth.js');
      const source = new RenderTarget(64, 36, { type: HalfFloatType, depthBuffer: false });
      const output = new RenderTarget(64, 36, { type: HalfFloatType, depthBuffer: false });
      const post = new LowHealthPass(), exposure = uniform(1), color = vec4(.25, .125, 2, .5);
      const pipelines = [new RenderPipeline(renderer, color),
        new RenderPipeline(renderer, post.asNode(texture(source.texture), exposure)),
        new RenderPipeline(renderer, post.asColorNode(color, exposure))];
      for (const pipeline of pipelines) pipeline.outputColorTransform = false;
      const target = renderer.getRenderTarget(); let cases = 0;
      try {
        renderer.setRenderTarget(source); pipelines[0].render();
        for (const aspect of [[1, .5625], [.5625, 1]]) {
          post.aspect.value.set(...aspect);
          for (const state of [[0, 0, 0], [.6, .4, .3], [1, 1, 1]]) {
            post.state.value.set(...state);
            for (const gain of [.2, 3]) {
              exposure.value = gain; renderer.setRenderTarget(output); pipelines[1].render();
              const reference = await renderer.readRenderTargetPixelsAsync(output, 0, 0, 64, 36);
              pipelines[2].render();
              const actual = await renderer.readRenderTargetPixelsAsync(output, 0, 0, 64, 36);
              if (reference.length !== actual.length || reference.some((v, i) => v !== actual[i]))
                throw new Error('pointwise low-health differs from its texture-input reference');
              cases++;
            }
          }
        }
        // A sampled colour is a value: keep its upstream displaced UV rather
        // than treating it as an unsampled texture and resetting to screenUV.
        pipelines[0].outputNode = vec4(screenUV, 2, .5);
        pipelines[0].needsUpdate = true;
        renderer.setRenderTarget(source); pipelines[0].render();
        const shifted = new RenderPipeline(renderer, post.asColorNode(
          texture(source.texture).sample(screenUV.add(vec2(2 / 64, 0))), exposure));
        shifted.outputColorTransform = false; post.state.value.set(0, 0, 0);
        try {
          renderer.setRenderTarget(output); pipelines[1].render();
          const base = await renderer.readRenderTargetPixelsAsync(output, 10, 10, 1, 1);
          shifted.render();
          const sample = await renderer.readRenderTargetPixelsAsync(output, 10, 10, 1, 1);
          const redShift = DataUtils.fromHalfFloat(sample[0]) - DataUtils.fromHalfFloat(base[0]);
          if (Math.abs(redShift - 2 / 64) > 1e-6)
            throw new Error('pointwise colour lost upstream sample coordinates');
          pointwiseParity = { cases, identical: true, redShift };
        } finally { shifted.dispose(); }
      } finally {
        renderer.setRenderTarget(target);
        for (const pipeline of pipelines) pipeline.dispose();
        post.dispose(); source.dispose(); output.dispose();
      }
    }
    if (resample) {
      const { screenUV, vec2 } = await import('/node_modules/.vite/deps/three_tsl.js');
      r.registerPass({ name: 'audit:resample', order: 100, asNode(color) {
        if (!color.isTextureNode) throw new Error('resampling post lost its texture input');
        return color.sample(screenUV.add(vec2(.001, -.001)));
      } });
      await window.__PUMP__(3);
    }
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
    const nativeCompute = renderer.compute;
    renderer.compute = function (nodes, ...a) {
      const previous = window.__AUDIT_STAGE__;
      const stage = { name: nodes.name || 'compute' };
      window.__AUDIT_STAGE__ = stage; audit.setStage(stage);
      try { return nativeCompute.call(this, nodes, ...a); }
      finally { window.__AUDIT_STAGE__ = previous; audit.setStage(previous); }
    };
    const render = r.render;
    r.render = function (ctx) {
      if (hurt) e.ctx.get('player').lowHealthPass.state.value.set(.6, .4, .3);
      return render.call(this, ctx);
    };
    if (warmup) await window.__PUMP__(warmup);
    const device = renderer.backend.device;
    const a = device.adapterInfo;
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
        for (const pass of [...audit.passes, ...audit.computePasses]) {
          pass.startNs = String(times[pass.slot]); pass.endNs = String(times[pass.slot + 1]);
          pass.gpuMs = Number(times[pass.slot + 1] - times[pass.slot]) / 1e6;
        }
        read.unmap(); read.destroy(); resolve.destroy();
      }
      return { quality: e.config.quality, size: [r.screenSize.width, r.screenSize.height],
        backend: renderer.backend.constructor.name, hardware: { vendor: a.vendor,
          architecture: a.architecture, fallback: a.isFallbackAdapter, userAgent: navigator.userAgent },
        warmup, hazeActive: e.ctx.get('fx').hazeSys.uActive.value,
        hazeLive: e.ctx.get('fx').hazeSys._live, engineFrame: e.time.frame,
        lowHealth: e.ctx.get('player').lowHealthPass.state.value.toArray(),
        pointwiseParity,
        resources: audit.resources, passes: audit.passes.map(p => ({ ...p, reads: [...p.reads] })),
        computePasses: audit.computePasses,
        copies: audit.copies, shaders: audit.shaders };
    } finally {
      queries?.destroy(); renderer.render = nativeRender; renderer.compute = nativeCompute;
      renderer.backend.draw = draw; r.render = render;
    }
  }, { frames, warmup, hurt: args.hurt === '1', resample: args.resample === '1', parity: args.parity === '1' });
  assert.equal(report.backend, 'WebGPUBackend');
  assert.equal(report.hardware.fallback, false, 'GPU audit requires hardware WebGPU');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(report.passes.length > 0, 'audit must observe actual GPU submissions');
  for (const pass of [...report.passes, ...report.computePasses]) {
    if (pass.colors) assert.ok(pass.colors.every(a => Number.isInteger(a.texture)), 'unmapped GPU attachment');
    if (pass.gpuMs !== undefined) assert.ok(Number.isFinite(pass.gpuMs) && pass.gpuMs >= 0);
  }
  if (args.verify === '1') {
    const expected = { high: 18, medium: 18, low: 14, ultra: 25 }[quality] +
      (args.resample === '1' ? 1 : 0);
    for (let frame = 0; frame < frames; frame++) {
      const fullscreen = report.passes.filter(p => p.frame === frame && p.draws > 0 && p.stage?.fullscreen &&
        !(p.stage.width === 64 && p.stage.height === 64));
      // Fog replaces a raster boundary; clustered lighting does not.
      const computes = report.computePasses.filter(p => p.frame === frame && p.stage?.name === 'Volumetric fog');
      assert.equal(fullscreen.length + computes.length, expected, 'redundant fullscreen boundary returned');
      assert.equal(report.copies.filter(p => p.frame === frame).length, quality === 'low' ? 0 : 2,
        'native TAA history copies must be retained');
    }
  }
  writeFileSync(out, JSON.stringify({ ...report, variant: args.variant ?? 'stock', errors }, null, 2));
  console.log(JSON.stringify({ quality, shot, frames, passes: report.passes.length,
    copies: report.copies.length, out }));
} finally { await browser.close(); stopViteServer(server); }
