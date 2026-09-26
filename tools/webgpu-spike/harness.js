/**
 * SPIKE — head-to-head between the production prepass and its TSL re-authoring.
 *
 *   arm A  `src/render/prepass.js`      GLSL3 + scene.overrideMaterial + hand-rolled
 *                                       previous-matrix bookkeeping
 *   arm B  `./prepass-tsl.js`           TSL + MRTNode + TSL `velocity`
 *
 * Both arms get the SAME scene (built per namespace from one deterministic
 * description) and the SAME camera/scene state per frame index, so:
 *
 *   - the readback diff measures the shaders, not the scene
 *   - the timings measure the pass, not the content
 *
 * Emits `window.__SPIKE__` with a JSON-able report plus per-channel readbacks.
 */
import * as TC from 'three';
import * as TG from 'three/webgpu';

import { GBuffer } from '../../src/render/prepass.js';
import { GBufferTSL } from './prepass-tsl.js';
import { buildScene } from './scene.js';

const params = new URLSearchParams(location.search);

const HALF = new Float32Array(65536);
(function initHalfTable() {
  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);
  for (let i = 0; i < 65536; i++) {
    const s = (i & 0x8000) >> 15;
    const e = (i >> 10) & 0x1f;
    const m = i & 0x3ff;
    let v;
    if (e === 0) v = (m / 1024) * Math.pow(2, -14);
    else if (e === 31) v = m ? NaN : Infinity;
    else v = (1 + m / 1024) * Math.pow(2, e - 15);
    HALF[i] = s ? -v : v;
  }
  f32[0] = 1;
  i32[0] = i32[0]; // no-op, keeps the typed arrays alive
})();

function halfAt(u16, index) {
  return HALF[u16[index]];
}

/** Flatten a possibly-padded typed array into Float32, top-left origin. */
function normalise(raw, width, height, channels, isHalf, flipY) {
  const out = new Float32Array(width * height * channels);
  const rowFloats = width * channels;
  const bytesPerTexel = channels * (isHalf ? 2 : 4);
  const bytesPerRow = Math.ceil((width * bytesPerTexel) / 256) * 256;
  const padded = raw.byteLength >= bytesPerRow * height;
  const srcRowFloats = padded ? bytesPerRow / (isHalf ? 2 : 4) : rowFloats;

  for (let y = 0; y < height; y++) {
    const sy = flipY ? height - 1 - y : y;
    const src = sy * srcRowFloats;
    const dst = y * rowFloats;
    for (let x = 0; x < rowFloats; x++) {
      out[dst + x] = isHalf ? halfAt(raw, src + x) : raw[src + x];
    }
  }
  return out;
}

function collectDrawList(scene) {
  const list = [];
  scene.traverse((o) => {
    if (o.visible && (o.isMesh || o.isSkinnedMesh || o.isInstancedMesh)) list.push(o);
  });
  return list;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

function stats(values) {
  const sorted = Float32Array.from(values).sort();
  let sum = 0;
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (values[i] > max) max = values[i];
  }
  return {
    mean: sum / values.length,
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    max,
  };
}

function fractionOver(values, threshold) {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > threshold) n++;
  return n / values.length;
}

function decodeOct(x, y) {
  const nx = x;
  const ny = y;
  const nz = 1 - Math.abs(x) - Math.abs(y);
  const t = Math.max(-nz, 0);
  return [nx + (nx >= 0 ? -t : t), ny + (ny >= 0 ? -t : t), nz];
}

function normalise3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/* -------------------------------------------------------------------------- */
/* Arm A — production GLSL prepass                                             */
/* -------------------------------------------------------------------------- */

