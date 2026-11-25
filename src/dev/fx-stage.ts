import * as THREE from 'three';

import type { DecalSystem } from '../fx/decals.ts';
import { spawnImpact } from '../fx/impacts.ts';
import type { FxSystem } from '../fx/index.ts';
import type { SurfaceName } from '../physics/surfaces.ts';

type DecalWorld = NonNullable<Parameters<DecalSystem['add']>[0]['world']>;
type FxBurstResult = { staged: string; at?: number[]; surface?: string };

interface FxTargetFrame {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
  surface: SurfaceName;
  world: DecalWorld | null;
  distance: number;
  spanU: number;
  spanV: number;
}

const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _stagedTracerOpts = Object.freeze({ flightTime: 0.1 });

export function stageFxBurst(fx: FxSystem, kind = 'wall'): FxBurstResult {
  // Shots run back to back in one session; stop the old loop before staging the next.
  if (kind === 'none' || kind === 'clear' || kind === 'off') {
    fx._captureStage?.clear();
    return { staged: 'none' };
  }
  return (fx._captureStage ??= new FxStage(fx)).burst(kind);
}

export class FxStage {
  private readonly script: Array<{ t: number; fn: () => void }> = [];
  private scriptTime = 0;
  private scriptPeriod = 0;
  private targetSupport: number | undefined;
  private target: FxTargetFrame | undefined;
  private probes: Float32Array | undefined;
  private readonly probeSurf = new Array<SurfaceName>(63).fill('concrete');
  private probeCount = 0;

  constructor(private readonly fx: FxSystem) {}

  clear(): void {
    this.script.length = 0;
    this.scriptTime = 0;
    this.scriptPeriod = 0;
  }

  /** Loop staged FX across the capture's ~90-frame settle window, retaining old
   * decals/dust alongside fresh flashes instead of letting a single burst expire.
   */
  burst(kind: string): FxBurstResult {
    const fx = this.fx;
    fx.now = fx.ctx.time.elapsed;
    const cam = fx.ctx.camera;
    cam.updateMatrixWorld();
    fx._camPos.setFromMatrixPosition(cam.matrixWorld);
    const target = this.findTarget();
    this.script.length = 0;
    this.scriptTime = 0;
    this.scriptPeriod = 1.56;

    const rng = fx.rng;
    const at = (t: number, fn: () => void): number => this.script.push({ t, fn });

    if (kind === 'explosion') {
      // Two detonations per loop, half a period apart, so whenever the harness
      // presses the shutter one of them is inside its first half second —
      // fireball and shockwave rather than only the smoke afterwards.
      this.scriptPeriod = 1.1;
      const boom = (side: number): void => {
        fx._tmpA
          .copy(target.point)
          .addScaledVector(target.normal, 1.1)
          .addScaledVector(target.tangent, side * 1.6);
        fx.explosion({ position: fx._tmpA, radius: 3.6, damage: 120 });
      };
      at(0.02, (): void => boom(-1));
      at(0.56, (): void => boom(1));
      this.stageWallHits(at, target, 6, 0.1, 0.95);
      return { staged: 'explosion', at: target.point.toArray() };
    }

    if (kind === 'muzzle') {
      // Cyclic rate shorter than the flash lifetime: a flash is always lit.
      this.scriptPeriod = 0.44;
      for (let i = 0; i < 8; i++) {
        const t = i * 0.055;
        at(t, (): void => this.stageMuzzle());
        if (i % 3 === 0) at(t + 0.01, (): void => this.stageShell());
        if (i % 2 === 0) at(t + 0.004, (): void => this.stageTracer(target));
      }
      return { staged: 'muzzle' };
    }

    if (kind === 'combat' || kind === 'firefight') {
      this.scriptPeriod = 1.6;
      this.stageWallHits(at, target, 9, 0.04, 1.2);
      at(1.3, (): void => this.impactAt(target, rng.signed() * 0.7, rng.range(-0.2, 0.5), 'metal'));
      at(1.42, (): void => this.impactAt(target, rng.signed() * 0.6, rng.range(-0.2, 0.5), null));
      at(1.5, (): void => this.impactAt(target, rng.signed() * 0.5, rng.range(-0.1, 0.6), 'metal'));
      at(1.36, (): void => this.stageTracer(target));
      at(1.44, (): void => this.stageCrossfire());
      at(1.12, (): void => this.stageShell());
      at(1.34, (): void => this.stageShell());
      at(1.52, (): void => this.stageMuzzle());
      return { staged: 'combat' };
    }

    // Impacts: walk sustained fire across a wall every 50 ms on a 0.9 s loop,
    // retaining fresh sparks, expanding dust and accumulated decals at any grab phase.
    this.scriptPeriod = 0.9;
    // 50 ms cadence against a 75 ms flash: strictly shorter than the flash
    // lifetime, so there is *always* a hot impact somewhere in the frame.
    this.stageWallHits(at, target, 18, 0.0, 0.85);
    console.info(
      `[fx] burst target ${target.surface} at ${target.distance.toFixed(2)}m ` +
        `n=(${target.normal.x.toFixed(2)},${target.normal.y.toFixed(2)},${target.normal.z.toFixed(2)}) ` +
        `support=${this.targetSupport ?? -1} span=${target.spanU.toFixed(2)}x${target.spanV.toFixed(2)}`
    );
    at(0.3, (): void => this.stageCrossfire());
    at(0.74, (): void => this.stageCrossfire());
    at(0.18, (): void => this.stageShell());
    at(0.52, (): void => this.stageShell());
    return { staged: kind, at: target.point.toArray(), surface: target.surface };
  }

