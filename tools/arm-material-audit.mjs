/** Independent arm material checks: glTF contract, linear color, neutral BRDF.
 * Standalone fixtures, not a second gameplay backend or a legacy-look target.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from './lib/browser-harness.mjs';
const args = parseArgs(), root = resolve(String(args.root ?? '.'));
const backend = String(args.backend ?? 'webgpu'), port = Number(args.port ?? 5304);
const out = resolve(String(args.out ?? '/tmp/cod-sleeve-audit'));
assert.equal(process.env.MESA_VK_DEVICE_SELECT, '1002:7550!');
assert(['webgl', 'webgpu'].includes(backend));
assert(!args['f90-control'], 'forward control retired: use the default compensation or --uncompensated for a negative');
mkdirSync(out, { recursive: true });
const server = await ensureViteServer({ root, port });
let browser;
try {
  browser = await launchChromium({ webgpu: backend === 'webgpu', headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage(), errors = [];
  if (args.uncompensated) {
    assert.equal(backend, 'webgpu');
    assert(['1', 'retro'].includes(args.uncompensated));
    await page.route('**/node_modules/.vite/deps/three_webgpu.js*', async route => {
      const response = await route.fetch(), body = await response.text();
      const pattern = args.uncompensated === 'retro'
        ? /(viewDirection: retroViewDirection,\s+f0: specularColorBlended,\s+f90: )specularF90/g
        : /(f0: specularColorBlended,\s+f90: )specularF90/g;
      assert.equal([...body.matchAll(pattern)].length, args.uncompensated === 'retro' ? 1 : 2);
      await route.fulfill({ response, body: body.replace(pattern, (_match, prefix) => `${prefix}1`) });
    });
  }
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/__arm_audit__', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto(`http://localhost:${port}/__arm_audit__`);
  const report = await page.evaluate(async backend => {
    const native = backend === 'webgpu';
    const fixture = native ? await import('/tools/arm-material-fixture.js') : null;
    const T = fixture?.THREE ?? await import('/node_modules/.vite/deps/three.js');
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const canvas = document.querySelector('canvas');
    const r = native ? new T.WebGPURenderer({ canvas, antialias: false }) : new T.WebGLRenderer({ canvas, antialias: false });
    if (native) await r.init();
    let device;
    if (native) {
      const a = r.backend.device.adapterInfo;
      device = { vendor: a.vendor, architecture: a.architecture, fallback: a.isFallbackAdapter };
      if (a.vendor !== 'amd' || a.architecture !== 'rdna-4' || a.isFallbackAdapter !== false) throw new Error('wrong native device');
    } else {
      const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      device = { renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
      if (!/RX 9070 XT|GFX1201/i.test(device.renderer)) throw new Error('wrong legacy device');
    }
    r.setSize(128, 128); r.toneMapping = T.NoToneMapping; r.outputColorSpace = T.LinearSRGBColorSpace;
    const gltf = await new GLTFLoader().loadAsync('/models/player/arms.glb');
    const materials = new Map();
    gltf.scene.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.set(m.name, m); });
    const source = materials.get('Olive_ripstop');
    const describe = m => ({ name: m.name, type: m.type, color: m.color.toArray(), roughness: m.roughness,
      metalness: m.metalness, ior: m.ior ?? null, specularIntensity: m.specularIntensity ?? null,
      specularColor: m.specularColor?.toArray() ?? null, normalScale: m.normalScale.toArray(),
      maps: Object.fromEntries(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'].map(k =>
        [k, m[k] ? { colorSpace: m[k].colorSpace, channel: m[k].channel, flipY: m[k].flipY } : null])) });
    const physical = () => {
      if (!native) return source.clone();
      const m = new T.MeshPhysicalNodeMaterial(); T.MeshPhysicalMaterial.prototype.copy.call(m, source); return m;
    };
    const current = native ? fixture.createArmMaterial(source) : source.clone();
    // Current gameplay preserves authored base color. Keep the old .30 only
    // as the explicitly named unlit calibration control below.
    const preserved = physical();
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 2;
    const light = new T.DirectionalLight(0xffffff, Math.PI); light.position.set(0, 0, 5); scene.add(light);
    const geo = new T.PlaneGeometry(2, 2); geo.setAttribute('uv1', geo.getAttribute('uv').clone());
    const mesh = new T.Mesh(geo, current); scene.add(mesh);
    const Target = native ? T.RenderTarget : T.WebGLRenderTarget;
    const target = new Target(128, 128, { type: T.FloatType, format: T.RGBAFormat,
      minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false });
    const render = async mat => {
      mesh.material = mat; r.setRenderTarget(target); r.render(scene, camera);
      let pixels;
      if (native) pixels = await r.readRenderTargetPixelsAsync(target, 0, 0, 128, 128);
      else { pixels = new Float32Array(128 * 128 * 4); r.readRenderTargetPixels(target, 0, 0, 128, 128, pixels); }
      const mean = [0, 0, 0];
      for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += pixels[i + c] / (128 * 128);
      return { mean, center: Array.from(pixels.slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 3)) };
    };
    const basic = native ? new T.MeshBasicNodeMaterial() : new T.MeshBasicMaterial();
    basic.toneMapped = false;
    const swatch = new T.DataTexture(new Uint8Array([58, 64, 43, 255]), 1, 1);
    swatch.colorSpace = T.SRGBColorSpace; swatch.needsUpdate = true;
    basic.map = swatch;
    const srgb = await render(basic);
    const decode = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    const expectedSrgb = [58, 64, 43].map(v => decode(v / 255));
    basic.map = source.map; basic.needsUpdate = true;
    const authoredAlbedo = await render(basic);
    basic.color.setScalar(.30);
    const calibratedAlbedo = await render(basic);
    const stripMaps = m => {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) m[k] = null;
      m.color.setScalar(0); m.metalness = 0; m.roughness = 1; m.needsUpdate = true;
    };
    const authoredDescription = describe(source), currentDescription = describe(current);
    const preservedDescription = describe(preserved);
    const currentTextured = await render(current), preservedTextured = await render(preserved);
    stripMaps(current); stripMaps(preserved);
    const currentBlackSpecular = await render(current), preservedBlackSpecular = await render(preserved);
    // Do not equate GGX single scattering to the complete r186 response:
    // both backends also apply DFG-based multi-scattering compensation.
    // Instead specularFactor=0 has an independent oracle: pure Lambert diffuse.
    preserved.specularIntensity = 0; preserved.color.setScalar(.18); preserved.needsUpdate = true;
    const diffuseOnly = [];
    for (const retroreflectivity of [0, 1]) for (const degrees of [0, 45, 75]) {
      preserved.retroreflectivity = retroreflectivity; preserved.needsUpdate = true;
      const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      camera.position.set(2 * sin, 0, 2 * cos); camera.lookAt(0, 0, 0);
      light.position.set(-5 * sin, 0, 5 * cos);
      const actual = await render(preserved), expected = .18 * cos;
      diffuseOnly.push({ degrees, retroreflectivity, actual, expected,
        maxError: Math.max(...actual.center.map(v => Math.abs(v - expected))),
        // Diagnostic prediction for the pinned native direct-BRDF f90:1 path.
        hardcodedF90Excess: .25 * 2 ** ((-5.55473 * cos - 6.98316) * cos) });
    }
    const diffuseOnlyConformant = diffuseOnly.every(p => p.maxError < 2e-6);
    const matrix = [];
    preserved.color.setRGB(.18, .24, .12);
    for (const specularIntensity of [0, .16, 1]) for (const metalness of [0, .5, 1])
      for (const roughness of [.25, 1]) for (const retroreflectivity of [0, .6]) for (const degrees of [0, 45, 75]) {
        Object.assign(preserved, { specularIntensity, metalness, roughness, retroreflectivity, needsUpdate: true });
        const angle = degrees * Math.PI / 180;
        camera.position.set(2 * Math.sin(angle), 0, 2 * Math.cos(angle)); camera.lookAt(0, 0, 0);
        light.position.set(-5 * Math.sin(angle), 0, 5 * Math.cos(angle));
        matrix.push({ specularIntensity, metalness, roughness, retroreflectivity, degrees, rgb: (await render(preserved)).center });
      }
    const result = { backend, device, authoredDescription, currentDescription, preservedDescription,
      srgb, expectedSrgb, authoredAlbedo, calibratedAlbedo, calibrationControlScale: .30, currentTextured, preservedTextured,
      currentBlackSpecular, preservedBlackSpecular, diffuseOnly, diffuseOnlyConformant, matrix };
    r.setRenderTarget(null); target.dispose(); geo.dispose(); basic.dispose(); swatch.dispose();
    current.dispose(); preserved.dispose(); r.dispose();
    return result;
  }, backend);
  writeFileSync(`${out}/${backend}-material.json`, JSON.stringify({ ...report,
    uncompensated: args.uncompensated ?? false, errors }, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  // Hardware sRGB lookup/quantization is not an exact CPU pow() evaluation.
  report.srgb.center.forEach((v, i) => assert(Math.abs(v - report.expectedSrgb[i]) < 2e-4));
  assert.equal(report.authoredDescription.specularIntensity, 0.1599999964237213);
  assert.equal(report.currentDescription.specularIntensity, report.authoredDescription.specularIntensity);
  assert.deepEqual(report.currentTextured, report.preservedTextured, 'application adapter preserves the physical material response');
  for (const row of report.matrix) assert(row.rgb.every(Number.isFinite), 'finite BRDF samples');
  if (args.strict === '1') assert(report.diffuseOnlyConformant, 'zero-specular material is not pure Lambert diffuse');
} finally { await browser?.close(); await stopViteServer(server); }
