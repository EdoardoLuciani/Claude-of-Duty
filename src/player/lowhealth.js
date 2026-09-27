import { Vector2, Vector3 } from 'three/webgpu';
import { Fn, clamp, dot, float, length, max, mix, screenUV, smoothstep,
  uniform, vec2, vec3, vec4 } from 'three/tsl';

/** Low-health treatment in linear HDR, before exposure and tone mapping. */
export class LowHealthPass {
  constructor() {
    this.name = 'player:lowhealth';
    this.order = 40;
    this.enabled = false;
    this.state = uniform(new Vector3());
    this.aspect = uniform(new Vector2(1, 1));
  }

  /** Compile once; the uniform zero state is an exact healthy-player no-op. */
  asNode(colorTexture, exposure) {
    return Fn(() => {
      const color = colorTexture.sample(screenUV).toVar();
      const c = color.rgb.toVar();
      const state = this.state;
      const amount = state.x, pulse = state.y, flash = state.z;
      const d = screenUV.sub(vec2(0.5)).mul(this.aspect);
      const radius = length(d).mul(1.414);
      const wide = smoothstep(0.18, 1, radius);
      const rim = smoothstep(0.34, 1.1, radius);
      const beat = amount.mul(float(0.32).add(pulse.mul(0.68)));
      const luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.assign(mix(c, vec3(luminance).mul(vec3(0.93, 0.97, 1.06)),
        clamp(amount.mul(float(2).add(pulse.mul(0.16))), 0, 0.94)));
      c.mulAssign(float(1).sub(wide.mul(float(0.85).add(beat.mul(0.24))).mul(amount)));
      const k = rim.mul(amount).mul(float(0.85).add(pulse.mul(0.3)));
      c.mulAssign(mix(vec3(1), vec3(1.16, 0.26, 0.22), clamp(k.mul(0.98), 0, 1)));
      const invExposure = float(1).div(max(exposure, 0.001));
      c.addAssign(vec3(0.115, 0.008, 0.005).mul(k).mul(invExposure));
      const ring = float(0.3).add(smoothstep(0.05, 0.95, radius).mul(0.7));
      const f = clamp(flash.mul(ring), 0, 1);
      c.mulAssign(mix(vec3(1), vec3(1.3, 0.4, 0.34), f));
      c.addAssign(vec3(0.16, 0.012, 0.008).mul(f).mul(invExposure));
      return vec4(c, color.a);
    })();
  }

  sync(health) {
    const amount = health.effect;
    const flash = health.hitFlash;
    this.enabled = amount > 0.004 || flash > 0.004;
    this.state.value.set(amount, health.pulse, flash);
  }

  resize(w, h) {
    if (w >= h) this.aspect.value.set(1, h / Math.max(1, w));
    else this.aspect.value.set(w / Math.max(1, h), 1);
  }

  dispose() {}
}
