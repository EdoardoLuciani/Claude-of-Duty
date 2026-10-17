// Resolve through Vite together: mixing raw/unversioned and optimized Three.js
// imports creates two TSL stacks and invalidates the material fixture.
export * as THREE from 'three/webgpu';
export * as TSL from 'three/tsl';
export { createArmMaterial } from '../src/weapons/arm-asset.ts';
import { createWebGpuRenderer } from '../src/render/webgpu-device.ts';

/** Analytic fixtures share device validation, not their independent pixel oracles. */
export async function createFixtureRenderer(width = 64, height = width) {
  const renderer = await createWebGpuRenderer(document.querySelector('canvas'));
  renderer.setSize(width, height);
  const info = renderer.backend.device.adapterInfo;
  window.__ASSERT_HARDWARE_DEVICE__({
    vendor: info.vendor,
    architecture: info.architecture,
    fallback: info.isFallbackAdapter,
  });
  return renderer;
}
