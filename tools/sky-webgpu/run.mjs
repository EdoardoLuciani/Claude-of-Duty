#!/usr/bin/env node
/**
 * Strict-WebGPU integration probe for the TSL sky subsystem.
 *
 * Runs the production `SkySystem` against the same strict device the game will
 * use, then reads back offscreen half-float targets to prove:
 *   - the time-of-day identity survives the port (day blue > night, golden warm)
 *   - the solar disc and the star field are present
 *   - the three atmosphere LUTs bake to physical values
 *   - the PMREM environment is installed and its source equirect is lit
 *   - the graph-injected fog node consumes a colour/depth pair
 *   - the velocity-driven temporal resolve blends toward history
 *
 * Requires a full Chromium with a real GPU adapter (not the Playwright headless
 * shell's SwiftShader). Set CHROMIUM_PATH to override discovery.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(cache) ?
  readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((name) => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null);
if (!executablePath) throw new Error('Full Chromium required for hardware WebGPU testing');

const port = 5199;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({
  executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'],
});

// The page already decodes half-float targets to numbers; this just normalises.
const half = (raw) => Array.from(raw);
const luma = (rgba) => 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];

try {
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/tools/sky-webgpu/index.html`);
  await page.waitForFunction(() => window.__SKY_WEBGPU__ !== undefined, null, { timeout: 120000 });
  const boot = await page.evaluate(() => ({ ok: window.__SKY_WEBGPU__.ok,
    error: window.__SKY_WEBGPU__.error, stack: window.__SKY_WEBGPU__.stack,
    backend: window.__SKY_WEBGPU__.backend }));
  assert.equal(boot.ok, true, `${boot.error}\n${boot.stack ?? ''}`);
  assert.equal(boot.backend, 'WebGPUBackend');

  const identity = await page.evaluate(() => window.__SKY_WEBGPU__.identity());
  const day = half(identity.day);
  const golden = half(identity.golden);
  const night = half(identity.night);
  assert.ok(luma(day) > 0.008, `day zenith too dark: ${day}`);
  assert.ok(day[2] > day[0], `day sky must be blue-dominant: ${day}`);
  assert.ok(luma(day) > luma(night) * 4, `night must be far below day: ${night} vs ${day}`);
  assert.ok(luma(night) < 0.02, `night zenith too bright: ${night}`);
  assert.ok(golden[0] >= golden[2], `golden zenith should not be blue-dominant: ${golden}`);

  const cloudFrame = await page.evaluate(() => window.__SKY_WEBGPU__.clouds());
  const cloudLumas = cloudFrame.samples.map((s) => luma(half(s)));
  const cloudSpread = Math.max(...cloudLumas) - Math.min(...cloudLumas);
  assert.ok(cloudSpread > 0.005,
    `clouds should vary across a day frame: ${JSON.stringify(cloudFrame.samples)}`);

  const sun = await page.evaluate(() => window.__SKY_WEBGPU__.sunDisc());
  const onSun = half(sun.onSun);
  const offSun = half(sun.offSun);
  assert.ok(luma(onSun) > luma(offSun) * 20 && luma(onSun) > 20,
    `solar disc missing: on ${onSun} off ${offSun}`);

  const stars = await page.evaluate(() => window.__SKY_WEBGPU__.stars());
  assert.ok(stars.withStars.max > stars.withoutStars.max * 1.3 &&
    stars.withStars.sum > stars.withoutStars.sum,
  `star/milky-way field missing: ${JSON.stringify(stars)}`);

  const lut = await page.evaluate(() => window.__SKY_WEBGPU__.lutProbe());
  const trans = half(lut.transmittance);
  assert.ok(trans[0] > 0 && trans[0] <= 1 && trans[1] > 0 && trans[1] <= 1,
    `transmittance out of range: ${trans}`);
  const sv = half(lut.skyView);
  assert.ok(luma(sv) > 1e-5, `sky-view LUT is black: ${sv}`);
  const amb = half(lut.ambient);
  assert.ok(luma(amb) > 1e-5, `ambient LUT is black: ${amb}`);

  const env = await page.evaluate(() => window.__SKY_WEBGPU__.envProbe());
  assert.equal(env.hasEnv, true, 'PMREM environment not installed');
  assert.notEqual(env.mapping, -1, 'environment has no cube mapping');
  const equirect = half(env.equirect);
  assert.ok(luma(equirect) > 0, `environment equirect is black: ${equirect}`);

  const fog = await page.evaluate(() => window.__SKY_WEBGPU__.fogProbe());
  const fogColor = half(fog.color);
  const fogged = half(fog.fogged);
  const fogDelta = Math.abs(luma(fogged) - luma(fogColor));
  assert.ok(fogDelta > 1e-4 && fogged.every((v) => Number.isFinite(v)),
    `fog node did not alter the colour: ${fogColor} -> ${fogged}`);

  const resolve = await page.evaluate(() => window.__SKY_WEBGPU__.resolveProbe());
  const cur = half(resolve.current);
  const resolved = half(resolve.resolved);
  assert.ok(resolved[0] > cur[0] + 0.01,
    `temporal resolve ignored history: ${cur} -> ${resolved}`);

  const cloud = await page.evaluate(() => window.__SKY_WEBGPU__.cloudShadow());
  assert.ok(cloud.values.every((v) => v >= 0 && v <= 1),
    `cloud occlusion out of range: ${cloud.values}`);
  assert.ok(cloud.values.some((v) => Math.abs(v - cloud.values[0]) > 0.02),
    `cloud occlusion field is uniform: ${cloud.values}`);

  const api = await page.evaluate(() => window.__SKY_WEBGPU__.api());
  assert.equal(api.envMap, true, 'sky did not publish an env map');
  assert.ok(['sky-sun', 'sky-moon'].includes(api.key), `key light: ${api.key}`);
  assert.ok(Number.isFinite(api.indirect) && Number.isFinite(api.exposureBias),
    `exposure/indirect not published: ${JSON.stringify(api)}`);

  await page.evaluate(() => window.__SKY_WEBGPU__.dispose());
  assert.equal(await page.evaluate(() => window.__SKY_WEBGPU__.disposed), true);
  if (errors.length) console.error('Sky WebGPU console:', errors);
  assert.deepEqual(errors, []);

  console.log(JSON.stringify({
    ok: true, backend: boot.backend,
    identity: { day, golden, night },
    sun: { onSun, offSun },
    stars,
    transmittance: trans,
    env: { hasEnv: env.hasEnv, mapping: env.mapping, equirect },
    fog: { color: fogColor, fogged },
    resolve: { current: cur, resolved },
    cloud: cloud.values,
    api,
  }, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
