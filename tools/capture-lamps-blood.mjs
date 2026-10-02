#!/usr/bin/env node
/** Matched in-engine close-ups for curved prop joints and injured sleeves. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5218);
const out = resolve(args.out ?? 'shots/lamps-blood');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  for (const shot of args.shot ? args.shot.split(',') : ['lamp', 'palm', 'drainpipe', 'cable', 'sleeves', 'clean', 'bandage']) {
    await page.evaluate(async shot => {
      window.__APPLY_SHOT__('weapon');
      const engine = window.__ENGINE__;
      const { ctx } = engine;
      const world = ctx.get('world');
      const player = ctx.get('player');
      const weapons = ctx.get('weapons');
      const vm = weapons.viewmodel;
      document.getElementById('ui').style.display = 'none';
      const poses = {
        lamp: { from: [-4.5, 4.9, 15.2], to: [-5.45, 5.53, 12.2], fov: 38 },
        palm: { from: [-3.0, 3.0, 20.5], to: [-5.4, 3.0, 20.0], fov: 65 },
        drainpipe: { from: [-5.3, .6, 18.4], to: [-6.58, .25, 19.135195728], fov: 38 },
        cable: { from: [-4.8, 7.15, 11.8], to: [-6.4, 7.18, 10.05], fov: 40 },
        cableSetback: { from: [-4.3, 7.4, 13], to: [-7.6, 7.15, 10.1], fov: 60 },
        cableHigh: { from: [-4.1, 8.1, 1.7], to: [-7.8, 7.5, -2], fov: 60 },
        cableTerrace: { from: [-3.0, 6.0, 23], to: [-7.7, 5.3, 21.9], fov: 65 },
      };
      const pose = poses[shot];
      engine.viewScene.visible = !pose;
      if (pose) {
        engine.camera.position.copy(world.levelToWorld(...pose.from));
        engine.camera.lookAt(world.levelToWorld(...pose.to));
        engine.camera.fov = pose.fov;
        engine.camera.updateProjectionMatrix();
        player.teleport(engine.camera.position, engine.camera.rotation);
      }
      player.health.reset(true);
      player.health.armour = 0;
      if (shot === 'sleeves' || shot === 'bandage') player.health.damage(70, null);
      await window.__PUMP__(45);
      if (shot === 'bandage') {
        weapons.update = () => {};
        weapons.fixedUpdate = () => {};
        weapons.lateUpdate = () => {};
        vm.debugFrozen = false;
        vm.holdBandage();
        vm.setBandageProgress(.24);
        const state = { ads: 0, sprint: 0, lowReady: false, speed: 0, crouch: false, airborne: false, trigger: 0, empty: false };
        for (let i = 0; i < 30; i++) vm.update(1 / 60, state);
      }
      if (shot === 'clean') vm.endBandage();
      await window.__PUMP__(30);
      await window.__PRESENT__();
    }, shot);
    await page.screenshot({ path: resolve(out, `${shot}.png`) });
    console.log(`${shot}: ${out}`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  stopViteServer(server);
}
