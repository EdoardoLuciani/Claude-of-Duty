import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { PNG } from 'pngjs';

import { launchChromium } from '../lib/browser-harness.mjs';
import { launchFirefox } from './firefox.mjs';
import { snapshot, cpuDelta, renderNodes } from './processes.mjs';
import { sources, sha } from './source.mjs';
const { values: args } = parseArgs({
  options: {
    browser: { type: 'string', default: 'chromium' },
    executable: { type: 'string' },
    reference: { type: 'string' },
    data: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'rgba8unorm' },
    target: { type: 'string', default: 'canvas' },
    scheduler: { type: 'string', default: 'raf' },
    pace: { type: 'string', default: 'uncapped' },
    agents: { type: 'string', default: '12' },
    frames: { type: 'string', default: '900' },
    warmup: { type: 'string', default: '120' },
    'in-flight': { type: 'string', default: '8' },
    capture: { type: 'string' },
    identity: { type: 'boolean', default: false },
    trace: { type: 'boolean', default: false },
  },
});
assert(
  args.executable && args.reference && args.data && args.out,
  'Required: --executable --reference --data --out'
);
assert(['chromium', 'firefox'].includes(args.browser));
assert(['canvas', 'offscreen'].includes(args.target));
assert(['raf', 'task', 'completion'].includes(args.scheduler));
assert(['uncapped', 'normal'].includes(args.pace));
assert(!args.trace || args.browser === 'chromium', 'Chrome-only presentation diagnostic');
assert(!args.identity || args.target === 'canvas');
const agents = Number(args.agents),
  frames = Number(args.frames),
  warmup = Number(args.warmup),
  inFlight = Number(args['in-flight']);
assert([5, 12].includes(agents));
assert(Number.isSafeInteger(frames) && frames > 0);
assert(Number.isSafeInteger(warmup) && warmup >= 0);
assert(Number.isInteger(inFlight) && inFlight >= 1 && inFlight <= 16);
const out = resolve(args.out),
  reference = resolve(args.reference),
  data = resolve(args.data),
  executable = resolve(args.executable);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ failure: 'incomplete' }));
