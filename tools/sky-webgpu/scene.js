import {
  FloatType, HalfFloatType, PerspectiveCamera, RenderTarget, Scene, Vector3,
} from 'three/webgpu';
import { DataUtils } from 'three';
import { texture, uv, vec2, vec3 } from 'three/tsl';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { BakePass, hdrTarget } from '../../src/sky/bake.js';
import { SkySystem } from '../../src/sky/index.js';

/**
 * Focused strict-WebGPU integration probe for the TSL sky.
 *
 * It is not a parallel gameplay renderer: it constructs the production
 * `SkySystem` against a minimal `ctx`, renders the sky exactly as a world pass
 * would (through `scene.backgroundNode`), bakes the PMREM environment, and
 * exercises the graph-injected fog node against a colour/depth pair. The runner
 * reads the offscreen half-float targets because headless Chromium's WebGPU
 * swapchain can be black even when the GPU passes are correct.
 */
const W = 320;
const H = 180;

try {
  const canvas = document.querySelector('#game');
  const renderer = await createWebGpuRenderer(canvas);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(75, W / H, 0.1, 2000);
  const viewScene = new Scene();
  const viewCamera = new PerspectiveCamera(75, W / H, 0.1, 2000);

  const lights = [];
  const render = {
    renderer,
    addLight(light) { lights.push(light); return light; },
    removeLight(light) { const i = lights.indexOf(light); if (i >= 0) lights.splice(i, 1); },
    setEnvMap(tex) { scene.environment = tex; viewScene.environment = tex; },
  };
  const events = { emit() {}, on() {}, off() {} };
  const ctx = {
    scene, camera, viewScene, viewCamera, canvas,
    config: { q: { volumetrics: true }, quality: 'high', deterministic: false },
    events,
    input: { pointerLocked: false },
    time: { elapsed: 0, raw: 0, dt: 0.016, fixed: 0, alpha: 1, scale: 1, frame: 0 },
    rng: Math.random,
    get(id) { return id === 'render' ? render : null; },
    peek(id) { return this.get(id); },
    has(id) { return id === 'render'; },
  };

  const sky = new SkySystem();
  await sky.init(ctx);

  const output = new RenderTarget(W, H, { type: HalfFloatType, depthBuffer: false });

  function draw(target = output) {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  }

  function setTime(t) {
    ctx.time.elapsed = t * 10;
    sky.setTimeOfDay(t);
    sky.update(0.016, ctx);
    draw();
  }

  function lookAt(dir) {
    camera.position.set(0, 0, 0);
    const d = new Vector3(dir[0], dir[1], dir[2]).normalize();
    // Orienting from the view axis avoids the up-vector gimbal at the zenith.
    camera.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), d);
    camera.updateMatrixWorld(true);
  }

  const read = async (target, x, y) => {
    const raw = await renderer.readRenderTargetPixelsAsync(target, x, y, 1, 1);
    // Float32 LUTs come back as floats; half-float colour targets as raw bits.
    return target.texture.type === FloatType
      ? Array.from(raw)
      : Array.from(raw, DataUtils.fromHalfFloat);
  };

  async function frameStats(target) {
    const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H);
    let sum = 0, max = 0;
    const count = raw.length / 4;
    for (let i = 0; i < raw.length; i += 4) {
      const l = 0.2126 * DataUtils.fromHalfFloat(raw[i]) +
        0.7152 * DataUtils.fromHalfFloat(raw[i + 1]) +
        0.0722 * DataUtils.fromHalfFloat(raw[i + 2]);
      sum += l;
      if (l > max) max = l;
    }
    return { sum, max, mean: sum / count };
  }

  /** A 1x1-ish flat colour target, used as the fog colour/depth input. */
  function solid(value) {
    const rt = hdrTarget(64, 64, { name: 'sky-probe-solid' });
    const pass = new BakePass('sky-probe-solid', vec3(value));
    pass.render(renderer, rt);
    pass.dispose();
    return rt;
  }

  window.__SKY_WEBGPU__ = {
    ok: true,
    backend: renderer.backend.constructor.name,

    /** Raw half-float pixel from the current sky frame. */
    probe: (x, y) => read(output, x, y),

    /** Read a named atmosphere LUT texel, decoded to float numbers. */
    probeLut: (name, x, y) => {
      const target = name === 'transmittance' ? sky.luts.transmittanceRt
        : name === 'ambient' ? sky.luts.ambientRt
          : name === 'multiScatter' ? sky.luts.multiScatterRt : sky.luts.skyViewRt;
      return read(target, x, y);
    },

    /** Look in a world direction at a time of day, then return the centre pixel. */
    sample: async (time, dir) => {
      setTime(time);
      lookAt(dir);
      draw();
      return read(output, (W / 2) | 0, (H / 2) | 0);
    },

    /** Time-of-day identity: clear-sky zenith and a golden-hour solar horizon. */
    identity: async () => {
      const weather = { ...sky.weather };
      sky.setWeather({ cloudCoverage: 0, cirrusCoverage: 0 });
      const zenith = [0, 1, 0.0001];
      const day = await window.__SKY_WEBGPU__.sample(16.5, zenith);
      const night = await window.__SKY_WEBGPU__.sample(1.5, zenith);
      setTime(19.2);
      const sun = sky.sunDirection;
      // Ten degrees above the low sun: the warm aureole, not the clipped disc.
      const golden = await window.__SKY_WEBGPU__.sample(19.2,
        [sun.x, sun.y + 0.18, sun.z]);
      sky.setWeather(weather);
      return { day, golden, night };
    },

    /** Clouds must introduce large-scale spatial variation in a day frame. */
    clouds: async () => {
      setTime(16.5);
      lookAt([0, 0.45, -0.9]);
      draw();
      const samples = [];
      for (let i = 0; i < 8; i++) {
        samples.push(await read(output, 20 + i * 34, 40 + (i % 3) * 30));
      }
      return { samples };
    },

    /** The solar disc must exist and be far above the sky around it. */
    sunDisc: async () => {
      setTime(16.5);
      const sun = sky.sunDirection;
      const away = new Vector3(-sun.x, Math.abs(sun.y) + 0.4, -sun.z).normalize();
      lookAt(away.toArray());
      draw();
      const offSun = await read(output, 10, 10);
      lookAt([sun.x, sun.y, sun.z]);
      draw();
      const onSun = await read(output, (W / 2) | 0, (H / 2) | 0);
      return { onSun, offSun };
    },

    /** The star field must raise the clear night sky above the zero floor. */
    stars: async () => {
      const weather = { ...sky.weather };
      sky.setWeather({ cloudCoverage: 0, cirrusCoverage: 0 });
      setTime(1.5);
      lookAt([0.2, 0.7, -0.5]);
      const before = sky.shared.uStarParams.value.x;
      sky.shared.uStarParams.value.x = 0;
      draw();
      const withoutStars = await frameStats(output);
      sky.shared.uStarParams.value.x = before;
      draw();
      const withStars = await frameStats(output);
      sky.setWeather(weather);
      return { withoutStars, withStars };
    },

    /** LUT sanity: transmittance is a fraction, sky-view is non-zero. */
    lutProbe: async () => ({
      transmittance: await read(sky.luts.transmittanceRt, 128, 60),
      transmittanceHorizon: await read(sky.luts.transmittanceRt, 128, 2),
      skyView: await read(sky.luts.skyViewRt, 192, 120),
      ambient: await read(sky.luts.ambientRt, 0, 0),
    }),

    /** IBL: PMREM installed and the source equirect is not black. */
    envProbe: async () => ({
      hasEnv: !!scene.environment,
      mapping: scene.environment?.mapping ?? -1,
      equirect: await read(sky.envEquirect, 256, 128),
      sunDir: sky.sunDirection.toArray(),
    }),

    /** Graph-injected fog must change a colour/depth pair. */
    fogProbe: async () => {
      const colorRt = solid(0.2);
      const depthRt = solid(50.0);
      const fogRt = hdrTarget(64, 64, { name: 'sky-probe-fog' });
      const node = sky.createFogNode({
        color: texture(colorRt.texture),
        depth: texture(depthRt.texture),
      });
      const pass = new BakePass('sky-probe-fog', node);
      try {
        pass.render(renderer, fogRt);
        return { color: await read(colorRt, 32, 32), fogged: await read(fogRt, 32, 32) };
      } finally {
        pass.dispose();
        colorRt.dispose();
        depthRt.dispose();
        fogRt.dispose();
      }
    },

    /** CPU cloud occlusion must respond to the weather and the sun. */
    cloudShadow: () => {
      const weather = { ...sky.weather };
      sky.setWeather({ cloudCoverage: 0.7 });
      const values = [];
      for (let i = 0; i < 12; i++) {
        values.push(sky.cloudShadowAt(i * 2500, (i * 1700) % 5000));
      }
      sky.setWeather(weather);
      return { values, sunAlt: sky.sunAltitude, ambient: sky.ambientColor.toArray() };
    },

    /** Raw sky sample for a world direction, bypassing the background path. */
    rawSample: async (dir) => {
      const rt = hdrTarget(32, 32, { name: 'sky-probe-raw' });
      const pass = new BakePass('sky-probe-raw',
        sky.skyScreen(vec3(dir[0], dir[1], dir[2]).normalize()));
      try {
        pass.render(renderer, rt);
        return read(rt, 16, 16);
      } finally {
        pass.dispose();
        rt.dispose();
      }
    },

    /** Compare the dome centre against a direct sample of the camera forward. */
    compare: async (time, dir) => {
      setTime(time);
      lookAt(dir);
      draw();
      const center = await read(output, (W / 2) | 0, (H / 2) | 0);
      const fwd = camera.getWorldDirection(new Vector3()).toArray();
      const rawFwd = await window.__SKY_WEBGPU__.rawSample(fwd);
      return { center, rawFwd, fwd };
    },

    /** Sample a LUT texture with an explicit uv, proving the sampling convention. */
    sampleLut: async (name, u, v) => {
      const tex = name === 'skyView' ? sky.luts.skyViewRt.texture : sky.luts.ambientRt.texture;
      const rt = hdrTarget(4, 4, { name: 'sky-probe-lut' });
      const pass = new BakePass('sky-probe-lut', texture(tex, vec2(u, v)));
      try {
        pass.render(renderer, rt);
        return read(rt, 1, 1);
      } finally {
        pass.dispose();
        rt.dispose();
      }
    },

    /** Directly evaluate the atmosphere raymarch for a direction. */
    raymarch: async (dir) => {
      const rt = hdrTarget(4, 4, { name: 'sky-probe-march' });
      const s = sky.shared;
      const pass = new BakePass('sky-probe-march', sky.raymarchSky(
        s.uViewPos, vec3(dir[0], dir[1], dir[2]).normalize(), s.uSunDir,
        s.uSunIrradiance, s.uMoonDir, s.uMoonIrradiance));
      try {
        pass.render(renderer, rt);
        return read(rt, 1, 1);
      } finally {
        pass.dispose();
        rt.dispose();
      }
    },

    /** Live uniform state, for diagnosing the photometric chain. */
    uniformState: () => ({
      sunIrr: sky.shared.uSunIrradiance.value.toArray(),
      moonIrr: sky.shared.uMoonIrradiance.value.toArray(),
      sunDir: sky.shared.uSunDir.value.toArray(),
      sunAlt: sky.shared.uSunAltitude.value,
      mie: sky.shared.uMieScale.value,
      viewPos: sky.shared.uViewPos.value.toArray(),
    }),

    /** Establish the bake-uv vs sample-v convention definitely. */
    gradientTest: async () => {
      const rt = hdrTarget(64, 64, { name: 'sky-probe-grad' });
      const pass = new BakePass('sky-probe-grad', vec3(uv().y));
      pass.render(renderer, rt);
      pass.dispose();
      const row0 = await read(rt, 32, 0);
      const row63 = await read(rt, 32, 63);
      const sample = async (v) => {
        const out = hdrTarget(4, 4, { name: 'sky-probe-grad-sample' });
        const p = new BakePass('sky-probe-grad-sample', texture(rt.texture, vec2(0.5, v)));
        p.render(renderer, out);
        p.dispose();
        const value = await read(out, 1, 1);
        out.dispose();
        return value;
      };
      const out = { row0, row63, sample01: await sample(0.1), sample09: await sample(0.9) };
      rt.dispose();
      return out;
    },

    /** The full public API the gameplay subsystems rely on. */
    api: () => ({
      time: sky.timeOfDay,
      sun: sky.sunDirection.toArray(),
      moon: sky.moonDirection.toArray(),
      alt: sky.sunAltitude,
      key: sky.keyLight?.name,
      indirect: sky.indirectScale,
      envMap: !!sky.envMap,
    }),

    dispose: async () => {
      output.dispose();
      sky.dispose();
      await renderer.dispose();
      window.__SKY_WEBGPU__.disposed = true;
    },
  };
} catch (error) {
  window.__SKY_WEBGPU__ = { ok: false, error: error.message, stack: error.stack };
}
