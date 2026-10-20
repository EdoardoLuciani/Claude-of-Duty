// VSync-free controls for the pinned #476 raw and Three.js renderers. Not used
// by the native executable. Default: matched persistent RGBA8/depth32 offscreen
// targets, no rAF. --windowed: real X11 canvas, unlimited rAF with VSync disabled.
// Equivalent vertex-output constructor mirrors the native Naga workaround.
// No shader arithmetic changes, private Three hooks, or timed API wrappers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    reference: { type: 'string' },
    data: { type: 'string' },
    executable: { type: 'string' },
    agents: { type: 'string', default: '5' },
    mode: { type: 'string', default: 'raw' },
    windowed: { type: 'boolean', default: false },
    frames: { type: 'string', default: '900' },
    warmup: { type: 'string', default: '120' },
    'in-flight': { type: 'string', default: '2' },
    out: { type: 'string' },
    capture: { type: 'string' },
  },
});
assert(
  args.reference && args.data && args.executable && args.out,
  'Required: --reference=/checkout/of/476 --data=DIR --executable=CHROME --out=JSON'
);
assert(['raw', 'three'].includes(args.mode), 'mode must be raw or three');
assert([5, 12].includes(Number(args.agents)), 'agents must be 5 or 12');
for (const key of ['frames', 'in-flight'])
  assert(Number.isSafeInteger(Number(args[key])) && Number(args[key]) > 0, key);
assert(Number.isSafeInteger(Number(args.warmup)) && Number(args.warmup) >= 0, 'warmup');
const root = resolve(args.reference),
  here = join(root, 'tools/direct-webgpu'),
  data = resolve(args.data);
