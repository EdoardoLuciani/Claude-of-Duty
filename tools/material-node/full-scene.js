import { AmbientLight, Color, DataTexture, DataUtils, DirectionalLight, EquirectangularReflectionMapping,
  PerspectiveCamera, RenderTarget, RGBAFormat, Scene, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { MaterialSystemNode } from '../../src/materials/index.js';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { createWorldViewPipeline } from '../../src/render/webgpu-pipeline.js';
import { PALETTE } from '../../src/world/palette.js';
import { WeaponMaterialsNode } from '../../src/weapons/materials-tsl.js';
import { WEAPON_DEFS } from '../../src/weapons/defs.js';
import { shapeMasks } from '../../src/weapons/viewmodel.js';

let renderer, materials, weaponMaterials, visual, rifle, target, environment, graph;
try {
  const start = performance.now();
  renderer = await createWebGpuRenderer(document.querySelector('#game'));
  renderer.setSize(480, 270);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
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
  scene.background = new Color(0x86a1b4);
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
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.02;
  sun.shadow.shadowNode = new CSMShadowNode(sun, { cascades: 3, maxFar: 120, lightMargin: 50 });
  scene.add(sun);

  const worldMeshes = [], palettes = new Set();
  const prep = performance.now();
  visual.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const palette = mesh.userData?.palette;
    if (!PALETTE[palette]) throw new Error(`unknown world palette ${palette}`);
    const def = PALETTE[palette];
    palettes.add(palette);
    mesh.material = materials.get(def.name, def.opts);
    mesh.castShadow = mesh.userData.castShadow !== false;
    mesh.receiveShadow = mesh.userData.receiveShadow !== false;
    mesh.layers.enable(1);
    mesh.matrixAutoUpdate = false;
    if (mesh.isInstancedMesh) mesh.computeBoundingSphere();
    worldMeshes.push(mesh);
  });
  const bakeMs = performance.now() - prep;
  const spawn = meta.spawns.find((s) => s.id === 'market') ?? meta.spawns[0];
  const camera = new PerspectiveCamera(72, 480 / 270, 0.08, 210);
  camera.position.fromArray(spawn.position).add(new Vector3(0, 1.65, 0));
  camera.lookAt(camera.position.clone().add(new Vector3(...spawn.forward)));
  target = new RenderTarget(480, 270);
  const viewScene = new Scene();
  const viewCamera = new PerspectiveCamera(60, 480 / 270, 0.005, 12);
  viewScene.environment = environment;
  viewScene.environmentIntensity = 0.24;
  const key = new DirectionalLight(0xffe8c4, 2.2);
  key.position.set(-0.45, 0.75, 0.55);
  viewScene.add(key, new AmbientLight(0x8fb6ff, 0.7));
  rifle = await new GLTFLoader().loadAsync('/models/weapons/rifle.glb');
  weaponMaterials = new WeaponMaterialsNode(materials);
  let weaponMeshes = 0;
  rifle.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const materialKey = mesh.userData.mat ?? mesh.material?.name ?? 'polymer';
    const soft = ['polymer', 'polymer_tan', 'rubber'].includes(materialKey);
    materials.bakeMasks(mesh.geometry, { wear: 1, grime: 1, ao: 1, edgeThreshold: 0.16 });
    shapeMasks(mesh.geometry, { wearAmp: soft ? 0.42 : 0.62,
      wearExp: soft ? 3.4 : 2.8, grimeAmp: 1.15, grimeExp: 1.25,
      aoAmp: 1, aoExp: 1.15 });
    mesh.material = weaponMaterials.get(materialKey);
    weaponMeshes++;
  });
  rifle.scene.position.fromArray(WEAPON_DEFS.rifle.hipPos);
  rifle.scene.rotation.fromArray([...WEAPON_DEFS.rifle.hipRot, 'XYZ']);
  viewScene.add(rifle.scene);
  graph = createWorldViewPipeline(renderer, scene, camera, viewScene, viewCamera,
    { gtao: !new URLSearchParams(location.search).has('noao') });
  renderer.setRenderTarget(target);
  const renderStart = performance.now();
  graph.render();
  const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 480, 270);
  const viewPixels = await renderer.readRenderTargetPixelsAsync(
    graph.viewPass.renderTarget, 0, 0, 480, 270);
  let partialViewPixels = 0;
  for (let i = 3; i < viewPixels.length; i += 4) {
    const alpha = DataUtils.fromHalfFloat(viewPixels[i]);
    if (alpha > 0.01 && alpha < 0.99) partialViewPixels++;
  }
  const { packedReadback } = await import('../lib/native-readback.js');
  const pixels = packedReadback(raw, 480, 270);
  const firstRenderMs = performance.now() - renderStart;
  const paletteHistogram = new Set();
  let changed = 0;
  const skyPixel = pixels.subarray(0, 3);
  for (let i = 0; i < pixels.length; i += 4) {
    paletteHistogram.add(`${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`);
    if (Math.abs(pixels[i] - skyPixel[0]) + Math.abs(pixels[i + 1] - skyPixel[1]) +
      Math.abs(pixels[i + 2] - skyPixel[2]) > 12) changed++;
  }
  renderer.setRenderTarget(null);
  window.__MATERIAL_WORLD__ = { ok: true, meshes: worldMeshes.length, weaponMeshes,
    partialViewPixels, viewCorner: Array.from(viewPixels.subarray(
      (10 * 480 + 10) * 4, (10 * 480 + 10) * 4 + 4)),
    palettes: palettes.size,
    instances: worldMeshes.filter((m) => m.isInstancedMesh).reduce((n, m) => n + m.count, 0),
    names: materials.names().length, sharedMs, bakeMs, firstRenderMs,
    changed, colorBins: paletteHistogram.size,
    pixels: new URLSearchParams(location.search).has('capture') ? Array.from(pixels) : null };
} catch (error) {
  window.__MATERIAL_WORLD__ = { ok: false, error: error.message, stack: error.stack };
} finally {
  graph?.dispose();
  target?.dispose();
  weaponMaterials?.dispose();
  materials?.dispose();
  environment?.dispose();
  const geometries = new Set();
  visual?.scene.traverse((o) => { if (o.isMesh) geometries.add(o.geometry); });
  rifle?.scene.traverse((o) => { if (o.isMesh) geometries.add(o.geometry); });
  for (const geometry of geometries) geometry.dispose();
  await renderer?.dispose();
}
