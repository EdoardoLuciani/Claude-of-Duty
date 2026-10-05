#!/usr/bin/env node
/** Strict-WebGPU PBR node material compile/render probe (no WebGL context). */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { join } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer } from '../lib/browser-harness.mjs';

const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync(cache) ?
  readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .map((name) => join(cache, name, 'chrome-linux64/chrome')).find(existsSync) : null);
if (!executablePath) throw new Error('Full Chromium required for material node probe');
const port = 5200;
const server = await ensureViteServer({ port, root: process.cwd() });
const browser = await launchChromium({ executablePath, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan',
    '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404 (Not Found)')) errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/tools/material-node/index.html${process.env.CAPTURE_DIR ? '?capture=1' : ''}`);
  await page.waitForFunction(() => window.__MATERIAL_NODE__ !== undefined, null,
    { timeout: 300000 }).catch(async (error) => {
    console.error('probe progress:', await page.evaluate(() => window.__WEAPON_PROGRESS__));
    console.error('browser errors:', errors);
    throw error;
  });
  const result = await page.evaluate(() => window.__MATERIAL_NODE__);
  assert.equal(result.ok, true, result.error ?? result.stack);
  assert.deepEqual(errors, []);
  assert.equal(result.states.length, 5);
  for (const state of result.states) {
    assert.equal(state.pixel.length, 4);
    assert.equal(state.pixel[3], 255);
    assert.ok(state.pixel.slice(0, 3).some((v) => v > 5), `${state.mode}/${state.type} rendered black`);
  }
  assert.equal(result.states[1].instancing, true);
  assert.deepEqual(result.states[2].pixel, result.states[3].pixel,
    'missing vertex mask must default to no wear/grime/AO');
  assert.equal(result.states[4].skinning, true);
  const expectedNormal = [0.5, 0, Math.cos(Math.PI / 6)];
  for (let i = 0; i < 3; i++)
    assert.ok(Math.abs(result.shaderValues.normal[i] - expectedNormal[i]) < 0.015,
      `planar flat normal ${i}: ${result.shaderValues.normal}, expected ${expectedNormal}`);
  assert.ok(Math.abs(result.shaderValues.roughness - 0.1) < 0.015,
    `roughness property must scale packed ORM: ${result.shaderValues.roughness}`);
  assert.ok(Math.abs(result.shaderValues.metalness - 0.12) < 0.015,
    `metalness property must scale packed ORM: ${result.shaderValues.metalness}`);
  assert.ok(result.shaderValues.sootMetalness > 0.02 &&
    result.shaderValues.sootMetalness < 0.121,
    `authored steel-soot metalness must respect its 0.12 multiplier: ${result.shaderValues.sootMetalness}`);
  assert.deepEqual(result.glbCases.map((x) => x.name),
    ['world', 'weapon', 'soldier', 'instanced']);
  for (const glb of result.glbCases) {
    const minimum = { world: 400, weapon: 60, soldier: 700, instanced: 100 }[glb.name];
    assert.ok(glb.vertices > (glb.instanced ? 100 : 1000) && glb.uv &&
      glb.color && glb.occupied > minimum,
      `${glb.name} failed GLB geometry/material probe: ${JSON.stringify(glb)}`);
  }
  assert.equal(result.glbCases[2].skinIndex, true);
  assert.equal(result.glbCases[3].instanced, true);
  assert.equal(result.soldierResult.slots, 9);
  assert.equal(result.soldierResult.mats, 9);
  assert.equal(result.soldierResult.loaded, 9);
  assert.equal(result.soldierResult.detail, 2);
  assert.ok(result.soldierResult.cache && result.soldierResult.pixel[0] > 10);
  assert.deepEqual(result.weaponResults.map((w) => w.parts), [21, 23, 16, 16, 17]);
  assert.ok(result.weaponResults.every((w) => w.occupied > 150));
  assert.equal(new Set(result.weaponResults.flatMap((w) => w.keys)).size, 16);
  assert.equal(result.libraryResult.names, 19);
  assert.equal(result.libraryResult.size, 256);
  assert.ok(result.libraryResult.reused && result.libraryResult.variant && result.libraryResult.shared);
  assert.ok(Math.abs(result.libraryResult.scale - 1 / 1.4) < 1e-6);
  assert.equal(result.libraryResult.groundY, -0.1);
  assert.ok(result.libraryResult.pixel[0] > 5, 'library node material rendered black');
  if (process.env.CAPTURE_DIR) {
    mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
    for (const [name, pixels] of Object.entries(result.captures)) {
      const png = new PNG({ width: 128, height: 128 });
      png.data = Buffer.from(pixels);
      writeFileSync(join(process.env.CAPTURE_DIR, `${name}.png`), PNG.sync.write(png));
    }
  }
  delete result.captures;
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  stopViteServer(server);
}
