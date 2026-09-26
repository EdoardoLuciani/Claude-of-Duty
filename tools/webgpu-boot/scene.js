import { Mesh, PlaneGeometry, Scene, OrthographicCamera, MeshBasicNodeMaterial,
  RenderPipeline, RenderTarget, HalfFloatType, DataTexture, RGBAFormat,
  UnsignedByteType, LinearFilter, NoBlending } from 'three/webgpu';
import { float, pass, uv, vec2 } from 'three/tsl';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { normalFromHeight } from '../../src/materials/normal-tsl.js';
import { detailSurface, macroSurface } from '../../src/materials/surfaces-tsl.js';
import { bakeDetail, bakeMacro, bakeSurface } from '../../src/materials/forge-tsl.js';
import { foliageSurface } from '../../src/materials/tsl/foliage.js';
import { glassSurface } from '../../src/materials/tsl/glass.js';

// A small integration probe, not a parallel gameplay renderer: exercise the
// exact strict device constructor and separate world / weapon passes.
try {
  const renderer = await createWebGpuRenderer(document.querySelector('#game'));
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
  // A translucent optic layer retains a partial-alpha compositing regression
  // without paying for MSAA on the entire first-person pass.
  const glass = new Mesh(new PlaneGeometry(0.2, 0.2),
    new MeshBasicNodeMaterial({ color: 0xf06442, transparent: true, opacity: 0.25 }));
  glass.position.x = 0.6;
  viewScene.add(glass);

  const worldPass = pass(scene, camera, { samples: 0 });
  const viewPass = pass(viewScene, viewCamera, { samples: 0 });
  // Transparent view colour is premultiplied: add it once, not twice.
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
    return { canvas: [renderer.domElement.width, renderer.domElement.height],
      target: [output.width, output.height] };
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
    // One real-GPU check of the reusable TSL texture-forge normal function.
    probeNormal: async () => {
      const data = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        data[i] = Math.round((x + 2 * y) * 255 / 45);
        data[i + 3] = 255;
      }
      const height = new DataTexture(data, 16, 16, RGBAFormat, UnsignedByteType);
      height.minFilter = height.magFilter = LinearFilter;
      height.needsUpdate = true;
      const mat = new MeshBasicNodeMaterial();
      mat.colorNode = normalFromHeight(height, vec2(1 / 16, 1 / 16), float(1));
      const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
      const testScene = new Scene();
      testScene.add(mesh);
      const target = new RenderTarget(16, 16, { type: HalfFloatType, depthBuffer: false });
      try {
        renderer.setRenderTarget(target);
        renderer.render(testScene, camera);
        return Array.from(await renderer.readRenderTargetPixelsAsync(target, 8, 8, 1, 1));
      } finally {
        renderer.setRenderTarget(null);
        target.dispose();
        height.dispose();
        mesh.geometry.dispose();
        mat.dispose();
      }
    },
    probeMacro: async () => {
      const mat = new MeshBasicNodeMaterial({ transparent: true, blending: NoBlending });
      const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
      const testScene = new Scene();
      testScene.add(mesh);
      const target = new RenderTarget(8, 8, { type: HalfFloatType, depthBuffer: false });
      try {
        const read = async (shift, x, y) => {
          const surface = macroSurface(uv().add(vec2(shift, 0)), float(1));
          mat.colorNode = surface.rgb;
          mat.opacityNode = surface.a;
          mat.needsUpdate = true;
          renderer.setRenderTarget(target);
          renderer.render(testScene, camera);
          return Array.from(await renderer.readRenderTargetPixelsAsync(target, x, y, 1, 1));
        };
        const center = await read(0, 3, 4);
        const adjacent = await read(1, 3, 4);
        const other = await read(0, 6, 2);
        const baked = bakeMacro(renderer, 8, 1);
        try {
          const sampleDetail = async (shift) => {
            const surface = detailSurface(uv().add(vec2(shift, 0)), float(1));
            mat.colorNode = surface.rgb;
            mat.opacityNode = surface.a;
            mat.needsUpdate = true;
            renderer.setRenderTarget(target);
            renderer.render(testScene, camera);
            return Array.from(await renderer.readRenderTargetPixelsAsync(target, 3, 4, 1, 1));
          };
          const detail = await sampleDetail(0);
          const detailAdjacent = await sampleDetail(1);
          const detailMaps = bakeDetail(renderer, 8, 1);
          try {
            return { center, adjacent, other,
              baked: Array.from(await renderer.readRenderTargetPixelsAsync(baked, 3, 4, 1, 1)),
              detail, detailAdjacent,
              detailBaked: Array.from(await renderer.readRenderTargetPixelsAsync(
                detailMaps.albedo, 3, 4, 1, 1)),
              detailNormal: Array.from(await renderer.readRenderTargetPixelsAsync(
                detailMaps.normal, 3, 4, 1, 1)) };
          } finally {
            detailMaps.albedo.dispose();
            detailMaps.normal.dispose();
          }
        } finally {
          baked.dispose();
        }
      } finally {
        renderer.setRenderTarget(null);
        target.dispose();
        mesh.geometry.dispose();
        mat.dispose();
      }
    },
    probeFoliage: async () => {
      const maps = bakeSurface(renderer, { size: 64, worldSize: 0.6, relief: 0.02,
        surface: foliageSurface(uv(), float(79)) });
      const sample = async (target, x, y) => Array.from(
        await renderer.readRenderTargetPixelsAsync(target, x, y, 1, 1));
      try {
        return { center: await sample(maps.albedo, 32, 32),
          edge: await sample(maps.albedo, 0, 0),
          orm: await sample(maps.orm, 32, 32),
          normal: await sample(maps.normal, 32, 32) };
      } finally {
        maps.albedo.dispose();
        maps.orm.dispose();
        maps.normal.dispose();
      }
    },
    probeGlass: async () => {
      const maps = bakeSurface(renderer, { size: 64, worldSize: 2, relief: 0.0008,
        surface: glassSurface(uv(), float(3)) });
      try {
        return { albedo: Array.from(await renderer.readRenderTargetPixelsAsync(
          maps.albedo, 32, 32, 1, 1)),
        orm: Array.from(await renderer.readRenderTargetPixelsAsync(maps.orm, 32, 32, 1, 1)),
        normal: Array.from(await renderer.readRenderTargetPixelsAsync(maps.normal, 32, 32, 1, 1)) };
      } finally {
        maps.albedo.dispose();
        maps.orm.dispose();
        maps.normal.dispose();
      }
    },
    resize,
    dispose: async () => {
      pipeline.dispose();
      worldPass.dispose();
      viewPass.dispose();
      output.dispose();
      background.geometry.dispose();
      weapon.geometry.dispose();
      glass.geometry.dispose();
      background.material.dispose();
      weapon.material.dispose();
      glass.material.dispose();
      await renderer.dispose();
      window.__WEBGPU_BOOT__.disposed = true;
    },
  };
} catch (error) {
  window.__WEBGPU_BOOT__ = { ok: false, error: error.message };
}
