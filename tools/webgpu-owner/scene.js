import { Scene, PerspectiveCamera, Mesh, MeshStandardNodeMaterial, BoxGeometry } from 'three/webgpu';
import { createConfig } from '../../src/core/config.js';
import { RenderSystem } from '../../src/render/index-webgpu.js';

let render, geometry, material;
try {
  const canvas = document.querySelector('#game');
  const scene = new Scene(), viewScene = new Scene();
  const camera = new PerspectiveCamera(72, 160 / 96, 0.05, 100);
  const viewCamera = new PerspectiveCamera(60, 160 / 96, 0.005, 12);
  camera.position.z = 3;
  geometry = new BoxGeometry(1, 1, 1);
  material = new MeshStandardNodeMaterial({ color: 0xc46b49 });
  scene.add(new Mesh(geometry, material));
  const ctx = { canvas, scene, camera, viewScene, viewCamera,
    config: createConfig({ quality: 'high' }), peek: () => null };
  render = new RenderSystem();
  await render.init(ctx);
  render.resize(160, 96);
  render.render(ctx);
  const pixels = await render.renderer.readRenderTargetPixelsAsync(render.hdrRt, 80, 48, 1, 1);
  render.resize(112, 72);
  camera.aspect = 112 / 72; camera.updateProjectionMatrix();
  viewCamera.aspect = 112 / 72; viewCamera.updateProjectionMatrix();
  render.render(ctx);
  const resized = await render.renderer.readRenderTargetPixelsAsync(render.hdrRt, 56, 36, 1, 1);
  const viewCorner = await render.renderer.readRenderTargetPixelsAsync(render.viewRt, 10, 10, 1, 1);
  const linearDepth = await render.renderer.readRenderTargetPixelsAsync(
    render._graph.prePass.renderTarget, 56, 36, 1, 1, 2);
  window.__OWNER_PROBE__ = { ok: true, backend: render.renderer.backend.constructor.name,
    width: render.screenSize.width, height: render.screenSize.height,
    pixel: [...pixels], linearDepth: [...linearDepth], resized: [...resized],
    viewCorner: [...viewCorner],
    worldSamples: render._graph.worldPass.renderTarget.samples,
    weaponSamples: render._graph.viewPass.renderTarget.samples };
} catch (error) { window.__OWNER_PROBE__ = { ok: false, error: error.stack }; }
finally { material?.dispose(); geometry?.dispose(); await render?.dispose(); }