async function runArmGLSL(W, H, frameA, frameB, warmup, frames) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;

  const renderer = new TC.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.autoClear = false;
  renderer.outputColorSpace = TC.SRGBColorSpace;
  // Backend defaults for a render-target clear alpha differ (WebGL leaves 1,
  // WebGPU 0). Pin it so the diff measures the shader, not the clear colour.
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(W, H, false);

  const gb = new GBuffer();
  gb.setSize(W, H);
  // Readback accommodation: gl.readPixels for a 2-channel RG16F attachment is a
  // portability cliff, so both arms write velocity as RGBA16F and only .xy is
  // interpreted. Shared by both arms, so the comparison stays symmetric.
  gb.rt.textures[1].format = TC.RGBAFormat;
  gb.rt.textures[1].type = TC.HalfFloatType;

  const world = buildScene(TC, {
    freezeObjects: params.has('freezeObjects'),
    freezeCamera: params.has('freezeCamera'),
  });
  const draws = collectDrawList(world.scene);
  const curr = new TC.Matrix4();
  const prev = new TC.Matrix4();

  const step = (frame) => {
    world.step(frame);
    curr.multiplyMatrices(world.camera.projectionMatrix, world.camera.matrixWorldInverse);
  };

  const renderFrame = () => {
    gb.render(renderer, world.scene, world.camera, curr, prev, true);
    // Record AFTER the pass, exactly as render/index.js:1482 does: the map has to
    // hold THIS frame's transforms so next frame diffs against them. Calling it
    // before the pass makes owPrevModelMatrix equal the current model matrix and
    // silently deletes all object motion from the velocity buffer.
    gb.beginRecord();
    gb.recordMatrices(draws, draws.length);
    gb.endRecord();
    prev.copy(curr);
  };

  for (let f = 0; f < frameB; f++) {
    step(f);
    renderFrame();
  }

  // Capture: the frame the two arms are compared on. The readback MUST happen
  // here, immediately -- running it after the timing loop reads a hundred frozen
  // frames later, which zeroes velocity and stales every per-object uniform.
  step(frameB);
  const cpuStart = performance.now();
  renderFrame();
  const captureCpuMs = performance.now() - cpuStart;

  const info = {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs ? renderer.info.programs.length : null,
  };

  const readChannel = (index) => {
    const tex = gb.rt.textures[index];
    const isHalf = tex.type === TC.HalfFloatType;
    const channels = index === 2 ? 1 : 4;
    const raw = isHalf ? new Uint16Array(W * H * channels) : new Float32Array(W * H * channels);
    renderer.readRenderTargetPixels(gb.rt, 0, 0, W, H, raw, 0, index);
    return { data: normalise(raw, W, H, channels, isHalf, true), channels };
  };

  const channels = [readChannel(0), readChannel(1), readChannel(2)];

  // Timing: no scene motion, no bookkeeping differences beyond what the pass needs.
  for (let i = 0; i < warmup; i++) renderFrame();

  const cpuSamples = [];
  for (let i = 0; i < frames; i++) {
    const c0 = performance.now();
    renderFrame();
    cpuSamples.push(performance.now() - c0);
  }

  // Wall time over a tight submit loop only measures how fast commands can be
  // QUEUED (the driver happily buffers hundreds of frames), so it says nothing
  // about the pass cost. Force a sync every few frames instead: the loop then
  // cannot run ahead of the GPU and the number becomes GPU-bound.
  const syncBuf = new Float32Array(1);
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < 8; i++) renderFrame();
    renderer.readRenderTargetPixels(gb.rt, 0, 0, 1, 1, syncBuf, 0, 2);
  }
  const serialTotal = performance.now() - t0;

  const result = {
    info,
    captureCpuMs,
    serialMsPerFrame: serialTotal / (frames * 8),
    submitMs: stats(Float32Array.from(cpuSamples)),
    channels,
    camera: world.camera,
    width: W,
    height: H,
  };

  gb.dispose();
  renderer.dispose();
  return result;
}

/* -------------------------------------------------------------------------- */
/* Arm B — TSL prepass                                                         */
/* -------------------------------------------------------------------------- */