  private stageWallHits(
    at: (time: number, fn: () => void) => number,
    target: FxTargetFrame,
    count: number,
    t0: number,
    t1: number
  ): void {
    const fx = this.fx;
    const rng = fx.rng;
    for (let i = 0; i < count; i++) {
      const f = i / Math.max(1, count - 1);
      const t = t0 + (t1 - t0) * f;
      // A gunner walking rounds across the wall: a broad sweep with a wobble,
      // so the group reads as aimed fire rather than a scatter plot.
      const su = Math.min(1.35, target.spanU * 0.88);
      const sv = Math.min(0.36, target.spanV * 0.7);
      const u = Math.sin(f * 3.9 + 0.4) * su + rng.signed() * su * 0.13;
      const v = Math.cos(f * 2.4) * sv + rng.signed() * sv * 0.35;
      const surf = i % 3 === 2 ? 'metal' : null;
      at(t, (): void => this.impactAt(target, u, v, surf));
    }
  }

  /** Fake a bullet:impact at an offset on the staged surface. */
  private impactAt(
    target: FxTargetFrame,
    u: number,
    v: number,
    surfaceOverride?: SurfaceName | null
  ): void {
    const fx = this.fx;
    fx._p
      .copy(target.point)
      .addScaledVector(target.tangent, u)
      .addScaledVector(target.bitangent, v);
    fx._n.copy(target.normal);
    if (target.world && fx.physics?.raycast) {
      // Re-trace so the hit sits on the real surface (and picks up its normal
      // and material) rather than on the plane through the first hit.
      fx._tmpA.copy(fx._p).addScaledVector(fx._n, 1.2);
      fx._tmpB.copy(fx._n).multiplyScalar(-1);
      const hit = fx.physics.raycast(fx._tmpA, fx._tmpB, 2.6, fx.physics.MASK.WORLD);
      if (hit.hit) {
        fx._p.copy(hit.point);
        fx._n.copy(hit.normal);
      }
    }
    fx._d.copy(fx._n).multiplyScalar(-1);
    // give the incoming round a believable oblique angle
    fx._d.x += fx.rng.signed() * 0.35;
    fx._d.y -= 0.18;
    fx._d.z += fx.rng.signed() * 0.35;
    fx._d.normalize();
    fx._suppressDecals = target.world === null;
    spawnImpact(fx, fx._p, fx._n, fx._d, surfaceOverride ?? target.surface, 1.15);
    fx._suppressDecals = false;
  }

  /** Stage view-space muzzle FX to match real first-person firing and reach viewFlash lighting.
   * Use the weapon's muzzle transform; only FX-only scenes fall back to an eye-relative offset.
   */
  private stageMuzzle(): void {
    const fx = this.fx;
    const cam = fx.ctx.camera;
    cam.updateMatrixWorld();
    const wp = fx.ctx.peek('weapons');
    let welded = false;
    if (typeof wp?.muzzleWorld === 'function') {
      wp.muzzleWorld(fx._tmpA);
      welded = fx._tmpA.lengthSq() > 1e-6;
    }
    if (!welded) fx._tmpA.set(0.16, -0.13, -0.72).applyMatrix4(cam.matrixWorld);
    fx._tmpB.set(0, 0, -1).transformDirection(cam.matrixWorld);
    fx.muzzleFlash({
      position: fx._tmpA,
      direction: fx._tmpB,
      weapon: 'rifle',
      view: true,
    });
  }

