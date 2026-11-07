import { GpuProgram, Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';

import type { HealthFx } from './health.ts';

// Same CSS gradient stops, evaluated directly in display space. No animated
// DOM gradients, fullscreen filters, per-frame Canvas2D bakes or texture uploads.
const VERTEX = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3f, uWorldTransformMatrix: mat3x3f,
  uWorldColorAlpha: vec4f, uResolution: vec2f,
}
struct LocalUniforms { uTransformMatrix: mat3x3f, uColor: vec4f, uRound: f32 }
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f }
@vertex fn mainVertex(@location(0) aPosition: vec2f, @location(1) aUV: vec2f) -> Output {
  let p = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix * vec3f(aPosition, 1);
  return Output(vec4f(p.xy, 0, 1), aUV, globalUniforms.uWorldColorAlpha * localUniforms.uColor);
}`;
const FRAGMENT = `
struct Injury { viewportBlood: vec4f, pulseFlash: vec2f }
@group(2) @binding(0) var<uniform> injury: Injury;
fn rgba(rgb: vec3f, a: f32) -> vec4f { return vec4f(rgb / 255.0 * a, a); }
fn over(top: vec4f, bottom: vec4f) -> vec4f { return top + bottom * (1.0 - top.a); }
fn spot(uv: vec2f, centre: vec2f, end: f32, rgb: vec3f, alpha: f32) -> vec4f {
  let size = injury.viewportBlood.xy;
  let extent = max(abs(centre), abs(vec2f(1) - centre)) * size;
  let radius = length(extent);
  let t = length((uv - centre) * size) / radius;
  return rgba(rgb, alpha * clamp(1.0 - t / end, 0.0, 1.0));
}
@fragment fn mainFragment(@location(0) uv: vec2f, @location(1) color: vec4f) -> @location(0) vec4f {
  // .ow-blood is inset -7%, then scaled about the centre by the heartbeat.
  let bloodUV = (uv - 0.5) / (1.14 * injury.viewportBlood.w) + 0.5;
  let r = length((bloodUV - 0.5) / vec2f(0.78, 0.74));
  let mid = rgba(vec3f(122,14,10), 0.55);
  let edge = rgba(vec3f(74,8,5), 0.85);
  let base = select(mix(vec4f(0), mid, clamp((r - 0.62) / 0.24, 0.0, 1.0)), mix(mid, edge, clamp((r - 0.86) / 0.14, 0.0, 1.0)), r > 0.86);
  // CSS backgrounds are listed front-to-back; bruise layer opacity is 0.5.
  var bruises = spot(bloodUV, vec2f(0.74,-0.02), 0.18, vec3f(88,10,8), 0.7);
  bruises = over(spot(bloodUV, vec2f(0.26,1.01), 0.19, vec3f(88,10,8), 0.75), bruises);
  bruises = over(spot(bloodUV, vec2f(0.99,0.58), 0.15, vec3f(96,10,8), 0.7), bruises);
  bruises = over(spot(bloodUV, vec2f(0.02,0.22), 0.17, vec3f(96,10,8), 0.75), bruises);
  let blood = over(bruises * 0.5, base) * injury.viewportBlood.z;
  let beatRadius = length((uv - 0.5) / vec2f(0.76,0.70));
  let beat = rgba(vec3f(150,14,10), 0.34 * clamp((beatRadius - 0.64) / 0.36, 0.0, 1.0)) * injury.pulseFlash.x;
  let flashRadius = length((uv - 0.5) / vec2f(0.90,0.86));
  let flash = mix(rgba(vec3f(150,16,10),0.22), rgba(vec3f(160,18,12),0.62), clamp((flashRadius - 0.40) / 0.60, 0.0, 1.0)) * injury.pulseFlash.y;
  return over(flash, over(beat, blood)) * color;
}`;

/** One retained WebGPU-only Pixi mesh, below all HUD chrome/markers. */
export class PixiInjury {
  private geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  private uniforms = new UniformGroup({
    viewportBlood: { value: new Float32Array([1, 1, 0, 1]), type: 'vec4<f32>' },
    pulseFlash: { value: new Float32Array(2), type: 'vec2<f32>' },
  });
  private shader = new Shader({
    gpuProgram: new GpuProgram({
      name: 'HUD injury',
      vertex: { source: VERTEX, entryPoint: 'mainVertex' },
      fragment: { source: FRAGMENT, entryPoint: 'mainFragment' },
    }),
    resources: { injury: this.uniforms },
  });
  readonly mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
  private disposed = false;

  resize(w: number, h: number, k: number): void {
    this.mesh.scale.set(w / k, h / k);
    this.uniforms.uniforms.viewportBlood[0] = w;
    this.uniforms.uniforms.viewportBlood[1] = h;
    this.uniforms.update();
  }

  update(health: HealthFx): boolean {
    const v = this.uniforms.uniforms.viewportBlood,
      p = this.uniforms.uniforms.pulseFlash;
    const blood = health.bloodAlpha < 0.004 ? 0 : Math.round(health.bloodAlpha * 1000) / 1000;
    const scale = Math.round(health.bloodScale * 10000) / 10000;
    const beat = health.beatAlpha < 0.004 ? 0 : Math.round(health.beatAlpha * 1000) / 1000;
    const flash = Math.round(health.flashAlpha * 1000) / 1000;
    const visible = blood > 0 || beat > 0 || flash > 0;
    const changed =
      this.mesh.visible !== visible ||
      v[2] !== Math.fround(blood) ||
      v[3] !== Math.fround(scale) ||
      p[0] !== Math.fround(beat) ||
      p[1] !== Math.fround(flash);
    this.mesh.visible = visible;
    if (changed) {
      v[2] = blood;
      v[3] = scale;
      p[0] = beat;
      p[1] = flash;
      this.uniforms.update();
    }
    return changed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.destroy();
    this.geometry.destroy();
    this.shader.destroy(true);
  }
}
