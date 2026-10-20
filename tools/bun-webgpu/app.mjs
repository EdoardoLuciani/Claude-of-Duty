import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setImmediate as turn, setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import gpu from '@kmamal/gpu';
import { PNG } from 'pngjs';

import { createPresentation } from './present.mjs';
import { sha, provenance } from './provenance.mjs';
import { createRaw } from './renderer.mjs';
import { decodeScene } from './scene.mjs';

const { values: args } = parseArgs({
  options: {
    data: { type: 'string' },
    agents: { type: 'string', default: '5' },
    windowed: { type: 'boolean', default: false },
    frames: { type: 'string' },
    warmup: { type: 'string', default: '120' },
    'in-flight': { type: 'string', default: '8' },
    out: { type: 'string' },
    capture: { type: 'string' },
    'freeze-pose': { type: 'boolean', default: false },
  },
});
const agents = Number(args.agents),
  width = 1920,
  height = 1080;
const frames = Number(args.frames ?? (args.windowed ? '0' : '900')),
  warmup = Number(args.warmup),
  inFlight = Number(args['in-flight']);
assert(args.data, '--data=/local/recorded-scenes is required');
assert([5, 12].includes(agents), 'agents must be 5 or 12');
assert(
  Number.isSafeInteger(frames) && frames >= 0 && (frames > 0 || args.windowed),
  'frames must be positive, or zero for interactive window'
);
assert(Number.isSafeInteger(warmup) && warmup >= 0, 'warmup');
assert(
  Number.isSafeInteger(inFlight) && inFlight >= 1 && inFlight <= 16,
  'in-flight must be 1..16'
);
if (args.out) await writeFile(args.out, JSON.stringify({ failure: 'incomplete' }));
const info = globalThis.__BUN_WEBGPU_BUILD__ || (await provenance());
const compiled = !!globalThis.__BUN_WEBGPU_BUILD__;
const dataDir = resolve(args.data),
  [json, bytes] = await Promise.all([
    readFile(join(dataDir, `scene-${agents}.json`)),
    readFile(join(dataDir, `scene-${agents}.bin`)),
  ]);
const datasetSha256 = sha(json, bytes);
const data = decodeScene(
  JSON.parse(json),
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);
for (const [name, value] of Object.entries(gpu))
  if (name.startsWith('GPU')) globalThis[name] = value;
let instance = gpu.create(['backend=vulkan']);
// Dawn's instance owns async runners: keep an explicit GC root until teardown.
// A local whose last read was requestAdapter is not a sufficient lifetime owner.
globalThis.navigator ??= {};
globalThis.navigator.gpu = instance;
let device,
  window,
  renderer,
  running = true,
  progress = performance.now();
