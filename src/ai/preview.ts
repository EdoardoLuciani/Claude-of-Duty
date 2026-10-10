/**
 * DEV ONLY — standalone character rig for iterating on the soldier model and
 * its animation without booting the whole game. Studio lighting, neutral
 * background, a real PMREM environment so metals and the goggle glass behave.
 *
 *   node src/ai/shoot.mjs --view=front --variant=vanguard --out=/tmp/ai-front.png
 *
 * Query params: variant, view (front|back|three|face|gear|legs|line), clip, phase, aim
 */

import * as THREE from 'three/webgpu';
import { dot, mix, normalize, positionLocal, pow, smoothstep, vec3 } from 'three/tsl';
import { createWebGpuRenderer } from '../render/webgpu-device.js';
import { Rng } from '../core/rng.ts';
import { SoldierMaterialsNode } from './textures-tsl.js';
import { buildSoldier, VARIANTS } from './soldier.ts';
import { RIG } from './rig.ts';
import { Animator } from './animator.ts';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = await createWebGpuRenderer(canvas);
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 60);

/* ---- environment: sky gradient + ground bounce, through PMREM ---- */
const envScene = new THREE.Scene();
{
  const g = new THREE.SphereGeometry(20, 32, 24);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const d = normalize(positionLocal);
  const sky = mix(vec3(0.55, 0.68, 0.92), vec3(0.16, 0.22, 0.32),
    d.y.mul(1.4).clamp(0, 1));
  const horizon = mix(vec3(0.18, 0.16, 0.13), sky,
    smoothstep(-0.12, 0.10, d.y));
  m.colorNode = horizon.add(vec3(6, 5.4, 4.6).mul(pow(
    dot(d, vec3(-0.45, 0.62, 0.35).normalize()).max(0), 900)));
  envScene.add(new THREE.Mesh(g, m));
}
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(envScene, 0.04).texture;
scene.environment = env;
scene.background = new THREE.Color(0x1b1f24);

/* ---- key / fill / rim ---- */
const key = new THREE.DirectionalLight(0xfff3e0, 3.1);
key.position.set(-3.2, 4.4, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -1.6;
key.shadow.camera.right = 1.6;
key.shadow.camera.top = 2.4;
key.shadow.camera.bottom = -0.2;
key.shadow.bias = -0.0006;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
rim.position.set(2.6, 2.0, -3.4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x9ab4d0, 0x2a231b, 0.55));

/* ---- ground ---- */
{
  const g = new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x2a2723, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/* ---- characters ---- */
const rng = new Rng(0xa11ce);
const materials = await SoldierMaterialsNode.fromCache({ base: '/models/proc', anisotropy: 8 });

const view = q.get('view') ?? 'front';
const variantName = (q.get('variant') ?? 'vanguard') as keyof typeof VARIANTS;
const names: Array<keyof typeof VARIANTS> = view === 'line'
  ? Object.keys(VARIANTS) as Array<keyof typeof VARIANTS>
  : [variantName];
type PreviewActor = { group: THREE.Group; mesh: THREE.SkinnedMesh; bones: THREE.Bone[]; animator: Animator; def: ReturnType<typeof buildSoldier> };
const actors: PreviewActor[] = [];

for (let i = 0; i < names.length; i++) {
  const def = buildSoldier(names[i], { rng: rng.fork(), materials });
  const { bones, skeleton, root } = RIG.createSkeleton();
  const mesh = new THREE.SkinnedMesh(def.geometry, def.materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(root);
  group.add(mesh);
  mesh.bind(skeleton);
  group.position.x = (i - (names.length - 1) / 2) * 1.15;
  scene.add(group);
  const animator = new Animator(RIG, bones, { rng: rng.fork() });
  actors.push({ group, mesh, bones, animator, def });
  console.info(`[preview] ${names[i]} ${def.stats.triangles} tris ${def.stats.vertices} verts`);
}

/* ---- camera framing ---- */
const VIEWS: Record<string, { pos: number[]; look: number[]; fov: number }> = {
  front: { pos: [0.0, 1.05, 3.1], look: [0, 1.02, 0], fov: 34 },
  three: { pos: [1.85, 1.25, 2.45], look: [0, 1.02, 0], fov: 34 },
  back: { pos: [0.1, 1.15, -3.0], look: [0, 1.02, 0], fov: 34 },
  face: { pos: [0.34, 1.68, 0.86], look: [0, 1.62, 0.02], fov: 24 },
  gear: { pos: [0.55, 1.32, 1.25], look: [0, 1.26, 0.05], fov: 30 },
  legs: { pos: [0.7, 0.55, 1.5], look: [0, 0.5, 0], fov: 32 },
  line: { pos: [0, 1.25, 4.6], look: [0, 1.05, 0], fov: 40 },
  // 25 m at the game's on-screen scale: a 1.75 m man subtends 4.0 deg, which in
  // a 1600 px frame at 30 deg vertical fov is ~215 px tall — exactly his
  // footprint in the `combat` shot. This is the view that proves the camo macro
  // blotches survive the mip chain instead of averaging to flat tan.
  far: { pos: [0.9, 1.35, 25], look: [0, 1.0, 0], fov: 30 },
  // 12 m: mid-range, where the gear silhouette has to read
  mid: { pos: [0.6, 1.3, 12], look: [0, 1.0, 0], fov: 30 },
};
const V = VIEWS[view] ?? VIEWS.front;
camera.position.fromArray(V.pos);
camera.lookAt(new THREE.Vector3().fromArray(V.look));
camera.fov = V.fov;
camera.updateProjectionMatrix();

/* ---- animation ---- */
const clip = (q.get('clip') ?? 'idle') as Parameters<Animator['setState']>[0]['clip'];
const phase = Number(q.get('phase') ?? 0);
const aim = q.get('aim');
const aimTarget = new THREE.Vector3(
  ...(aim ? aim.split(',').map(Number) : [0.5, 1.6, 6])
);

/** Frame index is the only clock here: see the loop below. */
const PREVIEW_DT = 1 / 60;
let frameIndex = 0;
let t = phase;
function frame(dt: number): void {
  t = phase + frameIndex * dt;
  for (const a of actors) {
    a.animator.setState({ clip, speed: 1, aimTarget, lookTarget: aimTarget, aimWeight: 1 });
    a.animator.update(dt, t);
    a.group.updateMatrixWorld(true);
  }
}

function loop(): void {
  requestAnimationFrame(loop);
  // This page has no engine, so it has no ctx.time — but it must not read the
  // wall clock either. shoot.mjs pumps a fixed number of frames and screenshots
  // frame N, so a real-dt integration made the pose depend on machine load and
  // on how long the texture bake happened to take. Frame index IS the clock:
  // frame N is always at t = phase + N/60, on any machine, at any frame rate.
  frameIndex++;
  frame(PREVIEW_DT);
  renderer.render(scene, camera);
  if (frameIndex === 4) previewWindow.__READY__ = true;
}
const previewWindow = window as Window & {
  __READY__?: boolean;
  __PREVIEW_RENDERER__?: typeof renderer;
  __PREVIEW_DRAW__?: () => void;
};
previewWindow.__PREVIEW_RENDERER__ = renderer;
previewWindow.__PREVIEW_DRAW__ = () => renderer.render(scene, camera);
requestAnimationFrame(loop);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
