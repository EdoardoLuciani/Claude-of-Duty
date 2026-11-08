import * as THREE from 'three';

/** Allocate pooled lights once and keep their identities/visibility stable; idle intensity is zero.
 * Light-count changes alter shader permutations. Flashes rise immediately and decay exponentially
 * with the authored effect time constant.
 */
interface LightEntry {
  light: THREE.PointLight;
  peak: number;
  age: number;
  duration: number;
  rise: number;
  decay: number;
  priority: number;
}
interface LightRegistrar {
  addLight?(light: THREE.PointLight, options: { range: number; priority: number }): void;
}
export class LightPool {
  lights: LightEntry[] = [];

  constructor(scene: THREE.Scene, count = 4) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.castShadow = false;
      l.visible = true;
      l.userData.owProbe = true;
      scene.add(l);
      this.lights.push({
        light: l,
        peak: 0,
        age: 1e9,
        duration: 1,
        rise: 0.008,
        decay: 3,
        priority: 0,
      });
    }
  }

  /** Register with the renderer so it can budget/cull them. */
  register(render: LightRegistrar): void {
    for (const e of this.lights) {
      // A generous range keeps the renderer's distance fade at 1 for anything
      // in front of the player, so we control intensity ourselves.
      render.addLight?.(e.light, { range: 90, priority: 3 });
    }
  }

  /** Linear RGB; peak in candela at t=0, duration in seconds, decay in 1/s,
   * distance cutoff in metres. Higher priority wins when the pool is full.
   */
  flash(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    peak: number,
    duration: number,
    decay: number,
    distance: number,
    priority = 1
  ): LightEntry | null {
    let best: LightEntry | null = null;
    let bestScore = -Infinity;
    for (const e of this.lights) {
      // free lights first, then whichever is furthest through its life
      const score = e.age >= e.duration ? 1e6 : e.age / e.duration - e.priority * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) return null;
    if (bestScore < 1e5 && best.priority > priority) return null;
    best.light.position.set(x, y, z);
    best.light.color.setRGB(r, g, b);
    best.light.distance = distance;
    best.peak = peak;
    best.age = 0;
    best.duration = duration;
    best.decay = decay;
    best.priority = priority;
    best.light.intensity = peak;
    return best;
  }

  update(dt: number): void {
    for (const e of this.lights) {
      if (e.age >= e.duration) {
        if (e.light.intensity !== 0) e.light.intensity = 0;
        continue;
      }
      e.age += dt;
      const t = e.age;
      // rise over the first millisecond, then exponential falloff with a
      // hard tail-off so it lands exactly on zero at `duration`
      const rise = Math.min(1, t / 0.004);
      const tail = 1 - Math.min(1, t / e.duration) ** 2;
      e.light.intensity = e.peak * rise * Math.exp(-e.decay * t) * tail;
      if (e.age >= e.duration) e.light.intensity = 0;
    }
  }

  dispose(): void {
    for (const e of this.lights) {
      e.light.parent?.remove(e.light);
      e.light.dispose();
    }
    this.lights.length = 0;
  }
}
