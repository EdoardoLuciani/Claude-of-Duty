import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, Renderer, StandardNodeLibrary, WebGPUBackend } from 'three/webgpu';
import { uniformTexture, uv } from 'three/tsl';
import { createWorldViewPipeline } from '../render/webgpu-pipeline.js';
import { Rng } from '../core/rng.ts';
import { EventBus } from '../core/registry.js';
import { createConfig } from '../core/config.js';
import { FxSystem } from './index.js';
import { Noise } from './noise.ts';

/**
 * DEV ONLY — standalone FX rig.
 *
 * Boots the FX subsystem against a minimal stand-in for `render` (the upstream
 * RenderPipeline with bloom, ACES through the node output pass) and `physics` (a
 * brute-force triangle soup with the same `queryAabb` contract as the BVH) so
 * impacts, decals and the refraction pass can be iterated on and screenshotted
 * without waiting for ten other subsystems. Nothing here ships.
 *
 * Strict WebGPU only. Reuse the game's depth/first-person/haze composition,
 * without its sky, TAA, AO or grading. Keep this rig's ACES display transform.
 */

const canvas = document.getElementById('fx');
const W = () => canvas.clientWidth || 1920;
const H = () => canvas.clientHeight || 1080;

// Strict WebGPU only: construct the backend directly so the dev harness cannot
// silently fall back to WebGL when the GPU is unavailable.
const parameters = {
  canvas,
  alpha: false,
  depth: true,
  stencil: false,
  antialias: false,
  powerPreference: 'high-performance',
};
const renderer = new Renderer(new WebGPUBackend(parameters), parameters);
renderer.library = new StandardNodeLibrary();
await renderer.init();
renderer.setPixelRatio(1);
renderer.setSize(W(), H(), false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, W() / H(), 0.05, 400);
camera.rotation.order = 'YXZ';
camera.position.set(1.7, 1.58, 0.75);
camera.lookAt(-0.5, 1.45, -3.0);

const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(60, W() / H(), 0.005, 12);

/* ---------------------------------------------------------------- lighting */
const sun = new THREE.DirectionalLight(0xffe9c8, 4.3);
sun.position.set(9, 11, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 40;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x9fc0ff, 0x3a3128, 0.5));

// This lightweight preview omits the game's sky/PMREM environment. Native
// PMREM is supported (see sky); preview materials retain their authored maps.
scene.background = new THREE.Color(0.24, 0.3, 0.4);

/* ------------------------------------------------------------- stand-in art */
function surfaceMaps(seed, opts) {
  const n = new Noise(new Rng(seed));
  const S = 256;
  const alb = new Uint8Array(S * S * 4);
  const nrm = new Uint8Array(S * S * 4);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * opts.scale;
      const v = (y / S) * opts.scale;
      let f = n.fbm(u, v, 5);
      f = f * 0.7 + n.fbm(u * 5.5, v * 5.5, 3) * 0.3;
      const crack = Math.pow(1 - Math.min(1, n.worleyEdge(u * 0.9, v * 0.9) * 8), 4);
      h[y * S + x] = f - crack * 0.5;
      const i = (y * S + x) * 4;
      const tint = 0.82 + 0.36 * f - crack * 0.35;
      alb[i] = Math.min(255, opts.color[0] * tint * 255);
      alb[i + 1] = Math.min(255, opts.color[1] * tint * 255);
      alb[i + 2] = Math.min(255, opts.color[2] * tint * 255);
      alb[i + 3] = 255;
      nrm[i + 3] = 255;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const at = (dx, dy) => h[(((y + dy) % S) + S) % S * S + ((((x + dx) % S) + S) % S)];
      const gx = (at(1, 0) - at(-1, 0)) * opts.relief;
      const gy = (at(0, 1) - at(0, -1)) * opts.relief;
      const l = Math.hypot(-gx, -gy, 1);
      const i = (y * S + x) * 4;
      nrm[i] = (-gx / l * 0.5 + 0.5) * 255;
      nrm[i + 1] = (-gy / l * 0.5 + 0.5) * 255;
      nrm[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(alb, true), normalMap: mk(nrm, false) };
}

const concreteMaps = surfaceMaps(11, { color: [0.44, 0.43, 0.4], scale: 5, relief: 5 });
const groundMaps = surfaceMaps(29, { color: [0.17, 0.16, 0.15], scale: 9, relief: 6 });
for (const t of [concreteMaps.map, concreteMaps.normalMap]) t.repeat.set(2.5, 1.4);
for (const t of [groundMaps.map, groundMaps.normalMap]) t.repeat.set(10, 10);

const wallMat = new MeshStandardNodeMaterial({
  ...concreteMaps,
  roughness: 0.86,
  metalness: 0,
  normalScale: new THREE.Vector2(1.4, 1.4),
});
const groundMat = new MeshStandardNodeMaterial({
  ...groundMaps,
  roughness: 0.72,
  metalness: 0,
  normalScale: new THREE.Vector2(1.2, 1.2),
});
const steelMat = new MeshStandardNodeMaterial({
  color: new THREE.Color(0.52, 0.53, 0.55),
  roughness: 0.42,
  metalness: 1,
  normalMap: concreteMaps.normalMap,
  normalScale: new THREE.Vector2(0.35, 0.35),
});

