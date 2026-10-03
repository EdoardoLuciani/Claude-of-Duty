/** Diagnostic only: authored material census, frozen-pose HDR lighting isolation,
 * neutral reference and final-frame controls. No production retuning. */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { ensureViteServer, stopViteServer, launchChromium, parseArgs } from './lib/browser-harness.mjs';
const args = parseArgs(), out = resolve(args.out ?? '/tmp/cod-weapon-calibration');
const width = 1280, height = 720, port = Number(args.port ?? 5312);
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
mkdirSync(out, { recursive: true });
const decode = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
function asset(path) {
  const bytes = readFileSync(path), jsonSize = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const bin = bytes.subarray(20 + jsonSize + 8);
  const image = index => {
    const im = doc.images[doc.textures[index].source], bv = doc.bufferViews[im.bufferView];
    return PNG.sync.read(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  };
  return doc.materials.map(m => {
    const p = m.pbrMetallicRoughness ?? {}, color = (p.baseColorFactor ?? [1, 1, 1, 1]).slice(0, 3);
    const meanBase = [...color]; let meanMetal = p.metallicFactor ?? 1, meanRough = p.roughnessFactor ?? 1;
    let metalRange = [meanMetal, meanMetal];
    if (p.baseColorTexture) {
      const im = image(p.baseColorTexture.index), sum = [0, 0, 0];
      for (let i = 0; i < im.data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += decode(im.data[i + c] / 255);
      for (let c = 0; c < 3; c++) meanBase[c] *= sum[c] / (im.width * im.height);
    }
    if (p.metallicRoughnessTexture) {
      const im = image(p.metallicRoughnessTexture.index); let metal = 0, rough = 0, lo = 1, hi = 0;
      for (let i = 0; i < im.data.length; i += 4) {
        const b = im.data[i + 2] / 255; metal += b; rough += im.data[i + 1] / 255; lo = Math.min(lo, b); hi = Math.max(hi, b);
      }
      metalRange = [lo * meanMetal, hi * meanMetal];
      meanMetal *= metal / (im.width * im.height); meanRough *= rough / (im.width * im.height);
    }
    return { name: m.name, color, meanBase, meanMetal, metalRange, meanRough,
      specularIntensity: m.extensions?.KHR_materials_specular?.specularFactor ?? 1 };
  });
}
const assets = {
  arms: asset('public/models/player/arms.glb'),
  rifle: asset('assets/weapons/m4a1-block-ii/m4a1-block-ii.glb'),
  pistol: asset('assets/weapons/p320-compact/p320-compact.glb'),
  mcx: asset('assets/weapons/mcx-virtus/mcx-virtus.glb'),
};
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(`${out}/assets.json`, JSON.stringify(assets, null, 2));
const server = await ensureViteServer({ port }); let browser;
try {
  browser = await launchChromium({ headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu', '--force-color-profile=srgb', '--mute-audio'],
  });
  for (const shot of String(args.shots ?? 'hero,interior,night').split(',')) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&shot=${shot}&q=high`);
    await page.waitForFunction('window.__READY__===true', null, { timeout: 120000 });
    const result = await page.evaluate(async ({ shot, width, height, assets, noObserver }) => {
      const e = window.__ENGINE__, ctx = e.ctx, r = ctx.get('render'), renderer = r.renderer;
      if (r.viewPracticals) throw new Error('This historical fixed-rig audit targets 0d9ada2; use tools/view-lighting-check.mjs for the world-dependent policy.');
      const a = renderer.backend.device.adapterInfo;
      if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter !== false) throw new Error('wrong GPU');
      const { THREE: T, TSL } = await import('/tools/arm-material-fixture.js');
      window.__APPLY_SHOT__(shot, { grabFrame: 180 }); await window.__PUMP__(180); await r._meterTask;
      r.settings.autoExposure = false;
      const vm = ctx.get('weapons').viewmodel, camera = ctx.viewCamera, fill = r.indirect;
      const state = () => ({ frame: e.time.frame, elapsed: e.time.elapsed, camera: camera.position.toArray(),
        rotation: camera.quaternion.toArray(), clip: vm.clipName, clipTime: vm.clipT, exposure: r._exposure,
        rng: [ctx.rng, ctx.get('ai').rng, ctx.get('weapons').rng, vm.rng, ctx.get('fx').rng]
          .map(rng => rng ? [rng.s0, rng.s1, rng.s2, rng.s3, rng._spare ?? null] : null) });
      const initial = state(), position = camera.position.clone(), rotation = camera.quaternion.clone();
      const worldPosition = ctx.camera.position.clone(), worldRotation = ctx.camera.quaternion.clone();
      const gunMeshes = new Set(); vm.active.group.traverse(o => { if (o.isMesh) gunMeshes.add(o); });
      const armMeshes = new Set([...vm.armL.skins, ...vm.armR.skins]);
      const meshes = [], materials = new Map(), lights = [];
      ctx.viewScene.traverseVisible(o => {
        if (o.isLight) lights.push({ light: o, intensity: o.intensity, position: o.position.clone(), target: o.target?.position.clone() });
        if (!o.isMesh) return;
        if (Array.isArray(o.material)) throw new Error('fixture expects material primitives');
        const group = armMeshes.has(o) ? (o.material.name.startsWith('Olive_') ? 1 : 2) : gunMeshes.has(o) ? 3 : 0;
        meshes.push({ mesh: o, material: o.material, group });
        if (group && !materials.has(o.material)) {
          const source = (group === 3 ? assets.rifle : assets.arms).find(m => m.name === o.material.name);
          if (!source) throw new Error(`missing authored material ${o.material.name}`);
          materials.set(o.material, { group, source, color: o.material.color.clone(), specularIntensity: o.material.specularIntensity });
        }
      });
      const env = ctx.viewScene.environment, envIntensity = ctx.viewScene.environmentIntensity;
      const sky = fill.sky.value.clone(), ground = fill.ground.value.clone(), ibl = fill.iblScale.value;
      const target = new T.RenderTarget(width, height, { type: T.FloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
      const display = new T.RenderTarget(width, height, { depthBuffer: false });
      const white = new T.DataTexture(new Uint8Array(512 * 256 * 4).fill(255), 512, 256);
      white.mapping = T.EquirectangularReflectionMapping; white.colorSpace = T.LinearSRGBColorSpace; white.needsUpdate = true;
      const restore = () => {
        for (const [m, s] of materials) { m.color.copy(s.color); m.specularIntensity = s.specularIntensity; }
        for (const s of lights) { s.light.intensity = s.intensity; s.light.position.copy(s.position); if (s.target) s.light.target.position.copy(s.target); }
        ctx.viewScene.environment = env; ctx.viewScene.environmentIntensity = envIntensity;
        fill.sky.value.copy(sky); fill.ground.value.copy(ground); fill.iblScale.value = ibl;
        camera.position.copy(position); camera.quaternion.copy(rotation);
        vm.anchor.position.copy(position); vm.anchor.quaternion.copy(rotation); vm.anchor.updateMatrixWorld(true);
        ctx.camera.position.copy(worldPosition); ctx.camera.quaternion.copy(worldRotation);
        for (const s of lights) { s.light.updateMatrixWorld(true); s.light.target?.updateMatrixWorld(true); }
      };
      const ready = async () => { camera.updateMatrixWorld(true); vm.anchor.updateMatrixWorld(true); await new Promise(requestAnimationFrame); };
      const raw = async () => {
        for (let i = 0; i < 3; i++) {
          await ready(); renderer.setClearColor(0, 0); renderer.setRenderTarget(target); renderer.render(ctx.viewScene, camera);
        }
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height); renderer.setRenderTarget(null); return pixels;
      };
      const png = (data) => {
        const c = document.createElement('canvas'); c.width = width; c.height = height;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
        return c.toDataURL('image/png').split(',')[1];
      };
      const final = async () => {
        await ready(); const setTarget = renderer.setRenderTarget;
        renderer.setRenderTarget = function (rt, ...rest) { return setTarget.call(this, rt ?? display, ...rest); };
        try { r.render(ctx); } finally { renderer.setRenderTarget = setTarget; setTarget.call(renderer, null); }
        return png(await renderer.readRenderTargetPixelsAsync(display, 0, 0, width, height));
      };
      // Same skinned geometry/sidedness, categorical material mask; no changing poses.
      const masks = new Map();
      for (const s of meshes) {
        const key = `${s.group}:${s.material.side}`;
        if (!masks.has(key)) masks.set(key, new T.MeshBasicNodeMaterial({ color: new T.Color().setRGB(s.group, 0, 0), side: s.material.side, toneMapped: false }));
        s.mesh.material = masks.get(key);
      }
      const labels = await raw();
      for (const s of meshes) s.mesh.material = s.material;
      const indices = [[], [], [], []];
      for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
        const i = y * width + x, g = Math.round(labels[i * 4]);
        if (g < 1 || g > 3 || labels[i * 4 + 3] < .99) continue;
        if ([-2, 2, -2 * width, 2 * width].every(d => Math.round(labels[(i + d) * 4]) === g)) indices[g].push(i * 4);
      }
      const stats = pixels => Object.fromEntries(['sleeve', 'glove', 'weapon'].map((name, k) => {
        const ids = indices[k + 1], rgb = [0, 0, 0], luma = []; let alphaLoss = 0;
        for (const i of ids) {
          if (pixels[i + 3] < .99) alphaLoss++;
          for (let c = 0; c < 3; c++) { if (!Number.isFinite(pixels[i + c])) throw new Error('nonfinite HDR'); rgb[c] += pixels[i + c]; }
          luma.push(pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722);
        }
        luma.sort((a, b) => a - b);
        return [name, { pixels: ids.length, alphaLoss, rgb: rgb.map(v => v / ids.length), mean: luma.reduce((a, b) => a + b, 0) / ids.length,
          trimmed: luma.slice(0, Math.floor(luma.length * .99)).reduce((a, b) => a + b, 0) / Math.floor(luma.length * .99),
          median: luma[Math.floor(luma.length * .5)], p95: luma[Math.floor(luma.length * .95)] }];
      }));
      const samples = [], images = {}; let productionPixels, noOpControlDifference;
      const sample = async (name, screenshot = false) => {
        const pixels = await raw();
        samples.push({ name, ...stats(pixels) });
        if (name === 'production') productionPixels = pixels;
        if (name === 'current') {
          let max = 0, changed = 0;
          for (let i = 0; i < pixels.length; i++) if (pixels[i] !== productionPixels[i]) {
            changed++; max = Math.max(max, Math.abs(pixels[i] - productionPixels[i]));
          }
          noOpControlDifference = { max, changed }; productionPixels = null;
        }
        if (name.startsWith('neutral-')) {
          const bytes = new Uint8Array(width * height * 4);
          for (let i = 0; i < bytes.length; i += 4) {
            for (let c = 0; c < 3; c++) {
              const v = Math.min(1, Math.max(0, pixels[i + c] + .18 * (1 - pixels[i + 3])));
              bytes[i + c] = Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055));
            }
            bytes[i + 3] = 255;
          }
          images[name] = png(bytes);
        }
        if (screenshot) images[name] = await final();
      };
      const base = group => { for (const [m, s] of materials) if (!group || s.group === group) m.color.fromArray(s.source.color); };
      const noDirect = () => { for (const s of lights) s.light.intensity = 0; };
      const noIndirect = () => { ctx.viewScene.environmentIntensity = 0; fill.sky.value.setScalar(0); fill.ground.value.setScalar(0); };
      const orient = (degrees, locked = false, literal = false) => {
        const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), degrees * Math.PI / 180);
        camera.quaternion.copy(rotation).premultiply(q); vm.anchor.quaternion.copy(camera.quaternion);
        ctx.camera.quaternion.copy(camera.quaternion);
        if (locked) for (const s of lights) if (s.target) {
          s.light.target.position.copy(s.target);
          s.light.position.copy(s.position).sub(s.target).applyQuaternion(literal ? camera.quaternion : q).add(s.target);
          s.light.updateMatrixWorld(true); s.light.target.updateMatrixWorld(true);
        }
      };
      await sample('production');
      // A no-op color node makes the native material observer refresh custom
      // environment uniforms even on completely frozen rigid meshes. Paused
      // ablations otherwise retained a prior fill term; extra frames and public
      // material invalidation alone did not fix it. Not a production workaround.
      const colorNodes = new Map();
      for (const [material] of materials) if (!noObserver && !material.colorNode) {
        colorNodes.set(material, material.colorNode); material.colorNode = TSL.materialColor; material.needsUpdate = true;
      }
      await sample('current', true);
      for (const [name, group] of [['sleeve-base', 1], ['weapon-base', 3], ['all-base', 0]]) {
        restore(); base(group); await sample(name, true);
      }
      restore(); for (const [m, s] of materials) if (s.group === 3) m.specularIntensity = s.source.specularIntensity;
      await sample('weapon-specular', true);
      restore(); orient(0, true, true); await sample('camera-relative', true);
      restore(); base(0); orient(0, true, true); await sample('camera-relative-base', true);
      for (const component of ['dark', 'key', 'rim', 'hemi', 'ibl', 'authored-fill']) {
        restore(); noDirect(); noIndirect();
        if (component === 'key') r.viewSun.intensity = lights.find(s => s.light === r.viewSun).intensity;
        if (component === 'rim') r.viewRim.intensity = lights.find(s => s.light === r.viewRim).intensity;
        if (component === 'hemi') r.viewFill.intensity = lights.find(s => s.light === r.viewFill).intensity;
        if (component === 'ibl') ctx.viewScene.environmentIntensity = envIntensity;
        if (component === 'authored-fill') { fill.sky.value.copy(sky); fill.ground.value.copy(ground); }
        await sample(component);
      }
      for (const locked of [false, true]) for (const yaw of [0, 90, 180, 270]) {
        restore(); noIndirect(); orient(yaw, locked); await sample(`direct-${locked ? 'locked' : 'fixed'}-${yaw}`);
      }
      restore(); camera.position.set(-8.5, 1.7, 3.2); vm.anchor.position.copy(camera.position);
      await sample('translation-only');
      // Neutral white-radiance environment: no colored lights, custom fill or IBL trim.
      restore(); noDirect(); noIndirect(); ctx.viewScene.environment = white; ctx.viewScene.environmentIntensity = 1; fill.iblScale.value = 1;
      await sample('neutral-current'); base(0); await sample('neutral-base');
      const cardScene = new T.Scene(); cardScene.environment = white;
      const cardMat = new T.MeshPhysicalNodeMaterial({ color: new T.Color().setScalar(.18), specularIntensity: 0, roughness: 1 });
      const cardGeo = new T.PlaneGeometry(2, 2), card = new T.Mesh(cardGeo, cardMat);
      const cardCamera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); cardCamera.position.z = 2; cardScene.add(card);
      renderer.setRenderTarget(target); renderer.render(cardScene, cardCamera);
      const cardPixels = await renderer.readRenderTargetPixelsAsync(target, width / 2, height / 2, 1, 1);
      const grayCard = Array.from(cardPixels.slice(0, 3)); renderer.setRenderTarget(null);
      const weaponMaterialPaths = [...vm.weapons].map(([id, entry]) => {
        const set = new Set(); entry.group.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) set.add(m); });
        return { id, materials: [...set].map(m => ({ name: m.name, type: m.type,
          nodeMaterial: !!m.isNodeMaterial, indirectEligible: !!m.isMeshStandardNodeMaterial,
          indirectPatched: r.indirect._patched.has(m) })) };
      });
      const inventory = [...materials].map(([m, s]) => ({ name: m.name, group: s.group, calibrated: s.color.toArray(),
        authored: s.source.color, specularIntensity: s.specularIntensity, authoredSpecular: s.source.specularIntensity,
        metalness: m.metalness, roughness: m.roughness, envMapIntensity: m.envMapIntensity, ownEnvMap: !!m.envMap }));
      restore(); await sample('repeat-current');
      const result = { device: { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter },
        initial, end: state(), grayCard, noObserver, noOpControlDifference, inventory, weaponMaterialPaths, lighting: {
          worldKey: { intensity: r.activeSun.intensity, color: r.activeSun.color.toArray(),
            direction: new T.Vector3().copy(r.activeSun.position).sub(r.activeSun.target.position).normalize().toArray() },
          envIntensity, sky: sky.toArray(), ground: ground.toArray(), iblScale: ibl,
          view: lights.map(s => ({ type: s.light.type, intensity: s.intensity, color: s.light.color.toArray(),
            position: s.position.toArray(), target: s.target?.toArray(), castShadow: s.light.castShadow })) }, samples, images };
      for (const [material, node] of colorNodes) { material.colorNode = node; material.needsUpdate = true; }
      for (const m of masks.values()) m.dispose(); cardGeo.dispose(); cardMat.dispose(); white.dispose(); target.dispose(); display.dispose();
      return result;
    }, { shot, width, height, assets, noObserver: args['no-observer'] === '1' });
    for (const [name, png] of Object.entries(result.images)) writeFileSync(`${out}/${shot}-${name}.png`, Buffer.from(png, 'base64'));
    delete result.images;
    writeFileSync(`${out}/${shot}.json`, JSON.stringify({ revision, width, height, ...result, errors }, null, 2));
    console.log(JSON.stringify({ shot, grayCard: result.grayCard, samples: result.samples.length, errors }));
    assert.deepEqual(result.initial, result.end, 'simulation and final camera/exposure state unchanged');
    assert(result.grayCard.every(v => Math.abs(v - .18) < 5e-4), 'neutral reference is 18% linear');
    for (const s of result.samples) for (const g of ['sleeve', 'glove', 'weapon']) {
      assert(s[g].pixels > 100); assert(s[g].alphaLoss < s[g].pixels * .005, 'stable camera-space coverage');
    }
    const byName = Object.fromEntries(result.samples.map(s => [s.name, s]));
    assert.equal(result.noOpControlDifference.changed, 0, 'identity color node changes baseline HDR');
    for (const g of ['sleeve', 'glove', 'weapon']) {
      const direct = ['key', 'rim', 'hemi'].reduce((sum, n) => sum + byName[n][g].mean, 0);
      assert(Math.abs(direct - byName['direct-fixed-0'][g].mean) < 1e-8, 'direct-light components do not reconstruct; check rigid-material uniform refresh');
      const total = direct + byName.ibl[g].mean + byName['authored-fill'][g].mean;
      assert(Math.abs(total - byName.current[g].mean) < 1e-8, 'lighting components do not reconstruct baseline');
      assert.equal(byName.dark[g].mean, 0);
      assert.equal(byName.current[g].mean, byName['repeat-current'][g].mean);
      const locked = [0, 90, 180, 270].map(yaw => byName[`direct-locked-${yaw}`][g].mean);
      assert(Math.max(...locked) / Math.min(...locked) < 1.005, 'camera-relative control changes brightness while turning');
    }
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.__ENGINE__.dispose()); await page.close();
  }
} finally { await browser?.close(); await stopViteServer(server); }
