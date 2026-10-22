import { createRaw } from './raw-renderer.js';
import { loadScene } from './scene-data.js';
const parameters = new URLSearchParams(location.search),
  canvas = document.querySelector('canvas');
canvas.width = 1920;
canvas.height = 1080;
window.__READY__ = (async () => {
  const data = await loadScene(Number(parameters.get('agents')));
  const renderer = await createRaw(canvas, data, { shadowSize: 1024 });
  if (renderer.info.fallback !== false) throw Error('nonfallback hardware adapter required');
  renderer.device.lost.then((info) => {
    if (info.reason !== 'destroyed') renderer.errors.push(`device lost: ${info.message}`);
  });
  window.__LAB__ = { renderer, data };
  return {
    adapterInfo: renderer.info,
    format: renderer.outputFormat,
    preferredFormat: navigator.gpu.getPreferredCanvasFormat(),
    nodes: data.meta.nodes.length,
    meshes: data.meta.meshes.length,
    dpr: devicePixelRatio,
    isolated: crossOriginIsolated,
    secure: isSecureContext,
  };
})();

window.__RUN__ = async ({ frames, warmup, inFlight, scheduler }) => {
  const { renderer } = window.__LAB__,
    queue = renderer.device.queue,
    pending = [];
  let resolver = null,
    completed = 0,
    scheduled = 0;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const r = resolver;
    resolver = null;
    r(performance.now());
  };
  const schedule = () => {
    if (scheduler === 'raf')
      return new Promise((r) =>
        requestAnimationFrame((t) => {
          scheduled++;
          r(t);
        })
      );
    if (scheduler === 'task')
      return new Promise((r) => {
        resolver = r;
        scheduled++;
        channel.port2.postMessage(0);
      });
    return Promise.resolve(null);
  };
  const step = async (index, origin) => {
    const beforeSchedule = performance.now(),
      scheduledTimestamp = await schedule(),
      start = performance.now();
    renderer.render(index);
    const renderMs = performance.now() - start,
      stats = renderer.stats();
    const sample = {
      startMs: start - origin,
      scheduleWaitMs: start - beforeSchedule,
      scheduledTimestamp,
      renderMs,
      draws: stats.draws.slice(),
      triangles: stats.triangles.slice(),
    };
    pending.push(
      queue.onSubmittedWorkDone().then(() => {
        completed++;
      })
    );
    const wait = performance.now();
    if (pending.length >= inFlight) await pending.shift();
    sample.fenceWaitMs = performance.now() - wait;
    if (renderer.errors.length) throw Error(renderer.errors.join('\n'));
    return sample;
  };
  const drain = async () => {
    await Promise.all(pending);
    await queue.onSubmittedWorkDone();
    pending.length = 0;
  };
  try {
    for (let i = 0; i < warmup; i++) await step(i, 0);
    await drain();
    const textureStart = renderer.textureCounts ? { ...renderer.textureCounts } : null;
    completed = 0;
    scheduled = 0;
    await window.__BOUNDARY__();
    console.timeStamp('cod-benchmark-start');
    const start = performance.now(),
      samples = [];
    for (let i = 0; i < frames; i++) samples.push(await step(i, start));
    await drain();
    const elapsedMs = performance.now() - start;
    console.timeStamp('cod-benchmark-end');
    await window.__BOUNDARY__();
    if (completed !== frames) throw Error(`incomplete GPU fences: ${completed}/${frames}`);
    return {
      frames,
      warmup,
      inFlight,
      scheduler,
      elapsedMs,
      msPerFrame: elapsedMs / frames,
      completed,
      scheduled,
      meanRenderMs: samples.reduce((n, s) => n + s.renderMs, 0) / frames,
      samples,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      width: canvas.width,
      height: canvas.height,
      dpr: devicePixelRatio,
      errors: renderer.errors.slice(),
      canvasTextureObjects: textureStart
        ? {
            acquisitions: renderer.textureCounts.acquisitions - textureStart.acquisitions,
            distinctObjects: renderer.textureCounts.distinctObjects - textureStart.distinctObjects,
          }
        : null,
      presentationCount: null,
      presentationCountNote:
        'GPU fences, rAF callbacks and canvas texture identities are NOT compositor/physical presentation counts',
    };
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
};

window.__CAPTURE__ = async (pose) => {
  const { renderer: r } = window.__LAB__;
  r.render(pose);
  const texture = r.outputTexture || canvas.getContext('webgpu').getCurrentTexture();
  const stride = Math.ceil((texture.width * 4) / 256) * 256;
  const read = r.device.createBuffer({
    size: stride * texture.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = r.device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow: stride }, [
    texture.width,
    texture.height,
  ]);
  r.device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const source = new Uint8Array(read.getMappedRange()),
    pixels = new Uint8Array(texture.width * texture.height * 4);
  for (let y = 0; y < texture.height; y++)
    pixels.set(source.subarray(y * stride, y * stride + texture.width * 4), y * texture.width * 4);
  if (texture.format === 'bgra8unorm')
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      pixels[i] = pixels[i + 2];
      pixels[i + 2] = r;
    }
  const encoded = pixels.toBase64();
  read.unmap();
  read.destroy();
  return encoded;
};
