/** One live native-game regression; asset geometry/contact matrices stay in smoke tests. */
import assert from 'node:assert/strict';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { installDevicePolicy, waitForGame } from '../../tools/lib/native-render.mjs';

const port = Number(process.env.PORT ?? 5553);
const server = await ensureViteServer({ port });
assert(server, 'Refusing an unverified server on an occupied port');
let browser;
try {
  browser = await launchChromium({ headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  collectBrowserErrors(page, errors);
  // Match the retired weapon checks: fail GPU validation warnings, not all TSL notices.
  page.on('console', (message) => {
    if (
      message.type() === 'warning' &&
      /GPUValidationError|validation error|Error while parsing WGSL/i.test(message.text())
    )
      errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await installDevicePolicy(page);
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await waitForGame(page, { timeout: 180000 });
  const rows = await page.evaluate(async () => {
    const ctx = window.__ENGINE__.ctx,
      w = ctx.get('weapons'),
      player = ctx.get('player');
    await w._restTask;
    window.__APPLY_SHOT__('weapon');
    player.setControlEnabled(true);
    let shots = 0,
      shells = 0;
    ctx.events.on('weapon:fire', () => shots++);
    ctx.events.on('weapon:shell', () => shells++);
    const pump = (frames) => window.__PUMP__(frames);
    const check = (condition, message) => {
      if (!condition) throw Error(`${w.activeId}: ${message}`);
    };
    const beltCount = () =>
      w.viewmodel.active.animation.bones.filter((b) => b.scale.x > 0.5).length;
    const checkMpxPose = () => {
      const vm = w.viewmodel,
        direction = vm.armR.hand.position.clone(),
        axis = direction.clone();
      for (const [arm, target] of [
        [vm.armR, vm._handPos],
        [vm.armL, vm._handPosL],
      ]) {
        direction.copy(arm.hand.position).sub(arm.forePivot.position).normalize();
        axis.set(0, 0, -1).applyQuaternion(arm.hand.quaternion);
        check(
          Math.acos(Math.max(-1, Math.min(1, axis.dot(direction)))) < (85 * Math.PI) / 180,
          'native aim/draw/fire wrist angle'
        );
        check(arm.hand.position.distanceTo(target) < 0.002, 'native hand reach');
      }
      if (vm.reticle.visible) {
        vm.reticle.getWorldPosition(direction).applyMatrix4(ctx.viewCamera.matrixWorldInverse);
        const pixels =
          (vm.dotCore.scale.x * ctx.get('render').screenSize.height) /
          (-direction.z * Math.tan((ctx.viewCamera.fov * Math.PI) / 360));
        check(Math.abs(pixels - 6) < 0.001, 'same-frame dot footprint');
      }
    };
    const rows = [];
    for (const [id, animation, slot] of [
      ['rifle', 'M4Animation', 'primary'],
      ['mcx', 'MCXAnimation', 'primary'],
      ['pistol', 'P320Animation', 'secondary'],
      ['smg', 'MPXAnimation', 'secondary'],
      ['lmg', 'EvolysAnimation', 'primary'],
      ['sniper', 'AX338Animation', 'primary'],
      ['shotgun', 'M590Animation', 'secondary'],
    ]) {
      w.resetForNewGame();
      if (!w.owns(id))
        check(slot === 'primary' ? w.equipPrimary(id) : w.equipSecondary(id), 'equip');
      check(w.setWeaponImmediate(id), 'authored model available');
      w.debugMode = 'idle';
      await pump(40);
      const cap = w.current.magSize;
      check(w.viewmodel.active.animation.constructor.name === animation, 'native adapter');
      check(w.ammo.mag === cap + 1, 'fresh chamber plus magazine');
      if (id === 'lmg') check(beltCount() === 8, 'initial belt');
      w.debugMode = 'ads';
      for (let frame = 0; frame < 60; frame++) {
        await pump(1);
        if (id === 'smg') checkMpxPose();
      }
      const vm = w.viewmodel;
      check(vm.adsT > 0.99, 'actual aim transition');
      if (id === 'sniper')
        check(vm.scopeOverlay.visible && !vm.active.group.visible, 'scope overlay');
      else if (id === 'mcx') {
        check(vm.scopeReticle.material.userData.owUniforms.uChevron.value === 1, 'ACOG chevron');
        check(ctx.camera.fov < ctx.config.fov * 0.3, 'world zoom');
      } else if (id === 'smg' || id === 'lmg') {
        check(vm.reticle.visible && !vm.scopeOverlay.visible, 'reflex ADS');
        check(!vm.dotRing.visible && !vm.dotHalo.visible && !vm.dotRim.visible, 'dot only');
      } else check(!vm.reticle.visible && !vm.scopeOverlay.visible, 'iron ADS');
      if (id === 'smg') {
        check(w.setWeapon('rifle'), 'animated switch away');
        await pump(90);
        check(w.setWeapon('smg'), 'held-aim animated draw');
        let drawFrames = 0,
          aimingFrames = 0;
        for (let frame = 0; frame < 80; frame++) {
          await pump(1);
          if (w.activeId !== 'smg' || vm.clipName !== 'draw') continue;
          checkMpxPose();
          drawFrames++;
          if (vm.adsT > 0 && vm.adsT < 1) aimingFrames++;
        }
        check(drawFrames > 20 && aimingFrames > 0, 'draw overlaps native aim-in');
      }
      w.debugMode = 'idle';
      await pump(40);
      const partial = Math.min(8, cap - 2);
      Object.assign(w.state, { mag: partial, chambered: true, reserve: 1000 });
      check(w.reload(), 'tactical reload accepted');
      await pump(12);
      const pausedTime = vm.clipT;
      ctx.time.scale = 0;
      await pump(8);
      check(vm.clipT === pausedTime, 'pause freezes the native reload');
      ctx.time.scale = 1;
      await pump(300);
      check(!w.reloading && w.ammo.mag === cap + 1, 'tactical +1 accounting');
      check(w.state.reserve === 1000 - (cap - partial), 'tactical reserve accounting');
      Object.assign(w.state, { mag: 0, chambered: false, reserve: 1000 });
      check(w.reload(), 'empty reload accepted');
      await pump(420);
      // Tube reloads fill both chamber and tube; detachable magazines feed from capacity.
      const full = id === 'shotgun' ? cap + 1 : cap;
      check(!w.reloading && w.ammo.mag === full && w.state.chambered, 'empty reload accounting');
      check(w.state.reserve === 1000 - full, 'empty reserve accounting');
      if (id === 'lmg') check(beltCount() === 8, 'insertion restores belt');
      w.debugMode = null;
      check(w.inspect(), 'inspect accepted');
      await pump(15);
      const before = [shots, shells];
      check(w.tryFire(), 'fire interrupts inspect');
      for (let frame = 0; frame < 90; frame++) {
        if (id === 'smg') w.debugMode = 'ads';
        await pump(1);
        if (id === 'smg') checkMpxPose();
      }
      check(shots === before[0] + 1 && shells === before[1] + 1, 'one live case per shot');
      check(w.state.chambered, 'automatic feed, bolt or pump completes');
      if (id === 'rifle') {
        const a = vm.active.animation;
        check(
          !a.reviewCase.visible && a.cover.quaternion.angleTo(a.openCover) < 1e-6,
          'live case/open cover'
        );
      }
      w.debugMode = null;
      Object.assign(w.state, { mag: 0, chambered: true });
      check(w.tryFire(), 'last chambered round');
      await pump(90);
      check(!w.state.chambered && !w.tryFire(), 'dry fire cannot produce a shot');
      if (id === 'lmg') check(beltCount() === 0, 'spent belt stays empty');
      if (id === 'pistol') check(vm.active.animation.slide.position.z > 0.025, 'slide lockback');
      if (id === 'smg')
        check(Math.abs(vm.active.animation.bolt.position.z - 0.038) < 0.00001, 'bolt lockback');
      const other = id === 'rifle' ? 'pistol' : 'rifle';
      check(w.setWeaponImmediate(other) && w.setWeaponImmediate(id), 'switch back');
      await pump(15);
      check(!w.state.chambered, 'switch cannot refill chamber');
      if (id === 'lmg') check(beltCount() === 0, 'switch cannot respawn belt');
      w.state.reserve = 1000;
      check(w.reload(), 'interrupted reload accepted');
      await pump(12);
      check(w.setWeaponImmediate(other) && w.setWeaponImmediate(id), 'interrupt before insertion');
      await pump(20);
      check(w.state.reserve === 1000, 'cancel before insertion consumes no reserve');
      check(!vm.active.animation.spare?.visible, 'no orphan spare');
      check(w.reload(), 'reload after cancellation');
      await pump(420);
      const committed = [w.ammo.mag, w.state.reserve];
      w._onPlayerDeath();
      await pump(8);
      check(
        w.ammo.mag === committed[0] && w.state.reserve === committed[1],
        'death preserves committed reload'
      );
      check(!vm.active.animation.spare?.visible, 'death cleans held spare');
      check(
        shots === before[0] + 2 && shells === before[1] + 2,
        'no extra cases during reload/death'
      );
      rows.push(id);
    }
    check(!window.__ENGINE__.error, 'no terminal engine error');
    return rows;
  });
  assert.deepEqual(rows, ['rifle', 'mcx', 'pistol', 'smg', 'lmg', 'sniper', 'shotgun']);
  assert.deepEqual(errors, []);
  console.log(
    'PASS seven native weapons: ADS/draw, pause, reload accounting/cancellation, cases and restart'
  );
} finally {
  try {
    await browser?.close();
  } finally {
    stopViteServer(server);
  }
}