async function runArmTSL(W, H, frameB, warmup, frames) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;

  const renderer = new TG.WebGPURenderer({
    canvas,
    antialias: false,
    trackTimestamp: true,
    forceWebGL: params.has('forceWebGL'),
  });
  await renderer.init();
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(W, H, false);

  const gb = new GBufferTSL();
  gb.setSize(W, H);
  gb.rt.textures[1].format = TG.RGBAFormat;
  gb.rt.textures[1].type = TG.HalfFloatType;
  gb.attach(renderer);

  const world = buildScene(TG, {
    freezeObjects: params.has('freezeObjects'),
    freezeCamera: params.has('freezeCamera'),
  });
  const step = (frame) => world.step(frame);
  const renderFrame = () => gb.render(renderer, world.scene, world.camera, true);

  for (let f = 0; f < frameB; f++) {
    step(f);
    renderFrame();
  }

  step(frameB);
  const cpuStart = performance.now();
  renderFrame();
  const captureCpuMs = performance.now() - cpuStart;

  const readChannel = async (index) => {
    const tex = gb.rt.textures[index];
    const isHalf = tex.type === TG.HalfFloatType;
    const channels = index === 2 ? 1 : 4;
    const raw = await renderer.readRenderTargetPixelsAsync(gb.rt, 0, 0, W, H, index);
    return { data: normalise(raw, W, H, channels, isHalf, false), channels };
  };

  // Read back the capture frame BEFORE anything else renders over it.
  const channels = [await readChannel(0), await readChannel(1), await readChannel(2)];

  // Unlike WebGLRenderer, the WebGPU path does not reset info per render() call,
  // so a counter read here accumulates the whole loop. Reset around one frame.
  renderer.info.reset();
  renderFrame();
  const info = {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    programs: renderer.info.programs ? renderer.info.programs.length : null,
  };

  for (let i = 0; i < warmup; i++) renderFrame();

  const cpuSamples = [];
  for (let i = 0; i < frames; i++) {
    const c0 = performance.now();
    renderFrame();
    cpuSamples.push(performance.now() - c0);
  }

  // See the arm-A note: a tight submit loop measures queueing, not the pass.
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < 8; i++) renderFrame();
    await renderer.readRenderTargetPixelsAsync(gb.rt, 0, 0, 1, 1, 2);
  }
  const serialTotal = performance.now() - t0;

  // info.render.timestamp ACCUMULATES across render() calls (the same trap as
  // info.render.triangles), so resolve it around exactly one frame.
  let gpuMs = null;
  const gpuSamples = [];
  for (let i = 0; i < 15; i++) {
    renderer.info.reset();
    renderFrame();
    try {
      await renderer.resolveTimestampsAsync('render');
      const t = renderer.info.render.timestamp;
      if (typeof t === 'number' && t > 0) gpuSamples.push(t);
    } catch {
      break; // timestamp queries unsupported: leave gpuMs null
    }
  }
  gpuSamples.sort((a, b) => a - b);
  gpuMs = gpuSamples.length ? gpuSamples[gpuSamples.length >> 1] : null;

  const result = {
    info,
    captureCpuMs,
    serialMsPerFrame: serialTotal / (frames * 8),
    submitMs: stats(Float32Array.from(cpuSamples)),
    camera: world.camera,
    width: W,
    height: H,
    gpuMs,
    timestampSupport: renderer.backend?.hasFeature
      ? renderer.backend.hasFeature('timestamp-query')
      : null,
    channels,
  };

  gb.dispose();
  renderer.dispose();
  return result;
}

/* -------------------------------------------------------------------------- */
/* Diff + montage                                                              */
/* -------------------------------------------------------------------------- */

/** Per-arm channel summary + a coarse ASCII depth map, for triage not for gates. */
function summarise(arm, camera, W, H) {
  const describe = (data, channels) => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let nonZero = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      if (v !== 0) nonZero++;
    }
    return {
      channels,
      min: +min.toFixed(6),
      max: +max.toFixed(6),
      mean: +(sum / data.length).toFixed(6),
      nonZeroFraction: +(nonZero / data.length).toFixed(4),
    };
  };

  const nd = arm.channels[0].data;
  const matIdHistogram = {};
  for (let i = 0; i < nd.length; i += 4) {
    const v = +nd[i + 3].toFixed(3);
    matIdHistogram[v] = (matIdHistogram[v] || 0) + 1;
  }

  const depth = arm.channels[2].data;
  const rows = 12;
  const cols = 32;
  const map = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(((c + 0.5) / cols) * W);
      const y = Math.floor(((r + 0.5) / rows) * H);
      const d = depth[y * W + x];
      line += d === 0 ? '.' : d < 8 ? '#' : d < 16 ? '+' : d < 30 ? '-' : ' ';
    }
    map.push(line);
  }

  return {
    camera: {
      pos: camera.position.toArray().map((v) => +v.toFixed(4)),
      quat: camera.quaternion.toArray().map((v) => +v.toFixed(4)),
      proj0: +camera.projectionMatrix.elements[0].toFixed(6),
      viewZ: +camera.matrixWorldInverse.elements[14].toFixed(4),
    },
    normal: describe(arm.channels[0].data, 4),
    velocity: describe(arm.channels[1].data, 2),
    depth: describe(depth, 1),
    matIdHistogram,
    depthMap: map,
  };
}

