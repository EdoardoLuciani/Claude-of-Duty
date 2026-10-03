import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer, parseArgs } from '../../tools/lib/browser-harness.mjs';

// node tests/e2e/day-night-e2e.mjs --out=shots/day-night --port=5185
const args = parseArgs(), port = Number(args.port ?? 5185), out = resolve(args.out ?? 'shots/day-night');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--ignore-gpu-blocklist',
  '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars',
  '--mute-audio', '--disable-frame-rate-limit'] });
const errors = [], report = [];
try {
  for (const shot of [
    { name: 'afternoon', hour: 16.5 }, { name: 'sunset', hour: 19.2 },
    { name: 'early-night', hour: 21 }, { name: 'night-powered', hour: 1.5 },
    { name: 'night-outage', hour: 1.5, power: 0 },
    { name: 'night-flashlight', hour: 1.5, power: 0, flashlight: true },
    { name: 'dawn', hour: 4.5 }, { name: 'morning', hour: 6 },
  ]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=night`);
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
    await page.evaluate(s => {
      window.__APPLY_SHOT__('night');
      const ctx = window.__ENGINE__.ctx;
      ctx.get('sky').setTimeOfDay(s.hour);
      ctx.get('world').setStreetlightPower(s.power ?? 1);
      ctx.get('player').setFlashlightEnabled(s.flashlight ?? false);
      ctx.get('render').exposure.reset();
    }, shot);
    await page.evaluate(() => window.__PUMP__(240));
    await page.evaluate(() => window.__PRESENT__(2));
    await page.screenshot({ path: `${out}/${shot.name}.png` });
    const info = await page.evaluate(() => {
      const ctx = window.__ENGINE__.ctx, sky = ctx.get('sky'), r = ctx.get('render');
      const gl = r.renderer.getContext();
      const nativeSkinWarm = r.renderer.info.programs.some(p => p.cacheKey.startsWith('depth,') &&
        gl.getShaderSource(p.vertexShader).includes('#define USE_SKINNING'));
      return { hour: sky.hour, moon: sky.moonLight.intensity, sun: sky.sunLight.intensity,
        nativeSkinWarm, fallback: r.sun.visible, programs: r.renderer.info.programs.length,
        calls: r.renderer.info.render.calls, hooks: window.__ENGINE__.__prewarmHooks };
    });
    assert.ok(Math.abs(info.hour - shot.hour) < 1e-10, 'deterministic captures freeze automatic clock');
    assert.equal(info.fallback, false, 'dim or absent moon never restores daylight');
    assert.equal(info.hooks.player.ok, true, 'native flashlight shadows warmed at boot');
    assert.equal(info.nativeSkinWarm, true, 'skinned native depth is warm even without combat actors');
    report.push({ ...shot, ...info });
    console.log(shot.name, JSON.stringify(info));
    await page.close();
  }
  const night = report.filter(s => s.name.startsWith('night-'));
  assert.equal(new Set(night.map(s => s.programs)).size, 1, 'power/toggle do not compile shader permutations');

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`);
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  const checks = await page.evaluate(async () => {
    const e = window.__ENGINE__, ctx = e.ctx, sky = ctx.get('sky'), world = ctx.get('world');
    const player = ctx.get('player'), r = ctx.get('render');
    const result = {};
    // Opt into live lighting without spawning combat actors in this probe.
    ctx.config.deterministic = false;
    ctx.get('ai').update = () => {};
    sky.setTimeOfDay(16.5);
    sky.setTimeRate(9 / 600);
    let skyBakes = 0;
    const bakeSky = sky._bakeSky.bind(sky);
    sky._bakeSky = () => { skyBakes++; bakeSky(); };
    await window.__PUMP__(60);
    result.liveHour = sky.hour;
    result.firstSecondSkyBakes = skyBakes;
    sky.update(599, ctx);
    result.tenMinuteHour = sky.hour;
    sky.update(100, ctx);
    result.continuesAfterNight = sky.hour;
    sky.setTimeOfDay(21);
    world.update(1 / 60, ctx);
    result.outageTriggered = world._outage.elapsed >= 0;
    world.update(2.1, ctx);
    result.powerCut = world._streetlightPower;
    const pauseHour = sky.hour, pauseAge = world._outage.elapsed;
    ctx.get('ui').pause();
    await window.__PUMP__(30);
    result.pauseFrozen = sky.hour === pauseHour && world._outage.elapsed === pauseAge;
    ctx.get('ui').resume();
    ctx.get('market').openShop();
    const shopHour = sky.hour, shopAge = world._outage.elapsed;
    await window.__PUMP__(30);
    result.shopFrozen = sky.hour === shopHour && world._outage.elapsed === shopAge;
    ctx.get('market').closeShop();
    world.update(180, ctx);
    result.restored = world._streetlightPower;
    sky.setTimeOfDay(21);
    world.update(1, ctx);
    result.noSecondCut = world._streetlightPower === 1;
    // Real input path and pause guard, without pointer-lock requirements.
    e.input.enabled = true; e.input.frozen = false;
    player.controlEnabled = true;
    e.input._pendingDown.add('KeyT');
    await window.__PUMP__(1);
    result.keyToggleOn = player.flashlightOn;
    e.input._pendingUp.add('KeyT');
    await window.__PUMP__(1);
    ctx.get('ui').pause();
    e.input._pendingDown.add('KeyT');
    await window.__PUMP__(1);
    result.pausedToggleIgnored = player.flashlightOn;
    e.input._pendingUp.add('KeyT');
    await window.__PUMP__(1);
    ctx.get('ui').resume();
    e.input.enabled = true; e.input.frozen = false;
    e.input._pendingDown.add('KeyT');
    await window.__PUMP__(1);
    result.keyToggleOff = !player.flashlightOn;
    e.input._pendingUp.add('KeyT');
    await window.__PUMP__(1);
    player.setFlashlightEnabled(true);
    ctx.events.emit('game:restart', { source: 'test' });
    result.restart = { hour: sky.hour, triggered: world._outage.elapsed >= 0,
      power: world._streetlightPower, flashlight: player.flashlightOn };

    // Inspect native-shadow update ordering against the real render pipeline.
    const shadowCalls = [];
    const nativeShadow = r.renderer.shadowMap.render;
    r.renderer.shadowMap.render = function(lights, scene, camera) {
      if (this.autoUpdate && player.flashlight.shadow.needsUpdate && lights.includes(player.flashlight)) {
        shadowCalls.push({ override: !!scene.overrideMaterial, fullWorld: world.root.visible });
      }
      return nativeShadow.call(this, lights, scene, camera);
    };
    player.setFlashlightEnabled(true);
    await window.__PUMP__(2);
    result.shadowCalls = shadowCalls;
    r.renderer.shadowMap.render = nativeShadow;

    // Observe a receiver behind an opaque wall from an offset camera. Using
    // the real flashlight, its center must be dark with the wall and lit without.
    const T = await import('/node_modules/three/build/three.module.js');
    const probe = new T.Scene();
    const wall = new T.Mesh(new T.BoxGeometry(1, 4, 0.15), new T.MeshStandardMaterial());
    wall.position.set(0, 2, -2); wall.castShadow = true;
    const receiver = new T.Mesh(new T.PlaneGeometry(4, 4), new T.MeshStandardMaterial());
    receiver.position.set(0, 2, -4); receiver.receiveShadow = true;
    probe.add(wall, receiver, player.flashlight, player.flashlight.target);
    player.flashlight.position.set(0, 2, 0);
    player.flashlight.target.position.set(0, 2, -4);
    const observer = new T.PerspectiveCamera(40, 1, 0.1, 30);
    observer.position.set(4, 2, 0); observer.lookAt(0, 2, -4);
    const target = new T.WebGLRenderTarget(32, 32);
    const previousTarget = r.renderer.getRenderTarget();
    const pixels = new Uint8Array(32 * 32 * 4);
    const sample = () => {
      player.flashlight.shadow.needsUpdate = true;
      r.renderer.setRenderTarget(target);
      r.renderer.clear(); r.renderer.render(probe, observer);
      r.renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
      const i = (16 * 32 + 16) * 4;
      return pixels[i] + pixels[i + 1] + pixels[i + 2];
    };
    const blocked = sample();
    wall.visible = false;
    const clear = sample();
    result.wallOcclusion = { blocked, clear };
    ctx.scene.add(player.flashlight, player.flashlight.target);
    player.lateUpdate();
    r.renderer.setRenderTarget(previousTarget);
    target.dispose(); wall.geometry.dispose(); wall.material.dispose();
    receiver.geometry.dispose(); receiver.material.dispose();

    player.health.dead = true;
    const deathHour = sky.hour, deathAge = world._outage.elapsed;
    await window.__PUMP__(2);
    result.deadFrozen = sky.hour === deathHour && world._outage.elapsed === deathAge && !player.flashlightOn;
    result.engineError = e.error;
    return result;
  });
  console.log('behaviour', JSON.stringify(checks, null, 2));
  assert.ok(Math.abs(checks.liveHour - 16.515) < 1e-9);
  assert.equal(checks.firstSecondSkyBakes, 0, 'incremental clock does not rebake sky every frame');
  assert.ok(Math.abs(checks.tenMinuteHour - 1.5) < 1e-9);
  assert.ok(Math.abs(checks.continuesAfterNight - 3) < 1e-9);
  for (const key of ['outageTriggered', 'pauseFrozen', 'shopFrozen', 'noSecondCut',
    'keyToggleOn', 'pausedToggleIgnored', 'keyToggleOff', 'deadFrozen']) assert.equal(checks[key], true, key);
  assert.equal(checks.powerCut, 0);
  assert.equal(checks.restored, 1);
  assert.deepEqual(checks.restart, { hour: 16.5, triggered: false, power: 1, flashlight: false });
  assert.equal(checks.engineError, null);
  assert.ok(checks.shadowCalls.length > 0);
  assert.ok(checks.shadowCalls.every(s => !s.override && s.fullWorld), 'spot shadows use full forward scene');
  assert.ok(checks.wallOcclusion.clear > 10 && checks.wallOcclusion.blocked < checks.wallOcclusion.clear * 0.05,
    'opaque wall blocks flashlight illumination behind it');
  assert.deepEqual(errors, []);
  await page.close();

  // Real non-capture boot: initial soldiers can be outside the 19m beam.
  const live = await browser.newPage({ viewport: { width: 640, height: 360 } });
  live.on('pageerror', e => errors.push(e.message));
  await live.goto(`http://127.0.0.1:${port}/`);
  await live.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  const livePrewarm = await live.evaluate(async () => {
    const e = window.__ENGINE__; e.stop();
    const ctx = e.ctx, r = ctx.get('render'), player = ctx.get('player'), ai = ctx.get('ai');
    const T = await import('/node_modules/three/build/three.module.js');
    const actor = ai.agents.find(a => a.alive);
    if (!actor) throw new Error('live boot did not spawn a soldier');
    const ahead = new T.Vector3(0, 0, -5).applyQuaternion(ctx.camera.quaternion).add(ctx.camera.position);
    ahead.y -= 1.6;
    const move = position => {
      actor.position.copy(position); actor.group.position.copy(position);
      actor.group.visible = true; actor.mesh.frustumCulled = true;
      actor.group.updateMatrixWorld(true);
    };
    const draw = () => { player.lateUpdate(); r.render(ctx); };
    move(ahead);
    player.setFlashlightEnabled(false);
    for (let i = 0; i < 10; i++) draw(); // settle non-native-shadow programs
    move(ctx.camera.position.clone().add(new T.Vector3(0, 0, 100)));
    player.setFlashlightEnabled(true); draw(); draw();
    const before = r.renderer.info.programs.length;
    const gl = r.renderer.getContext(), compile = gl.compileShader;
    let compiles = 0;
    gl.compileShader = function(shader) { compiles++; return compile.call(this, shader); };
    try {
      move(ahead); draw(); draw(); draw();
      return { before, after: r.renderer.info.programs.length, compiles, error: e.error };
    } finally { gl.compileShader = compile; }
  });
  console.log('live flashlight prewarm', JSON.stringify(livePrewarm));
  assert.equal(livePrewarm.after, livePrewarm.before, 'soldier entering enabled beam does not add a program');
  assert.equal(livePrewarm.compiles, 0, 'soldier entering enabled beam does not compile shaders');
  assert.equal(livePrewarm.error, null);
  assert.deepEqual(errors, []);
  await live.close();
  writeFileSync(`${out}/report.json`, JSON.stringify({ ok: true, shots: report, checks, livePrewarm }, null, 2));
  console.log('day/night e2e passed');
} finally {
  await browser.close();
  stopViteServer(server);
}
