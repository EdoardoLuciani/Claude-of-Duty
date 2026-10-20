// Local-only benchmark server. Raw page imports no Three.js modules.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { PNG } from 'pngjs';

import { launchChromium, parseArgs } from '../lib/browser-harness.mjs';
const args = parseArgs(),
  here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, '../..');
const data = resolve(args.data || './direct-webgpu-data'),
  out = resolve(args.out || join(data, 'run.json'));
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let base = here,
      path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (path.startsWith('vendor/')) {
      base = join(repo, 'node_modules/three');
      path = path.slice(7);
    } else if (path.startsWith('data/')) {
      base = data;
      path = path.slice(5);
      if (!/^scene-(5|12)\.(json|bin)$/.test(path)) throw Error('invalid data path');
    }
    const file = resolve(base, path);
    if (!file.startsWith(base + '/')) throw Error('invalid path');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader(
      'Content-Type',
      Object.entries(mime).find(([ext]) => file.endsWith(ext))?.[1] || 'application/octet-stream'
    );
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await launchChromium({
    headless: true,
    executablePath: args.executable || chromium.executablePath(),
    args: [
      '--ignore-gpu-blocklist',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--mute-audio',
    ],
  });
  const width = Number(args.w || 1920),
    height = Number(args.h || 1080),
    page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => requests.push(r.url()));
  page.setDefaultTimeout(180000);
  const url = `http://127.0.0.1:${server.address().port}/?mode=${args.mode || 'raw'}&agents=${args.agents || 5}&w=${width}&h=${height}&shadow=${args.shadow || 1024}${args.freeze ? '&freeze=1' : ''}`;
  await page.goto(url);
  const boot = await page.evaluate(() => window.__LAB_READY__);
  console.log('ready', boot);
  const session = await browser.newBrowserCDPSession();
  const boundaries = [];
  await page.exposeFunction('__BOUNDARY__', async () =>
    boundaries.push(await session.send('SystemInfo.getProcessInfo'))
  );
  const datasetSha256 = createHash('sha256')
    .update(await readFile(join(data, `scene-${args.agents || 5}.json`)))
    .update(await readFile(join(data, `scene-${args.agents || 5}.bin`)))
    .digest('hex');
  const rendererSha256 = createHash('sha256')
    .update(await readFile(join(here, 'raw-renderer.js')))
    .update(await readFile(join(here, 'three-reference.js')))
    .update(await readFile(join(here, 'math.js')))
    .update(await readFile(join(here, 'shaders.js')))
    .digest('hex');
  const result = await page.evaluate(
    async ({ frames, warmup, count }) => {
      const { renderer, data, mode, adapterInfo } = window.__LAB__,
        tick = () => new Promise((resolve) => requestAnimationFrame(resolve));
      for (let i = 0; i < warmup; i++) {
        await tick();
        renderer.render(i);
      }
      await renderer.device.queue.onSubmittedWorkDone();
      const totals = {
        writes: 0,
        bytes: 0,
        submits: 0,
        draws: 0,
        pipelines: 0,
        groups: 0,
        vertices: 0,
        indices: 0,
      };
      if (count) {
        const queue = renderer.device.queue,
          write = queue.writeBuffer,
          submit = queue.submit;
        queue.writeBuffer = function (buffer, offset, source, start = 0, size) {
          const scale = ArrayBuffer.isView(source) ? source.BYTES_PER_ELEMENT || 1 : 1;
          totals.writes++;
          totals.bytes += size === undefined ? source.byteLength - start * scale : size * scale;
          return write.apply(this, arguments);
        };
        queue.submit = function () {
          totals.submits++;
          return submit.apply(this, arguments);
        };
        for (const [method, key] of [
          ['drawIndexed', 'draws'],
          ['setPipeline', 'pipelines'],
          ['setBindGroup', 'groups'],
          ['setVertexBuffer', 'vertices'],
          ['setIndexBuffer', 'indices'],
        ]) {
          const original = GPURenderPassEncoder.prototype[method];
          GPURenderPassEncoder.prototype[method] = function () {
            totals[key]++;
            return original.apply(this, arguments);
          };
        }
      }
      const warmBuilds = renderer.builds?.() || 0;
      await window.__BOUNDARY__();
      const samples = [],
        start = performance.now();
      for (let i = 0; i < frames; i++) {
        await tick();
        const before = performance.now();
        renderer.render(i);
        const renderMs = performance.now() - before;
        const stats = renderer.stats();
        samples.push({ renderMs, draws: stats.draws.slice(), triangles: stats.triangles.slice() });
        if (renderer.errors.length) throw Error(renderer.errors.join('\n'));
      }
      await renderer.device.queue.onSubmittedWorkDone();
      const elapsedMs = performance.now() - start;
      await window.__BOUNDARY__();
      return {
        mode,
        adapterInfo,
        frames,
        warmup,
        warmBuilds,
        lateBuilds: (renderer.builds?.() || 0) - warmBuilds,
        crossOriginIsolated,
        elapsedMs,
        msPerFrame: elapsedMs / frames,
        meanRenderMs: samples.reduce((n, s) => n + s.renderMs, 0) / frames,
        counts: count ? totals : null,
        samples,
        debug: renderer.debug?.(),
        scene: {
          nodes: data.meta.nodes.length,
          meshes: data.meta.meshes.length,
          groups: data.meta.meshes.reduce((n, m) => n + m.ranges.length, 0),
          bakedFrames: data.meta.frameCount,
        },
      };
    },
    { frames: Number(args.frames || 900), warmup: Number(args.warmup || 120), count: !!args.count }
  );
  assert.equal(boundaries.length, 2);
  result.processCpu = boundaries[0].processInfo.map((p) => {
    const end = boundaries[1].processInfo.find((e) => e.id === p.id);
    assert(end, 'stable process');
    return {
      type: p.type,
      id: p.id,
      msPerFrame: ((end.cpuTime - p.cpuTime) * 1000) / result.frames,
    };
  });
  result.browserVersion = browser.version();
  result.frozenPose = !!args.freeze;
  result.system = await session.send('SystemInfo.getInfo');
  result.datasetSha256 = datasetSha256;
  result.rendererSha256 = rendererSha256;
  assert.equal(result.lateBuilds, 0, 'no late shader builders');
  result.requestsThree = requests.filter((url) => url.includes('/vendor/')).length;
  if (result.mode.startsWith('raw'))
    assert.equal(result.requestsThree, 0, 'raw renderer must not load Three.js');
  if (args.capture)
    for (const pose of String(args.poses ?? args.pose ?? 60).split(',')) {
      const image = await page.evaluate(async (frame) => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const renderer = window.__LAB__.renderer,
          canvas = document.querySelector('canvas');
        renderer.render(frame);
        const device = renderer.device,
          texture = canvas.getContext('webgpu').getCurrentTexture(),
          stride = Math.ceil((canvas.width * 4) / 256) * 256;
        const read = device.createBuffer({
          size: stride * canvas.height,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow: stride }, [
          canvas.width,
          canvas.height,
        ]);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const source = new Uint8Array(read.getMappedRange()),
          rgba = new Uint8Array(canvas.width * canvas.height * 4);
        for (let y = 0; y < canvas.height; y++)
          rgba.set(
            source.subarray(y * stride, y * stride + canvas.width * 4),
            y * canvas.width * 4
          );
        if (texture.format.startsWith('bgra'))
          for (let i = 0; i < rgba.length; i += 4) {
            const r = rgba[i];
            rgba[i] = rgba[i + 2];
            rgba[i + 2] = r;
          }
        const base64 = rgba.toBase64();
        read.unmap();
        read.destroy();
        return { base64, width: canvas.width, height: canvas.height };
      }, Number(pose));
      const png = new PNG({ width: image.width, height: image.height });
      png.data = Buffer.from(image.base64, 'base64');
      await writeFile(
        resolve(
          args.poses ? String(args.capture).replace(/\.png$/, `-p${pose}.png`) : args.capture
        ),
        PNG.sync.write(png)
      );
    }
  result.browser = await browser.version();
  result.errors = errors;
  await writeFile(out, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        meanRenderMs: result.meanRenderMs,
        msPerFrame: result.msPerFrame,
        counts: result.counts,
        first: result.samples[0],
        errors,
      },
      null,
      2
    )
  );
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