  private stageShell(): void {
    const fx = this.fx;
    const cam = fx.ctx.camera;
    cam.updateMatrixWorld();
    fx._tmpA.set(0.2, -0.1, -0.45).applyMatrix4(cam.matrixWorld);
    fx._tmpB.set(fx.rng.range(1.3, 2.1), fx.rng.range(1.2, 2.0), fx.rng.range(-0.4, 0.4));
    fx._tmpB.applyMatrix4(cam.matrixWorld).sub(cam.position);
    fx.spawnShell(fx._tmpA, fx._tmpB);
  }

  private stageTracer(target: FxTargetFrame): void {
    const fx = this.fx;
    const cam = fx.ctx.camera;
    fx._tmpA.set(0.18, -0.12, -0.7).applyMatrix4(cam.matrixWorld);
    const rng = fx.rng;
    fx._tmpB
      .copy(target.point)
      .addScaledVector(target.tangent, rng.signed() * Math.min(1.2, target.spanU * 0.45))
      .addScaledVector(target.bitangent, rng.signed() * Math.min(0.35, target.spanV * 0.4));
    // Stop on the wall: soft-depth clipping hides the entire anchored quad as
    // soon as its head passes behind the surface. The capture-only 100 ms
    // flight keeps the incoming streak readable without inventing hidden
    // lifetime.
    fx.tracer(fx._tmpA, fx._tmpB, 250, _stagedTracerOpts);
  }

  /** Incoming round crossing the frame — reads as a firefight, not a range. */
  private stageCrossfire(): void {
    const fx = this.fx;
    const cam = fx.ctx.camera;
    const rng = fx.rng;
    fx._tmpA
      .set(rng.range(-14, -9), rng.range(-1.2, 1.4), rng.range(-16, -8))
      .applyMatrix4(cam.matrixWorld);
    fx._tmpB
      .set(rng.range(9, 15), rng.range(-1.4, 1.2), rng.range(-18, -9))
      .applyMatrix4(cam.matrixWorld);
    fx.tracer(fx._tmpA, fx._tmpB, 280);
  }

