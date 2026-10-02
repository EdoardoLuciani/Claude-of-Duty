#!/usr/bin/env node
/** Review-only front-post alternatives; never changes the shipped M4 asset.
 * node tools/capture-m4-sights.mjs --port=5208 --out=.tmp-rend/m4-sights
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';

const args = parseArgs(), port = Number(args.port ?? 5208);
const out = resolve(args.out ?? '.tmp-rend/m4-sights');
mkdirSync(out, { recursive: true });
const variants = [
  { id: 'A', label: 'Current / 2.60 mm', scale: 1 },
  { id: 'B', label: '+25% / 3.25 mm', scale: 1.25 },
  { id: 'C', label: '+50% / 3.90 mm', scale: 1.5 },
  { id: 'D', label: '+100% / 5.20 mm', scale: 2 },
  { id: 'E', label: '+50% / ivory tip', scale: 1.5, paint: 0xd1cbb8 },
  { id: 'F', label: '+50% / amber tip', scale: 1.5, paint: 0xc69b4b },
];
const scenes = [
  { id: 'day-1080', label: 'Daylight / 1920 × 1080', width: 1920, height: 1080, time: 16.5 },
  { id: 'dusk-1080', label: 'Dusk / 1920 × 1080', width: 1920, height: 1080, time: 19.2 },
  { id: 'day-720', label: 'Daylight / 1280 × 720', width: 1280, height: 720, time: 16.5 },
];
const server = await ensureViteServer({ port });
const browser = await launchChromium({ headless: true, args: [
  '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
  '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars',
] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const errors = [], captures = [];
page.on('pageerror', e => errors.push(e.stack));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

try {
  for (const scene of scenes) for (const variant of variants) {
    // Fresh engine per capture: identical RNG, idle phase, camera and TAA history.
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 90000 });
    const metrics = await page.evaluate(async ({ variant, time }) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      window.__APPLY_SHOT__('weapon');
      const ctx = window.__ENGINE__.ctx, w = ctx.get('weapons');
      ctx.get('sky').setTimeOfDay(time);
      ctx.get('player').setControlEnabled(true);
      w.debugMode = 'ads';
      const root = w.viewmodel.active.animation.root;
      root.updateMatrixWorld(true);
      const inverseRoot = root.matrixWorld.clone().invert();
      const top = root.getObjectByName('SOCKET_front_post').getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
      const radius = .0013, height = .1395 - .132642, epsilon = .000002;
      const point = new THREE.Vector3(), pieces = [];
      root.traverse(mesh => {
        if (!mesh.isMesh) return;
        const geo = mesh.geometry, position = geo.getAttribute('position'), index = geo.index;
        if (!index) return;
        const toRoot = new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
        const inside = new Uint8Array(position.count);
        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
          inside[i] = Math.abs(point.x - top.x) <= radius + epsilon &&
            Math.abs(point.z - top.z) <= radius + epsilon &&
            point.y >= top.y - height - epsilon && point.y <= top.y + epsilon ? 1 : 0;
        }
        const post = [], rest = [];
        for (let i = 0; i < index.count; i += 3) {
          const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
          (inside[a] && inside[b] && inside[c] ? post : rest).push(a, b, c);
        }
        if (post.length) pieces.push({ mesh, geo, toRoot, post, rest });
      });
      if (pieces.length !== 1) throw new Error(`Expected one isolated front post, got ${pieces.length}`);
      const { mesh, geo, toRoot, post, rest } = pieces[0];
      // Copy ONLY the isolated post's vertices, preserving authored UVs/normals.
      const ids = [...new Set(post)], remap = new Map(ids.map((id, i) => [id, i]));
      const postGeo = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geo.attributes)) {
        const values = new attribute.array.constructor(ids.length * attribute.itemSize);
        ids.forEach((id, i) => {
          for (let j = 0; j < attribute.itemSize; j++) values[i * attribute.itemSize + j] = attribute.array[id * attribute.itemSize + j];
        });
        postGeo.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
      }
      postGeo.setIndex(post.map(id => remap.get(id)));
      postGeo.applyMatrix4(toRoot);
      postGeo.computeBoundingBox();
      const size = postGeo.boundingBox.getSize(new THREE.Vector3());
      if (Math.abs(size.x - radius * 2) > epsilon || Math.abs(size.y - height) > epsilon || post.length < 90) {
        throw new Error(`Post isolation failed: ${JSON.stringify({ size, indices: post.length })}`);
      }
      // Baseline remains the untouched authored mesh, not a reconstructed cylinder.
      if (variant.scale !== 1 || variant.paint) {
        mesh.geometry = geo.clone();
        mesh.geometry.setIndex(rest);
        postGeo.translate(-top.x, 0, 0);
        postGeo.scale(variant.scale, 1, 1);
        postGeo.translate(top.x, 0, 0);
        const replacement = new THREE.Mesh(postGeo, mesh.material);
        replacement.frustumCulled = false;
        replacement.receiveShadow = true;
        root.add(replacement);
        if (variant.paint) {
          // Opaque, non-emissive 1.4 mm paint sleeve. Top stays at the same datum.
          const paintHeight = .0014;
          const tipGeo = new THREE.CylinderGeometry(radius + .00001, radius + .00001, paintHeight, 16);
          tipGeo.scale(variant.scale, 1, 1);
          tipGeo.translate(top.x, top.y - paintHeight / 2, top.z);
          const tipMat = new THREE.MeshPhysicalMaterial({ color: variant.paint, metalness: 0, roughness: .8, specularIntensity: .12 });
          const tip = new THREE.Mesh(tipGeo, tipMat);
          tip.frustumCulled = false;
          tip.receiveShadow = true;
          root.add(tip);
        }
      } else postGeo.dispose();
      await window.__PUMP__(100);
      await window.__PRESENT__(2);
      return { top: top.toArray(), authoredSize: size.toArray(), postTriangles: post.length / 3,
        frame: ctx.time.frame, worldFov: ctx.camera.fov, viewFov: ctx.viewCamera.fov,
        reticle: w.viewmodel.reticle.visible, render: window.__RENDER_INFO__ };
    }, { variant, time: scene.time });
    assert.equal(metrics.reticle, false);
    assert.equal(metrics.frame, 103);
    const file = `${scene.id}-${variant.id}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    captures.push({ scene: scene.id, variant: variant.id, file, ...metrics });
    console.log(`Captured ${file}`);
  }
  assert.deepEqual(errors, []);
  for (const scene of scenes) {
    const group = captures.filter(c => c.scene === scene.id);
    for (const c of group) {
      assert.equal(c.worldFov, group[0].worldFov);
      assert.equal(c.viewFov, group[0].viewFov);
      assert.deepEqual(c.top, group[0].top);
    }
  }
  // Review sheets use real captures, not re-rendered or composited sight artwork.
  const board = await browser.newPage({ viewport: { width: 1576, height: 1100 }, deviceScaleFactor: 1 });
  for (const zoom of [1, 3]) {
    const rows = scenes.map(scene => `<h2>${scene.label}</h2><section>${variants.map(variant => {
      const file = captures.find(c => c.scene === scene.id && c.variant === variant.id).file;
      const data = readFileSync(`${out}/${file}`).toString('base64');
      return `<article><h3>${variant.id} — ${variant.label}</h3><div class="crop"><img src="data:image/png;base64,${data}" style="width:${scene.width * zoom}px;height:${scene.height * zoom}px"></div></article>`;
    }).join('')}</section>`).join('');
    await board.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;padding:20px;background:#171c23;color:#e6edf3;font:16px system-ui}
      h1{font-size:23px;margin:0 0 8px}p{margin:0 0 18px;color:#b5c0ce}h2{font-size:17px;margin:18px 0 10px}
      section{display:grid;grid-template-columns:repeat(6,248px);gap:8px}h3{font-size:14px;margin:0;padding:10px 6px;background:#303944}
      .crop{position:relative;width:248px;height:248px;overflow:hidden;background:#111}
      img{position:absolute;max-width:none;left:50%;top:50%;transform:translate(-50%,-50%);${zoom > 1 ? 'image-rendering:pixelated;' : ''}}
    </style><h1>M4A1 front-post prototypes — ${zoom === 1 ? 'native-size center crops' : '3× pixel enlargement (diagnostic only)'}</h1>
    <p>Same pose / frame 103 / unchanged aperture, FOV, recoil and accuracy. E/F: non-emissive 1.4 mm painted tip.</p>${rows}`);
    await board.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
    await board.screenshot({ path: `${out}/comparison-${zoom}x.png`, fullPage: true });
  }
  await board.close();
  writeFileSync(`${out}/report.json`, JSON.stringify({ variants, scenes, captures, errors }, null, 2) + '\n');
  console.log(`Review captures and sheets: ${out}`);
} finally {
  await browser.close();
  stopViteServer(server);
}
