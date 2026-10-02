#!/usr/bin/env node
/**
 * Diagnostic ONLY: most controls deliberately render stale/incorrect images.
 * No control is an optimization proposal or a gameplay/backend option.
 *
 * MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-frame-isolation.mjs \
 *   --live=1 --frames=300 --controls=stock --nav=1 --out=/tmp/nav-record
 * Repeat with --replay=/tmp/nav-record.json to replace physical attachment
 * probes with recorded answers, rejecting any differing input/query sequence.
 *
 * --live=0 holds simulation/camera still for interleaved same-scene controls.
 * --agents=normal lets the staged starting actors use normal decisions/motion.
 * --cpu=1 --trace=1 collect sampled CPU and marked browser/native timelines.
 * Counters are candidate draws/work BEFORE optional draw suppression, not
 * proof of identical images. Wall time is not thread CPU or GPU execution.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs(), root = fileURLToPath(new URL('../', import.meta.url));
const frames = Number(args.frames ?? 300), port = Number(args.port ?? 5286);
const out = String(args.out ?? '/tmp/webgpu-frame-isolation');
const controls = String(args.controls ?? 'stock').split(',');
const allowed = new Set(['stock', 'no-writes', 'no-draw', 'no-bindings', 'no-nodes',
  'no-uniform-check', 'no-texture-check', 'half-res', 'frozen-shadows', 'no-meter', 'no-render']);
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
assert.ok(Number.isInteger(frames) && frames >= 60 && frames <= 900);
for (const control of controls) assert.ok(allowed.has(control), `unknown control: ${control}`);
const replay = args.replay ? JSON.parse(readFileSync(String(args.replay), 'utf8')).navRecords : null;
if (args.replay) assert.ok(Array.isArray(replay), 'missing navigation records');
const server = await ensureViteServer({ root, port });
const browser = await launchChromium({ headless: true,
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  args: ['--ignore-gpu-blocklist', '--mute-audio', '--use-angle=vulkan', '--enable-features=Vulkan',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=combat&q=high`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 90000 });
  const hardware = await page.evaluate(() => {
    const renderer = window.__ENGINE__.ctx.get('render').renderer;
    const a = renderer.backend.device.adapterInfo;
    return { backend: renderer.backend.constructor.name, vendor: a.vendor,
      architecture: a.architecture, isFallbackAdapter: a.isFallbackAdapter, userAgent: navigator.userAgent };
  });
  assert.equal(hardware.backend, 'WebGPUBackend');
  assert.equal(hardware.vendor, 'amd');
  assert.equal(hardware.architecture, 'rdna-4');
  assert.equal(hardware.isFallbackAdapter, false);
  await page.evaluate(async () => {
    await window.__PUMP__(60);
    await window.__ENGINE__.ctx.get('render')._meterTask;
  });
  const cdp = await page.context().newCDPSession(page), bc = await browser.newBrowserCDPSession();
  if (args.cpu === '1') {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await cdp.send('Profiler.start');
  }
  if (args.trace === '1') await bc.send('Tracing.start', {
    categories: 'blink.user_timing,devtools.timeline,v8,renderer.scheduler,gpu,disabled-by-default-gpu.service,disabled-by-default-gpu.dawn',
    transferMode: 'ReturnAsStream',
  });
  const result = await page.evaluate(async ({ frames, controls, live, navMode, replay, inspect, normalAgents }) => {
    const e = window.__ENGINE__, r = e.ctx.get('render'), renderer = r.renderer;
    const backend = renderer.backend, queue = backend.device.queue;
    let control = 'stock', builds = 0, draws = 0, work = 0, writes = 0, bytes = 0, renderMs = 0;
    let activeObject = null, inspecting = false;
    const warmed = new WeakSet(), census = {};
    function entry() {
      const rt = renderer.getRenderTarget(), g = r._graph;
      const cascade = r.activeSun.shadow.shadowNode._shadowNodes.findIndex(n => n.shadowMap === rt);
      const name = rt === g.prePass.renderTarget ? 'prepass' : rt === g.worldPass.renderTarget ? 'world' :
        rt === g.viewPass.renderTarget ? 'weapon' : cascade >= 0 ? `CSM${cascade}` : 'post';
      return census[name] ??= { draws: 0, hasNode: 0, skinned: 0, nodeChecks: 0,
        bindingChecks: 0, uniformChecks: 0, renderUniformIDs: {}, lightUniformIDs: [] };
    }
    const isSceneObject = ro => ro && (ro.scene === e.ctx.scene || ro.scene === e.ctx.viewScene);
    const oldBuild = renderer.debug.onNodeBuilderCreated;
    renderer.debug.onNodeBuilderCreated = (...a) => { builds++; oldBuild?.(...a); };
    const bind = renderer._bindings.updateForRender, updateGroup = renderer._nodes.updateGroup;
    renderer._bindings.updateForRender = function (ro) {
      const previous = activeObject;
      activeObject = ro;
      try {
        // Never skip first use, fullscreen dependencies or ping-pong texture rebinding.
        if (control === 'no-bindings' && warmed.has(ro) && isSceneObject(ro)) return;
        bind.call(this, ro);
        warmed.add(ro);
      } finally { activeObject = previous; }
    };
    renderer._nodes.updateGroup = function (binding) {
      if (isSceneObject(activeObject)) {
        if (control === 'no-uniform-check' && binding.isUniformsGroup) return false;
        if (control === 'no-texture-check' && (binding.isSampledTexture || binding.isSampler)) return false;
      }
      const updated = updateGroup.call(this, binding);
      if (inspecting && activeObject) {
        const a = entry();
        a.bindingChecks++;
        if (updated) {
          a.uniformChecks += binding.uniforms?.length ?? 0;
          if (binding.groupNode?.name === 'render') for (const u of binding.uniforms ?? []) {
            const id = u.nodeUniform.node.id;
            a.renderUniformIDs[id] = (a.renderUniformIDs[id] ?? 0) + 1;
          }
        }
      }
      return updated;
    };
    const nodes = renderer._nodes.updateForRender;
    renderer._nodes.updateForRender = function (ro) {
      if (inspecting) {
        const a = entry(), state = ro.getNodeBuilderState();
        a.nodeChecks += state.updateNodes.length;
        for (const n of state.updateNodes) if (n.isAnalyticLightNode) {
          for (const v of [n.baseColorNode ?? n.colorNode, n.cutoffDistanceNode, n.decayExponentNode]) {
            if (v && !a.lightUniformIDs.includes(v.id)) a.lightUniformIDs.push(v.id);
          }
        }
      }
      if (control === 'no-nodes' && warmed.has(ro) && isSceneObject(ro)) return;
      return nodes.call(this, ro);
    };
    const draw = backend.draw, write = queue.writeBuffer, render = r.render;
    backend.draw = function (ro, info) {
      const p = ro.getDrawParameters();
      if (p) { draws++; work += p.vertexCount * p.instanceCount; }
      if (inspecting) {
        const a = entry();
        a.draws++; a.hasNode += Number(ro.getMonitor().hasNode); a.skinned += Number(!!ro.object.isSkinnedMesh);
      }
      if (control !== 'no-draw') return draw.call(this, ro, info);
    };
    queue.writeBuffer = function (target, offset, data, dataOffset = 0, size) {
      writes++;
      const elementBytes = data.BYTES_PER_ELEMENT ?? 1;
      bytes += size === undefined ? data.byteLength - dataOffset * elementBytes : size * elementBytes;
      if (control !== 'no-writes') return write.call(this, target, offset, data, dataOffset, size);
    };
    r.render = function (ctx) {
      if (control === 'no-render') return;
      const started = performance.now();
      try { return render.call(this, ctx); }
      finally { renderMs = performance.now() - started; }
    };
    if (live) {
      e.input.enabled = true; e.input.frozen = false;
      e.ctx.get('player').setControlEnabled(true);
      e.ctx.get('ai').debugStage('firefight');
      // Same deterministic starting positions, but allow normal decisions/motion.
      if (normalAgents) for (const agent of e.ctx.get('ai').agents) agent.staged = null;
    }
    const samples = [], navRecords = [];
    let navFrame = null, replayIndex = 0;
    if (navMode) {
      const ai = e.ctx.get('ai'), nav = ai.grid;
      const attach = nav.canAttach, move = nav._probe.move, invoke = e._invoke;
      e._invoke = function (sys, method, arg) {
        const started = performance.now();
        try { return invoke.call(this, sys, method, arg); }
        finally {
          if (navFrame) {
            const key = `${sys.constructor.id}.${method}`;
            navFrame.systems[key] = (navFrame.systems[key] ?? 0) + performance.now() - started;
          }
        }
      };
      nav._probe.move = function (...a) {
        if (navFrame) navFrame.moves++;
        return move.apply(this, a);
      };
      nav.canAttach = function (from, to, ...a) {
        const key = [from.x, from.y, from.z, to.x, to.y, to.z, ...a, this.physics.staticWorld.version];
        const started = performance.now(), before = this.stats.endpointChecks;
        let answer;
        if (replay) {
          const row = replay[replayIndex++];
          if (!row || JSON.stringify(key) !== JSON.stringify(row.key))
            throw new Error(`navigation replay input mismatch at ${replayIndex - 1}`);
          answer = row.answer;
          this.stats.endpointChecks += row.endpointChecks;
        } else answer = attach.call(this, from, to, ...a);
        if (navFrame) { navFrame.attachCalls++; navFrame.attachMs += performance.now() - started; }
        navRecords.push({ key, answer, endpointChecks: this.stats.endpointChecks - before });
        return answer;
      };
      for (const [owner, method] of [[nav, 'lineOfWalk'], [nav, 'findPath'], [ai.cover, 'pick']]) {
        const original = owner[method];
        owner[method] = function (...a) {
          const started = performance.now();
          try { return original.apply(this, a); }
          finally {
            if (navFrame) {
              const v = navFrame.calls[method] ??= { count: 0, ms: 0 };
              v.count++; v.ms += performance.now() - started;
            }
          }
        };
      }
    }
    const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
    for (let block = 0; block < controls.length; block++) {
      control = controls[block];
      renderer.setPixelRatio(control === 'half-res' ? .5 : 1);
      for (const n of r.activeSun.shadow.shadowNode._shadowNodes) {
        n.shadow.autoUpdate = control !== 'frozen-shadows'; n.shadow.needsUpdate = false;
      }
      const priorExposure = r.settings.autoExposure;
      r.settings.autoExposure = control !== 'no-meter';
      for (let i = 0; i < frames + 30; i++) {
        await tick();
        const at = performance.now();
        if (i === 30) performance.mark(`root-${block}-${control}-start`);
        navFrame = navMode ? { systems: {}, calls: {}, moves: 0, attachCalls: 0, attachMs: 0 } : null;
        draws = work = writes = bytes = renderMs = builds = 0;
        inspecting = inspect && block === 0 && i === 30;
        if (live) {
          e.input._rawLook.x -= .006 / e.config.sensitivity;
          e.input.down.add('KeyW');
          if (i % 90 < 30) e.input.down.add('Mouse0'); else e.input.down.delete('Mouse0');
          e.step();
        } else r.render(e.ctx);
        const wall = performance.now() - at;
        if (e.error) throw new Error(JSON.stringify(e.error));
        if (i >= 30) samples.push({ block, control, i, at, wall, renderMs, draws, work,
          writes, bytes, builds, nav: navFrame });
      }
      performance.mark(`root-${block}-${control}-end`);
      r.settings.autoExposure = priorExposure;
    }
    await queue.onSubmittedWorkDone();
    if (replay && replayIndex !== replay.length) throw new Error('navigation replay count mismatch');
    const ai = e.ctx.get('ai');
    const gameplay = { frame: e.time.frame, camera: e.camera.position.toArray(),
      rotation: e.camera.quaternion.toArray(), rng: [e.rng.s0, e.rng.s1, e.rng.s2, e.rng.s3],
      agents: ai.agents.map(a => ({ id: a.id, alive: a.alive, health: a.health, state: a.state,
        position: a.position.toArray(), target: a.moveTarget.toArray(), pathLen: a.pathLen,
        hasMoveTarget: a.hasMoveTarget, pathPending: a.pathPending })) };
    return { samples, census, navRecords, gameplay };
  }, { frames, controls, live: args.live !== '0', navMode: args.nav === '1' || !!replay,
    replay, inspect: args.census === '1', normalAgents: args.agents === 'normal' });
  if (args.cpu === '1') {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(out + '.cpuprofile', JSON.stringify(profile));
  }
  if (args.trace === '1') {
    const ended = new Promise(resolve => bc.once('Tracing.tracingComplete', resolve));
    await bc.send('Tracing.end');
    const { stream } = await ended;
    let text = '';
    for (;;) {
      const part = await bc.send('IO.read', { handle: stream, size: 1048576 });
      text += part.base64Encoded ? Buffer.from(part.data, 'base64').toString() : part.data;
      if (part.eof) break;
    }
    await bc.send('IO.close', { handle: stream });
    writeFileSync(out + '.trace.json', text);
  }
  const stats = values => {
    const sorted = values.slice().sort((a, b) => a - b), at = p => sorted[Math.floor(sorted.length * p)];
    return { mean: values.reduce((sum, v) => sum + v, 0) / values.length,
      p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) };
  };
  const blocks = controls.map((control, block) => {
    const rows = result.samples.filter(s => s.block === block), values = {};
    for (const key of ['wall', 'renderMs', 'draws', 'work', 'writes', 'bytes']) values[key] = stats(rows.map(s => s[key]));
    return { block, control, ...values,
      interval: stats(rows.slice(1).map((s, i) => s.at - rows[i].at)),
      builds: rows.reduce((sum, s) => sum + s.builds, 0) };
  });
  writeFileSync(out + '.json', JSON.stringify({ hardware, errors, frames, controls,
    scenario: { live: args.live !== '0', normalAgents: args.agents === 'normal',
      initialFrames: 60, settlingPerBlock: 30, replay: !!replay }, blocks, ...result }, null, 2));
  console.log(JSON.stringify({ hardware, errors, blocks }, null, 2));
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally {
  await browser.close();
  await stopViteServer(server);
}
