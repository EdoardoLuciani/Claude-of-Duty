#!/usr/bin/env node
// Projection coverage, owner-material lighting, and first-strike graph variants.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
import { verifyNative, captureNative } from './lib/native-render.mjs';
const args = parseArgs(), port = Number(args.port ?? 5401);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ webgpu: true, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (args.negative) assert(['frustum', 'projection-hook', 'materials', 'radio'].includes(args.negative));
  if (args.negative === 'projection-hook') await page.route('**/src/render/index-webgpu.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'this.activeSun.shadow.shadowNode.refreshCameraFrustums();'; assert(source.includes(marker));
    await route.fulfill({ response, body: source.replace(marker, '') });
  });
  if (args.negative === 'frustum') await page.route('**/src/render/csm-webgpu.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'if (this.camera && !this._cameraProjection.equals(this.camera.projectionMatrix))';
    assert(source.includes(marker));
    await route.fulfill({ response, body: source.replace(marker, 'if (false)') });
  });
  if (args.negative === 'materials') await page.route(/\/src\/(radio\/index|weapons\/(grenade-mesh|ammo-pickups))\.js/, async route => {
    const response = await route.fetch(), source = await response.text();
    assert(source.includes('new MeshStandardNodeMaterial('));
    await route.fulfill({ response, body: source.replaceAll('new MeshStandardNodeMaterial(', 'new THREE.MeshStandardMaterial(') });
  });
  if (args.negative === 'radio') await page.route('**/src/radio/index.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'await render._warmGraph()'; assert(source.includes(marker));
    await route.fulfill({ response, body: source.replace(marker, 'await renderer.compileAsync(stage, this.ctx.camera, this.ctx.scene)') });
  });
  await page.route('**/projection-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(`http://localhost:${port}/projection-fixture`);
  const fixture = await page.evaluate(async requireAMD => {
    const { THREE: T } = await import('/tools/arm-material-fixture.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const { StableCSMShadowNode } = await import('/src/render/csm-webgpu.js');
    const { IndirectFill } = await import('/src/render/indirect-webgpu.js');
    const { RadioSystem } = await import('/src/radio/index.js');
    const { grenadeMaterials } = await import('/src/weapons/grenade-mesh.js');
    const { AmmoPickups } = await import('/src/weapons/ammo-pickups.js');
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const renderer = await createWebGpuRenderer(document.querySelector('canvas'));
    const a = renderer.backend.device.adapterInfo;
    check(!a.isFallbackAdapter && (!requireAMD || a.vendor === 'amd' && a.architecture === 'rdna-4'), 'native test adapter');
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
    const target = new T.RenderTarget(256, 64, { type: T.HalfFloatType });
    renderer.setRenderTarget(target); renderer.setClearColor(0, 1);
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(75, 16/9, .1, 200);
    camera.position.set(0, 10, 20); camera.lookAt(0, 0, -15); camera.updateMatrixWorld();
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(30, 70, 10);
    light.castShadow = true; light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -.0001; light.shadow.normalBias = .02;
    const csm = new StableCSMShadowNode(light, { cascades: 3, maxFar: 120 }); light.shadow.shadowNode = csm;
    scene.add(light, light.target, new T.AmbientLight(0xffffff, .2));
    const material = new T.MeshStandardNodeMaterial({ color: 0xb0b0b0, roughness: 1 });
    const ground = new T.Mesh(new T.PlaneGeometry(400, 400), material); ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);
    const boxes = new T.BoxGeometry(3, 5, 3);
    for (const z of [-5,-25,-55]) for (let x = -60; x <= 60; x += 12) {
      const box = new T.Mesh(boxes, material); box.position.set(x, 2.5, z); box.castShadow = true; box.receiveShadow = true; scene.add(box);
    }
    const draw = async () => {
      await new Promise(requestAnimationFrame); renderer.render(scene, camera);
      return Array.from(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 64));
    };
    await draw(); const ids = csm.lights.map(l => l.id);
    const initialWidth = csm.lights[0].shadow.camera.right * 2;
    camera.aspect = 4; camera.updateProjectionMatrix();
    const stale = await draw();
    csm.refreshCameraFrustums(); const corrected = await draw();
    const fittedWidth = csm.lights[0].shadow.camera.right * 2;
    csm.updateFrustums(); const reference = await draw();
    check(corrected.every((v,i) => v === reference[i]), 'projection refresh differs from explicit native refit');
    const changed = stale.filter((v,i) => v !== reference[i]).length;
    check(changed > 100 && fittedWidth > initialWidth * 1.5, 'fixture must expose stale wide-aspect shadow coverage');
    const repeat = await draw(); check(repeat.every((v,i) => v === reference[i]), 'unchanged projection changed shadow pixels');
    const picture = values => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      const pixels = new Uint8ClampedArray(values.length), color = new T.Color();
      for (let i = 0; i < values.length; i += 4) {
        color.setRGB(...values.slice(i,i+3).map(T.DataUtils.fromHalfFloat)).convertLinearToSRGB();
        pixels[i] = color.r * 255; pixels[i+1] = color.g * 255; pixels[i+2] = color.b * 255; pixels[i+3] = 255;
      }
      canvas.getContext('2d').putImageData(new ImageData(pixels,256,64),0,0);
      return canvas.toDataURL('image/png').split(',')[1];
    };
    const pictures = { before: picture(stale), after: picture(reference) };
    check(csm.lights.every((l,i) => l.id === ids[i]), 'projection refit replaced lights');
    csm.dispose(); ground.geometry.dispose(); boxes.dispose(); material.dispose(); target.dispose();

    const room = new T.Scene();
    const env = new T.DataTexture(new Uint8Array(256*128*4).fill(255), 256, 128); env.mapping = T.EquirectangularReflectionMapping; env.needsUpdate = true; room.environment = env;
    const fill = new IndirectFill({ viewCamera: null, peek: () => null });
    fill.roomCount.value = 1; fill.rooms[0].set(0, 0, 10, 10); fill.roomsY[0].set(-5, 5, 0, 0);
    fill.update(light, { ambientColor: { r: .15, g: .15, b: .15 } });
    const owners = grenadeMaterials().map((mat,i) => [`grenade-${i}`, mat]);
    const ammo = new AmmoPickups({ ctx: {}, rng: {} });
    for (const name of ['case','edge','latch']) owners.push([`pickup-${name}`, ammo.materials[name]]);
    const radio = new RadioSystem(), collected = new Set();
    radio.ctx = { scene: room, peek: () => ({ renderer, patchMaterials(stage) {
      stage.traverse(mesh => { if (mesh.material) collected.add(mesh.material); });
    }, async _warmGraph() {} }) };
    await radio.prewarmMaterials();
    for (const [i,mat] of [...collected].entries()) owners.push([`radio-${i}`, mat]);
    const rt = new T.RenderTarget(64,64,{type:T.HalfFloatType}); renderer.setRenderTarget(rt);
    const cam = new T.PerspectiveCamera(60,1,.1,20); cam.position.z = 3; cam.updateMatrixWorld();
    const plane = new T.Mesh(new T.PlaneGeometry(2,2)); room.add(plane);
    const pixel = async mat => {
      plane.material = mat; fill.patch(mat); renderer.render(room,cam);
      const pixels = await renderer.readRenderTargetPixelsAsync(rt,32,32,1,1);
      return Array.from(pixels.slice(0,3), T.DataUtils.fromHalfFloat);
    };
    const materials = [];
    for (const [name,mat] of owners) {
      const ref = new T.MeshStandardNodeMaterial({ color: mat.color, roughness: mat.roughness, metalness: mat.metalness,
        emissive: mat.emissive, emissiveIntensity: mat.emissiveIntensity, transparent: mat.transparent, opacity: mat.opacity });
      const actual = await pixel(mat), expected = await pixel(ref);
      materials.push({name,actual,expected});
      check(actual.every((v,i) => Math.abs(v-expected[i]) < .000001), `${name}: bypassed indoor lighting ${actual} != ${expected}`);
      ref.dispose();
    }
    plane.geometry.dispose(); rt.dispose(); env.dispose();
    for (const g of Object.values(ammo.geometries)) g.dispose();
    for (const m of Object.values(ammo.materials)) m.dispose();
    renderer.setRenderTarget(null); await renderer.dispose();
    return { adapter: {vendor:a.vendor,architecture:a.architecture}, initialWidth, fittedWidth, changed, materials, pictures };
  }, process.env.MESA_VK_DEVICE_SELECT === '1002:7550!');
  if (args.shots) for (const [name, data] of Object.entries(fixture.pictures))
    writeFileSync(`${args.shots}-${name}.png`, Buffer.from(data, 'base64'));
  delete fixture.pictures;
  console.log('fixtures', JSON.stringify(fixture));
  await page.goto(`http://localhost:${port}/?capture=1&lockstep=1&q=${args.quality ?? 'high'}`);
  await page.waitForFunction('window.__READY__===true', null, { timeout: 120000 });
  await verifyNative(page);
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.evaluate(() => window.__PUMP__(2));
  const gameplay = await page.evaluate(async () => {
    const e = window.__ENGINE__, ctx = e.ctx, r = ctx.get('render'), radio = ctx.get('radio');
    const csm = r.activeSun.shadow.shadowNode, camera = ctx.camera;
    camera.aspect = 4; camera.fov = 50; camera.updateProjectionMatrix();
    r.render(ctx); const width = csm.lights[0].shadow.camera.right;
    csm.updateFrustums();
    if (width !== csm.lights[0].shadow.camera.right) throw Error('render owner did not refresh projection');
    await window.__PUMP__(60); window.__NATIVE_BUILDS__ = 0; window.__NATIVE_BUILD_INFO__.length = 0;
    if (!radio.callStrike()) throw Error('first strike refused');
    let planeDraws = 0, bombDraws = 0;
    radio.active[0].plane.traverse(m => { if (m.isMesh) m.onBeforeRender = () => planeDraws++; });
    for (let i = 0; i < 120; i++) {
      radio.update(1/60); const strike = radio.active[0];
      for (const b of strike.bombs) b.mesh.traverse(m => { if (m.isMesh) m.onBeforeRender = () => bombDraws++; });
      camera.position.copy(strike.plane.position); camera.position.x += 25; camera.position.y += 8; camera.position.z += 35;
      camera.lookAt(strike.plane.position); camera.updateMatrixWorld();
      await new Promise(requestAnimationFrame); r.render(ctx);
    }
    return { planeDraws, bombDraws, builders: window.__NATIVE_BUILD_INFO__ };
  });
  console.log('first strike', JSON.stringify(gameplay));
  assert(gameplay.planeDraws > 0 && gameplay.bombDraws > 0, 'real plane and bombs must be drawn');
  assert.deepEqual(gameplay.builders, [], 'first radio strike: late shader builders');
  if (args.shot) await captureNative(page, String(args.shot));
  assert.deepEqual(errors, []);
  if (args.out) writeFileSync(String(args.out), JSON.stringify({fixture,gameplay},null,2));
  await page.evaluate(() => window.__ENGINE__.dispose());
} finally { await browser.close(); await stopViteServer(server); }