const watchdog = setInterval(() => {
  if (performance.now() - progress > 60000) {
    console.error('GPU/event loop progress timeout');
    process.exit(1);
  }
}, 1000);
const failures = [];
try {
  const adapter = await instance.requestAdapter({ powerPreference: 'high-performance' });
  assert(
    adapter && !adapter.info.isFallbackAdapter,
    'hardware Vulkan adapter required; refusing CPU fallback'
  );
  const adapterInfo = {
    vendor: adapter.info.vendor,
    architecture: adapter.info.architecture,
    device: adapter.info.device,
    description: adapter.info.description,
    fallback: adapter.info.isFallbackAdapter,
  };
  device = await adapter.requestDevice();
  device.lost.then((lost) => {
    if (lost.reason !== 'destroyed') failures.push(`device lost: ${lost.message}`);
  });
  device.pushErrorScope('validation');
  let presentation = null;
  if (args.windowed) {
    const sdl = (await import('@kmamal/sdl')).default;
    window = sdl.video.createWindow({
      width,
      height,
      webgpu: true,
      resizable: false,
      title: 'Bun + native WebGPU — recorded scene',
    });
    assert(
      window.pixelWidth === width && window.pixelHeight === height,
      'window must be exactly 1920×1080 physical pixels'
    );
    window.on('close', () => {
      running = false;
    });
    window.on('keyDown', (e) => {
      if (e.key === 'ESCAPE' || e.scancode === 'ESCAPE') window.destroy();
    });
    presentation = createPresentation(gpu, device, window);
  }
  const format = presentation?.format || 'rgba8unorm';
  const output = presentation
    ? null
    : device.createTexture({
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
  const outputView = output?.createView();
  renderer = await createRaw(
    { device, width, height, format, view: presentation ? presentation.view : () => outputView },
    data,
    { freezePose: args['freeze-pose'] }
  );
  const setupError = await device.popErrorScope();
  assert(!setupError, setupError?.message);
  const pending = [];
  const encode = (index) => {
    renderer.render(index);
    presentation?.swap();
  };
  const fence = async () => {
    pending.push(device.queue.onSubmittedWorkDone());
    if (pending.length >= inFlight) await pending.shift();
    progress = performance.now();
  };
  const drain = async () => {
    await Promise.all(pending);
    pending.length = 0;
    await device.queue.onSubmittedWorkDone();
  };
  if (frames === 0) {
    console.log(
      'Interactive 60 Hz replay, NOT a throughput measurement. Escape/close exits; VSync mode is Immediate.'
    );
    const clock = performance.now();
    while (running && !window.destroyed) {
      encode(Math.floor((performance.now() - clock) * 0.06) % data.meta.frameCount);
      await fence();
      await sleep(1000 / 60);
    }
    await drain();
  } else {
    for (let i = 0; i < warmup; i++) {
      assert(running, 'window closed during warmup');
      encode(i);
      await fence();
    }
    await drain();
    await turn();
    const samples = [],
      cpuStart = process.cpuUsage(),
      start = performance.now();
    let renderTotal = 0;
    for (let i = 0; i < frames; i++) {
      assert(running, 'window closed before benchmark completed');
      const before = performance.now();
      encode(i);
      const renderMs = performance.now() - before;
      renderTotal += renderMs;
      const stats = renderer.stats();
      samples.push({ draws: [...stats.draws], triangles: [...stats.triangles], renderMs });
      await fence();
    }
    await drain();
    const elapsedMs = performance.now() - start,
      cpu = process.cpuUsage(cpuStart);
    await turn();
    assert.deepEqual([...renderer.errors, ...failures], [], 'GPU/API errors');
    const report = {
      ...info,
      compiled,
      runtime: process.versions.bun ? 'bun' : 'node',
      runtimeVersion: process.versions.bun || process.versions.node,
      binarySha256: sha(await readFile(process.execPath)),
      mode: args.windowed ? 'windowed' : 'offscreen',
      pacing: 'bounded-completion-no-rAF',
      presentMode: args.windowed ? 'Immediate' : null,
      surfaceFormat: presentation?.format || null,
      presentationDrawsPerFrame: 0,
      presentationSubmitsPerFrame: 0,
      rendererSubmitsPerFrame: 1,
      format,
      depthFormat: 'depth32float',
      width,
      height,
      agents,
      frames,
      warmup,
      inFlight,
      freezePose: args['freeze-pose'],
      adapterInfo,
      datasetSha256,
      elapsedMs,
      msPerFrame: elapsedMs / frames,
      meanRenderMs: renderTotal / frames,
      processCpuMsPerFrame: (cpu.user + cpu.system) / 1000 / frames,
      samples,
      errors: [],
      limitations: [
        'limited historical #476 workload; not full-game FPS',
        'Bun executable embeds JSCore/JIT and native addons, not JS-to-machine-code AOT',
        'window is direct non-sRGB Vulkan WSI; no extra presentation draw/submit',
        'Dawn binding/compiler differs from Chrome and Rust WGPU; language speedup not isolated',
      ],
    };
    if (args.capture) {
      await mkdir(args.capture, { recursive: true });
      for (const pose of [0, 60, 119]) {
        renderer.render(pose);
        await device.queue.onSubmittedWorkDone();
        const row = Math.ceil((width * 4) / 256) * 256;
        const buffer = device.createBuffer({
          size: row * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: presentation ? presentation.texture() : output },
          { buffer, bytesPerRow: row },
          { width, height }
        );
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint8Array(buffer.getMappedRange()),
          rgba = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y++)
          rgba.set(source.subarray(y * row, y * row + width * 4), y * width * 4);
        buffer.unmap();
        buffer.destroy();
        if (format === 'bgra8unorm')
          for (let i = 0; i < rgba.length; i += 4) {
            const r = rgba[i];
            rgba[i] = rgba[i + 2];
            rgba[i + 2] = r;
          }
        if (presentation) presentation.swap();
        let nonblank = false;
        for (let i = 4; i < rgba.length; i += 4)
          if (rgba[i] !== rgba[0] || rgba[i + 1] !== rgba[1] || rgba[i + 2] !== rgba[2]) {
            nonblank = true;
            break;
          }
        assert(nonblank, 'blank GPU readback');
        await writeFile(
          join(args.capture, `scene-${agents}-p${pose}.png`),
          PNG.sync.write({ width, height, data: rgba })
        );
      }
      await turn();
      assert.deepEqual([...renderer.errors, ...failures], [], 'capture GPU errors');
    }
    if (args.out) await writeFile(args.out, JSON.stringify(report) + '\n');
    console.log(
      JSON.stringify({
        runtime: report.runtime,
        compiled,
        mode: report.mode,
        msPerFrame: report.msPerFrame,
        fps: 1000 / report.msPerFrame,
        meanRenderMs: report.meanRenderMs,
        processCpuMsPerFrame: report.processCpuMsPerFrame,
      })
    );
  }
} finally {
  clearInterval(watchdog);
  device?.destroy();
  if (window && !window.destroyed) window.destroy();
  await turn();
  delete globalThis.navigator.gpu;
  instance = null;
}
