import { DataUtils } from 'three';
import {
  AmbientLight,
  DataTexture,
  DirectionalLight,
  FloatType,
  HalfFloatType,
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RedFormat,
  RenderTarget,
  RGBAFormat,
  Scene,
  Vector3,
} from 'three/webgpu';
import { cameraProjectionMatrix, screenUV, uniformTexture, vec4 } from 'three/tsl';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { Rng } from '../../src/core/rng.js';
import { buildDecalAtlas, buildParticleAtlas, D, P } from '../../src/fx/atlas.js';
import { ParticleLayer, resetSpawn } from '../../src/fx/particles.js';
import { DecalSystem } from '../../src/fx/decals.js';
import { HazeSystem } from '../../src/fx/haze.js';
import { ShellSystem } from '../../src/fx/shells.js';

/**
 * Isolated strict-WebGPU probe for the FX node materials.
 *
 * It is not a gameplay renderer and draws no other subsystem: it constructs the
 * real `ParticleLayer` / `DecalSystem` / `HazeSystem` node graphs from `src/fx`
 * against a strict `WebGPUBackend` (no WebGL fallback), renders each into an
 * offscreen half-float target and reads the result back. That is the only way to
 * observe a WebGPU-only effect on a headless GPU here, because Chromium's
 * headless swapchain screenshots come back black even when the passes are
 * correct. Run it on the discrete and integrated GPU via `run.mjs`.
 */