const collide = [];
function addMesh(geo, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  m.layers.enable(1); // Opaque depth for soft particles and haze.
  scene.add(m);
  collide.push(m);
  return m;
}

const ground = addMesh(new THREE.BoxGeometry(60, 0.4, 60), groundMat, 0, -0.2, 0);
ground.castShadow = false;
addMesh(new THREE.BoxGeometry(7.5, 3.4, 0.45), wallMat, -0.4, 1.7, -3.2);
addMesh(new THREE.BoxGeometry(0.45, 3.4, 4), wallMat, 3.1, 1.7, -1.4);
addMesh(new THREE.BoxGeometry(1.1, 0.9, 0.75), steelMat, 1.5, 0.45, -2.1, 0.4);
addMesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), steelMat, -2.8, 0.7, -2.4, -0.3);

/* ------------------------------- physics stand-in: a brute-force tri soup */
class MiniWorld {
  constructor(meshes) {
    const tris = [];
    const v = new THREE.Vector3();
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        const t = [];
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, i + k).applyMatrix4(m.matrixWorld);
          t.push(v.x, v.y, v.z);
        }
        tris.push(t);
      }
      if (g !== m.geometry) g.dispose();
    }
    this.triCount = tris.length;
    this.pos = new Float32Array(this.triCount * 9);
    this.nrm = new Float32Array(this.triCount * 3);
    this.mask = new Uint16Array(this.triCount).fill(0xffff);
    this.aabbs = new Float32Array(this.triCount * 6);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < this.triCount; i++) {
      this.pos.set(tris[i], i * 9);
      a.set(tris[i][0], tris[i][1], tris[i][2]);
      b.set(tris[i][3], tris[i][4], tris[i][5]);
      c.set(tris[i][6], tris[i][7], tris[i][8]);
      b.sub(a);
      c.sub(a);
      b.cross(c).normalize();
      this.nrm[i * 3] = b.x;
      this.nrm[i * 3 + 1] = b.y;
      this.nrm[i * 3 + 2] = b.z;
      const t = tris[i];
      for (let k = 0; k < 3; k++) {
        this.aabbs[i * 6 + k] = Math.min(t[k], t[3 + k], t[6 + k]);
        this.aabbs[i * 6 + 3 + k] = Math.max(t[k], t[3 + k], t[6 + k]);
      }
    }
    this._cand = new Int32Array(2048);
    this.candidates = this._cand;
  }

  queryAabb(minx, miny, minz, maxx, maxy, maxz) {
    let n = 0;
    const A = this.aabbs;
    for (let i = 0; i < this.triCount && n < this._cand.length; i++) {
      const b = i * 6;
      if (A[b] > maxx || A[b + 3] < minx) continue;
      if (A[b + 1] > maxy || A[b + 4] < miny) continue;
      if (A[b + 2] > maxz || A[b + 5] < minz) continue;
      this._cand[n++] = i;
    }
    return n;
  }
}

const miniWorld = new MiniWorld(collide);
const raycaster = new THREE.Raycaster();
const _hitOut = {
  hit: false,
  point: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  distance: 0,
  surface: 'concrete',
};
const physicsStub = {
  staticWorld: miniWorld,
  MASK: { WORLD: 0xffff },
  raycast(origin, dir, maxDist) {
    raycaster.set(origin, _tmpDir.copy(dir).normalize());
    raycaster.far = maxDist ?? 100;
    const hits = raycaster.intersectObjects(collide, false);
    _hitOut.hit = hits.length > 0;
    if (_hitOut.hit) {
      _hitOut.point.copy(hits[0].point);
      _hitOut.normal.copy(hits[0].face.normal).transformDirection(hits[0].object.matrixWorld);
      _hitOut.distance = hits[0].distance;
      _hitOut.surface = hits[0].object.material === steelMat ? 'metal' : 'concrete';
    }
    return _hitOut;
  },
  groundHeight() {
    return 0;
  },
  addRigidBody: null,
};
const _tmpDir = new THREE.Vector3();

/* ------------------------------------------------------------ render stub */
const renderStub = {
  renderer,
  depthTexture: null,
  velocityTexture: null,
  screenSize: { width: W(), height: H() },
  sunDir: new THREE.Vector3(),
  activeSun: sun,
  addLight() {},
};

let pipeline = null;
function buildPipeline() {
  pipeline?.dispose();
  pipeline = createWorldViewPipeline(renderer, scene, camera, viewScene, viewCamera, {
    gtao: false, bloomStrength: 0.16, bloomThreshold: 1.5,
    warp: node => fx.hazeSys.warpNode(node),
    afterDepth: () => fx.hazeSys.render(renderer, camera),
  });
  renderStub.depthTexture = pipeline.linearDepth.value;
}

