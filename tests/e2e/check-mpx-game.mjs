#!/usr/bin/env node
// Actual game boot, HDR pass, shared arms, ammunition/events and interruptions.
// --reel records native clips; --optic-review compares temporary ADS framing.
import assert from 'node:assert/strict';
import { verifyNative, captureNative } from './native-render.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5214), out = resolve(args.out ?? '.tmp-rend/mpx/game');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const pump = n => page.evaluate(n => window.__PUMP__(n), n);
const query = fn => page.evaluate(fn);
async function capture(name) {
  await page.evaluate(() => window.__PRESENT__(2)); await captureNative(page, `${out}/${name}.png`);
}
async function opticPlacement() {
  return query(() => {
    const { ctx, w } = window.mpxReview, vm = w.viewmodel, camera = ctx.viewCamera;
    const p = camera.position.clone(); let nearestLens = Infinity, farthestLens = -Infinity;
    let minLensY = Infinity, maxLensY = -Infinity, minFrontY = Infinity, maxFrontY = -Infinity;
    vm.active.model.root.traverse(o => {
      if (!o.isMesh || !o.material.name.startsWith('11 |')) return;
      o.updateWorldMatrix(true, false);
      const positions = o.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        nearestLens = Math.min(nearestLens, -p.z); farthestLens = Math.max(farthestLens, -p.z);
        const front = -p.z > vm.active.def.eyeRelief;
        p.applyMatrix4(camera.projectionMatrix);
        if (front) { minFrontY = Math.min(minFrontY, p.y); maxFrontY = Math.max(maxFrontY, p.y); }
        minLensY = Math.min(minLensY, p.y); maxLensY = Math.max(maxLensY, p.y);
      }
    });
    vm.reticle.getWorldPosition(p).applyMatrix4(camera.matrixWorldInverse);
    const dotPixels = vm.dotCore.scale.x * ctx.get('render').screenSize.height / (-p.z * Math.tan(camera.fov * Math.PI / 360));
    const direction = p.clone();
    const wristAngle = arm => {
      direction.copy(arm.hand.position).sub(arm.forePivot.position).normalize();
      p.set(0, 0, -1).applyQuaternion(arm.hand.quaternion);
      return Math.acos(Math.max(-1, Math.min(1, p.dot(direction)))) * 180 / Math.PI;
    };
    return { adsT: vm.adsT, clip: vm.clipName, clipTime: vm.clipT, eyeRelief: vm.active.def.eyeRelief, nearestLens, farthestLens, nearPlane: camera.near, viewFov: camera.fov,
      rearLensHeightFraction: (maxLensY - minLensY) / 2, frontLensHeightFraction: (maxFrontY - minFrontY) / 2, worldFov: ctx.camera.fov,
      dotPixels, dotVisible: vm.reticle.visible, dotOnly: !vm.dotRing.visible && !vm.dotHalo.visible && !vm.dotRim.visible,
      rightWristAngle: wristAngle(vm.armR), leftWristAngle: wristAngle(vm.armL),
      rightWristError: vm.armR.hand.position.distanceTo(vm._handPos), leftWristError: vm.armL.hand.position.distanceTo(vm._handPosL) };
  });
}
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await verifyNative(page);
  await page.waitForFunction(() => window.__ENGINE__.ctx.get('weapons')._restDone, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__APPLY_SHOT__('weapon');
    const ctx = window.__ENGINE__.ctx, w = ctx.get('weapons');
    window.mpxReview = { ctx, w, shots: 0, shells: 0, drops: 0, reloads: [] };
    ctx.events.on('weapon:fire', e => { if (e.actor === 'player') window.mpxReview.shots++; });
    ctx.events.on('weapon:shell', () => window.mpxReview.shells++);
    ctx.events.on('weapon:reload', e => window.mpxReview.reloads.push({ phase: e.phase, retained: e.retained }));
    const drop = w._dropMagazine.bind(w);
    w._dropMagazine = () => { window.mpxReview.drops++; drop(); };
    ctx.get('player').setControlEnabled(true);
    if (!w.equipSecondary('smg')) throw new Error('MPX failed to equip');
  });
  await pump(60);
  assert.equal(await query(() => window.mpxReview.w.viewmodel.active.animation.constructor.name), 'MPXAnimation');
  assert.equal(await query(() => window.mpxReview.w.ammo.mag), 31, 'existing chamber/+1 semantics');
  await capture('hip');
  const hipPose = await opticPlacement();
  assert(hipPose.rightWristAngle < 60 && hipPose.leftWristAngle < 60, 'actual authored MPX meets the same hip wrist limits as other weapons');
  const aimPoses = [];
  await page.evaluate(() => { window.mpxReview.w.debugMode = 'ads'; });
  for (let i = 0; i < 60; i++) {
    await pump(1);
    const pose = await opticPlacement(); aimPoses.push(pose);
    assert(pose.rightWristAngle < 85 && pose.leftWristAngle < 85, 'ordinary aim transition stays within wrist limits');
    if (pose.dotVisible) assert(Math.abs(pose.dotPixels - 1.5) < .001, 'dot sizes against the same frame FOV during aim-in');
  }
  assert(await query(() => { const vm = window.mpxReview.w.viewmodel; return vm.reticle.visible && !vm.scopeOverlay.visible && vm.adsT > .99; }));
  assert(await query(() => { const { w } = window.mpxReview; const p = w.viewmodel.active.model.root.getObjectByName('SOCKET_sight').getWorldPosition(w._tmp); p.project(w.ctx.viewCamera); return Math.abs(p.x) < .01 && Math.abs(p.y) < .01; }), 'ADS socket projects onto crosshair');
  assert(await query(() => { const vm = window.mpxReview.w.viewmodel;
    return vm.dotCore.visible && !vm.dotRing.visible && !vm.dotHalo.visible && !vm.dotRim.visible;
  }), 'MPX uses the selected dot-only reticle, not the shared segmented ring');
  await capture('reflex-ads');
  const opticalPlacement = await opticPlacement();
  assert(opticalPlacement.nearestLens > opticalPlacement.nearPlane + .02, 'ADS eye/near plane stays behind both actual lens surfaces');
  assert(opticalPlacement.rightWristError < .002 && opticalPlacement.leftWristError < .002, 'ADS preserves actual shared-hand reach');
  assert(Math.abs(opticalPlacement.dotPixels - 1.5) < .001, '720p uses only the declared small dot readability floor');
  assert(opticalPlacement.rearLensHeightFraction > .4, 'close ADS must not regress to a small distant optic');
  assert(opticalPlacement.frontLensHeightFraction > .4, 'large usable front window, not only a large near opening');
  assert(opticalPlacement.rightWristAngle < 85 && opticalPlacement.leftWristAngle < 85, 'actual MPX ADS respects the shared wrist-angle limit');
  const cameraComparisons = [];
  if (args['optic-review']) {
    await page.evaluate(() => { window.mpxReview.adsDefinition = window.mpxReview.w.viewmodel.active.def; });
    // Match the projected rear collar size, rather than letting farther views
    // shrink the housing. 39.2mm is the staged rear collar's axial extent.
    for (const distance of [.11, .18, .22, .28]) {
      const viewFov = 2 * Math.atan(Math.tan(opticalPlacement.viewFov * Math.PI / 360) *
        (opticalPlacement.eyeRelief - .0392) / (distance - .0392)) * 180 / Math.PI / 60;
      await page.evaluate(([distance, viewFov]) => {
        const r = window.mpxReview; r.w.viewmodel.active.def = { ...r.adsDefinition, eyeRelief: distance, viewFov };
      }, [distance, viewFov]);
      await pump(60); await capture(`ads-matched-eye-${distance}`);
      const placement = await opticPlacement();
      assert(placement.nearestLens > placement.nearPlane + .02 && placement.rightWristError < .002 && placement.leftWristError < .002);
      cameraComparisons.push(placement);
    }
    await page.evaluate(() => { const r = window.mpxReview; r.w.viewmodel.active.def = r.adsDefinition; delete r.adsDefinition; });
    await pump(60);
    assert(Math.abs((await opticPlacement()).worldFov - opticalPlacement.worldFov) < .001, 'weapon framing must not zoom the world');
  }
  // Keep aiming through a real animated rifle -> MPX switch. The native free
  // hand path must compose with shared aim-in, not just reach its wrist target.
  assert(await query(() => window.mpxReview.w.setWeapon('rifle'))); await pump(90);
  assert(await query(() => window.mpxReview.w.setWeapon('smg')));
  const drawPoses = [];
  for (let i = 0; i < 80; i++) {
    await pump(1);
    if (!await query(() => window.mpxReview.w.activeId === 'smg' && window.mpxReview.w.viewmodel.clipName === 'draw')) continue;
    const pose = await opticPlacement(); drawPoses.push(pose);
    assert(pose.rightWristAngle < 85 && pose.leftWristAngle < 85, 'held-aim native draw preserves wrist limits');
    assert(pose.rightWristError < .002 && pose.leftWristError < .002, 'held-aim draw wrists retain reach');
    if (pose.dotVisible) assert(Math.abs(pose.dotPixels - 1.5) < .001, 'same-frame dot sizing during native draw plus aim');
    if (drawPoses.length === 6) await capture('held-aim-draw');
    if (drawPoses.length === 9) await capture('held-aim-draw-late');
    if (drawPoses.length === 18) await capture('held-aim-draw-approach');
    if (drawPoses.length === 25) await capture('held-aim-draw-grip');
  }
  assert(drawPoses.length > 20 && drawPoses.some(p => p.adsT > 0 && p.adsT < 1), 'held-aim regression must exercise native draw during aim-in');
  await page.evaluate(() => { window.mpxReview.w.debugMode = 'idle'; }); await pump(40);
  assert(await query(() => { const { w } = window.mpxReview; w.state.mag = 8; return w.reload(); }));
  await pump(25); await capture('tactical-remove');
  const pausedTime = await query(() => window.mpxReview.w.viewmodel.clipT);
  await page.evaluate(() => { window.mpxReview.ctx.time.scale = 0; }); await pump(8);
  assert.equal(await query(() => window.mpxReview.w.viewmodel.clipT), pausedTime, 'pause freezes reload');
  await page.evaluate(() => { window.mpxReview.ctx.time.scale = 1; });
  await pump(36); await capture('tactical-fresh');
  assert(await query(() => { const a = window.mpxReview.w.viewmodel.active.animation; return a.spare.visible && !a.magazine.visible; }));
  await pump(25); await capture('tactical-seat');
  await pump(28);
  assert.equal(await query(() => window.mpxReview.w.state.mag), 30);
  assert.equal(await query(() => window.mpxReview.drops), 0, 'retain partial magazine');
  assert(await query(() => window.mpxReview.reloads.filter(e => e.phase === 'magout').every(e => e.retained)));
  assert(await query(() => { const { w } = window.mpxReview; w.state.mag = 0; w.state.chambered = false; w.state.reserve = 100; return w.reload(); }));
  await pump(36); await capture('empty-remove');
  await pump(35); await capture('empty-fresh');
  assert.equal(await query(() => window.mpxReview.drops), 1, 'one physical empty magazine');
  assert(await query(() => {
    // Native boot prewarms every weapon's pool, not only the first dropped mag.
    const visible = window.mpxReview.w._magPools.get('smg').filter(p => p.group.visible);
    return visible.length === 1 && visible[0].group.children.length > 0;
  }), 'one visible MPX magazine, independent of pool creation order');
  await pump(56); await capture('empty-bolt-release');
  await pump(26);
  assert.equal(await query(() => window.mpxReview.w.ammo.mag), 30, 'empty reload chambers from a 30-round magazine');
  assert.equal(await query(() => window.mpxReview.w.state.reserve), 70);
  assert(await query(() => { const { w } = window.mpxReview; w.debugMode = null; return w.inspect(); }));
  await pump(40); await capture('inspect-left');
  assert(await query(() => window.mpxReview.w.tryFire()), 'firing interrupts inspection'); await pump(8);
  await page.evaluate(() => { window.mpxReview.w.debugMode = 'ads'; });
  const firingPoses = [];
  for (let i = 0; i < 8; i++) {
    assert(await query(() => window.mpxReview.w.tryFire()));
    for (let tick = 0; tick < 6; tick++) {
      await pump(1);
      const pose = await opticPlacement();
      assert(pose.rightWristAngle < 85 && pose.leftWristAngle < 85, 'ADS transition/firing respects existing wrist limits');
      assert(pose.rightWristError < .002 && pose.leftWristError < .002, 'ADS firing hands retain reach');
      firingPoses.push({ right: pose.rightWristAngle, left: pose.leftWristAngle });
    }
  }
  await capture('fire');
  assert(await query(() => { const vm = window.mpxReview.w.viewmodel;
    return vm.adsT > .99 && !vm.dotRing.visible && !vm.dotHalo.visible && !vm.dotRim.visible;
  }), 'ADS firing retains dot-only presentation without changing recoil');
  await page.evaluate(() => { window.mpxReview.w.debugMode = null; });
  assert.equal(await query(() => window.mpxReview.shots), 9); assert.equal(await query(() => window.mpxReview.shells), 9);
  await page.evaluate(() => { const { w } = window.mpxReview; w.state.mag = 0; w.state.chambered = true; }); await pump(8);
  assert(await query(() => window.mpxReview.w.tryFire())); await pump(8); await capture('last-shot');
  assert(await query(() => { const a = window.mpxReview.w.viewmodel.active.animation; return Math.abs(a.bolt.position.z - .038) < .00001; }));
  await page.evaluate(() => { const { w } = window.mpxReview; w.setWeaponImmediate('rifle'); w.setWeaponImmediate('smg'); }); await pump(15);
  assert(await query(() => Math.abs(window.mpxReview.w.viewmodel.active.animation.bolt.position.z - .038) < .00001), 'switch preserves empty lockback');
  assert(await query(() => window.mpxReview.w.reload())); await pump(35);
  const reserve = await query(() => window.mpxReview.w.state.reserve);
  await page.evaluate(() => { window.mpxReview.w.setWeaponImmediate('rifle'); window.mpxReview.w.setWeaponImmediate('smg'); }); await pump(20);
  assert.equal(await query(() => window.mpxReview.w.state.reserve), reserve, 'cancel before insertion consumes no ammunition');
  assert(await query(() => { const a = window.mpxReview.w.viewmodel.active.animation; return a.magazine.visible && !a.spare.visible && a.root.position.length() < .00001; }));
  assert(await query(() => window.mpxReview.w.reload())); await pump(120);
  const committed = await query(() => ({ mag: window.mpxReview.w.ammo.mag, reserve: window.mpxReview.w.state.reserve }));
  await page.evaluate(() => { window.mpxReview.w._onPlayerDeath(); }); await pump(8);
  assert.deepEqual(await query(() => ({ mag: window.mpxReview.w.ammo.mag, reserve: window.mpxReview.w.state.reserve })), committed, 'cancel after insertion retains exactly one committed reload');
  assert(await query(() => { const a = window.mpxReview.w.viewmodel.active.animation; return a.magazine.visible && !a.spare.visible; }));
  await page.evaluate(() => { const { w } = window.mpxReview; w.resetForNewGame(); w.equipSecondary('smg'); }); await pump(60);
  assert.equal(await query(() => window.mpxReview.w.ammo.mag), 31);
  assert.equal(await query(() => window.mpxReview.w.state.reserve), 224);
  assert(await query(() => window.mpxReview.w.setWeapon('rifle')));
  assert.equal(await query(() => window.mpxReview.w.viewmodel.clipName), 'holster');
  await pump(21); assert.equal(await query(() => window.mpxReview.w.activeId), 'rifle');
  await pump(40);
  assert(await query(() => window.mpxReview.w.setWeapon('smg')));
  await pump(25);
  assert.equal(await query(() => window.mpxReview.w.activeId), 'smg');
  assert.equal(await query(() => window.mpxReview.w.viewmodel.active.animation.name), 'Draw');
  await capture('draw'); await pump(32);
  assert.equal(await query(() => window.mpxReview.w.viewmodel.clipName), null);
  const counts = await query(() => ({ shots: window.mpxReview.shots, shells: window.mpxReview.shells, drops: window.mpxReview.drops }));
  assert.deepEqual(counts, { shots: 10, shells: 10, drops: 2 }, 'one live casing per shot and one drop per committed empty reload');
  if (args.reel) {
    const frames = `${out}/reel-frames`; mkdirSync(frames, { recursive: true });
    const segments = []; let index = 0;
    for (const [name, n] of [['Idle', 30], ['Fire', 30], ['Last_Shot', 18], ['Reload_Empty', 78], ['Reload_Tactical', 58], ['Inspect', 90], ['Holster', 12], ['Draw', 18]]) {
      await page.evaluate(name => {
        const { w } = window.mpxReview; w.viewmodel.stopClip(); w.debugMode = null;
        w.state.mag = name === 'Last_Shot' ? 0 : name === 'Reload_Empty' ? 0 : name === 'Fire' ? 30 : 8;
        w.state.chambered = name !== 'Reload_Empty'; w.state.reserve = 224;
        w._fireTimer = 0;
        if (name.startsWith('Reload')) w.reload();
        else if (name === 'Inspect') w.inspect();
        else if (name === 'Holster') w.setWeapon('rifle');
        else if (name === 'Draw') { w.setWeaponImmediate('smg'); w.viewmodel.play('draw'); }
      }, name);
      segments.push({ name, firstFrame: index, frames: n });
      for (let f = 0; f < n; f++) {
        if (name === 'Fire' || (name === 'Last_Shot' && f === 0)) await query(() => window.mpxReview.w.tryFire());
        await pump(2);
        await captureNative(page, `${frames}/${String(index++).padStart(4, '0')}.png`);
      }
    }
    writeFileSync(`${out}/reel-segments.json`, JSON.stringify(segments, null, 2));
    const labels = segments.map(s => `drawtext=font='DejaVu Sans':text='MPX - ${s.name.replaceAll('_', ' ')}':x=20:y=150:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8:enable='between(n,${s.firstFrame},${s.firstFrame + s.frames - 1})'`).join(',');
    const result = spawnSync('ffmpeg', ['-y', '-framerate', '30', '-i', `${frames}/%04d.png`, '-vf', labels, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', `${out}/mpx-gameplay.mp4`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(errors, []);
  const finalCounts = await query(() => ({ shots: window.mpxReview.shots, shells: window.mpxReview.shells, drops: window.mpxReview.drops }));
  assert.equal(finalCounts.shots, finalCounts.shells, 'capture playback also emits one live casing per shot');
  const report = { ok: true, hipPose, aimPoses, drawPoses, opticalPlacement, cameraComparisons, firingPoses, ...counts, playbackCounts: args.reel ? finalCounts : null, render: await query(() => window.__RENDER_INFO__), errors };
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); stopViteServer(server); }
