import * as THREE from 'three';
import { float, uv } from 'three/tsl';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { TextureForge } from '../../src/materials/generator.js';
import { bakeSurface } from '../../src/materials/forge-tsl.js';
import { LIBRARY } from '../../src/materials/library.js';
import { foliageSurface } from '../../src/materials/tsl/foliage.js';
import { glassSurface } from '../../src/materials/tsl/glass.js';

// Comparison harness only: the production renderer never creates a WebGL
// context, and the strict WebGPU-only boot probe remains independent of this.
let gpu, gl, forge;
try {
  gpu = await createWebGpuRenderer(document.querySelector('#game'));
  gl = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  forge = new TextureForge(gl);
  const size = 64;
  const results = {};
  for (const [name, surfaceFn] of Object.entries({ foliage: foliageSurface, glass: glassSurface })) {
    const def = LIBRARY[name].bake;
    const legacy = forge.build({ key: name, glsl: LIBRARY[name].glsl, size,
      seed: def.seed, worldSize: def.worldSize, relief: def.relief });
    const node = bakeSurface(gpu, { size, worldSize: def.worldSize, relief: def.relief,
      surface: surfaceFn(uv(), float(def.seed)) });
    const maps = {};
    try {
      for (const key of ['albedo', 'orm', 'normal']) {
        const before = new Uint8Array(size * size * 4);
        gl.readRenderTargetPixels(legacy[key].renderTarget, 0, 0, size, size, before);
        const after = await gpu.readRenderTargetPixelsAsync(node[key], 0, 0, size, size);
        // WebGL reads from the bottom-left; WebGPU reads from the top-left.
        // Align rows before comparing authored pixels, not the raw buffers.
        const error = [0, 0, 0, 0], peak = [0, 0, 0, 0];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) {
          const i = (y * size + x) * 4 + c;
          const d = Math.abs(before[i] - after[((size - 1 - y) * size + x) * 4 + c]);
          error[c] += d;
          peak[c] = Math.max(peak[c], d);
        }
        maps[key] = { mean: error.map((n) => +(n / (size * size)).toFixed(3)), peak };
      }
    } finally {
      node.albedo.dispose();
      node.orm.dispose();
      node.normal.dispose();
    }
    results[name] = maps;
  }
  window.__MATERIAL_PARITY__ = { ok: true, results };
} catch (e) {
  window.__MATERIAL_PARITY__ = { ok: false, error: e.message, stack: e.stack };
} finally {
  forge?.dispose();
  gl?.dispose();
  await gpu?.dispose();
}
