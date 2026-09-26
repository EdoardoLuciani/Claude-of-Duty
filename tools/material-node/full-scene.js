import { AmbientLight, DataTexture, DirectionalLight, EquirectangularReflectionMapping,
  PerspectiveCamera, RenderTarget, RGBAFormat, Scene, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MaterialSystemNode } from '../../src/materials/system-tsl.js';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { PALETTE } from '../../src/world/palette.js';

let renderer, materials, visual, target, environment;
try {
  const start = performance.now();
  renderer = await createWebGpuRenderer(document.querySelector('#game'));
  renderer.setSize(480, 270);
  renderer.setClearColor(0x86a1b4, 1);
  materials = new MaterialSystemNode({ renderer });
  await materials.init({ config: { quality: 'low', q: { anisotropy: 2 } } });
  const sharedMs = performance.now() - start;
  const meta = await (await fetch('/models/world/level.json')).json();
  const response = await fetch(`/models/world/${meta.assets.visual}`);
  if (!response.ok) throw new Error(`world GLB HTTP ${response.status}`);
  const data = response.headers.get('content-encoding')?.includes('gzip')
    ? await response.arrayBuffer()
    : await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  visual = await new GLTFLoader().parseAsync(data, '/models/world/');
  const scene = new Scene();
  scene.add(visual.scene);
  const sky = new Uint8Array(16 * 8 * 4);
  for (let i = 0; i < sky.length; i += 4) {
    sky[i] = 175; sky[i + 1] = 186; sky[i + 2] = 199; sky[i + 3] = 255;
  }
  environment = new DataTexture(sky, 16, 8, RGBAFormat);
  environment.colorSpace = SRGBColorSpace;
  environment.mapping = EquirectangularReflectionMapping;
  environment.needsUpdate = true;
  scene.environment = environment;
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffe5c2, 2.8);
  sun.position.set(18, 60, 23);
  scene.add(sun);

  const worldMeshes = [], palettes = new Set();
  const prep = performance.now();
  visual.scene.traverse((mesh) => {
    if (!mesh.isMesh && !mesh.isInstancedMesh) return;
    const palette = mesh.userData?.palette;
    if (!PALETTE[palette]) throw new Error(`unknown world palette ${palette}`);
    const def = PALETTE[palette];
    palettes.add(palette);
    mesh.material = materials.get(def.name, def.opts);
    mesh.castShadow = mesh.userData.castShadow !== false;
    mesh.receiveShadow = mesh.userData.receiveShadow !== false;
    mesh.matrixAutoUpdate = false;
    if (mesh.isInstancedMesh) mesh.computeBoundingSphere();
    worldMeshes.push(mesh);
  });
  const bakeMs = performance.now() - prep;
  materials.setGroundLevel(0);
  const spawn = meta.spawns.find((s) => s.id === 'market') ?? meta.spawns[0];
  const camera = new PerspectiveCamera(72, 480 / 270, 0.08, 210);
  camera.position.fromArray(spawn.position).add(new Vector3(0, 1.65, 0));
  camera.lookAt(camera.position.clone().add(new Vector3(...spawn.forward)));
  target = new RenderTarget(480, 270);
  renderer.setRenderTarget(target);
  const renderStart = performance.now();
  renderer.render(scene, camera);
  const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 480, 270);
  // WebGPU readback rows may be padded to 256-byte alignment. Repack before
  // checking pixels or writing the PNG (480 RGBA pixels occupy 1920 bytes).
  const rowBytes = (raw.length - 480 * 4) / 269;
  if (rowBytes < 480 * 4 || !Number.isInteger(rowBytes))
    throw new Error(`invalid world readback stride ${rowBytes}`);
  const pixels = new Uint8Array(480 * 270 * 4);
  for (let y = 0; y < 270; y++)
    pixels.set(raw.subarray(y * rowBytes, y * rowBytes + 480 * 4), y * 480 * 4);
  const firstRenderMs = performance.now() - renderStart;
  const paletteHistogram = new Set();
  let changed = 0, nonBlack = 0;
  const skyPixel = pixels.subarray(0, 3);
  for (let i = 0; i < pixels.length; i += 4) {
    paletteHistogram.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    if (Math.abs(pixels[i] - skyPixel[0]) + Math.abs(pixels[i + 1] - skyPixel[1]) +
      Math.abs(pixels[i + 2] - skyPixel[2]) > 12) changed++;
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 16) nonBlack++;
  }
  renderer.setRenderTarget(null);
  window.__MATERIAL_WORLD__ = { ok: true, meshes: worldMeshes.length, palettes: palettes.size,
    instances: worldMeshes.filter((m) => m.isInstancedMesh).reduce((n, m) => n + m.count, 0),
    names: materials.names().length, sharedMs, bakeMs, firstRenderMs,
    changed, nonBlack, colorBins: paletteHistogram.size,
    pixels: new URLSearchParams(location.search).has('capture') ? Array.from(pixels) : null };
} catch (error) {
  window.__MATERIAL_WORLD__ = { ok: false, error: error.message, stack: error.stack };
} finally {
  target?.dispose();
  materials?.dispose();
  environment?.dispose();
  const geometries = new Set();
  visual?.scene.traverse((o) => { if (o.isMesh) geometries.add(o.geometry); });
  for (const geometry of geometries) geometry.dispose();
  await renderer?.dispose();
}
