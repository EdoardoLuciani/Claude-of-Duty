import { Mesh, PlaneGeometry, Scene, OrthographicCamera, MeshBasicNodeMaterial,
  RenderPipeline, RenderTarget, HalfFloatType } from 'three/webgpu';
import { pass } from 'three/tsl';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';

// A small integration probe, not a parallel gameplay renderer: exercise the
// exact strict device constructor and a world + independent MSAA weapon pass.
const canvas = document.querySelector('#game');

try {
  const renderer = await createWebGpuRenderer(canvas);
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const viewScene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const viewCamera = camera.clone();
  camera.position.z = 2;
  viewCamera.position.z = 2;
  const background = new Mesh(new PlaneGeometry(2, 2),
    new MeshBasicNodeMaterial({ color: 0x246eb1 }));
  scene.add(background);
  const weapon = new Mesh(new PlaneGeometry(0.8, 0.8),
    new MeshBasicNodeMaterial({ color: 0xf06442 }));
  viewScene.add(weapon);

  const worldPass = pass(scene, camera, { samples: 0 });
  const viewPass = pass(viewScene, viewCamera, { samples: 4 });
  // MSAA resolves the view against transparent black (premultiplied colour).
  // Source-over must add that colour once, not multiply coverage a second time.
  const pipeline = new RenderPipeline(renderer, worldPass.mul(viewPass.a.oneMinus()).add(viewPass));
  // The test reads this target asynchronously: Chromium's headless WebGPU
  // swapchain can appear black in Playwright screenshots even when GPU passes
  // produce correct pixels. Production will present to the canvas instead.
  const output = new RenderTarget(160, 96, { type: HalfFloatType, depthBuffer: false });
  const resize = (w, h) => {
    renderer.setSize(w, h);
    output.setSize(w, h);
    renderer.setRenderTarget(output);
    pipeline.render();
    renderer.setRenderTarget(null);
  };
  resize(160, 96);
  window.__WEBGPU_BOOT__ = {
    ok: true,
    backend: renderer.backend.constructor.name,
    worldSamples: worldPass.renderTarget.samples,
    weaponSamples: viewPass.renderTarget.samples,
    probe: async (x, y) => Array.from(await renderer.readRenderTargetPixelsAsync(output, x, y, 1, 1)),
    viewAlpha: async (x, y) => (await renderer.readRenderTargetPixelsAsync(
      viewPass.renderTarget, x, y, 1, 1))[3],
    resize,
    dispose: async () => {
      pipeline.dispose();
      worldPass.dispose();
      viewPass.dispose();
      output.dispose();
      background.geometry.dispose();
      weapon.geometry.dispose();
      background.material.dispose();
      weapon.material.dispose();
      await renderer.dispose();
      window.__WEBGPU_BOOT__.disposed = true;
    },
  };
} catch (error) {
  window.__WEBGPU_BOOT__ = { ok: false, error: error.message };
}
