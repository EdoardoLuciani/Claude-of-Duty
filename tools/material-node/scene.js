import { AmbientLight, Bone, Box3, BoxGeometry, BufferAttribute, DataTexture,
  DirectionalLight, EquirectangularReflectionMapping, InstancedMesh, Matrix4,
  Mesh, PerspectiveCamera, RenderTarget, RGBAFormat, Scene, Skeleton,
  SkinnedMesh, SRGBColorSpace, Uint16BufferAttribute, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { float, uv, vec3, vec4 } from 'three/tsl';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { bakeSurface, bakeMacro, bakeDetail } from '../../src/materials/forge-tsl.js';
import { brushedMetalSurface } from '../../src/materials/tsl/metal-brushed.js';
import { concreteSurface } from '../../src/materials/tsl/arch.js';
import { rubberSurface } from '../../src/materials/tsl/rubber.js';
import { createSurfaceNodeMaterial } from '../../src/materials/shader-tsl.js';
import { MaterialSystemNode } from '../../src/materials/system-tsl.js';
import { createSoldierNodeMaterial, SoldierMaterialsNode } from '../../src/ai/textures-tsl.js';
import { resolveMaterials } from '../../src/ai/soldier.js';
import { loadPngTexture } from '../../src/core/pngtex.js';
import { PALETTE } from '../../src/world/palette.js';
import { LIBRARY } from '../../src/materials/library.js';
import { WEAPON_MATERIALS } from '../../src/weapons/materials.js';
import { bakeMasks } from '../../src/materials/masks.js';

let gpu, surface, detail, macro;
const owned = []; // GPU readback/disposal includes late real-GLB tests.
try {
  gpu = await createWebGpuRenderer(document.querySelector('#game'));
  gpu.setSize(128, 128);
  gpu.setClearColor(0x171c25, 1);
  surface = bakeSurface(gpu, { size: 64, worldSize: 0.8, relief: 0.004,
    surface: brushedMetalSurface(uv(), float(83)) });
  macro = bakeMacro(gpu, 32);
  detail = bakeDetail(gpu, 64);
  const set = { name: 'metal_brushed', ...Object.fromEntries(
    Object.entries(surface).map(([key, target]) => [key, target.texture])) };
  const shared = { macro: macro.texture, detailNormal: detail.normal.texture,
    detailAlbedo: detail.albedo.texture };
  const base = {
    uvMode: 'planar', localSpace: false, scale: 0.8, offset: [0, 0],
    parallax: 0.002, parallaxFade: [6, 14], normalStrength: 1,
    detail: [8, 0.25, 0.15, 8], detailWorld: 0.26,
    macro: [0.09, 0.14, 0.1, 0.2], macroBig: [1, 0, 0.03],
    weather: [0.15, 0.15, 0.2, 0.2], groundY: 0,
    wear: [0.5, 0.7, 0.5, 0], vertexMasks: true,
    wearMaterial: [0.16, 1, 0, 0.9], wearColor: 0xb9bcc0,
    dustColor: 0x6b6154, grimeColor: 0x2a2620, rustColor: 0x6d3a1c,
    roughness: [1, 0, 0.08], aoStrength: 1, tint: 0xffffff,
    cloth: [0, 1, 0, 0], alphaMask: false,
  };
  const scene = new Scene();
  const skyPixels = new Uint8Array(16 * 8 * 4);
  for (let i = 0; i < skyPixels.length; i += 4) {
    skyPixels[i] = 174; skyPixels[i + 1] = 186;
    skyPixels[i + 2] = 197; skyPixels[i + 3] = 255;
  }
  const environment = new DataTexture(skyPixels, 16, 8, RGBAFormat);
  environment.colorSpace = SRGBColorSpace;
  environment.mapping = EquirectangularReflectionMapping;
  environment.needsUpdate = true;
  scene.environment = environment;
  owned.push(environment);
  scene.add(new AmbientLight(0xffffff, 1.3));
  const sun = new DirectionalLight(0xffffff, 3);
  sun.position.set(2, 5, 3);
  scene.add(sun);
  const camera = new PerspectiveCamera(55, 1, 0.1, 15);
  camera.position.set(0.3, 0.7, 3.3);
  camera.lookAt(0, 0, 0);
  const target = new RenderTarget(128, 128);
  const states = [];
  for (const [mode, local, type] of [['planar', false, 'world'],
    ['triplanar', false, 'world'], ['mesh', true, 'weapon'],
    ['mesh', true, 'unmasked'], ['mesh', false, 'soldier']]) {
    const p = { ...base, uvMode: mode, localSpace: local,
      vertexMasks: type === 'world' || type === 'unmasked',
      parallax: mode === 'planar' ? base.parallax : 0 };
    const material = createSurfaceNodeMaterial(set, p, shared);
    const geometry = new BoxGeometry(1.6, 1.6, 0.5);
    if (p.vertexMasks && type !== 'unmasked') {
      const color = new Float32Array(geometry.attributes.position.count * 4);
      for (let i = 0; i < color.length; i += 4) {
        color[i] = 0.3; color[i + 1] = 0.25; color[i + 2] = 0.1; color[i + 3] = 0;
      }
      geometry.setAttribute('color', new BufferAttribute(color, 4));
    }
    let mesh;
    if (type === 'soldier') {
      const skinIndex = new Uint16Array(geometry.attributes.position.count * 4);
      const skinWeight = new Float32Array(skinIndex.length);
      for (let i = 0; i < skinWeight.length; i += 4) skinWeight[i] = 1;
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
      mesh = new SkinnedMesh(geometry, material);
      const root = new Bone();
      mesh.add(root);
      mesh.bind(new Skeleton([root]));
    } else if (mode === 'triplanar') {
      mesh = new InstancedMesh(geometry, material, 2);
      mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, 0));
      mesh.setMatrixAt(1, new Matrix4().makeTranslation(10, 0, 0));
      mesh.computeBoundingSphere();
    } else mesh = new Mesh(geometry, material);
    scene.add(mesh);
    gpu.setRenderTarget(target);
    gpu.render(scene, camera);
    const pixel = Array.from(await gpu.readRenderTargetPixelsAsync(target, 64, 64, 1, 1));
    gpu.setRenderTarget(null);
    states.push({ mode, type, pixel, skinning: !!mesh.isSkinnedMesh,
      instancing: !!mesh.isInstancedMesh, geometryUV: !!geometry.attributes.uv });
    scene.remove(mesh);
    material.dispose();
    geometry.dispose();
    if (mesh.isSkinnedMesh) mesh.skeleton.dispose();
  }
  const loader = new GLTFLoader();
  const soldier = await loader.loadAsync('/models/soldiers/vanguard.glb');
  const rifle = await loader.loadAsync('/models/weapons/rifle.glb');
  const worldMeta = await (await fetch('/models/world/level.json')).json();
  const worldResponse = await fetch(`/models/world/${worldMeta.assets.visual}`);
  const decoded = worldResponse.headers.get('content-encoding')?.includes('gzip')
    ? await worldResponse.arrayBuffer()
    : await new Response(worldResponse.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const world = await loader.parseAsync(decoded, '/models/world/');
  const glbCases = [];
  const captures = {};
  let soldierMesh, weaponMesh, worldMesh;
  soldier.scene.traverse((o) => { if (!soldierMesh && o.isSkinnedMesh) soldierMesh = o; });
  rifle.scene.traverse((o) => { if (!weaponMesh && o.isMesh && o.userData?.mat === 'alu') weaponMesh = o; });
  const concreteCandidates = [], instancedCandidates = [];
  world.scene.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && PALETTE[o.userData?.palette]?.name === 'concrete')
      concreteCandidates.push(o);
    if (o.isInstancedMesh && PALETTE[o.userData?.palette]?.name === 'concrete')
      instancedCandidates.push(o);
  });
  worldMesh = concreteCandidates.sort((a, b) => a.geometry.attributes.position.count -
    b.geometry.attributes.position.count)[0];
  if (!soldierMesh || !weaponMesh || !worldMesh) throw new Error('real soldier/weapon/world GLB sample absent');
  const glbMaterials = [];
  const concreteSet = bakeSurface(gpu, { size: 64, worldSize: 2.5, relief: 0.09,
    surface: concreteSurface(uv(), float(11), vec3(1), vec3(1), vec4(1, 0, 0, 0)) });
  const rubberSet = bakeSurface(gpu, { size: 64, worldSize: 0.8, relief: 0.005,
    surface: rubberSurface(uv(), float(601)) });
  owned.push(concreteSet.albedo, concreteSet.orm, concreteSet.normal,
    rubberSet.albedo, rubberSet.orm, rubberSet.normal);
  const maps = (name, baked) => ({ name, albedo: baked.albedo.texture,
    orm: baked.orm.texture, normal: baked.normal.texture });
  glbMaterials.push(createSurfaceNodeMaterial(maps('concrete', concreteSet),
    { ...base, ...LIBRARY.concrete.mat, ...PALETTE[worldMesh.userData.palette].opts,
      detailWorld: 0.26, parallax: 0 }, shared, LIBRARY.concrete.three));
  glbMaterials.push(createSurfaceNodeMaterial(maps('rubber', rubberSet),
    { ...base, ...LIBRARY.rubber.mat, ...WEAPON_MATERIALS.alu[1],
      detailWorld: 0.26, parallax: 0 }, shared, LIBRARY.rubber.three));
  const loadAi = (name, srgb) => loadPngTexture(`/models/proc/ai-${name}.png`, { srgb });
  const [camo, aiOrm, aiNormal, aiDetail] = await Promise.all([
    loadAi('camo_arid-albedo', true), loadAi('camo_arid-orm', false),
    loadAi('camo_arid-normal', false),
    loadPngTexture('/models/proc/ai-detail-cloth.png'),
  ]);
  owned.push(camo, aiOrm, aiNormal, aiDetail);
  glbMaterials.push(createSoldierNodeMaterial({ albedo: camo, orm: aiOrm, normal: aiNormal },
    { name: 'ai_camo_arid', normalScale: 1, ao: 0.85 },
    { texture: aiDetail, scale: 15, normal: 0.7, rough: 0.2 }));
  for (const [name, source, material] of [
    ['world', worldMesh, glbMaterials[0]], ['weapon', weaponMesh, glbMaterials[1]],
    ['soldier', soldierMesh, glbMaterials[2]],
  ]) {
    const model = name === 'world' ? world.scene : name === 'weapon' ? rifle.scene : soldier.scene;
    model.updateMatrixWorld(true);
    const geo = name === 'weapon' ? source.geometry.clone() : source.geometry;
    if (name === 'weapon') bakeMasks(geo, { edgeThreshold: 0.16 });
    const sample = source.isSkinnedMesh
      ? new SkinnedMesh(geo, material) : new Mesh(geo, material);
    if (sample.isSkinnedMesh) sample.bind(source.skeleton, source.bindMatrix);
    sample.matrix.copy(source.matrixWorld);
    sample.matrixAutoUpdate = false;
    sample.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(sample);
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(0.1, bounds.getSize(new Vector3()).length() * 0.7);
    camera.near = Math.max(0.01, radius * 0.01);
    camera.far = Math.max(15, radius * 8);
    camera.updateProjectionMatrix();
    const eye = name === 'weapon' ? new Vector3(1.9, 0.5, 0.8)
      : name === 'world' ? new Vector3(1.2, 2.0, 1.2) : new Vector3(0, 0.25, 1.8);
    camera.position.copy(center).add(eye.multiplyScalar(radius));
    camera.lookAt(center);
    // Preserve the GLB's original skeleton and transforms; rendering a clone
    // without its bindings can pass compilation yet produce an exploded mesh.
    scene.add(sample);
    gpu.setRenderTarget(target);
    gpu.render(scene, camera);
    const image = await gpu.readRenderTargetPixelsAsync(target, 0, 0, 128, 128);
    gpu.setRenderTarget(null);
    const centerIndex = (64 * 128 + 64) * 4;
    let occupied = 0;
    for (let i = 0; i < image.length; i += 4) {
      if (Math.max(Math.abs(image[i] - image[0]), Math.abs(image[i + 1] - image[1]),
        Math.abs(image[i + 2] - image[2])) > 3) occupied++;
    }
    if (new URLSearchParams(location.search).has('capture')) captures[name] = Array.from(image);
    glbCases.push({ name, occupied, palette: source.userData?.palette ?? null,
      slot: source.userData?.mat ?? null, vertices: geo.attributes.position.count,
      uv: !!geo.attributes.uv, color: !!geo.attributes.color,
      skinIndex: !!geo.attributes.skinIndex, instanced: source.isInstancedMesh,
      pixel: Array.from(image.slice(centerIndex, centerIndex + 4)) });
    scene.remove(sample);
    if (name === 'weapon') geo.dispose();
  }
  const instanceSource = instancedCandidates.find((o) => o.name === 'prop_jersey');
  if (!instanceSource) throw new Error('real instanced world prop absent');
  const instancedMaterial = createSurfaceNodeMaterial(maps('concrete', concreteSet),
    { ...base, ...LIBRARY.concrete.mat, ...PALETTE[instanceSource.userData.palette].opts,
      detailWorld: 0.26, parallax: 0 }, shared, LIBRARY.concrete.three);
  const instance = new InstancedMesh(instanceSource.geometry, instancedMaterial, 1);
  const instanceMatrix = new Matrix4();
  instanceSource.getMatrixAt(0, instanceMatrix);
  instance.setMatrixAt(0, instanceMatrix);
  instance.computeBoundingSphere();
  instance.frustumCulled = false;
  instance.matrix.copy(instanceSource.matrixWorld);
  instance.matrixAutoUpdate = false;
  instance.updateMatrixWorld(true);
  const focus = new Mesh(instanceSource.geometry);
  focus.matrix.copy(instance.matrixWorld).multiply(instanceMatrix);
  focus.matrixAutoUpdate = false;
  focus.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(focus);
  const center = bounds.getCenter(new Vector3());
  const radius = Math.max(0.1, bounds.getSize(new Vector3()).length() * 0.7);
  camera.near = Math.max(0.01, radius * 0.01);
  camera.far = Math.max(15, radius * 8);
  camera.updateProjectionMatrix();
  camera.position.copy(center).add(new Vector3(radius * 1.6, radius * 0.8, radius * 1.4));
  camera.lookAt(center);
  scene.add(instance);
  gpu.setRenderTarget(target);
  gpu.render(scene, camera);
  const pixels = await gpu.readRenderTargetPixelsAsync(target, 0, 0, 128, 128);
  gpu.setRenderTarget(null);
  let occupied = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.max(Math.abs(pixels[i] - pixels[0]), Math.abs(pixels[i + 1] - pixels[1]),
      Math.abs(pixels[i + 2] - pixels[2])) > 3) occupied++;
  }
  if (new URLSearchParams(location.search).has('capture')) captures.instanced = Array.from(pixels);
  glbCases.push({ name: 'instanced', occupied,
    vertices: instance.geometry.attributes.position.count,
    uv: !!instance.geometry.attributes.uv, color: !!instance.geometry.attributes.color,
    skinIndex: false, instanced: true, palette: instanceSource.userData.palette });
  scene.remove(instance);
  instancedMaterial.dispose();
  for (const material of glbMaterials) material.dispose();
  const soldierLibrary = await SoldierMaterialsNode.fromCache({ base: '/models/proc', anisotropy: 2 });
  let soldierResult;
  try {
    const metadata = await (await fetch('/models/soldiers/vanguard.json')).json();
    const slotMaterials = resolveMaterials('vanguard', metadata.slots, soldierLibrary);
    const sample = new SkinnedMesh(soldierMesh.geometry, slotMaterials[0]);
    sample.bind(soldierMesh.skeleton, soldierMesh.bindMatrix);
    sample.matrix.copy(soldierMesh.matrixWorld);
    sample.matrixAutoUpdate = false;
    scene.add(sample);
    const bounds = new Box3().setFromObject(sample);
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(0.1, bounds.getSize(new Vector3()).length() * 0.7);
    camera.near = 0.01;
    camera.far = Math.max(15, radius * 8);
    camera.updateProjectionMatrix();
    camera.position.copy(center).add(new Vector3(0, radius * 0.25, radius * 1.8));
    camera.lookAt(center);
    gpu.setRenderTarget(target);
    gpu.render(scene, camera);
    const pixel = Array.from(await gpu.readRenderTargetPixelsAsync(target, 64, 64, 1, 1));
    for (const material of slotMaterials.slice(1)) {
      sample.material = material;
      gpu.render(scene, camera);
    }
    gpu.setRenderTarget(null);
    scene.remove(sample);
    soldierResult = { slots: metadata.slots.length, mats: slotMaterials.length,
      cache: soldierLibrary.get(`camo_${metadata.variant?.camo ?? 'arid'}`,
        { key: 'probe' }) === soldierLibrary.get(`camo_${metadata.variant?.camo ?? 'arid'}`,
        { key: 'probe' }),
      loaded: Object.keys(soldierLibrary.sets).length,
      detail: Object.keys(soldierLibrary.details).length, pixel };
  } finally {
    soldierLibrary.dispose();
  }
  const library = new MaterialSystemNode({ renderer: gpu });
  let libraryResult;
  try {
    await library.init({ config: { quality: 'low', q: { anisotropy: 2 } } });
    const concrete = library.get('concrete', { vertexMasks: true });
    const again = library.get('concrete', { vertexMasks: true });
    const rubber = library.get('rubber', { uvMode: 'triplanar', localSpace: true });
    const foliage = library.get('foliage', { vertexMasks: false });
    const fabric = library.get('fabric', { vertexMasks: false });
    const foliageSet = library.getTextureSet('foliage');
    library.tune(concrete, { scale: 1.4, tint: 0xaca190,
      weather: [0.1, 0.2, 0.3, 0.4], normalStrength: 0.75 });
    library.setGroundLevel(-0.1);
    const sample = new Mesh(instanceSource.geometry, concrete);
    sample.matrix.copy(focus.matrixWorld);
    sample.matrixAutoUpdate = false;
    sample.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(sample);
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(0.1, bounds.getSize(new Vector3()).length() * 0.7);
    camera.near = Math.max(0.01, radius * 0.01);
    camera.far = Math.max(15, radius * 8);
    camera.updateProjectionMatrix();
    camera.position.copy(center).add(new Vector3(radius * 1.6, radius * 0.8, radius * 1.4));
    camera.lookAt(center);
    scene.add(sample);
    gpu.setRenderTarget(target);
    gpu.render(scene, camera);
    const libraryPixel = Array.from(await gpu.readRenderTargetPixelsAsync(target, 64, 64, 1, 1));
    gpu.setRenderTarget(null);
    scene.remove(sample);
    // Force both alpha-tested cutout and physical cloth-fold shader compilation.
    sample.material = foliage;
    scene.add(sample);
    gpu.render(scene, camera);
    sample.material = fabric;
    gpu.render(scene, camera);
    scene.remove(sample);
    libraryResult = { names: library.names().length, reused: concrete === again,
      variant: concrete !== rubber, size: foliageSet.size,
      shared: !!library.detailNormal && !!library.macroTexture,
      scale: concrete.userData.owControls.tile.value,
      groundY: concrete.userData.owControls.ground.value, pixel: libraryPixel };
  } finally {
    library.dispose();
  }
  window.__MATERIAL_NODE__ = { ok: true, states, glbCases, soldierResult,
    libraryResult, captures,
    concreteCandidates: concreteCandidates.map((o) => [o.name, o.geometry.attributes.position.count]),
    instancedCandidates: instancedCandidates.map((o) => [o.name, o.count]) };
  target.dispose();
} catch (error) {
  window.__MATERIAL_NODE__ = { ok: false, error: error.message, stack: error.stack };
} finally {
  surface?.albedo.dispose(); surface?.orm.dispose(); surface?.normal.dispose();
  detail?.albedo.dispose(); detail?.normal.dispose(); macro?.dispose();
  for (const resource of owned) resource.dispose();
  await gpu?.dispose();
}
