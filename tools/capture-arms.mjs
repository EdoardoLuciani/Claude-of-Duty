#!/usr/bin/env node
// In-engine visual matrix. Uses the real weapon models, clips, lights and arm
// skins; gameplay is paused while each deterministic viewmodel pose is sampled.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs();
const port = Number(args.port ?? 5187);
const out = resolve(args.out ?? '/tmp/player-arms-review');
mkdirSync(out, {recursive:true});
const server = await ensureViteServer({port});
const browser = await launchChromium({headless:true, args:['--ignore-gpu-blocklist','--hide-scrollbars','--force-color-profile=srgb']});
const page = await browser.newPage({viewport:{width:1280,height:720}});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true', null, {timeout:120000});
  await page.evaluate(async () => {
    window.__APPLY_SHOT__('weapon');
    await window.__PUMP__(45);
    const w = window.__ENGINE__.ctx.get('weapons');
    // Only the visual matrix is under test here. Ordinary smoke tests still
    // exercise the weapon system's event handling and gameplay timings.
    w.update = () => {};
    w.fixedUpdate = () => {};
    w.lateUpdate = () => {};
    w.viewmodel.onClipEvent = () => {};
  });
  const reports = [];
  const weaponIds = await page.evaluate(() => [...window.__ENGINE__.ctx.get('weapons').states.keys()]);
  for (const weapon of args.weapon ? [args.weapon] : weaponIds) {
    const actions = args.action ? [args.action] : ['idle','ads','walk','sprint','crouch','airborne','land','fire','reloadTac','reloadEmpty','inspect','draw','holster','grenade','throwLong','throwShort','radio'];
    if (!args.action && await page.evaluate(id => !!window.__ENGINE__.ctx.get('weapons').viewmodel.weapons.get(id).clips.cycle, weapon)) actions.push('cycle');
    for (const action of actions) {
      const samples = action === 'cycle' ? [.04,.08,.12,.16,.5,.72,.76,.80,.84,.88]
        : ['reloadTac','reloadEmpty','inspect'].includes(action) ? [.25,.55,.85] : [.5];
      for (const fraction of samples) {
        const report = await page.evaluate(({weapon,action,fraction}) => {
          const w = window.__ENGINE__.ctx.get('weapons');
          const vm = w.viewmodel;
          w.setWeaponImmediate(weapon);
          vm.stopClip();
          vm.endGrenade();
          vm.endRadio();
          vm.debugFrozen = false;
          vm.adsT = vm.sprintT = 0;
          const state = {ads:0,sprint:0,lowReady:false,speed:0,crouch:false,airborne:false,trigger:0,empty:false};
          for (let i = 0; i < 45; i++) vm.update(1/60,state);
          if (action === 'ads') state.ads = 1;
          if (action === 'sprint') { state.sprint = 1; state.speed = 5; }
          if (action === 'walk') state.speed = 2;
          if (action === 'crouch') state.crouch = true;
          if (action === 'airborne') { state.airborne = true; vm.jump(); }
          if (action === 'land') vm.land(5);
          if (action === 'fire') { state.trigger = 1; vm.addRecoil(.018,.003); }
          let duration = 1;
          if (vm.active.clips[action]) duration = vm.play(action);
          if (action === 'grenade') vm.holdGrenade();
          if (action === 'throwLong' || action === 'throwShort') {
            vm.holdGrenade();
            vm.throwGrenade(action === 'throwLong' ? 'long' : 'short');
            duration = vm._throwDuration;
          }
          if (action === 'radio') vm.holdRadio();
          const frames = Math.max(1,Math.round(duration*fraction*60));
          let checked = 0;
          for (let frame = 0; frame < frames; frame++) {
            vm.update(1/60,state);
            vm.anchor.updateMatrixWorld(true);
            for (const arm of [vm.armL,vm.armR]) {
              for (const mesh of arm.skins) {
                mesh.skeleton.update();
                if (!mesh.skeleton.boneMatrices.every(Number.isFinite)) throw new Error(`${weapon}/${action}: non-finite skin`);
                checked++;
              }
            }
          }
          return {weapon,action,fraction,frames,checked,poses:[vm.armL.pose,vm.armR.pose],skins:vm.armL.skins.length+vm.armR.skins.length};
        },{weapon,action,fraction});
        await page.evaluate(async () => { await window.__PUMP__(2); await window.__PRESENT__(); });
        const name = `${weapon}-${action}-${Math.round(fraction*100)}`;
        await page.screenshot({path:`${out}/${name}.png`});
        assert.equal(report.skins,10);
        reports.push(report);
      }
    }
  }
  const bitmaps = await page.evaluate(() => {
    const vm = window.__ENGINE__.ctx.get('weapons').viewmodel;
    const images = new Map();
    const textures = new Set();
    for (const mesh of vm.armAsset.meshes) {
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
      }
    }
    for (const texture of textures) {
      const image = texture.source.data;
      if (!(image instanceof ImageBitmap) || images.has(image)) continue;
      images.set(image,0);
      const close = image.close.bind(image);
      image.close = () => { images.set(image,images.get(image)+1); close(); };
    }
    if (!images.size) throw new Error('No decoded arm bitmaps tested');
    vm.dispose();
    vm.armAsset.dispose(); // Repeated asset cleanup must not close sources twice.
    for (const [image,count] of images) {
      if (count !== 1 || image.width !== 0 || image.height !== 0) {
        throw new Error(`Arm bitmap not closed exactly once: ${count}, ${image.width}x${image.height}`);
      }
    }
    return images.size;
  });
  console.log(`Disposal verified: ${bitmaps} unique arm ImageBitmaps closed exactly once`);
  assert.deepEqual(errors,[]);
  writeFileSync(`${out}/report.json`,JSON.stringify(reports,null,2)+'\n');
  console.log(`${reports.length} in-engine arm/animation captures: ${out}`);
} finally {
  await browser.close();
  stopViteServer(server);
}