/* --------------------------------------------------------------- fake ctx */
const config = createConfig({ quality: 'ultra', deterministic: true });
const events = new EventBus();
const time = { elapsed: 0, raw: 0, dt: 1 / 60, fixed: 1 / 120, alpha: 0, scale: 1, frame: 0 };
const systems = { render: renderStub, physics: physicsStub };
const ctx = {
  scene,
  camera,
  viewScene,
  viewCamera,
  canvas,
  config,
  events,
  input: { frozen: true },
  time,
  rng: new Rng(0xfeed),
  get: (id) => systems[id] ?? null,
  peek: (id) => systems[id] ?? null,
  has: (id) => !!systems[id],
};

function resize() {
  const w = Math.max(1, W());
  const h = Math.max(1, H());
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  viewCamera.aspect = w / h;
  viewCamera.updateProjectionMatrix();
  renderStub.screenSize.width = w;
  renderStub.screenSize.height = h;
  fx.resize();
  buildPipeline();
}

const fx = new FxSystem();
await fx.init(ctx);
systems.fx = fx;
fx._attachView(); // This rig exercises first-person bursts without a weapon model.
resize();
addEventListener('resize', resize);
const warmed = await fx.prewarmMaterials();
if (!warmed.ok) throw new Error(`FX preview warmup failed: ${JSON.stringify(warmed)}`);

const params = new URLSearchParams(location.search);
let KIND = params.get('kind') ?? 'wall';
if (KIND === 'closeup') {
  // decal / dust inspection at half a metre off the wall
  camera.position.set(0.35, 1.55, -1.55);
  camera.lookAt(-0.35, 1.5, -3.0);
  camera.updateMatrixWorld();
  KIND = 'wall';
}
fx.debugBurst(KIND);
window.__FX__ = fx;
window.__BURST__ = (k) => fx.debugBurst(k);

// Atlas inspector: ?kind=atlas | patlas | natlas | ormatlas draws a baked atlas
// full-screen so every tile can be judged on its own.
const atlasNode = uniformTexture(fx._decalAtlas.albedo);
const atlasMat = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
atlasMat.fragmentNode = atlasNode.sample(uv());
const atlasQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), atlasMat);
atlasQuad.frustumCulled = false;
const atlasScene = new THREE.Scene();
atlasScene.add(atlasQuad);
const atlasCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
const ATLAS_VIEWS = {
  atlas: () => fx._decalAtlas.albedo,
  atlasa: () => fx._decalAtlas.albedo,
  natlas: () => fx._decalAtlas.normal,
  ormatlas: () => fx._decalAtlas.orm,
  patlas: () => fx._atlas.texture,
  patlasa: () => fx._atlas.texture,
};

function advance() {
  time.frame++;
  time.elapsed += time.dt;
  time.raw += time.dt;

  renderStub.sunDir.copy(sun.position).normalize();
  camera.updateMatrixWorld();
  viewCamera.updateMatrixWorld();

  fx.update(time.dt, ctx);
  fx.lateUpdate(time.dt, ctx);

  if (params.get('log') && time.frame % 30 === 0) {
    console.info(
      `f${time.frame} add=${fx.add.spawned} lit=${fx.lit.spawned} mote=${fx.motes.spawned} ` +
        `haze=${fx.hazeSys.layer.spawned} decals=${fx.stats.decals} impacts=${fx.stats.spawned} ` +
        `addVis=${fx.add.mesh.visible} litVis=${fx.lit.mesh.visible} inst=${fx.add.geometry.instanceCount}`
    );
  }
}

function draw() {
  const av = ATLAS_VIEWS[params.get('kind')];
  if (av) {
    atlasNode.value = av();
    renderer.setRenderTarget(null);
    renderer.render(atlasScene, atlasCam);
    return;
  }
  renderer.setRenderTarget(null);
  pipeline.render();
}
window.__PREVIEW_RENDERER__ = renderer;
window.__PREVIEW_DRAW__ = draw;
window.__PREVIEW_STEP__ = advance;
window.__PREVIEW_GRAPH__ = () => pipeline;
window.__PREVIEW_CTX__ = ctx;
let raf;
function frame() {
  advance(); draw();
  raf = requestAnimationFrame(frame);
}
draw(); // Do not publish readiness before the real composition succeeds.
window.__READY__ = true;
if (!params.has('lockstep')) raf = requestAnimationFrame(frame);

async function dispose() {
  window.__READY__ = false;
  cancelAnimationFrame(raf);
  removeEventListener('resize', resize);
  pipeline.dispose(); fx.dispose();
  for (const mesh of collide) mesh.geometry.dispose();
  for (const material of [wallMat, groundMat, steelMat, atlasMat]) material.dispose();
  for (const texture of [...Object.values(concreteMaps), ...Object.values(groundMaps)]) texture.dispose();
  atlasQuad.geometry.dispose(); sun.shadow.dispose();
  await renderer.dispose();
}
window.__PREVIEW_DISPOSE__ = dispose;
if (import.meta.hot) import.meta.hot.dispose(dispose);