assert.equal(
  execFileSync('git', ['-C', reference, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  '11ebdcacef532da3b96b6f30c4c764096d65e944',
  'pinned #476 input'
);
assert.equal(
  execFileSync('git', ['-C', reference, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'reference must be clean'
);
const served = await sources(reference, args.target, args.identity, args.format);
const datasetSha256 = sha(
  await readFile(join(data, `scene-${agents}.json`)),
  await readFile(join(data, `scene-${agents}.bin`))
);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    let body;
    if (path === '/')
      body =
        '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><style>html,body{margin:0;background:black}canvas{display:block}</style><canvas></canvas><script type="module" src="/client.js"></script>';
    else if (path === '/client.js') body = served.client;
    else if (Object.hasOwn(served.files, path.slice(1))) body = served.files[path.slice(1)];
    else if (new RegExp(`^/data/scene-${agents}\\.(json|bin)$`).test(path))
      body = await readFile(join(data, path.slice(6)));
    else throw Error('not a local fixture asset');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader(
      'Content-Type',
      path === '/'
        ? 'text/html'
        : path.endsWith('.js')
          ? 'text/javascript'
          : path.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream'
    );
    res.end(body);
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const env = { ...process.env, MESA_VK_DEVICE_SELECT: '1002:7550!' };
for (const k of [
  'WAYLAND_DISPLAY',
  'WAYLAND_SOCKET',
  'VK_INSTANCE_LAYERS',
  'VK_LOADER_LAYERS_ENABLE',
  'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS',
])
  delete env[k];
let browser, firefox, session, traceDone;
const errors = [],
  warnings = [],
  requests = [],
  boundaries = [];
let nativeLog = '';
const chromeArgs = [
  '--ozone-platform=x11',
  '--ignore-gpu-blocklist',
  '--mute-audio',
  ...(args.pace === 'uncapped' ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
];
try {
  let page, rootPid, launch;
  if (args.browser === 'chromium') {
    browser = await launchChromium({
      headless: false,
      executablePath: executable,
      env,
      args: chromeArgs,
    });
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    session = await browser.newBrowserCDPSession();
    rootPid = (await session.send('SystemInfo.getProcessInfo')).processInfo.find(
      (p) => p.type === 'browser'
    ).id;
    launch = {
      args: (await readFile(`/proc/${rootPid}/cmdline`, 'utf8')).split('\0').filter(Boolean),
    };
  } else {
    firefox = await launchFirefox(executable, out + '.profile', args.pace, env, {
      log: (text) => {
        nativeLog += text;
        process.stderr.write(text);
      },
    });
    browser = firefox.browser;
    rootPid = firefox.pid;
    launch = { args: firefox.args, preferences: firefox.preferences, systemAccess: false };
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  }
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.exposeFunction('__BOUNDARY__', async () => {
    boundaries.push({
      processes: await snapshot(rootPid),
      chrome: session ? await session.send('SystemInfo.getProcessInfo') : null,
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?agents=${agents}`);
  const setup = await page.evaluate(() => window.__READY__);
  assert.equal(setup.adapterInfo.fallback, false);
  assert.equal(setup.dpr, 1);
  assert.equal(setup.isolated, true);
  assert.equal(setup.format, args.format);
  await page.bringToFront();
  await new Promise((r) => setTimeout(r, 1000));
  if (args.trace) {
    traceDone = new Promise((r) => session.once('Tracing.tracingComplete', r));
    await session.send('Tracing.start', {
      categories: 'benchmark,viz,cc,devtools.timeline,blink.console',
      transferMode: 'ReturnAsStream',
      options: 'record-until-full',
    });
  }
  const result = await page.evaluate((options) => window.__RUN__(options), {
    frames,
    warmup,
    inFlight,
    scheduler: args.scheduler,
  });
  assert.equal(boundaries.length, 2);
  assert.equal(result.completed, frames);
  assert.equal(result.visibility, 'visible');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(errors, []);
  assert(!requests.some((url) => url.includes('/vendor/')), 'no Three modules');
  if (args.trace) {
    await session.send('Tracing.end');
    const { stream } = await traceDone;
    let text = '';
    for (;;) {
      const chunk = await session.send('IO.read', { handle: stream });
      text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data;
      if (chunk.eof) break;
    }
    await session.send('IO.close', { handle: stream });
    await writeFile(out + '.trace.json', text);
  }
  const nodes = await renderNodes(boundaries[1].processes);
  assert(
    nodes.some((n) => n.vendor === '0x1002' && n.device === '0x7550'),
    'owned browser must open RX 9070 XT render node'
  );
  if (args.capture) {
    await mkdir(args.capture, { recursive: true });
    for (const pose of [0, 60, 119]) {
      const encoded = await page.evaluate((p) => window.__CAPTURE__(p), pose),
        rgba = Buffer.from(encoded, 'base64');
      assert(
        rgba.some((v, i) => i % 4 !== 3 && v !== rgba[i % 4]),
        'nonblank GPU readback'
      );
      await writeFile(
        join(args.capture, `pose-${pose}.png`),
        PNG.sync.write({ width: 1920, height: 1080, data: rgba })
      );
    }
  }
  assert.deepEqual(
    await page.evaluate(() => window.__LAB__.renderer.errors),
    [],
    'post-capture GPU validation'
  );
  assert.deepEqual(errors, []);
  const system = session ? await session.send('SystemInfo.getInfo') : null;
  if (system)
    assert.equal(
      system.gpu.featureStatus.gpu_compositing,
      'enabled',
      'headful hardware compositing'
    );
  const report = {
    ...result,
    browser: args.browser,
    version: await browser.version(),
    binarySha256: sha(await readFile(executable)),
    setup,
    target: args.target,
    pace: args.pace,
    agents,
    diagnostic: args.identity
      ? 'canvas-texture-identity'
      : args.trace
        ? 'presentation-feedback-trace'
        : null,
    primaryEligible: !args.identity && !args.trace,
    launch,
    environment: {
      display: env.DISPLAY,
      mesaDevice: env.MESA_VK_DEVICE_SELECT,
      windowBackend: 'X11/XWayland; child-only selection',
      inheritedGraphicsOverrides: Object.fromEntries(
        [
          'mesa_glthread',
          'MESA_LOADER_DRIVER_OVERRIDE',
          'MESA_VK_WSI_PRESENT_MODE',
          'DRI_PRIME',
          'MOZ_WEBRENDER',
          'LIBGL_ALWAYS_SOFTWARE',
        ]
          .filter((k) => env[k] !== undefined)
          .map((k) => [k, env[k]])
      ),
    },
    datasetSha256,
    originalSourceSha256: served.originalSha256,
    rendererSha256: served.rendererSha256,
    clientSha256: served.clientSha256,
    processCpu: cpuDelta(boundaries[0].processes, boundaries[1].processes, frames),
    processSnapshots: boundaries,
    renderNodes: nodes,
    system,
    requests: requests.map((url) => new URL(url).pathname),
    warnings,
    errors,
    nativeSharedTextureWarnings: nativeLog
      .split('\n')
      .filter((line) => /SharedTexture|configuration format not supported/.test(line)),
    limitations: [
      'limited #476 recorded renderer, not full-game FPS',
      'GPU completion callbacks include IPC/event-loop delivery; not GPU timestamps',
      'headful controls throughout; explicit unorm format recorded per variant, COPY_SRC unchanged',
      'browser task/rAF/texture counts do not establish physical presented frames',
      'Firefox WebGPU content adapter strings are redacted; hardware corroborated by private about:support diagnostic and owned DRM node',
    ],
  };
  await writeFile(out, JSON.stringify(report) + '\n');
  console.log(
    JSON.stringify({
      browser: report.browser,
      target: report.target,
      scheduler: report.scheduler,
      pace: report.pace,
      msPerFrame: report.msPerFrame,
      fps: 1000 / report.msPerFrame,
      renderMs: report.meanRenderMs,
      completed: report.completed,
    })
  );
} finally {
  try {
    if (firefox) await firefox.close();
    else await browser?.close();
  } finally {
    await new Promise((r) => server.close(r));
  }
}
