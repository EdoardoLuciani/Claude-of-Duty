#!/usr/bin/env node
/** Real weapon clips + live game audio; --root/--before also capture the unchanged baseline. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs();
const root = resolve(args.root ?? fileURLToPath(new URL('../../', import.meta.url)));
const out = args.out ? resolve(args.out) : null;
assert(!out || !out.startsWith(root), 'Keep evidence outside the repository');
if (out) mkdirSync(out, { recursive: true });
const port = Number(args.port ?? 5537);
const server = await ensureViteServer({ root, port });
assert(server, 'Refusing an occupied server port');
const errors = [],
  results = [];
let browser;
try {
  browser = await launchChromium({
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await waitForGame(page, { timeout: 180000 });
  console.log('Game ready; initializing audio capture');
  await page.evaluate(async () => {
    window.__APPLY_SHOT__('weapon');
    const engine = window.__ENGINE__,
      ctx = engine.ctx,
      w = ctx.get('weapons'),
      audio = ctx.get('audio');
    await w._restTask;
    engine.setGameplaySuspended(true);
    if (!(await audio.start())) throw Error('Game audio startup failed');
    audio.ambience.dispose();
    audio.update(0, ctx);
    const dest = audio.actx.createMediaStreamDestination();
    audio.mixer.masterGain.connect(dest);
    // Direct WebGPU swapchain capture is black on headless Vulkan. Read the
    // native final graph into a 2D capture canvas, as captureNative() does.
    const { packedReadback } = await import('/tools/lib/native-readback.js');
    const r = ctx.get('render'),
      width = r.screenSize.width,
      height = r.screenSize.height;
    const target = new r.viewRt.constructor(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const drawing = canvas.getContext('2d');
    window.reloadFrame = async (label) => {
      const previous = r.renderer.getRenderTarget();
      const face = r.renderer.getActiveCubeFace(),
        mip = r.renderer.getActiveMipmapLevel();
      let pixels;
      try {
        r.renderer.setRenderTarget(target);
        r._graph.render();
        pixels = await r.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
      } finally {
        r.renderer.setRenderTarget(previous, face, mip);
      }
      const packed = new Uint8ClampedArray(packedReadback(pixels, width, height));
      if (!packed.some((x, i) => i % 4 !== 3 && x > 0)) throw Error('Blank native capture');
      drawing.putImageData(new ImageData(packed, width, height), 0, 0);
      drawing.fillStyle = '#000a';
      drawing.fillRect(0, 0, width, 42);
      drawing.fillStyle = '#fff';
      drawing.font = '24px sans-serif';
      drawing.fillText(label, 16, 30);
    };
    window.reloadStream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    window.reloadCaptureDispose = () => {
      target.dispose();
      window.reloadStream.getTracks().forEach((t) => t.stop());
      audio.mixer.masterGain.disconnect(dest);
    };
    window.reloadTrace = [];
    ctx.events.on('weapon:reload', (p) =>
      window.reloadTrace.push({
        phase: p.phase,
        clipTime: w.viewmodel.clipT,
        audioTime: audio.actx.currentTime,
      })
    );
    ctx.events.on('weapon:shell', () =>
      window.reloadTrace.push({ phase: 'casing', clipTime: w.viewmodel.clipT })
    );
    window.reloadRecorded = [];
    if (audio.samples.reload) {
      const original = audio.samples.reload.bind(audio.samples);
      audio.samples.reload = (...options) => {
        const voice = original(...options);
        if (voice) window.reloadRecorded.push({ weapon: options[0], phase: options[1] });
        return voice;
      };
    }
  });
  console.log('Audio capture initialized');
  const cases = [
    ...['rifle', 'mcx', 'pistol', 'smg', 'sniper', 'shotgun', 'lmg'].flatMap((id) => [
      [id, 'tactical'],
      [id, 'empty'],
    ]),
    ['shotgun', 'fire'],
    ['sniper', 'fire'],
    ['rifle', 'cancel'],
    ['rifle', 'combat'],
  ];
  for (const [id, mode] of cases) {
    const row = await page.evaluate(
      async ({ id, mode, capture, before }) => {
        const engine = window.__ENGINE__,
          ctx = engine.ctx,
          w = ctx.get('weapons'),
          audio = ctx.get('audio');
        w.owned.add(id);
        w.setWeaponImmediate(id);
        w.viewmodel.stopClip();
        w._tubeLoop = false;
        w._fireTimer = 0;
        Object.assign(w.state, {
          mag: mode === 'empty' ? 0 : 2,
          chambered: mode !== 'empty',
          reserve: id === 'shotgun' ? 1 : 200,
        });
        Object.assign(w._state, {
          empty: mode === 'empty',
          magazineLoaded: mode !== 'empty',
          remainingRounds: mode === 'empty' ? 0 : 3,
        });
        // Match gunfire variants across baseline/new captures despite different
        // RNG use by synthesized versus recorded reloads in earlier cases.
        audio.rng = new audio.rng.constructor(337);
        for (const kind of Object.keys(audio.samples.indices)) audio.samples.indices[kind] = 0;
        window.reloadTrace.length = window.reloadRecorded.length = 0;
        const chunks = [];
        let recorder;
        if (capture) {
          recorder = new MediaRecorder(window.reloadStream, {
            mimeType: 'video/webm;codecs=vp9,opus',
            videoBitsPerSecond: 1500000,
          });
          recorder.ondataavailable = (e) => chunks.push(e.data);
          // A video recorder needs a newly rendered frame before it can start.
          recorder.start();
        }
        let fired = false,
          cancelled = false,
          nextEnemy = 0.1,
          worstFrame = 0;
        const duration =
          mode === 'fire'
            ? 2
            : (mode === 'empty' ? w.state.def.reloadEmpty : w.state.def.reloadTac) + 1;
        const start = performance.now();
        let last = start;
        while ((performance.now() - start) / 1000 < duration) {
          const now = performance.now(),
            elapsed = (now - start) / 1000;
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          worstFrame = Math.max(worstFrame, dt);
          if (!fired && elapsed >= 0.25) {
            fired = true;
            if (!(mode === 'fire' ? w.tryFire() : w.reload()))
              throw Error(`${id}/${mode}: action refused`);
          }
          if (mode === 'cancel' && !cancelled && elapsed > 0.9) {
            w.viewmodel.stopClip();
            cancelled = true;
          }
          if (mode === 'combat' && elapsed >= nextEnemy) {
            nextEnemy += 0.16;
            const origin = ctx.camera.position.clone();
            origin.x += 8;
            origin.z -= 4;
            ctx.events.emit('weapon:fire', {
              actor: 'enemy',
              weapon: 'rifle',
              origin,
              dir: origin.clone().sub(ctx.camera.position).normalize(),
              seed: 337,
              firstPerson: false,
            });
          }
          ctx.time.elapsed += dt;
          // Advance normal pose/ammo state and transient FX as well as the clip;
          // suspending unrelated gameplay must not freeze lockback or muzzle flash.
          w.update(dt, ctx);
          const fx = ctx.get('fx');
          fx.update(dt, ctx);
          w.lateUpdate(dt, ctx);
          fx.lateUpdate(dt, ctx);
          audio.update(dt, ctx);
          await window.__PUMP__(1);
          if (capture) await window.reloadFrame(`${id} / ${mode} — ${before ? 'BEFORE' : 'AFTER'}`);
        }
        let data;
        if (recorder) {
          await new Promise((ready) => {
            recorder.onstop = ready;
            recorder.stop();
          });
          const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          data = btoa(binary);
        }
        return {
          id,
          mode,
          trace: window.reloadTrace.slice(),
          recorded: window.reloadRecorded.slice(),
          report: audio.report(),
          worstFrame,
          error: engine.error,
          data,
        };
      },
      { id, mode, capture: !!out, before: !!args.before }
    );
    assert.equal(row.error, null);
    assert.equal(row.report.errors, 0);
    if (!args.before) {
      assert.equal(
        row.recorded.length,
        row.trace.filter((e) => e.phase !== 'casing').length,
        `${id}/${mode}: every handling cue uses a recording, including hand settle`
      );
      if (mode === 'fire')
        assert.deepEqual(
          row.trace.filter((e) => e.phase !== 'casing').map((e) => e.phase),
          id === 'shotgun' ? ['pump'] : ['boltopen', 'boltclose']
        );
      else if (mode === 'cancel')
        assert(!row.trace.some((e) => ['magin', 'charge', 'boltclose', 'end'].includes(e.phase)));
      else
        assert(
          row.recorded.length >= (mode === 'empty' ? 3 : 2),
          `${id}/${mode}: real recorded routing`
        );
    }
    if (mode === 'fire') assert.equal(row.trace.filter((e) => e.phase === 'casing').length, 1);
    if (out) writeFileSync(resolve(out, `${id}-${mode}.webm`), Buffer.from(row.data, 'base64'));
    delete row.data;
    results.push(row);
    console.log(
      `${id}/${mode}: ${row.trace.map((e) => e.phase).join(', ')}; ${row.recorded.length} recorded cues`
    );
  }
  await page.evaluate(() => window.reloadCaptureDispose());
  assert.deepEqual(errors, []);
  if (out) writeFileSync(resolve(out, 'report.json'), JSON.stringify(results, null, 2) + '\n');
} finally {
  await browser?.close();
  stopViteServer(server);
}