function diffChannels(a, b) {
  const reports = {};

  const da = a.channels[2].data;
  const db = b.channels[2].data;
  const depthErr = new Float32Array(Math.min(da.length, db.length));
  for (let i = 0; i < depthErr.length; i++) depthErr[i] = Math.abs(da[i] - db[i]);
  reports.depth = { ...stats(depthErr), over1cm: fractionOver(depthErr, 0.01) };

  const va = a.channels[1].data;
  const vb = b.channels[1].data;
  const velErr = new Float32Array(Math.min(va.length, vb.length) >> 2);
  for (let i = 0; i < velErr.length; i++) {
    velErr[i] = Math.hypot(va[i * 4] - vb[i * 4], va[i * 4 + 1] - vb[i * 4 + 1]);
  }
  reports.velocity = { ...stats(velErr), over1e4: fractionOver(velErr, 1e-4) };

  const na = a.channels[0].data;
  const nb = b.channels[0].data;
  const pixels = Math.min(na.length, nb.length) >> 2;
  const normalErr = new Float32Array(pixels);
  const coverageErr = new Float32Array(pixels);
  const matIdErr = new Float32Array(pixels);
  let covMismatch = 0;
  let skinnedPixels = 0;
  for (let i = 0; i < pixels; i++) {
    const A = normalise3(decodeOct(na[i * 4], na[i * 4 + 1]));
    const B = normalise3(decodeOct(nb[i * 4], nb[i * 4 + 1]));
    const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    normalErr[i] = (Math.acos(dot) * 180) / Math.PI;
    coverageErr[i] = Math.abs(na[i * 4 + 2] - nb[i * 4 + 2]);
    matIdErr[i] = Math.abs(na[i * 4 + 3] - nb[i * 4 + 3]);
    if (na[i * 4 + 2] < 0.85) skinnedPixels++;
    if (coverageErr[i] > 1e-3) covMismatch++;
  }
  reports.normalDeg = { ...stats(normalErr), over1deg: fractionOver(normalErr, 1) };
  reports.coverage = { ...stats(coverageErr), over1e3: fractionOver(coverageErr, 1e-3) };
  reports.matId = { ...stats(matIdErr), over1e3: fractionOver(matIdErr, 1e-3) };
  reports.pixels = pixels;
  reports.coverageMismatchPixels = covMismatch;
  reports.skinnedPixels = skinnedPixels;

  return reports;
}

function montage(canvas, armA, armB, W, H) {
  canvas.width = W;
  canvas.height = H * 3;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101014';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rows = [
    ['A glsl', armA],
    ['B tsl', armB],
    ['diff x8', null],
  ];

  const depthA = armA.channels[2].data;
  const depthB = armB.channels[2].data;
  const nA = armA.channels[0].data;
  const nB = armB.channels[0].data;
  const vA = armA.channels[1].data;
  const vB = armB.channels[1].data;

  let maxDepth = 0;
  for (let i = 0; i < W * H; i++) maxDepth = Math.max(maxDepth, depthA[i]);
  maxDepth = Math.max(maxDepth, 1);

  const cellsW = Math.floor(W / 3);

  const put = (col, x0, y0, cellW, fn) => {
    const image = ctx.createImageData(cellW, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < cellW; x++) {
        const i = y * W + x0 + x;
        const rgb = fn(i);
        const o = (y * cellW + x) * 4;
        image.data[o] = rgb[0];
        image.data[o + 1] = rgb[1];
        image.data[o + 2] = rgb[2];
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, col * cellW, y0 * H);
  };

  for (let row = 0; row < 3; row++) {
    const y0 = row;
    if (rows[row][1]) {
      const isA = row === 0;
      const nd = isA ? nA : nB;
      const dpt = isA ? depthA : depthB;
      const vel = isA ? vA : vB;
      // normal xy
      put(0, 0, y0, cellsW, (i) => [
        Math.round(255 * (nd[i * 4] * 0.5 + 0.5)),
        Math.round(255 * (nd[i * 4 + 1] * 0.5 + 0.5)),
        Math.round(255 * nd[i * 4 + 2]),
      ]);
      // depth
      put(1, cellsW, y0, cellsW, (i) => {
        const d = 1 - Math.min(1, dpt[i] / maxDepth);
        const c = Math.round(255 * Math.pow(d, 0.35));
        return [c, c, c];
      });
      // velocity, x8
      put(2, cellsW * 2, y0, cellsW, (i) => [
        Math.round(Math.min(255, Math.max(0, 128 + vel[i * 4] * 255 * 8))),
        Math.round(Math.min(255, Math.max(0, 128 + vel[i * 4 + 1] * 255 * 8))),
        128,
      ]);
    } else {
      put(0, 0, y0, cellsW, (i) => {
        const e = Math.min(1, Math.abs(nA[i * 4] - nB[i * 4]) + Math.abs(nA[i * 4 + 1] - nB[i * 4 + 1]));
        const c = Math.round(255 * Math.min(1, e * 8));
        return [c, 0, 0];
      });
      put(1, cellsW, y0, cellsW, (i) => {
        const c = Math.round(255 * Math.min(1, Math.abs(depthA[i] - depthB[i]) * 8));
        return [c, 0, 0];
      });
      put(2, cellsW * 2, y0, cellsW, (i) => {
        const e = Math.hypot(vA[i * 4] - vB[i * 4], vA[i * 4 + 1] - vB[i * 4 + 1]);
        const c = Math.round(255 * Math.min(1, e * 255 * 8));
        return [c, 0, 0];
      });
    }
  }
}

