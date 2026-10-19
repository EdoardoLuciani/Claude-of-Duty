#!/usr/bin/env node
// Public-API parity oracle: compare actual CSM/flashlight depth, not temporal RGB.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

const args = parseArgs(),
  port = Number(args.port ?? 5389);
assert(!args.negative || ['layers', 'transform'].includes(args.negative));
let server, browser;
try {
  server = await ensureViteServer({ port });
  browser = await launchChromium({
    headless: true,
    channel: 'chromium',
    args: ['--ignore-gpu-blocklist', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&q=high`);
  await waitForGame(page);
  await page.evaluate(() => {
    window.__SHADOW_READY_BUILDERS__ = window.__NATIVE_BUILDS__;
    window.__APPLY_SHOT__('combat');
  });
  await page.evaluate(() => window.__PUMP__(30));
  const result = await page.evaluate(async (negative) => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const engine = window.__ENGINE__,
      render = engine.ctx.get('render'),
      renderer = render.renderer;
    const ai = engine.ctx.get('ai'),
      player = engine.ctx.get('player'),
      sky = engine.ctx.get('sky');
    const actors = ai.agents;
    const firstUseBuilders = window.__SHADOW_READY_BUILDERS__;
    player.setFlashlightEnabled(true);
    await window.__PUMP__(2);
    if (window.__NATIVE_BUILDS__ !== firstUseBuilders)
      throw Error('first-use soldier/flashlight variants escaped prewarm');
    if (new Set(actors.map((a) => a.variantName)).size !== 3 || !actors.some((a) => a.ragdoll))
      throw Error('three actual soldier variants and an active ragdoll required');
    if (actors.some((a) => !a.shadowCaster))
      throw Error('application-owned shadow casters required');
    const probes = new Map(),
      rows = [];
    async function depths() {
      const csm = render.activeSun.shadow.shadowNode;
      const maps = csm.lights.map((light) => light.shadow.map);
      if (player.flashlightOn) maps.push(player.flashlight.shadow.map);
      const saved = renderer.getRenderTarget(),
        values = [];
      try {
        for (const map of maps) {
          if (!map?.depthTexture) throw Error('native shadow depth must exist');
          let probe = probes.get(map);
          if (!probe) {
            const material = new T.NodeMaterial();
            material.fragmentNode = N.vec4(
              N.textureLoad(map.depthTexture, N.ivec2(N.screenCoordinate.xy)).r,
              0,
              0,
              1
            );
            const target = new T.RenderTarget(map.width, map.height, { type: T.FloatType });
            probe = { material, target, quad: new T.QuadMesh(material) };
            probes.set(map, probe);
          }
          renderer.setRenderTarget(probe.target);
          probe.quad.render(renderer);
          const rgba = await renderer.readRenderTargetPixelsAsync(
            probe.target,
            0,
            0,
            map.width,
            map.height
          );
          const depth = new Float32Array(map.width * map.height);
          for (let i = 0; i < depth.length; i++) depth[i] = rgba[i * 4];
          values.push(depth);
        }
      } finally {
        renderer.setRenderTarget(saved);
      }
      return values;
    }
    try {
      for (const [index, time] of [9, 16.5, 23].entries()) {
        sky.setTimeOfDay(time);
        player.setFlashlightEnabled(index > 0);
        engine.ctx.camera.rotation.y += 0.03;
        await window.__PUMP__(15);
        const enabled = actors.map((a) => a.mesh.castShadow || a.shadowCaster.mesh.castShadow);
        let sourceDraws = 0,
          proxyDraws = 0,
          sourceSpotDraws = 0,
          proxySpotDraws = 0;
        const callbacks = actors.map((a) => a.mesh.onBeforeShadow);
        for (let i = 0; i < actors.length; i++) {
          actors[i].mesh.castShadow = enabled[i];
          actors[i].shadowCaster.mesh.visible = false;
          actors[i].mesh.onBeforeShadow = (_r, _object, camera) => {
            sourceDraws++;
            if (camera === player.flashlight.shadow.camera) sourceSpotDraws++;
          };
        }
        // Native shadow nodes update once per native frame/camera. Advance a
        // visible rAF boundary without advancing the lockstep simulation.
        await new Promise(requestAnimationFrame);
        player.flashlight.shadow.needsUpdate = player.flashlightOn;
        render.render(engine.ctx);
        const original = await depths();
        for (let i = 0; i < actors.length; i++) {
          const a = actors[i];
          a.mesh.onBeforeShadow = callbacks[i];
          a.shadowCaster.update(enabled[i]);
          a.shadowCaster.mesh.onBeforeShadow = (_r, _object, camera) => {
            proxyDraws++;
            if (camera === player.flashlight.shadow.camera) proxySpotDraws++;
          };
          if (negative === 'layers') a.shadowCaster.mesh.layers.set(0);
          if (negative === 'transform') a.shadowCaster.mesh.position.x = 0.3;
        }
        await new Promise(requestAnimationFrame);
        player.flashlight.shadow.needsUpdate = player.flashlightOn;
        render.render(engine.ctx);
        const combined = await depths();
        let changed = 0,
          covered = 0,
          samples = 0;
        for (let map = 0; map < original.length; map++) {
          if (original[map].length !== combined[map].length) throw Error('depth size changed');
          for (let i = 0; i < original[map].length; i++) {
            const a = original[map][i],
              b = combined[map][i];
            if (!Number.isFinite(a) || !Number.isFinite(b)) throw Error('invalid depth');
            if (a !== b) changed++;
            if (a < 1) covered++;
          }
          samples += original[map].length;
        }
        if (changed) throw Error(`shadow depth mismatch at ${time}: ${changed} samples`);
        if (!sourceDraws || !proxyDraws || sourceDraws <= proxyDraws || !covered)
          throw Error(`non-vacuous shadow reduction required: ${sourceDraws} -> ${proxyDraws}`);
        if (player.flashlightOn && (!sourceSpotDraws || !proxySpotDraws))
          throw Error('flashlight must reach a soldier in both modes');
        rows.push({
          time,
          flashlight: player.flashlightOn,
          maps: original.length,
          samples,
          covered,
          changed,
          sourceDraws,
          proxyDraws,
          sourceSpotDraws,
          proxySpotDraws,
        });
        for (const a of actors)
          a.shadowCaster.mesh.onBeforeShadow = T.Object3D.prototype.onBeforeShadow;
      }
      // Relevance must gate the real caster, not just the beauty mesh.
      for (const a of actors) {
        a.shadowCaster.update(false);
        if (a.mesh.castShadow || a.shadowCaster.mesh.visible) throw Error('relevance gate failed');
      }
      const adapter = renderer.backend.device.adapterInfo;
      return {
        hardware: {
          vendor: adapter.vendor,
          architecture: adapter.architecture,
          fallback: adapter.isFallbackAdapter,
        },
        rows,
      };
    } finally {
      for (const { target, material } of probes.values()) {
        target.dispose();
        material.dispose();
      }
    }
  }, args.negative ?? null);
  assert.deepEqual(errors, []);
  assert.equal(result.hardware.fallback, false, 'hardware WebGPU required');
  console.log(JSON.stringify(result, null, 2));
  if (args.out) writeFileSync(String(args.out), JSON.stringify(result, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
