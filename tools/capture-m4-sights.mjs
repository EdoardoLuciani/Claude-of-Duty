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
const allVariants = [
  { id: 'A', label: 'Current / 2.60 mm', scale: 1 },
  { id: 'B', label: '+25% / 3.25 mm', scale: 1.25 },
  { id: 'C', label: '+50% / 3.90 mm', scale: 1.5 },
  { id: 'D', label: '+100% / 5.20 mm', scale: 2 },
  { id: 'E', label: '+50% / ivory tip', scale: 1.5, paint: 0xd1cbb8 },
  { id: 'F', label: '+50% / amber tip', scale: 1.5, paint: 0xc69b4b },
  { id: 'G', label: 'Wide hole / green tip', scale: 1, apertureScale: 2, paint: 0x39ff14, emissive: 2 },
  { id: 'H', label: 'Green / clear support', scale: 1, apertureScale: 2, paint: 0x39ff14, emissive: 2, clearSupport: true },
];
const requested = args.variants ? String(args.variants).split(',') : allVariants.map(v => v.id);
assert(requested.length && requested.every(id => allVariants.some(v => v.id === id)), 'Unknown variant ID');
const variants = allVariants.filter(v => requested.includes(v.id));
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
      const point = new THREE.Vector3();
      function isolate(test) {
        const pieces = [];
        root.updateMatrixWorld(true);
        root.traverse(mesh => {
          if (!mesh.isMesh) return;
          const geo = mesh.geometry, position = geo.getAttribute('position'), index = geo.index;
          if (!index) return;
          const toRoot = new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
          const inside = new Uint8Array(position.count);
          for (let i = 0; i < position.count; i++) {
            point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
            inside[i] = test(point) ? 1 : 0;
          }
          const post = [], rest = [];
          for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
            (inside[a] && inside[b] && inside[c] ? post : rest).push(a, b, c);
          }
          if (post.length) pieces.push({ mesh, geo, toRoot, post, rest });
        });
        if (pieces.length !== 1) throw new Error(`Expected one isolated sight part, got ${pieces.length}`);
        return pieces[0];
      }
      // Copy only the isolated part's vertices, preserving authored UVs/normals.
      function extract({ geo, post, toRoot }) {
        const ids = [...new Set(post)], remap = new Map(ids.map((id, i) => [id, i]));
        const part = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(geo.attributes)) {
          const values = new attribute.array.constructor(ids.length * attribute.itemSize);
          ids.forEach((id, i) => {
            for (let j = 0; j < attribute.itemSize; j++) values[i * attribute.itemSize + j] = attribute.array[id * attribute.itemSize + j];
          });
          part.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
        }
        part.setIndex(post.map(id => remap.get(id)));
        return part.applyMatrix4(toRoot);
      }
      const front = isolate(p => Math.abs(p.x - top.x) <= radius + epsilon &&
        Math.abs(p.z - top.z) <= radius + epsilon &&
        p.y >= top.y - height - epsilon && p.y <= top.y + epsilon);
      const { mesh, geo, post, rest } = front;
      const postGeo = extract(front);
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
          // 1.4 mm tip sleeve. G/H add emission; E/F remain non-emissive.
          const paintHeight = .0014;
          const tipGeo = new THREE.CylinderGeometry(radius + .00001, radius + .00001, paintHeight, 16);
          tipGeo.scale(variant.scale, 1, 1);
          tipGeo.translate(top.x, top.y - paintHeight / 2, top.z);
          const tipMat = new THREE.MeshPhysicalMaterial({ color: variant.paint, metalness: 0, roughness: .8,
            specularIntensity: .12, emissive: variant.emissive ? variant.paint : 0, emissiveIntensity: variant.emissive ?? 0 });
          const tip = new THREE.Mesh(tipGeo, tipMat);
          tip.frustumCulled = false;
          tip.receiveShadow = true;
          root.add(tip);
        }
      } else postGeo.dispose();
      const sight = root.getObjectByName('SOCKET_sight').getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
      // Exact authored cup rings: exclude the supporting stalk and housing.
      const rings = [[-.0017, .0035], [0, .0038], [.0017, .0036], [.002, .0032], [.0019, .0028], [0, .0014], [-.0017, .0014]];
      const onCup = p => rings.some(([z, r]) => Math.abs(p.z - sight.z - z) < epsilon &&
        Math.abs(Math.hypot(p.x - sight.x, p.y - sight.y) - r) < epsilon);
      const inner = .0014 * (variant.apertureScale ?? 1), outer = .0038;
      let supportTop = null, supportMesh = null, cupMesh = null;
      if (variant.clearSupport) {
        const support = isolate(p => Math.abs(p.x - sight.x) <= .00225 + epsilon &&
          p.y >= .119 - epsilon && p.y <= .139 + epsilon &&
          p.z >= .029 - epsilon && p.z <= .038 + epsilon && !onCup(p));
        const stalk = extract(support);
        stalk.computeBoundingBox();
        const bounds = stalk.boundingBox, width = bounds.max.x - bounds.min.x;
        if (Math.abs(width - .0045) > epsilon || bounds.max.y < .1385 || bounds.min.y > .1195) {
          throw new Error(`Support isolation failed: ${JSON.stringify(bounds)}`);
        }
        // Keep its base planted; shorten it to the cup's lower wall, below the throat.
        supportTop = sight.y - inner - .0001;
        const base = bounds.min.y, heightScale = (supportTop - base) / (bounds.max.y - base);
        stalk.translate(0, -base, 0);
        stalk.scale(1, heightScale, 1);
        stalk.translate(0, base, 0);
        support.mesh.geometry = support.mesh.geometry.clone();
        support.mesh.geometry.setIndex(support.rest);
        supportMesh = new THREE.Mesh(stalk, support.mesh.material);
        supportMesh.frustumCulled = false;
        supportMesh.receiveShadow = true;
        root.add(supportMesh);
      }
      const rear = isolate(onCup);
      if (rear.post.length / 3 !== 672) throw new Error(`Unexpected cup topology: ${rear.post.length / 3}`);
      if (variant.apertureScale) {
        const cup = extract(rear), positions = cup.getAttribute('position');
        const radialScale = (outer - inner) / (outer - .0014);
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i);
          const dx = point.x - sight.x, dy = point.y - sight.y, r = Math.hypot(dx, dy);
          const next = inner + (r - .0014) * radialScale;
          positions.setXYZ(i, sight.x + dx * next / r, sight.y + dy * next / r, point.z);
        }
        cup.computeVertexNormals();
        rear.mesh.geometry = rear.mesh.geometry.clone();
        rear.mesh.geometry.setIndex(rear.rest);
        cupMesh = new THREE.Mesh(cup, rear.mesh.material);
        cupMesh.frustumCulled = false;
        cupMesh.receiveShadow = true;
        root.add(cupMesh);
      }
      // Prove the new throat is clear and its rim is still present, not a mask.
      root.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(), direction = new THREE.Vector3(0, 0, -1).transformDirection(root.matrixWorld);
      let supportContactDepth = 0, supportContactSamples = 0;
      if (supportMesh) {
        // Real shared solid volume, not just touching bounding boxes or an ADS silhouette.
        const probeMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        const supportProbe = new THREE.Mesh(supportMesh.geometry, probeMat);
        const cupProbe = new THREE.Mesh(cupMesh.geometry, probeMat);
        supportProbe.matrixWorld.copy(supportMesh.matrixWorld);
        cupProbe.matrixWorld.copy(cupMesh.matrixWorld);
        const up = new THREE.Vector3(0, 1, 0).transformDirection(root.matrixWorld);
        function boundaries(probe) {
          const distances = ray.intersectObject(probe, false).map(hit => hit.distance);
          const unique = distances.filter((d, i) => !i || d - distances[i - 1] > epsilon);
          if (unique.length % 2) throw new Error('Open/ambiguous junction geometry');
          return unique;
        }
        for (const x of [-.0008, 0, .0008]) for (const z of [-.0014, -.0009, -.0004, .0001, .0006, .0011]) {
          const origin = new THREE.Vector3(sight.x + x, .11, sight.z + z).applyMatrix4(root.matrixWorld);
          ray.set(origin, up); ray.far = .04;
          const stalk = boundaries(supportProbe), cup = boundaries(cupProbe);
          let depth = 0;
          for (let s = 0; s < stalk.length; s += 2) for (let c = 0; c < cup.length; c += 2) {
            depth = Math.max(depth, Math.min(stalk[s + 1], cup[c + 1]) - Math.max(stalk[s], cup[c]));
          }
          if (depth > epsilon) supportContactSamples++;
          supportContactDepth = Math.max(supportContactDepth, depth);
        }
        probeMat.dispose();
        if (supportContactSamples < 3 || supportContactDepth < .00025) {
          throw new Error(`Rear ring is not securely anchored: ${supportContactSamples} contact rays, ${supportContactDepth * 1000} mm overlap`);
        }
      }
      for (const [fraction, blocked] of [[.98, false], [1.02, true]]) {
        const origin = sight.clone().add(new THREE.Vector3(inner * fraction, 0, .025)).applyMatrix4(root.matrixWorld);
        ray.set(origin, direction); ray.far = .05;
        if ((ray.intersectObject(root, true).length > 0) !== blocked) throw new Error(`Rear throat/rim check failed at ${fraction}`);
      }
      // Sample the whole near opening, including its lower third, not just its sides.
      let apertureSamples = 0, apertureObstructed = 0;
      for (let x = -7; x <= 7; x++) for (let y = -7; y <= 7; y++) {
        if (Math.hypot(x / 8, y / 8) > .9) continue;
        const origin = sight.clone().add(new THREE.Vector3(inner * x / 8, inner * y / 8, .025)).applyMatrix4(root.matrixWorld);
        ray.set(origin, direction); ray.far = .05;
        apertureSamples++;
        if (ray.intersectObject(root, true).length) apertureObstructed++;
      }
      if (variant.clearSupport && apertureObstructed) throw new Error(`Support still blocks ${apertureObstructed}/${apertureSamples} aperture rays`);
      await window.__PUMP__(100);
      await window.__PRESENT__(2);
      return { top: top.toArray(), authoredSize: size.toArray(), postTriangles: post.length / 3,
        apertureDiameter: inner * 2, apertureOuterDiameter: outer * 2, supportTop, apertureSamples, apertureObstructed,
        supportContactDepth, supportContactSamples,
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
  const board = await browser.newPage({ viewport: { width: Math.max(800, 40 + variants.length * 256), height: 1100 }, deviceScaleFactor: 1 });
  for (const zoom of [1, 3]) {
    const rows = scenes.map(scene => `<h2>${scene.label}</h2><section>${variants.map(variant => {
      const file = captures.find(c => c.scene === scene.id && c.variant === variant.id).file;
      const data = readFileSync(`${out}/${file}`).toString('base64');
      return `<article><h3>${variant.id} — ${variant.label}</h3><div class="crop"><img src="data:image/png;base64,${data}" style="width:${scene.width * zoom}px;height:${scene.height * zoom}px"></div></article>`;
    }).join('')}</section>`).join('');
    await board.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;padding:20px;background:#171c23;color:#e6edf3;font:16px system-ui}
      h1{font-size:23px;margin:0 0 8px}p{margin:0 0 18px;color:#b5c0ce}h2{font-size:17px;margin:18px 0 10px}
      section{display:grid;grid-template-columns:repeat(${variants.length},248px);gap:8px}h3{font-size:14px;margin:0;padding:10px 6px;background:#303944}
      .crop{position:relative;width:248px;height:248px;overflow:hidden;background:#111}
      img{position:absolute;max-width:none;left:50%;top:50%;transform:translate(-50%,-50%);${zoom > 1 ? 'image-rendering:pixelated;' : ''}}
    </style><h1>M4A1 sight prototypes — ${zoom === 1 ? 'native-size center crops' : '3× pixel enlargement (diagnostic only)'}</h1>
    <p>Same pose / frame 103 / unchanged FOV, recoil and accuracy.<br>G/H: 2× rear hole, original post width, green tip. H: support below opening.</p>${rows}`);
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