const require = createRequire(join(root, 'package.json'));
const { PNG } = require('pngjs');
const { launchChromium } = await import(pathToFileURL(join(root, 'tools/lib/browser-harness.mjs')));
const original = await readFile(join(here, 'raw-renderer.js'), 'utf8');
const replace = (s, old, replacement) => {
  assert.equal(s.split(old).length, 2, `pinned source changed: ${old}`);
  return s.replace(old, replacement);
};
let source = replace(
  original,
  '  const cameraWorld = [',
  `  const outputTexture = texture([canvas.width, canvas.height], format,
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
  const outputView = outputTexture.createView();
  const cameraWorld = [`
);
source = replace(source, 'context.getCurrentTexture().createView()', 'outputView');
source = replace(
  source,
  '  return {\n    device,\n    errors,',
  '  return {\n    device,\n    errors,\n    outputTexture,'
);
const shaders = replace(
  await readFile(join(here, 'shaders.js'), 'utf8'),
  'var out:VertexOut;out.clip=frame.vp*world;out.world=world.xyz;out.normal=(object.normal*vec4<f32>(normal,0.0)).xyz;out.material=instance.y;return out;',
  'return VertexOut(frame.vp*world,world.xyz,(object.normal*vec4<f32>(normal,0.0)).xyz,instance.y);'
);
// Public RenderTarget/readback APIs only: no Three backend hooks or patched GPU methods.
const originalThree = await readFile(join(here, 'three-reference.js'), 'utf8');
let threeSource = replace(
  originalThree,
  '  const skyColor =',
  `  const outputTarget = new THREE.RenderTarget(canvas.width, canvas.height, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, samples: 0,
    depthTexture: new THREE.DepthTexture(canvas.width, canvas.height, THREE.FloatType),
  });
  outputTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  outputTarget.depthTexture.format = THREE.DepthFormat;
  const skyColor =`
);
threeSource = replace(
  threeSource,
  'renderer.setRenderTarget(null);',
  'renderer.setRenderTarget(outputTarget);'
);
threeSource = replace(
  threeSource,
  '  return {\n    device,\n    errors,',
  `  return {
    device,
    errors,
    outputFormat: 'rgba8unorm',
    readOutput: () => renderer.readRenderTargetPixelsAsync(outputTarget, 0, 0, canvas.width, canvas.height),`
);
const servedRaw = args.windowed ? original : source;
const servedThree = args.windowed ? originalThree : threeSource;
const sha = (...chunks) => chunks.reduce((h, c) => h.update(c), createHash('sha256')).digest('hex');
const rendererSha256 = sha(
  args.mode === 'raw' ? servedRaw : servedThree,
  await readFile(join(here, 'math.js')),
  shaders
);
const datasetSha256 = sha(
  await readFile(join(data, `scene-${args.agents}.json`)),
  await readFile(join(data, `scene-${args.agents}.bin`))
);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    let base, relative;
    if (path.startsWith('/vendor/') && args.mode === 'three') {
      base = join(root, 'node_modules/three');
      relative = path.slice(8);
    } else if (/^\/data\/scene-(?:5|12)\.(?:json|bin)$/.test(path)) {
      base = data;
      relative = path.slice(6);
    } else {
      assert(
        /^\/(?:|index\.html|app\.js|raw-renderer\.js|three-reference\.js|math\.js|shaders\.js|scene-data\.js)$/.test(
          path
        )
      );
      base = here;
      relative = path === '/' ? 'index.html' : path.slice(1);
    }
    const file = resolve(base, relative);
    assert(file.startsWith(base + '/'), 'local files only');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.html')
          ? 'text/html'
          : file.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream'
    );
    res.end(
      path === '/raw-renderer.js'
        ? servedRaw
        : path === '/three-reference.js'
          ? servedThree
          : path === '/shaders.js'
            ? shaders
            : await readFile(file)
    );
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await launchChromium({
    headless: !args.windowed,
    executablePath: args.executable,
    args: [
      '--ozone-platform=x11',
      '--ignore-gpu-blocklist',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--mute-audio',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(180000);
  const errors = [],
    requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?mode=${args.mode}&agents=${args.agents}&w=1920&h=1080&shadow=1024`
  );
  await page.evaluate(() => window.__LAB_READY__);
  const session = await browser.newBrowserCDPSession(),
    boundaries = [];
  await page.exposeFunction('__BOUNDARY__', async () =>
    boundaries.push(await session.send('SystemInfo.getProcessInfo'))
  );
  const result = await page.evaluate(
    async ({ frames, warmup, inFlight, windowed }) => {
      const { renderer, data, adapterInfo } = window.__LAB__,
        pending = [];
      const tick = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const frame = async (i) => {
        if (windowed) await tick();
        const start = performance.now();
        renderer.render(i);
        const renderMs = performance.now() - start;
        const stats = renderer.stats(),
          sample = { renderMs, draws: stats.draws.slice(), triangles: stats.triangles.slice() };
        // Each promise fences the submission just encoded, not all future ones.
        pending.push(renderer.device.queue.onSubmittedWorkDone());
        if (pending.length >= inFlight) await pending.shift();
        if (renderer.errors.length) throw Error(renderer.errors.join('\n'));
        return sample;
      };
      for (let i = 0; i < warmup; i++) await frame(i);
      await renderer.device.queue.onSubmittedWorkDone();
      pending.length = 0;
      const warmBuilds = renderer.builds?.() || 0;
      const format = windowed
        ? document.querySelector('canvas').getContext('webgpu').getCurrentTexture().format
        : renderer.outputFormat || renderer.outputTexture.format;
      await window.__BOUNDARY__();
      const start = performance.now(),
        samples = [];
      for (let i = 0; i < frames; i++) samples.push(await frame(i));
      await renderer.device.queue.onSubmittedWorkDone();
      const elapsedMs = performance.now() - start;
      await window.__BOUNDARY__();
      return {
        mode: window.__LAB__.mode + (windowed ? '-canvas' : '-offscreen'),
        pacing: windowed ? 'unlimited-rAF+completion-fences' : 'completion-fences-no-rAF',
        target: windowed ? 'canvas' : 'offscreen-texture',
        canvas: {
          width: document.querySelector('canvas').width,
          height: document.querySelector('canvas').height,
          dpr: devicePixelRatio,
        },
        visibility: document.visibilityState,
        warmBuilds,
        lateBuilds: (renderer.builds?.() || 0) - warmBuilds,
        frames,
        warmup,
        inFlight,
        width: 1920,
        height: 1080,
        elapsedMs,
        msPerFrame: elapsedMs / frames,
        meanRenderMs: samples.reduce((n, s) => n + s.renderMs, 0) / frames,
        samples,
        adapterInfo,
        crossOriginIsolated,
        scene: { nodes: data.meta.nodes.length, meshes: data.meta.meshes.length },
        format,
      };
    },
    {
      frames: Number(args.frames),
      warmup: Number(args.warmup),
      inFlight: Number(args['in-flight']),
      windowed: args.windowed,
    }
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
  if (args.capture)
    for (const pose of [0, 60, 119]) {
      const rgba = await page.evaluate(async (pose) => {
        const r = window.__LAB__.renderer;
        r.render(pose);
        if (r.readOutput) return (await r.readOutput()).toBase64();
        const t =
            r.outputTexture ||
            document.querySelector('canvas').getContext('webgpu').getCurrentTexture(),
          stride = Math.ceil((t.width * 4) / 256) * 256;
        const read = r.device.createBuffer({
          size: stride * t.height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const e = r.device.createCommandEncoder();
        e.copyTextureToBuffer({ texture: t }, { buffer: read, bytesPerRow: stride }, [
          t.width,
          t.height,
        ]);
        r.device.queue.submit([e.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(read.getMappedRange()),
          rgba = new Uint8Array(t.width * t.height * 4);
        for (let y = 0; y < t.height; y++)
          rgba.set(data.subarray(y * stride, y * stride + t.width * 4), y * t.width * 4);
        if (t.format.startsWith('bgra'))
          for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
        const encoded = rgba.toBase64();
        read.unmap();
        read.destroy();
        return encoded;
      }, pose);
      const png = new PNG({ width: 1920, height: 1080 });
      png.data = Buffer.from(rgba, 'base64');
      assert(
        png.data.some((v, i) => i % 4 !== 3 && v !== png.data[i % 4]),
        'nonblank capture'
      );
      await writeFile(`${args.capture}-p${pose}.png`, PNG.sync.write(png));
    }
  result.datasetSha256 = datasetSha256;
  result.rendererSha256 = rendererSha256;
  result.originalRendererSha256 = sha(args.mode === 'raw' ? original : originalThree);
  result.browser = browser.version();
  result.system = await session.send('SystemInfo.getInfo');
  result.errors = errors;
  assert.deepEqual(errors, []);
  assert.equal(result.lateBuilds, 0, 'no shader builders after warmup');
  result.requestsThree = requests.filter((url) => url.includes('/vendor/')).length;
  if (args.mode === 'raw') assert.equal(result.requestsThree, 0, 'no Three.js imports');
  else assert(result.requestsThree > 0, 'Three.js must actually be loaded');
  result.browserFlags = [
    '--ozone-platform=x11',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
  ];
  await writeFile(args.out, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      mode: result.mode,
      msPerFrame: result.msPerFrame,
      meanRenderMs: result.meanRenderMs,
      processCpu: result.processCpu,
    })
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
