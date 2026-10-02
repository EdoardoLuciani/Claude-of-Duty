#!/usr/bin/env node
/** Real health/armour/healing events and shared skinned materials, in WebGL. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs();
const port = Number(args.port ?? 5207), out = resolve(args.out ?? '/tmp/cod-arm-blood');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
async function pump(n) { await page.evaluate(n => window.__PUMP__(n), n); }
async function shot(name) {
  await page.evaluate(() => window.__PRESENT__());
  await page.screenshot({ path: `${out}/${name}.png` });
}
async function state() {
  return page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx, vm = ctx.get('weapons').viewmodel;
    const blood = vm.armAsset.blood, renderer = ctx.get('render').renderer;
    const armResources = [];
    for (const arm of [vm.armL, vm.armR]) arm.root.traverse(o => {
      if (o.isMesh) armResources.push([o.uuid, o.geometry.uuid, o.material.uuid]);
    });
    return { armResources, amount: blood.amount.value, health: ctx.get('player').health.value,
      bandages: ctx.get('player').bandages, healing: ctx.get('player').healCtrl.active,
      version: blood.texture.version, programs: renderer.info.programs.length,
      textures: renderer.info.memory.textures };
  });
}
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  await pump(90);
  assert.equal((await state()).amount, 0);
  await shot('full-health');
  assert(await page.evaluate(() => {
    const vm = window.__ENGINE__.ctx.get('weapons').viewmodel;
    return [vm.armL, vm.armR].every(arm => arm.skins.every(mesh => {
      const sleeve = mesh.material.name.startsWith('Olive_');
      return mesh.geometry.hasAttribute('armBloodPosition') === sleeve &&
        (!sleeve || mesh.material.customProgramCacheKey().includes('arm-blood-v2'));
    }));
  }), 'only sleeve/stitch meshes on both arms carry the mask; gloves stay untouched');
  await page.evaluate(() => {
    const hp = window.__ENGINE__.ctx.get('player').health;
    hp.armour = 50;
    hp.damage(20, null);
  });
  assert.equal((await state()).amount, 0, 'armour-only hit does not stain');
  await page.evaluate(() => {
    const hp = window.__ENGINE__.ctx.get('player').health;
    hp.armour = 0;
    hp.damage(70, null);
  });
  assert.equal((await state()).amount, .7, 'damage is visible immediately, before another frame');
  await pump(90);
  await shot('injured');
  const injured = await state();
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('player').setControlEnabled(true);
    ctx.input.enabled = true;
    ctx.input.frozen = false;
  });
  await pump(25);
  await page.keyboard.down('KeyH');
  await pump(75);
  assert((await state()).healing, 'bandage is in progress');
  assert.equal((await state()).amount, .7, 'starting/partial healing does not clean');
  await shot('bandaging');
  await page.keyboard.up('KeyH');
  await pump(3);
  assert.deepEqual([(await state()).amount, (await state()).bandages], [.7, 2], 'release leaves blood and inventory intact');
  await page.keyboard.down('KeyH');
  await pump(40);
  await page.evaluate(() => window.__ENGINE__.ctx.get('player').cancelHeal('test-interrupt'));
  await page.keyboard.up('KeyH');
  await pump(3);
  assert.equal((await state()).amount, .7, 'interruption does not clean');
  await page.keyboard.down('KeyH');
  await pump(190);
  await page.keyboard.up('KeyH');
  await pump(3);
  const healed = await state();
  assert.equal(healed.health, 80);
  assert.equal(healed.bandages, 1);
  assert(Math.abs(healed.amount - .2) < 1e-8, 'completed bandage removes the actual 50 restored HP');
  await shot('healed');
  await page.keyboard.down('KeyH');
  await pump(190);
  await page.keyboard.up('KeyH');
  await pump(3);
  assert.deepEqual([(await state()).health, (await state()).amount], [100, 0], 'capped 20 HP heal fully cleans');
  assert.equal((await state()).bandages, 0);
  await page.evaluate(() => {
    const player = window.__ENGINE__.ctx.get('player');
    player.health.damage(20, null);
    player.respawn(0);
  });
  assert.equal((await state()).amount, 0, 'living-player respawn clears stains');
  await page.evaluate(() => {
    const player = window.__ENGINE__.ctx.get('player');
    player.health.armour = 0;
    player.health.damage(100, null);
    player.respawn(0);
  });
  assert.equal((await state()).amount, 0, 'death/respawn clears stains');
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('player').health.damage(35, null);
    ctx.events.emit('game:restart', { source: 'test' });
  });
  assert.equal((await state()).amount, 0, 'restart clears stains');
  assert.equal((await state()).version, injured.version, 'health changes never upload the mask');
  await page.evaluate(() => window.__APPLY_SHOT__('weapon'));
  // Every weapon uses the same skinned pair, including the authored MCX/P320.
  for (const id of ['rifle', 'pistol', 'mcx', 'smg', 'shotgun', 'lmg', 'sniper']) {
    await page.evaluate(id => {
      const ctx = window.__ENGINE__.ctx, weapons = ctx.get('weapons');
      weapons.debugMode = 'idle';
      weapons.setWeaponImmediate(id);
      ctx.get('player').health.heal(100);
      ctx.get('player').health.armour = 0;
      ctx.get('player').health.damage(40, null);
    }, id);
    await pump(6);
    assert.equal((await state()).amount, .4, `${id} retains blood on shared arms`);
    await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').viewmodel.play('reloadTac'));
    await pump(30);
    assert.equal((await state()).amount, .4, `${id} reload does not change stains`);
    if (id === 'pistol') await shot('pistol-reload');
    await page.evaluate(() => {
      const w = window.__ENGINE__.ctx.get('weapons');
      w.viewmodel.stopClip();
      w.debugMode = 'ads';
      w.viewmodel.adsT = 1;
    });
    await pump(12);
    assert.equal((await state()).amount, .4, `${id} ADS does not change stains`);
    assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').viewmodel.adsT), 1,
      `${id} reaches the aimed pose`);
    if (id === 'mcx') await shot('mcx-ads');
  }
  // Prewarm must cover the one fixed shader, and healing adds no GPU resources.
  assert.equal(healed.programs, injured.programs, 'bandage/health changes do not compile shaders');
  assert(healed.textures <= injured.textures, 'no texture growth during healing (temporary engine textures may be released)');
  // Global GPU geometry counts can rise as the existing bandage first renders;
  // compare the actual arm-owned meshes/materials/geometries, not renderer uploads.
  assert.deepEqual(healed.armResources, injured.armResources, 'no overlays or replacement arm resources during healing');
  const teardown = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx, weapons = ctx.get('weapons');
    const blood = weapons.viewmodel.armAsset.blood;
    let disposals = 0;
    blood.texture.addEventListener('dispose', () => disposals++);
    weapons.dispose();
    ctx.get('player').health.heal(100); // Real health snapshot after listener removal.
    return { disposals, amount: blood.amount.value };
  });
  assert.deepEqual(teardown, { disposals: 1, amount: .4 }, 'owner disposes the mask once and unsubscribes from health');
  assert.deepEqual(errors, []);
  console.log(`Arm blood: armour, damage, partial/cancel/interrupted/complete/capped healing, respawn/restart, seven weapons and stable GPU resources passed; captures: ${out}`);
} finally {
  await browser.close(); stopViteServer(server);
}