/* -------------------------------------------------------------------------- */

export async function runSpike(opts = {}) {
  const W = Number(params.get('w') ?? opts.width ?? 960);
  const H = Number(params.get('h') ?? opts.height ?? 540);
  const frameB = Number(params.get('frame') ?? opts.frame ?? 90);
  const warmup = Number(params.get('warmup') ?? 30);
  const frames = Number(params.get('frames') ?? 200);
  // Arm A leg of the production contract: the prepass sees the frame BEFORE this
  // one via owPrevVP, so it has to be stepped to `frameB - 1` first.
  const frameA = frameB - 1;

  const report = { config: { W, H, frame: frameB, warmup, frames }, errors: [] };
  const t0 = performance.now();

  let armA = null;
  try {
    armA = await runArmGLSL(W, H, frameA, frameB, warmup, frames);
  } catch (e) {
    report.errors.push(`armA(glsl): ${e && e.stack ? e.stack : e}`);
  }

  let armB = null;
  try {
    armB = await runArmTSL(W, H, frameB, warmup, frames);
  } catch (e) {
    report.errors.push(`armB(tsl): ${e && e.stack ? e.stack : e}`);
  }

  report.totalMs = performance.now() - t0;

  if (armA && armB) {
    report.armA = { info: armA.info, captureCpuMs: armA.captureCpuMs, serialMsPerFrame: armA.serialMsPerFrame, submitMs: armA.submitMs };
    report.armB = {
      info: armB.info,
      captureCpuMs: armB.captureCpuMs,
      serialMsPerFrame: armB.serialMsPerFrame,
      submitMs: armB.submitMs,
      gpuMs: armB.gpuMs,
      timestampSupport: armB.timestampSupport,
    };
    // Per-pixel probe: a handful of covered pixels, both arms, so a scaling or
    // sign error in the velocity convention is visible as a number, not a guess.
    const probe = [];
    const vа = armA.channels[1].data;
    const vb = armB.channels[1].data;
    const nda = armA.channels[0].data;
    for (const [px, py] of [[0.5, 0.4], [0.3, 0.5], [0.7, 0.5], [0.5, 0.7], [0.2, 0.35], [0.8, 0.65], [0.5, 0.3], [0.4, 0.8]]) {
      const x = Math.floor(px * W);
      const y = Math.floor(py * H);
      const i = y * W + x;
      probe.push({
        px: +px.toFixed(2),
        py: +py.toFixed(2),
        covA: +nda[i * 4 + 2].toFixed(3),
        vA: [+vа[i * 4].toFixed(6), +vа[i * 4 + 1].toFixed(6)],
        vB: [+vb[i * 4].toFixed(6), +vb[i * 4 + 1].toFixed(6)],
      });
    }
    report.probe = probe;
    report.armADetail = summarise(armA, armA.camera, W, H);
    report.armBDetail = summarise(armB, armB.camera, W, H);
    report.diff = diffChannels(armA, armB);
    try {
      montage(document.getElementById('montage'), armA, armB, W, H);
      report.montage = document.getElementById('montage').toDataURL('image/png');
    } catch (e) {
      report.errors.push(`montage: ${e && e.message ? e.message : e}`);
    }
  }

  return report;
}