try {
  const renderer = await createWebGpuRenderer(document.querySelector('#game'));
  renderer.setSize(64, 64);
  renderer.setClearColor(0x000000, 0);

  const particleAtlas = buildParticleAtlas(new Rng(0xf00d), 256);
  const decalAtlas = buildDecalAtlas(new Rng(0xbeef), 256);

  const camera = new PerspectiveCamera(60, 1, 0.05, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();

  const target = new RenderTarget(64, 64, { type: HalfFloatType, depthBuffer: true });
  const half = (v) => DataUtils.fromHalfFloat(v);

  const readPixel = async (rt, x, y) =>
    Array.from(await renderer.readRenderTargetPixelsAsync(rt, x, y, 1, 1), half);

  const countBright = async (rt, w, h, threshold, stride = 4) => {
    const raw = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
    let n = 0;
    for (let i = 0; i + stride - 1 < raw.length; i += stride) {
      if (Math.abs(half(raw[i])) > threshold) n++;
    }
    return n;
  };

  const renderScene = async (scene) => {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  };

  /* ---------------------------------------------------------------- additive */
  const additive = new ParticleLayer({
    capacity: 32,
    mode: 'additive',
    atlas: particleAtlas.texture,
    cols: particleAtlas.cols,
  });
  const addScene = new Scene();
  addScene.add(additive.mesh);

  const flash = resetSpawn();
  flash.x = 0; flash.y = 0; flash.z = -2;
  flash.size0 = 0.5; flash.size1 = 0.5; flash.sizeCurve = 1;
  flash.life = 10; flash.drag = 0; flash.gravity = 0;
  flash.tile = P.FLASH_CORE;
  flash.r0 = 1; flash.g0 = 0.5; flash.b0 = 0.1; flash.i0 = 12;
  flash.r1 = 1; flash.g1 = 0.5; flash.b1 = 0.1; flash.i1 = 12;
  flash.alpha = 1; flash.alphaCurve = 1; flash.soft = 0.5; flash.seed = 0.5;
  additive.emit(flash, 0);
  additive.flush(0.5);
  await renderScene(addScene);
  const additiveCenter = await readPixel(target, 32, 32);
  const additiveBright = await countBright(target, 64, 64, 0.01);

  /* ------------------------------------------------------------- soft depth */
  // A 1x1 linear-depth texture at 1 m stands in for `render.depthTexture`. The
  // sprite sits at 2 m, so the soft test must fade it to nothing.
  const nearDepth = new DataTexture(new Float32Array([1]), 1, 1, RedFormat, FloatType);
  nearDepth.name = 'probe-near-depth';
  nearDepth.needsUpdate = true;
  additive.setDepth(nearDepth);
  additive.uniforms.uSoftEnable.value.x = 1;
  additive.flush(0.5);
  await renderScene(addScene);
  const additiveSoft = await readPixel(target, 32, 32);
  additive.setDepth(null);
  additive.uniforms.uSoftEnable.value.x = 0;
  additive.flush(0.5);

  /* ---------------------------------------------------------------- anchored */
  const anchored = resetSpawn();
  anchored.x = 0; anchored.y = 0; anchored.z = -2;
  anchored.vz = -50;
  anchored.size0 = 0.12; anchored.size1 = 0.09; anchored.stretch = 0.26;
  anchored.flags = 2;
  anchored.life = 10; anchored.drag = 0; anchored.gravity = 0;
  anchored.tile = P.STREAK;
  anchored.r0 = 1; anchored.g0 = 0.52; anchored.b0 = 0.18; anchored.i0 = 26;
  anchored.r1 = 1; anchored.g1 = 0.4; anchored.b1 = 0.12; anchored.i1 = 16;
  anchored.alpha = 1; anchored.alphaCurve = 0.25; anchored.soft = 0.1; anchored.seed = 0.5;
  additive.emit(anchored, 0);
  additive.flush(0.02);
  await renderScene(addScene);
  const anchoredPixel = await readPixel(target, 32, 32);

  /* -------------------------------------------------------------------- lit */
  const lit = new ParticleLayer({
    capacity: 32,
    mode: 'lit',
    atlas: particleAtlas.texture,
    cols: particleAtlas.cols,
  });
  const litScene = new Scene();
  litScene.add(lit.mesh);
  const smoke = resetSpawn();
  smoke.x = 0; smoke.y = 0; smoke.z = -2;
  smoke.size0 = 0.6; smoke.size1 = 0.9; smoke.sizeCurve = 0.5;
  smoke.life = 10; smoke.drag = 0; smoke.gravity = 0;
  smoke.tile = P.SMOKE_A;
  smoke.r0 = 0.3; smoke.g0 = 0.3; smoke.b0 = 0.3; smoke.i0 = 1;
  smoke.r1 = 0.2; smoke.g1 = 0.2; smoke.b1 = 0.2; smoke.i1 = 1;
  smoke.alpha = 1; smoke.alphaCurve = 1.2; smoke.soft = 0.5; smoke.seed = 0.5;
  lit.emit(smoke, 0);
  lit.flush(0.5);
  await renderScene(litScene);
  const litCenter = await readPixel(target, 32, 32);
  const litBright = await countBright(target, 64, 64, 0.005);

  /* ------------------------------------------------------------------ decal */
  const decals = new DecalSystem({
    capacity: 4,
    albedo: decalAtlas.albedo,
    normal: decalAtlas.normal,
    orm: decalAtlas.orm,
    cols: decalAtlas.cols,
  });
  const decalScene = new Scene();
  decalScene.add(decals.mesh);
  decalScene.add(new AmbientLight(0xffffff, 2.0));
  const decalSun = new DirectionalLight(0xffffff, 3.0);
  decalSun.position.set(0.4, 1.0, 1.2);
  decalScene.add(decalSun);
  const decalPoint = new Vector3(0, 0, -2);
  const decalNormal = new Vector3(0, 0, 1);
  const placed = decals.add({
    point: decalPoint,
    normal: decalNormal,
    size: 1.0,
    tile: D.SCORCH,
    roll: 0,
    life: 10,
    fade: 0.72,
    opacity: 1,
    maxAngle: 62,
    depth: 0.2,
    flip: false,
    world: null,
    mask: 0xffff,
    now: 0,
  });
  decals.flush(0.1);
  await renderScene(decalScene);
  const decalBright = await countBright(target, 64, 64, 0.02);
  decals.flush(10.5);
  await renderScene(decalScene);
  const decalFaded = await countBright(target, 64, 64, 0.02);

  /* ------------------------------------------------------------------- haze */
  const haze = new HazeSystem({
    capacity: 16,
    atlas: particleAtlas.texture,
    cols: particleAtlas.cols,
  });
  haze.resize(64, 64);
  haze.emit(0, 0, 0, -2, 0.6, 2.0, 10, 0.9, P.SMOKE_B, 0.5);
  haze.update(0.5, null, camera);
  const hazeRendered = haze.render(renderer, camera);
  const hazeRaw = await renderer.readRenderTargetPixelsAsync(haze.rt, 0, 0, 32, 32);
  let hazeMax = 0;
  for (let i = 0; i < hazeRaw.length; i += 2) {
    hazeMax = Math.max(hazeMax, Math.abs(half(hazeRaw[i])), Math.abs(half(hazeRaw[i + 1])));
  }

  /* -------------------------------------------------------------- haze warp */
  // A known gradient is resampled through the TSL warp graph. A non-zero max
  // delta against the unwarped sample proves the graph compiled and shifts UVs.
  const grad = new DataTexture(gradient(16), 16, 16, RGBAFormat, FloatType);
  grad.name = 'probe-gradient';
  grad.needsUpdate = true;
  const gradNode = uniformTexture(grad);
  haze.uStrength.value.x = 1.0;

  const quadScene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  quadCam.position.z = 1;
  const warpTarget = new RenderTarget(16, 16, { type: HalfFloatType, depthBuffer: false });
  const plainTarget = new RenderTarget(16, 16, { type: HalfFloatType, depthBuffer: false });

  // The anchored branch reconstructs the screen segment from P[0][0]/P[1][1].
  // Verify the TSL matrix element access against the camera's own matrix before
  // trusting the projection.
  const diagMat = new MeshBasicNodeMaterial({
    fragmentNode: vec4(
      cameraProjectionMatrix.element(0).element(0),
      cameraProjectionMatrix.element(1).element(1),
      0,
      1
    ),
    depthTest: false,
  });
  quad.material = diagMat;
  renderer.setRenderTarget(plainTarget);
  renderer.render(quadScene, quadCam);
  const diag = await readPixel(plainTarget, 8, 8);

  quad.material = new MeshBasicNodeMaterial({ fragmentNode: gradNode.sample(screenUV), depthTest: false });
  renderer.setRenderTarget(plainTarget);
  renderer.render(quadScene, quadCam);
  quad.material = new MeshBasicNodeMaterial({ fragmentNode: haze.warpNode(gradNode), depthTest: false });
  renderer.setRenderTarget(warpTarget);
  renderer.render(quadScene, quadCam);
  renderer.setRenderTarget(null);
  const plain = await renderer.readRenderTargetPixelsAsync(plainTarget, 0, 0, 16, 16);
  const warped = await renderer.readRenderTargetPixelsAsync(warpTarget, 0, 0, 16, 16);
  let warpMax = 0;
  for (let i = 0; i < plain.length; i++) {
    warpMax = Math.max(warpMax, Math.abs(half(plain[i]) - half(warped[i])));
  }
  // The target still contains old offsets after expiry; idle warp must ignore
  // them without forcing a half-res clear draw every empty frame.
  haze.update(20, null, camera);
  const idleRendered = haze.render(renderer, camera);
  renderer.setRenderTarget(warpTarget);
  renderer.render(quadScene, quadCam);
  renderer.setRenderTarget(null);
  const idle = await renderer.readRenderTargetPixelsAsync(warpTarget, 0, 0, 16, 16);
  let idleMax = 0;
  for (let i = 0; i < plain.length; i++)
    idleMax = Math.max(idleMax, Math.abs(half(plain[i]) - half(idle[i])));

  /* ----------------------------------------------------------------- shells */
  // Brass casings are an opaque PBR node material on an InstancedMesh; the
  // lathe is millimetre-scale, so render it into a larger target.
  const shellFx = {
    rng: new Rng(0x55aa),
    gravity: -9.81,
    physics: null,
    emitLit() {},
    audioPing() {},
  };
  const shells = new ShellSystem(shellFx);
  const shellScene = new Scene();
  shellScene.add(shells.mesh);
  shellScene.add(new AmbientLight(0xffffff, 2.0));
  const shellSun = new DirectionalLight(0xffffff, 3.0);
  shellSun.position.set(0.5, 1.0, 1.0);
  shellScene.add(shellSun);
  shells.spawn(new Vector3(0, 0, -0.3), new Vector3(0.2, 0.5, 0));
  shells.update(0.05);
  const shellTarget = new RenderTarget(128, 128, { type: HalfFloatType, depthBuffer: true });
  renderer.setRenderTarget(shellTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(shellScene, camera);
  renderer.setRenderTarget(null);
  const shellBright = await countBright(shellTarget, 128, 128, 0.02);

  const adapter = await (await navigator.gpu.requestAdapter()).info;

  window.__FX_WEBGPU__ = {
    ok: true,
    backend: renderer.backend.constructor.name,
    adapter: { vendor: adapter.vendor, architecture: adapter.architecture, device: adapter.device },
    additive: { center: additiveCenter, bright: additiveBright },
    soft: { center: additiveSoft },
    anchored: { center: anchoredPixel },
    lit: { center: litCenter, bright: litBright },
    decal: { placed, bright: decalBright, faded: decalFaded },
    shells: { bright: shellBright },
    haze: { rendered: hazeRendered, max: hazeMax, warpMax, idleRendered, idleMax },
    projection: {
      p00: diag[0],
      p11: diag[1],
      expected00: quadCam.projectionMatrix.elements[0],
      expected11: quadCam.projectionMatrix.elements[5],
    },
  };
} catch (error) {
  window.__FX_WEBGPU__ = { ok: false, error: error?.message ?? String(error), stack: error?.stack };
}

function gradient(size) {
  const data = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = x / (size - 1);
      data[i + 1] = y / (size - 1);
      data[i + 2] = 0.25;
      data[i + 3] = 1;
    }
  }
  return data;
}
