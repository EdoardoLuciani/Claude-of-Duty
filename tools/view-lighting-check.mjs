/** Native view-light policy/material regression, not a performance benchmark. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';
const args = parseArgs(), out = resolve(args.out ?? '/tmp/cod-view-light-check');
const port = Number(args.port ?? 5314), width = 960, height = 540;
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
const exposure = args.exposure === undefined ? null : Number(args.exposure);
assert(exposure === null || (Number.isFinite(exposure) && exposure > 0 && exposure <= 32));
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ port }); let browser;
try {
  browser = await launchChromium({ headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 }); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (args['stale-indirect'] === '1') await page.route('**/src/render/indirect-webgpu.js', async route => {
    const response = await route.fetch(); const text = await response.text();
    assert.equal(text.split('.setGroup(renderGroup)').length - 1, 5);
    await route.fulfill({ response, body: text.replace('positionWorld, renderGroup,', 'positionWorld, objectGroup,')
      .replaceAll('.setGroup(renderGroup)', '.setGroup(objectGroup)') });
  });
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=hero&q=${args.quality ?? 'high'}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 120000 });
  const result = await page.evaluate(async ({ width, height, allScenes, exposure }) => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const e = window.__ENGINE__, ctx = e.ctx, r = ctx.get('render'), renderer = r.renderer;
    const weapons = ctx.get('weapons'), vm = weapons.viewmodel;
    if (exposure !== null) { r.settings.autoExposure = false; r._exposure = r._exposureTarget = exposure; }
    const adapter = renderer.backend.device.adapterInfo;
    if (adapter.vendor !== 'amd' || adapter.architecture !== 'rdna-4' || adapter.isFallbackAdapter !== false) throw new Error('wrong actual GPU');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const display = new T.RenderTarget(width, height, { depthBuffer: false });
    const target = new T.RenderTarget(width, height, { type: T.FloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    const images = {}, scenes = [], inventory = [];
    const capture = async name => {
      const setTarget = renderer.setRenderTarget;
      renderer.setRenderTarget = function (rt, ...rest) { return setTarget.call(this, rt ?? display, ...rest); };
      try { r.render(ctx); } finally { renderer.setRenderTarget = setTarget; setTarget.call(renderer, null); }
      const data = await renderer.readRenderTargetPixelsAsync(display, 0, 0, width, height);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
      images[name] = canvas.toDataURL('image/png').split(',')[1];
    };
    const ids = [r.viewSun.id, r.viewFill.id, ...r.viewPracticals.map(s => s.light.id)];
    for (const shot of ['hero', 'interior', 'night']) {
      window.__APPLY_SHOT__(shot); await window.__PUMP__(180); await r._meterTask;
      r.render(ctx);
      const keyDirection = r.viewSun.position.clone().sub(r.viewSun.target.position).normalize();
      check(keyDirection.distanceTo(r.sunDir) < 1e-10, 'view key must track world direction');
      check(r.viewSun.color.equals(r.activeSun.color), 'view key must track world color');
      check(Math.abs(r.viewSun.intensity - r.activeSun.intensity * r._viewVisibility) < 1e-10, 'view key visibility budget');
      const available = r.indirect.sky.value.clone().multiplyScalar(r.indirect.viewVisibility.value);
      available.x += r.activeSun.color.r * r.viewSun.intensity;
      available.y += r.activeSun.color.g * r.viewSun.intensity;
      available.z += r.activeSun.color.b * r.viewSun.intensity;
      for (const s of r.viewPracticals) if (s.source) {
        available.x += s.source.color.r * s.irradiance;
        available.y += s.source.color.g * s.irradiance;
        available.z += s.source.color.b * s.irradiance;
        check(s.light.intensity === s.source.intensity && s.light.color.equals(s.source.color), 'practical proxy changed source light');
      }
      const fillRGB = r.viewFill.color.toArray().map(v => v * r.viewFill.intensity);
      check(fillRGB.every((v, i) => Math.abs(v - available.getComponent(i) * .1) < 1e-10), 'readability fill exceeds documented budget');
      const viewDirection = r.viewFill.position.clone().sub(ctx.camera.position).normalize();
      check(viewDirection.distanceTo(r._viewFillDirection.clone().applyQuaternion(ctx.camera.quaternion)) < 1e-10, 'readability direction is not camera-relative');
      scenes.push({ shot, exposure: r._exposure, key: r.activeSun.intensity, viewKey: r.viewSun.intensity,
        keyVisibility: r._viewVisibility, skyVisibility: r.indirect.viewVisibility.value, fillRGB,
        practicals: r.viewPracticals.filter(s => s.source).map(s => ({ position: s.light.position.toArray(), intensity: s.light.intensity, irradiance: s.irradiance })) });
      await capture(shot);
      const corner = await renderer.readRenderTargetPixelsAsync(r.viewRt, 0, 0, 1, 1);
      check(corner[3] === 0 && r.viewRt.samples === 0, 'view clear/isolated non-MSAA contract');
    }
    window.__APPLY_SHOT__('weapon');
    for (const id of ['rifle', 'pistol', 'mcx', 'smg', 'lmg', 'shotgun', 'sniper']) {
      weapons.debugMode = 'idle'; weapons.setWeaponImmediate(id); await window.__PUMP__(30);
      const materials = new Set(); vm.active.group.traverse(o => { if (o.isMesh) materials.add(o.material); });
      for (const material of materials) {
        check(material.isNodeMaterial, `${id}: non-native material`);
        if (material.isMeshStandardNodeMaterial && !material.userData.owNoPatch) check(r.indirect._patched.has(material), `${id}: missed indirect hook`);
      }
      inventory.push({ id, materials: [...materials].map(m => ({ name: m.name, type: m.type, color: m.color?.toArray(), specular: m.specularIntensity })) });
      await capture(id);
      if (id !== 'shotgun') {
        // Actual posed GLB base colors, without lighting/exposure: distinguish
        // bright illumination from a loader turning the pigment itself white.
        const originals = [], basics = new Map();
        vm.active.group.traverse(o => {
          if (!o.isMesh) return;
          const m = o.material;
          if (!basics.has(m)) basics.set(m, new T.MeshBasicNodeMaterial({ color: m.color, map: m.map,
            side: m.side, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite, toneMapped: false }));
          originals.push([o, m]); o.material = basics.get(m);
        });
        vm.armL.root.visible = vm.armR.root.visible = false;
        await new Promise(requestAnimationFrame);
        renderer.setClearColor(0, 0); renderer.setRenderTarget(target); renderer.render(ctx.viewScene, ctx.viewCamera);
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
        renderer.setRenderTarget(null);
        const rgb = [0, 0, 0]; let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > .99) {
          count++; for (let c = 0; c < 3; c++) rgb[c] += pixels[i + c];
        }
        check(count > 100, 'blank unlit material probe');
        inventory[inventory.length - 1].unlit = { pixels: count, meanRGB: rgb.map(v => v / count) };
        for (const [mesh, material] of originals) mesh.material = material;
        for (const material of basics.values()) material.dispose();
        vm.armL.root.visible = vm.armR.root.visible = true;
      }
    }
    for (const arm of [vm.armL, vm.armR]) for (const mesh of arm.skins) {
      check(mesh.material.color.toArray().every(v => v === 1), 'arm loader darkens authored base color');
      check(Math.abs(mesh.material.specularIntensity - .16) < 1e-6, 'authored arm specular lost');
    }
    for (const prop of [vm.grenade, vm.radio]) prop.traverse(o => {
      if (o.isMesh && o.material.isMeshStandardMaterial) check(o.material.isNodeMaterial, 'held prop missed native conversion');
    });
    check(JSON.stringify(ids) === JSON.stringify([r.viewSun.id, r.viewFill.id, ...r.viewPracticals.map(s => s.light.id)]), 'light identities changed');

    if (allScenes) for (const shot of ['hero', 'interior', 'night']) {
      window.__APPLY_SHOT__(shot); await window.__PUMP__(180); await r._meterTask;
      for (const id of ['smg', 'sniper', 'shotgun']) {
        weapons.setWeaponImmediate(id); await window.__PUMP__(30);
        await capture(`${shot}-${id}`);
      }
    }

    // Rigid geometry, completely frozen camera/pose: no identity color node.
    // These controls exercise the shipping uniform groups, not a forced refresh.
    weapons.setWeaponImmediate('rifle'); await window.__PUMP__(2);
    const f = r.indirect, sky = f.sky.value.clone(), ground = f.ground.value.clone();
    const visibility = f.viewVisibility.value, ibl = f.iblScale.value, env = ctx.viewScene.environmentIntensity;
    const lights = []; ctx.viewScene.traverse(o => { if (o.isLight) { lights.push([o, o.intensity]); o.intensity = 0; } });
    vm.armL.root.visible = vm.armR.root.visible = false;
    const initial = { frame: e.time.frame, elapsed: e.time.elapsed, rng: [ctx.rng.s0, ctx.rng.s1, ctx.rng.s2, ctx.rng.s3] };
    f.sky.value.setScalar(0); f.ground.value.setScalar(0); f.viewVisibility.value = 1; f.iblScale.value = 0; ctx.viewScene.environmentIntensity = 0;
    const raw = async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise(requestAnimationFrame); renderer.setClearColor(0, 0);
        renderer.setRenderTarget(target); renderer.render(ctx.viewScene, ctx.viewCamera);
      }
      const p = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height); renderer.setRenderTarget(null); return p;
    };
    const sum = p => {
      const rgb = [0, 0, 0];
      for (let i = 0; i < p.length; i += 4) for (let c = 0; c < 3; c++) {
        check(Number.isFinite(p[i + c]), 'nonfinite HDR'); rgb[c] += p[i + c];
      }
      return rgb;
    };
    const dark = sum(await raw());
    f.sky.value.set(1, 0, 0); const red = sum(await raw());
    check(red[0] > dark[0] + 1 && red[1] === dark[1] && red[2] === dark[2], 'rigid custom fill stayed stale');
    f.sky.value.set(0, 1, 0); const green = sum(await raw());
    check(green[1] > dark[1] + 1 && green[0] === dark[0] && green[2] === dark[2], 'rigid custom fill retained old hue');
    f.sky.value.setScalar(0); const restored = sum(await raw());
    check(JSON.stringify(dark) === JSON.stringify(restored), 'custom fill failed to return to zero');
    check(initial.frame === e.time.frame && initial.elapsed === e.time.elapsed &&
      JSON.stringify(initial.rng) === JSON.stringify([ctx.rng.s0, ctx.rng.s1, ctx.rng.s2, ctx.rng.s3]), 'probe advanced simulation/RNG');
    f.sky.value.copy(sky); f.ground.value.copy(ground); f.viewVisibility.value = visibility;
    f.iblScale.value = ibl; ctx.viewScene.environmentIntensity = env;
    for (const [light, intensity] of lights) light.intensity = intensity;
    vm.armL.root.visible = vm.armR.root.visible = true;
    target.dispose(); display.dispose();
    return { device: { vendor: adapter.vendor, architecture: adapter.architecture, fallback: adapter.isFallbackAdapter },
      scenes, inventory, uniformProbe: { dark, red, green, restored }, images };
  }, { width, height, allScenes: args['all-scenes'] === '1', exposure });
  for (const [name, png] of Object.entries(result.images)) writeFileSync(`${out}/${name}.png`, Buffer.from(png, 'base64'));
  delete result.images; assert.deepEqual(errors, []);
  writeFileSync(`${out}/report.json`, JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ...result, errors }, null, 2));
  console.log(JSON.stringify(result));
  await page.evaluate(() => window.__ENGINE__.dispose()); await page.close();
} finally { await browser?.close(); stopViteServer(server); }