  private findTarget(): FxTargetFrame {
    const fx = this.fx;
    const cam = fx.ctx.camera;
    const t = (this.target ??= {
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      bitangent: new THREE.Vector3(),
      surface: 'concrete',
      world: null,
      distance: 0,
      spanU: 3,
      spanV: 1.2,
    });
    fx._camPos.setFromMatrixPosition(cam.matrixWorld);
    const ph = fx.physics;
    let best: Pick<FxTargetFrame, 'point' | 'normal' | 'surface' | 'distance'> | null = null;
    let bestDist = Infinity;
    if (ph?.raycast && ph.staticWorld.triCount > 0) {
      // Dense 9x7 probes find facing walls rather than skipping to grazing props.
      // Record hits, then score coplanar support so a broad wall beats a centred
      // post or narrow pillar. Prefer targets in the 1.5-9 m screenshot band.
      const probes = this.probes ?? (this.probes = new Float32Array(63 * 8));
      let np = 0;
      for (let i = 0; i < 63; i++) {
        const yaw = ((i % 9) - 4) * 0.075;
        const pitch = (Math.floor(i / 9) - 3) * 0.08;
        fx._tmpB.set(0, 0, -1).applyAxisAngle(_axisX, pitch).applyAxisAngle(_axisY, yaw);
        fx._tmpB.transformDirection(cam.matrixWorld);
        const hit = ph.raycast(fx._camPos, fx._tmpB, 40, ph.MASK.WORLD);
        if (!hit.hit) continue;
        const d = hit.distance;
        // A grazing hit on a thin prop makes a poor showcase.
        const face = -fx._tmpB.dot(hit.normal);
        if (d < 1.2 || face < 0.3) continue;
        const b = np * 8;
        probes[b] = hit.point.x;
        probes[b + 1] = hit.point.y;
        probes[b + 2] = hit.point.z;
        probes[b + 3] = hit.normal.x;
        probes[b + 4] = hit.normal.y;
        probes[b + 5] = hit.normal.z;
        probes[b + 6] = d;
        probes[b + 7] = Math.abs(d - 5) + (Math.abs(yaw) + Math.abs(pitch)) * 7 + (1 - face) * 3;
        this.probeSurf[np] = hit.surface;
        np++;
      }
      this.probeCount = np;
      for (let i = 0; i < np; i++) {
        const a = i * 8;
        const nx = probes[a + 3];
        const ny = probes[a + 4];
        const nz = probes[a + 5];
        const pd = probes[a] * nx + probes[a + 1] * ny + probes[a + 2] * nz;
        let support = 0;
        for (let j = 0; j < np; j++) {
          if (j === i) continue;
          const c = j * 8;
          if (probes[c + 3] * nx + probes[c + 4] * ny + probes[c + 5] * nz < 0.96) continue;
          const off = probes[c] * nx + probes[c + 1] * ny + probes[c + 2] * nz - pd;
          if (off > -0.12 && off < 0.12) support++;
        }
        // Each co-planar neighbour is worth a metre of framing error: 6+ of them
        // (a broad face) beats a perfectly centred sliver every time.
        const score = probes[a + 7] - Math.min(support, 12) * 1.0;
        if (score < bestDist) {
          bestDist = score;
          this.targetSupport = support;
          best = best ?? {
            point: new THREE.Vector3(),
            normal: new THREE.Vector3(),
            surface: 'concrete',
            distance: 0,
          };
          best.point.set(probes[a], probes[a + 1], probes[a + 2]);
          best.normal.set(nx, ny, nz);
          best.surface = this.probeSurf[i];
          best.distance = probes[a + 6];
        }
      }
    }
    // Real geometry always beats the virtual plane: decals at 20 m still read as
    // bullet holes, a burst with no decals at all does not.
    if (best && best.distance < 22) {
      t.point.copy(best.point);
      t.normal.copy(best.normal);
      t.surface = best.surface;
      t.world = ph?.staticWorld ?? null;
      t.distance = best.distance;
    } else {
      // Nothing close enough to shoot: stage the burst on a virtual plane in
      // front of the camera and skip decals (there is nothing to stick to).
      fx._tmpB.set(0, 0, -1).transformDirection(cam.matrixWorld);
      t.point.copy(fx._camPos).addScaledVector(fx._tmpB, 3.2);
      t.normal.copy(fx._tmpB).multiplyScalar(-1);
      t.surface = 'concrete';
      t.world = null;
      t.distance = 3.2;
    }
    // tangent frame on the surface, biased so 'up' on the wall is world up
    fx._tmpA.set(0, 1, 0);
    if (Math.abs(t.normal.y) > 0.9) fx._tmpA.set(1, 0, 0);
    t.bitangent.copy(fx._tmpA).addScaledVector(t.normal, -t.normal.dot(fx._tmpA)).normalize();
    t.tangent.crossVectors(t.bitangent, t.normal).normalize();

    // Measure coplanar support in the surface frame to keep the staged burst
    // on the selected face rather than spraying past narrow pillars.
    t.spanU = 0.35;
    t.spanV = 0.25;
    const pr = this.probes;
    if (pr && this.probeCount > 0 && t.world) {
      const pd = t.point.dot(t.normal);
      let uMin = 0;
      let uMax = 0;
      let vMin = 0;
      let vMax = 0;
      for (let i = 0; i < this.probeCount; i++) {
        const b = i * 8;
        if (pr[b + 3] * t.normal.x + pr[b + 4] * t.normal.y + pr[b + 5] * t.normal.z < 0.96)
          continue;
        const off = pr[b] * t.normal.x + pr[b + 1] * t.normal.y + pr[b + 2] * t.normal.z - pd;
        if (off < -0.12 || off > 0.12) continue;
        fx._tmpA.set(pr[b], pr[b + 1], pr[b + 2]).sub(t.point);
        const u = fx._tmpA.dot(t.tangent);
        const v = fx._tmpA.dot(t.bitangent);
        if (u < uMin) uMin = u;
        if (u > uMax) uMax = u;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
      t.spanU = Math.max(0.35, Math.min(uMax, -uMin));
      t.spanV = Math.max(0.25, Math.min(vMax, -vMin));
    }
    return t;
  }

  tick(dt: number): void {
    if (!this.script.length) return;
    const period = this.scriptPeriod;
    const prev = this.scriptTime;
    let now = prev + dt;
    if (now < period) {
      this.fire(prev, now);
    } else {
      // Fire the tail of this loop and the head of the next one, so a wrap
      // never silently swallows the events that straddle it.
      this.fire(prev, period);
      now -= period;
      this.fire(-1e-6, now);
    }
    this.scriptTime = now;
  }

  private fire(from: number, to: number): void {
    for (const e of this.script) if (e.t > from && e.t <= to) e.fn();
  }
}
