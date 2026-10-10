import * as T from 'three/webgpu';
import * as N from 'three/tsl';
import { createAoFilter } from './ao-filter-fixture.js';

// Known signal, not a claim of physical AO ground truth. Includes flat-surface
// noise, a thin contact shadow, an opaque depth discontinuity and neutral sky.
export async function reviewSyntheticAo(renderer, camera, current, selected) {
  const w = 320, h = 192, halfW = w / 2, halfH = h / 2;
  const originalSize = renderer.getSize(new T.Vector2()), originalTarget = renderer.getRenderTarget();
  const depth = new Float32Array(w * h), hardware = new Float32Array(w * h);
  const truth = new Float32Array(w * h), noisy = new Uint8Array(halfW * halfH);
  const signal = (x, y) => x >= 280 ? 1 : x >= 160 ? .9 :
    .7 - .32 * Math.exp(-.5 * ((y - 108) / 3) ** 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, z = x >= 280 ? 0 : x >= 160 ? 9 : 3;
    truth[i] = signal(x, y); depth[i] = z;
    hardware[i] = z ? camera.far * (1 - camera.near / z) / (camera.far - camera.near) : 1;
  }
  let seed = 42;
  for (let y = 0; y < halfH; y++) for (let x = 0; x < halfW; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = signal(x * 2 + .5, y * 2 + .5);
    noisy[y * halfW + x] = Math.round(255 * Math.max(0, Math.min(1,
      value === 1 ? 1 : value + .18 * (seed / 4294967296 * 2 - 1))));
  }
  const dataTexture = (data, width, height, type, filter) => {
    const t = new T.DataTexture(data, width, height, T.RedFormat, type);
    t.minFilter = t.magFilter = filter; t.needsUpdate = true; return t;
  };
  const ao = dataTexture(noisy, halfW, halfH, T.UnsignedByteType, T.LinearFilter);
  const linear = dataTexture(depth, w, h, T.FloatType, T.NearestFilter);
  const raw = dataTexture(hardware, w, h, T.FloatType, T.NearestFilter);
  const target = new T.RenderTarget(w, h, { depthBuffer: false });
  const results = {}, pictures = {};
  renderer.setSize(w, h);
  try {
    for (const name of ['current', 'depth', 'depth-tuned', 'color', 'color-default', 'compute']) {
      const f = createAoFilter(name, N.texture(ao), N.texture(linear),
        { camera, rawDepth: N.texture(raw) }, current, selected);
      const p = new T.RenderPipeline(renderer, N.Fn(() => {
        for (const node of f.computeNodes) node.toStack();
        return N.vec4(f.textureNode.sample(N.screenUV).rrr, 1);
      })());
      p.outputColorTransform = false;
      try {
        await new Promise(requestAnimationFrame); renderer.setRenderTarget(target); p.render();
        const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h);
        let mse = 0, count = 0, flatMse = 0, flatCount = 0, edgeError = 0, edgeCount = 0;
        let skyMin = 1, contact = 0, flank = 0, contactCount = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x, value = data[i * 4] / 255, error = value - truth[i];
          if (!depth[i]) { skyMin = Math.min(skyMin, value); continue; }
          mse += error * error; count++;
          if ((x < 150 || x > 170 && x < 270) && Math.abs(y - 108) > 15) {
            flatMse += error * error; flatCount++;
          }
          if (x >= 157 && x <= 162 && Math.abs(y - 108) > 15) {
            edgeError += Math.abs(error); edgeCount++;
          }
          if (x >= 10 && x < 150 && y === 108) {
            contact += value; flank += (data[((y - 12) * w + x) * 4] + data[((y + 12) * w + x) * 4]) / 510;
            contactCount++;
          }
        }
        results[name] = { rmse: Math.sqrt(mse / count), flatRmse: Math.sqrt(flatMse / flatCount),
          depthEdgeMae: edgeError / edgeCount, skyMin, contactContrast: (flank - contact) / contactCount,
          idealContactContrast: .32, size: [f.textureNode.value.image.width, f.textureNode.value.image.height] };
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
        pictures[name] = canvas.toDataURL('image/png').split(',')[1];
      } finally { p.dispose(); f.dispose(); }
    }
    return { results, pictures };
  } finally {
    target.dispose(); ao.dispose(); linear.dispose(); raw.dispose();
    renderer.setRenderTarget(originalTarget); renderer.setSize(originalSize.x, originalSize.y);
  }
}
