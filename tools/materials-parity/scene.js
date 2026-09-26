import * as THREE from 'three';
import { float, uv, vec3, vec4 } from 'three/tsl';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { TextureForge } from '../../src/materials/generator.js';
import { bakeSurface } from '../../src/materials/forge-tsl.js';
import { LIBRARY } from '../../src/materials/library.js';
import { GLSL_SURFACES } from '../../src/materials/glsl/library.js';
import { SURFACES_TSL, GENERATED_SURFACES } from '../../src/materials/surfaces-index-tsl.js';

// Comparison harness only: the production renderer never creates a WebGL
// context, and the strict WebGPU-only boot probe remains independent of this.
let gpu, gl, forge;
try {
  gpu = await createWebGpuRenderer(document.querySelector('#game'));
  gl = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
  forge = new TextureForge(gl);
  const size = 64;
  const authored = Object.keys(LIBRARY).sort();
  const ported = Object.keys(SURFACES_TSL).sort();
  if (JSON.stringify(authored) !== JSON.stringify(ported) ||
      JSON.stringify(authored) !== JSON.stringify(Object.keys(GLSL_SURFACES).sort()))
    throw new Error('authored GLSL, data and TSL surface registries differ');
  const results = {};
  const cases = Object.fromEntries(Object.entries(SURFACES_TSL).map(([name, fn]) =>
    [name, [name, fn, {}, GENERATED_SURFACES.has(name)]]));
  cases.weapon_anodised = ['rubber', SURFACES_TSL.rubber, { seed: 601, relief: 0.005 }];
  const only = new URLSearchParams(location.search).get('only');
  if (only && !cases[only]) throw new Error(`unknown surface ${only}`);
  for (const [name, [libraryKey, surfaceFn, overrides, generated]] of Object.entries(cases)) {
    if (only && only !== name) continue;
    const def = { ...LIBRARY[libraryKey].bake, ...overrides };
    const tintA = new THREE.Color(def.tintA ?? 0xffffff);
    const tintB = new THREE.Color(def.tintB ?? 0xffffff);
    const param = new THREE.Vector4(...(def.param ?? [0, 0, 0, 0]));
    const legacy = forge.build({ key: libraryKey, glsl: GLSL_SURFACES[libraryKey], size,
      seed: def.seed, worldSize: def.worldSize, relief: def.relief, tintA, tintB, param });
    const input = [uv(), float(def.seed)];
    if (generated) input.push(vec3(tintA.r, tintA.g, tintA.b),
      vec3(tintB.r, tintB.g, tintB.b), vec4(param.x, param.y, param.z, param.w));
    const node = bakeSurface(gpu, { size, worldSize: def.worldSize, relief: def.relief,
      surface: surfaceFn(...input) });
    const maps = {};
    try {
      for (const key of ['albedo', 'orm', 'normal']) {
        const before = new Uint8Array(size * size * 4);
        gl.readRenderTargetPixels(legacy[key].renderTarget, 0, 0, size, size, before);
        const after = await gpu.readRenderTargetPixelsAsync(node[key], 0, 0, size, size);
        // WebGL reads from the bottom-left; WebGPU reads from the top-left.
        // Align rows before comparing authored pixels, not the raw buffers.
        const error = [0, 0, 0, 0], peak = [0, 0, 0, 0], avgBefore = [0, 0, 0, 0],
          avgAfter = [0, 0, 0, 0];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) {
          const i = (y * size + x) * 4 + c;
          const actual = after[((size - 1 - y) * size + x) * 4 + c];
          const d = Math.abs(before[i] - actual);
          error[c] += d;
          avgBefore[c] += before[i];
          avgAfter[c] += after[((size - 1 - y) * size + x) * 4 + c];
          peak[c] = Math.max(peak[c], d);
        }
        maps[key] = { mean: error.map((n) => +(n / (size * size)).toFixed(3)), peak,
          before: avgBefore.map((n) => +(n / (size * size)).toFixed(3)),
          after: avgAfter.map((n) => +(n / (size * size)).toFixed(3)) };
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
