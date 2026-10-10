/** Standalone legacy-worktree comparison; never a gameplay backend toggle.
 * Run GPU measurements sequentially. Historical reports are in PR #316.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();
const root = resolve(String(args.root ?? '.'));
const backend = String(args.backend ?? 'webgpu');
const port = Number(args.port ?? 5300), frames = Number(args.frames ?? 600), settle = 30;
const width = Number(args.width ?? 960), height = Number(args.height ?? 540);
const shot = String(args.shot ?? 'combat'), quality = String(args.quality ?? 'high');
const out = String(args.out ?? '/tmp/webgpu-legacy-benchmark');
const alignedRng = args['align-rng'] === '1', audit = args.audit === '1';
const normalAgents = args.agents === 'normal', live = args.live !== '0';
const clockRate = Number(args['clock-rate'] ?? 0);
assert(Number.isFinite(clockRate) && clockRate >= 0 && (!clockRate || live));
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
assert(['webgpu', 'webgl'].includes(backend));
assert(Number.isInteger(frames) && frames >= 60 && frames <= 900);
if (alignedRng) assert.equal(backend, 'webgpu');
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const three = JSON.parse(readFileSync(`${root}/node_modules/three/package.json`, 'utf8')).version;
const server = await ensureViteServer({ root, port });
let browser;
try {
  browser = await launchChromium({ webgpu: backend === 'webgpu',
    headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ['--ignore-gpu-blocklist', '--mute-audio', '--use-angle=vulkan',
      '--enable-features=Vulkan', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (alignedRng) {
    // Test-only restoration of the legacy renderer's unused startup RNG fork.
    // This changes the scenario seed streams, not the measured render path.
    await page.route('**/src/render/index-webgpu.js*', async route => {
      const response = await route.fetch(), body = await response.text();
      const marker = '    this.ctx = ctx;';
      assert.equal(body.split(marker).length, 2);
      assert(!body.includes('ctx.rng.fork('), 'runtime already reserves the RNG stream; omit --align-rng=1');
      await route.fulfill({ response, body: body.replace(marker,
        `${marker}\n    ctx.rng.fork(); // diagnostic legacy stream reservation`) });
    });
  }
  const t0 = performance.now();
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=${shot}&q=${quality}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 120000 });
  const readyMs = performance.now() - t0;
  const meta = await page.evaluate(() => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
    const rng = x => x ? [x.s0, x.s1, x.s2, x.s3] : null;
    let device;
    if (renderer.backend) {
      const a = renderer.backend.device.adapterInfo;
      device = { backend: 'webgpu', vendor: a.vendor, architecture: a.architecture,
        isFallbackAdapter: a.isFallbackAdapter };
    } else {
      const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (!ext) throw new Error('actual GL renderer info required');
      device = { backend: 'webgl', vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
    }
    return {
      device, userAgent: navigator.userAgent,
      drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
      internal: [r.screenSize.width, r.screenSize.height], pixelRatio: renderer.getPixelRatio(),
      quality: e.config.quality, config: e.config.q, frame: e.time.frame, rng: rng(e.rng),
      systemRng: e.registry.ordered.map(s => [s.constructor.id, rng(s.rng)]),
      prewarm: window.__PREWARM__?.hooks ?? e.__prewarmHooks ?? null, viewSamples: r.viewRt.samples,
      targets: { world: [r.hdrRt.width, r.hdrRt.height], view: [r.viewRt.width, r.viewRt.height] },
      bootMeasures: performance.getEntriesByType('measure').map(m => ({ name: m.name, ms: m.duration })),
    };
  });
  assert.equal(meta.device.backend, backend);
  if (backend === 'webgpu') {
    assert.equal(meta.device.vendor, 'amd');
    assert.equal(meta.device.architecture, 'rdna-4');
    assert.equal(meta.device.isFallbackAdapter, false);
  } else {
    assert.match(meta.device.renderer, /RX 9070 XT|GFX1201/i);
    assert.doesNotMatch(meta.device.renderer, /SwiftShader|llvmpipe|lavapipe/i);
  }
  assert.deepEqual(meta.drawingBuffer,
    [Math.round(width * meta.config.renderScale), Math.round(height * meta.config.renderScale)]);
  assert.deepEqual(meta.targets.world, meta.drawingBuffer);
  assert.deepEqual(meta.targets.view, meta.drawingBuffer);

  const result = await page.evaluate(async ({ frames, settle, normalAgents, live, audit, clockRate }) => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
    const rng = x => x ? [x.s0, x.s1, x.s2, x.s3] : null;
    const snapshot = () => ({
      frame: e.time.frame, camera: e.camera.position.toArray(), rotation: e.camera.quaternion.toArray(),
      rng: rng(e.rng), aiRng: rng(e.ctx.get('ai').rng), weaponRng: rng(e.ctx.get('weapons').rng),
      playerRng: rng(e.ctx.get('player').rng), fxRng: rng(e.ctx.get('fx').rng),
      viewmodelRng: rng(e.ctx.get('weapons').viewmodel.rng),
      playerDead: e.ctx.get('player').dead,
      weapon: { id: e.ctx.get('weapons').activeId, mag: e.ctx.get('weapons').state.mag },
      agents: e.ctx.get('ai').agents.map(a => ({
        id: a.id, alive: a.alive, health: a.health, state: a.state, position: a.position.toArray(),
        target: a.moveTarget.toArray(), pathLen: a.pathLen,
        hasMoveTarget: a.hasMoveTarget, pathPending: a.pathPending,
      })),
    });
    await window.__PUMP__(60);
    await r._meterTask;
    if (live) {
      e.input.enabled = true;
      e.input.frozen = false;
      e.ctx.get('player').setControlEnabled(true);
      e.ctx.get('ai').debugStage('firefight');
      if (normalAgents) for (const a of e.ctx.get('ai').agents) a.staged = null;
    }
    if (clockRate) { e.ctx.get('sky').setTimeOfDay(18); e.ctx.get('sky').setTimeRate(clockRate); }
    const initial = snapshot(), samples = [], auditEvents = [];
    let renderMs = 0, builders = 0, auditTick = -1;
    if (audit) {
      // Diagnostic only: these payload copies perturb timing; do not benchmark with --audit=1.
      const fx = e.ctx.get('fx');
      for (const name of ['onImpact', 'onWeaponFire', 'onActorDeath', 'onLand', 'onFootstep', 'spawnShell']) {
        const orig = fx[name];
        fx[name] = function (...args) {
          const before = rng(this.rng);
          const props = Object.fromEntries(Object.entries(args[0] ?? {})
            .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v) || v?.isVector3)
            .map(([k, v]) => [k, v?.isVector3 ? v.toArray() : v]));
          const value = orig.apply(this, args);
          auditEvents.push({ i: auditTick, name, props, before, after: rng(this.rng) });
          return value;
        };
      }
    }
    const oldBuilder = renderer.debug?.onNodeBuilderCreated;
    if (renderer.backend) {
      renderer.debug.onNodeBuilderCreated = (...args) => { builders++; oldBuilder?.(...args); };
    }
    const programsBefore = renderer.info.programs?.length ?? null;
    const render = r.render;
    r.render = function (ctx) {
      const t = performance.now();
      try { return render.call(this, ctx); }
      finally { renderMs = performance.now() - t; }
    };
    const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
    try {
      for (let i = 0; i < frames + settle; i++) {
        await tick();
        const at = performance.now();
        builders = 0;
        auditTick = i;
        if (live) {
          e.input._rawLook.x -= .006 / e.config.sensitivity;
          e.input.down.add('KeyW');
          if (i % 90 < 30) e.input.down.add('Mouse0');
          else e.input.down.delete('Mouse0');
          e.step();
        } else r.render(e.ctx);
        const wall = performance.now() - at;
        if (e.error) throw new Error(JSON.stringify(e.error));
        if (i >= settle) samples.push({ i, at, wall, renderMs, hour: e.ctx.get('sky').hour,
          playerDead: e.ctx.get('player').dead,
          builders: renderer.backend ? builders : null, programs: renderer.info.programs?.length ?? null });
      }
    } finally {
      r.render = render;
      if (renderer.backend) renderer.debug.onNodeBuilderCreated = oldBuilder;
    }
    const final = snapshot(), programsAfter = renderer.info.programs?.length ?? null;
    let meshes = 0, instances = 0;
    e.ctx.get('world').root.traverse(o => {
      if (o.isMesh) { meshes++; if (o.isInstancedMesh) instances += o.count; }
    });
    return { initial, final, samples, auditEvents, programsBefore, programsAfter, world: { meshes, instances } };
  }, { frames, settle, normalAgents, live, audit, clockRate });

  const stats = values => {
    const a = values.slice().sort((a, b) => a - b), p = x => a[Math.floor(a.length * x)];
    return { mean: a.reduce((s, x) => s + x, 0) / a.length,
      p50: p(.5), p95: p(.95), p99: p(.99), max: a.at(-1) };
  };
  const summary = {
    interval: stats(result.samples.slice(1).map((s, i) => s.at - result.samples[i].at)),
    wall: stats(result.samples.map(s => s.wall)), render: stats(result.samples.map(s => s.renderMs)),
    builders: backend === 'webgpu' ? result.samples.reduce((s, x) => s + x.builders, 0) : null,
  };
  const report = { root, revision, three, backend, shot, quality, width, height, frames, settle,
    initialFrames: 60, normalAgents, live, alignedRng, audit, clockRate, readyMs, meta, summary, ...result, errors };
  writeFileSync(`${out}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ backend, three, device: meta.device, readyMs, summary, errors }, null, 2));
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally {
  await browser?.close();
  stopViteServer(server);
}
