#!/usr/bin/env node
// Analytic plane/box oracle for shadow acne and retained blocker/contact coverage.
import assert from 'node:assert/strict';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs(), port = Number(args.port ?? 5326);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-angle=vulkan','--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/csm-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>CSM bias oracle</title>' }));
  if (args.negative) await page.route('**/src/render/csm-webgpu.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = '      light.shadow.biasNode ??= cascadeBias(light.shadow, this.light);';
    assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, '') });
  });
  if (args['volume-negative']) await page.route('**/src/render/volumetric-shadow.js', async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = 'const empty = new DepthTexture(1, 1);'; assert.equal(body.split(marker).length, 2);
    await route.fulfill({ response, body: body.replace(marker, 'const empty = placeholders[0] ?? new DepthTexture(1, 1);') });
  });
  await page.goto(`http://localhost:${port}/csm-check.html`);
  const result = await page.evaluate(async () => {
    const { THREE: T, TSL: N } = await import('/tools/arm-material-fixture.js');
    const { createVolumetricShadow } = await import('/src/render/volumetric-shadow.js');
    const { StableCSMShadowNode } = await import('/src/render/csm-webgpu.js');
    const { createWebGpuRenderer } = await import('/src/render/webgpu-device.js');
    const r = await createWebGpuRenderer(document.createElement('canvas'));
    const a = r.backend.device.adapterInfo;
    if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter) throw new Error('RX 9070 XT required');
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFShadowMap;
    const size = 256, target = new T.RenderTarget(size, size, { type: T.FloatType });
    const camera = new T.PerspectiveCamera(60, 1, .1, 150);
    camera.position.set(0, 5, 12); camera.lookAt(0, 0, -22); camera.updateMatrixWorld(true);
    const bounds = new T.Box3(new T.Vector3(-1, 0, -12), new T.Vector3(1, 4, -10));
    const ray = new T.Ray(), sunRay = new T.Ray(), hit = new T.Vector3(), point = new T.Vector3();
    const ndc = new T.Vector3(), planeMath = new T.Plane(new T.Vector3(0, 1, 0), 0), rows = [];
    try {
      for (const resolution of [512, 1024, 2048]) for (const elevation of [15, 35, 65]) {
        const scene = new T.Scene();
        const material = new T.MeshLambertNodeMaterial({ color: 0xffffff, side: T.DoubleSide });
        const plane = new T.Mesh(new T.PlaneGeometry(300, 300), material);
        plane.rotation.x = -Math.PI / 2; plane.castShadow = plane.receiveShadow = true;
        const box = new T.Mesh(new T.BoxGeometry(2, 4, 2), material); box.position.set(0, 2, -11); box.castShadow = box.receiveShadow = true;
        const angle = elevation * Math.PI / 180;
        const direction = new T.Vector3(.7 * Math.cos(angle), Math.sin(angle), Math.sqrt(.51) * Math.cos(angle));
        const light = new T.DirectionalLight(0xffffff, Math.PI / direction.y);
        light.position.copy(direction).multiplyScalar(100); light.castShadow = true;
        light.shadow.mapSize.set(resolution, resolution); light.shadow.bias = -.00008; light.shadow.normalBias = .02;
        const csm = new StableCSMShadowNode(light, { cascades: 3, maxFar: 120, lightMargin: 50 });
        light.shadow.shadowNode = csm;
        scene.add(plane, box, light, light.target);
        r.setRenderTarget(target); r.render(scene, camera);
        const pixels = await r.readRenderTargetPixelsAsync(target, 0, 0, size, size);
        const texel = Math.max(...csm.lights.map(l => (l.shadow.camera.right - l.shadow.camera.left) / resolution));
        let lit = 0, acne = 0, minLit = 1, dark = 0, darkSum = 0, nearestDark = Infinity;
        const blocked = (x, z) => { sunRay.origin.set(x, .0001, z); sunRay.direction.copy(direction); return !!sunRay.intersectBox(bounds, hit); };
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          ndc.set((x + .5) / size * 2 - 1, 1 - (y + .5) / size * 2, .5).unproject(camera);
          ray.origin.copy(camera.position); ray.direction.copy(ndc).sub(camera.position).normalize();
          if (!ray.intersectPlane(planeMath, point) || Math.abs(point.x) > 60 || point.z < -65 || point.z > 5) continue;
          const obstruction = ray.intersectBox(bounds, hit);
          if (obstruction && hit.distanceToSquared(camera.position) < point.distanceToSquared(camera.position)) continue;
          const value = pixels[(y * size + x) * 4];
          if (!Number.isFinite(value)) throw new Error('non-finite shadow output');
          const m = texel * 3;
          const tests = [[0,0],[-m,0],[m,0],[0,-m],[0,m]].map(([dx,dz]) => blocked(point.x + dx, point.z + dz));
          if (tests.every(v => !v)) { lit++; minLit = Math.min(minLit, value); if (value < .97) acne++; }
          if (tests.every(Boolean)) { dark++; darkSum += value; }
          if (tests[0] && value < .2) {
            const distance = Math.hypot(Math.max(-1 - point.x, 0, point.x - 1), Math.max(-12 - point.z, 0, point.z + 10));
            nearestDark = Math.min(nearestDark, distance);
          }
        }
        const volume = createVolumetricShadow({ activeSun: light, ctx: { camera }, q: { cascades: 3, shadowDistance: 120 } });
        const probeMaterial = new T.NodeMaterial();
        probeMaterial.fragmentNode = N.vec4(volume.visibility(N.vec3(N.screenUV.x.mul(40).sub(20), 2, N.screenUV.y.mul(30).sub(25))).xxx, 1);
        new T.QuadMesh(probeMaterial).render(r);
        const mask = await r.readRenderTargetPixelsAsync(target, 0, 0, size, size);
        const lightRight = new T.Vector3().setFromMatrixColumn(csm.lights[0].shadow.camera.matrixWorld, 0);
        const lightUp = new T.Vector3().setFromMatrixColumn(csm.lights[0].shadow.camera.matrixWorld, 1);
        let volumeLit = 0, volumeDark = 0, volumeBad = 0;
        const volumeErrors = [];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const px = (x + .5) / size * 40 - 20, pz = (y + .5) / size * 30 - 25;
          // Exclude the PCF footprint in LIGHT-plane coordinates, not world
          // XZ: at low sun a texture texel projects far across the receiver.
          const states = [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]].map(([dx,dy]) => {
            sunRay.origin.set(px, 2, pz).addScaledVector(lightRight, dx * texel * 3).addScaledVector(lightUp, dy * texel * 3);
            sunRay.direction.copy(direction);
            return sunRay.origin.y < 0 || !!sunRay.intersectBox(bounds, hit);
          });
          const value = mask[(y * size + x) * 4];
          if (!Number.isFinite(value)) throw new Error('non-finite volume visibility');
          if (states.every(v => !v)) { volumeLit++; if (value < .95) volumeBad++; }
          if (states.every(Boolean)) { volumeDark++; if (value > .05) volumeBad++; }
          if (volumeErrors.length < 5 && ((states.every(v => !v) && value < .95) || (states.every(Boolean) && value > .05))) volumeErrors.push({ px, pz, value, blocked: states[0] });
        }
        probeMaterial.dispose(); volume.dispose();
        rows.push({ resolution, elevation, texel, lit, acne, minLit, dark, darkMean: dark ? darkSum / dark : null, nearestDark,
          volumeLit, volumeDark, volumeBad, volumeErrors });
        csm.dispose(); material.dispose(); plane.geometry.dispose(); box.geometry.dispose();
      }
    } finally { r.setRenderTarget(null); target.dispose(); r.dispose(); }
    return { device: { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter }, rows };
  });
  console.log(JSON.stringify(result, null, 2)); assert.deepEqual(errors, []);
  assert(result.rows.reduce((sum, row) => sum + row.volumeDark, 0) > 100, 'enough fully occluded volume samples');
  for (const row of result.rows) {
    assert(row.volumeLit > 40000);
    assert(row.volumeBad === 0, 'volumetric visibility disagrees with clear/blocked world rays');
    assert(row.lit > 10000); assert(row.acne / row.lit < .001, 'unoccluded plane has shadow bands');
    if (row.dark) assert(row.darkMean < .1, 'blocker shadow was lost');
    assert(row.nearestDark < Math.max(.15, row.texel), 'contact shadow detached by more than one coarse cascade texel');
  }
} finally { await browser.close(); stopViteServer(server); }
