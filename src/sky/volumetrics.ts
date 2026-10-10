import {
  Fn, If, Loop, abs, cameraPosition, cameraProjectionMatrixInverse,
  cameraWorldMatrix, clamp, dot, exp, float, max, min, mix,
  screenCoordinate, screenUV, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import type { Texture } from 'three';
import type { Node } from 'three/webgpu';
import { skIGN, skVal3 } from './noise.js';
import { skHG, SK_PI } from './atmosphere-tsl.js';

/**
 * Volumetric fog, light shafts and aerial perspective — TSL port.
 *
 * The production graph marches shadowed inscatter and composites analytic
 * per-channel transmittance at full resolution, before the first-person pass.
 * It has no temporal fog history; world TAA is resolved upstream.
 *
 * SCATTERING vs EXTINCTION. These are separate uniforms and deliberately not
 * tied by a single-scattering albedo. Extinction is set by the visibility we
 * want down the street; the inscatter gain is set by how readable the shafts
 * need to be. A physically closed system either has invisible shafts outdoors
 * or milk at 200 m.
 *
 * DEPTH CONTRACT — the node needs the world-pass **linear view depth in metres,
 * positive**, exactly the contract the WebGL renderer published as
 * `r.depthTexture`. A cleared background must read as zero so it bypasses fog;
 * the sky dome already integrates atmospheric scattering over its view ray.
 *
 * VISIBILITY CONTRACT — `visibility(worldPos, pixelNoise)` is an optional TSL function
 * returning sun/moon visibility in 0..1 (the upstream CSM). When it is absent
 * the shafts still carry the cumulus cloud shadow, but not building occlusion.
 */
interface VolumetricShared { uFog: Node<'vec4'>; uFog2: Node<'vec4'>; uFogExt: Node<'vec3'>; uPhase: Node<'vec4'>; uKeyDir: Node<'vec3'>; uKeyIrr: Node<'vec3'>; uFogDrift: Node<'vec3'>; ambientTex: Texture; skCloudShadow: (worldXZ: Node<'vec2'>, sunDir: Node<'vec3'>) => Node<'float'> }
interface SampleNode extends Node<'vec4'> { sample(uv: Node<'vec2'>): Node<'vec4'> }
interface VolumetricBuildOptions { color: Node<'vec3'> | Node<'vec4'> | SampleNode; depth: Node<'float'> | SampleNode; invProj?: Node<'mat4'>; camWorld?: Node<'mat4'>; camPos?: Node<'vec3'>; visibility?: (worldPos: Node<'vec3'>, noise: Node<'float'> | null) => Node<'float'>; frame?: Node<'float'>; uv?: Node<'vec2'>; coordinate?: Node<'vec2'> }

export function createVolumetricNodes(shared: VolumetricShared, { steps = 40, march = true }: { steps?: number; march?: boolean } = {}) {
  const {
    uFog, uFog2, uFogExt, uPhase, uKeyDir, uKeyIrr, uFogDrift,
    ambientTex, skCloudShadow,
  } = shared;

  /**
   * Colour of the haze as a function of the angle to the key. The two texels of
   * the ambient LUT are the two ends of that axis — whole-sky average (cool) and
   * horizon band average (warm) — so distance separates by hue, not by grey.
   */
  const skFogAmbient = Fn<[Node<'float'>], Node<'vec3'>>(([cosKey]) => {
    const cool = texture(ambientTex, vec2(0.25, 0.5)).rgb;
    const hor = texture(ambientTex, vec2(0.75, 0.5)).rgb;
    const keyHue = uKeyIrr.div(max(1e-4, max(uKeyIrr.x, max(uKeyIrr.y, uKeyIrr.z))));
    const f = float(0.5).add(clamp(cosKey, -1, 1).mul(0.5));
    const warm = hor.mul(mix(vec3(1), keyHue, 0.55)).mul(1.3);
    return mix(cool, warm, f.mul(f));
  });

  /** Dual-lobe HG: a forward peak for the shafts, a broad back lobe behind you. */
  const skFogPhase = (cosTheta: Node<'float'>) =>
    mix(skHG(cosTheta, uPhase.x), skHG(cosTheta, uPhase.y), uPhase.z);

  /**
   * The shaft gain applied to the *anisotropic excess only*, so the knob lifts
   * the forward peak without veiling every pixel with the isotropic floor.
   */
  const skFogInscatterPhase = Fn<[Node<'float'>], Node<'float'>>(([cosTheta]) => {
    const iso = 1 / (4 * SK_PI);
    const p = skFogPhase(cosTheta);
    return p.add(max(0, p.sub(iso)).mul(uFog2.y.sub(1)));
  });

  /** Near-field ramp: twelve metres of real air scatters nothing measurable. */
  const skFogNearRamp = Fn<[Node<'float'>], Node<'float'>>(([t]) => smoothstep(0, 12, t));

  /** Normalised density: 1 at the fog base, exponential above, wind-torn. */
  const skFogDensity = Fn<[Node<'vec3'>], Node<'float'>>(([p]) => {
    const h = exp(p.y.sub(uFog.z).negate().mul(uFog.y));
    const result = h.toVar();
    If(uFog2.w.greaterThan(0.001), () => {
      const q = p.mul(uPhase.w).add(uFogDrift);
      const n = skVal3(q).mul(0.63).add(skVal3(q.mul(2.71).add(5.1)).mul(0.37));
      result.assign(h.mul(mix(1, float(0.30).add(n.mul(1.55)), uFog2.w)));
    });
    return result;
  });

  /**
   * Closed form of integral(0..t) exp(-(y-b)/H) ds along a ray. Exact, so the
   * transmittance applied to geometry is smooth at full resolution.
   */
  const skHeightIntegral = Fn<[Node<'float'>, Node<'float'>, Node<'float'>], Node<'float'>>(([y0, dy, t]) => {
    const d0 = exp(y0.sub(uFog.z).negate().mul(uFog.y));
    const x = dy.mul(uFog.y).mul(t);
    const result = float(0).toVar();
    If(abs(x).lessThan(1e-4), () => {
      result.assign(d0.mul(t));
    }).Else(() => {
      result.assign(d0.mul(float(1).sub(exp(x.negate())))
        .div(dy.mul(uFog.y)));
    });
    return result;
  });

  /** World ray through the current screen UV, normalised on the z = -1 plane. */
  const skRayFor = Fn<[Node<'vec2'>, Node<'mat4'>, Node<'mat4'>], Node<'vec4'>>(([uv, invProj, camWorld]) => {
    // Native screen/texture UV has its origin at the top left; camera NDC
    // points up. Flip only the reconstruction coordinate, not the depth/color
    // sample. Otherwise ground pixels march skyward and mirror the sun's lobe.
    const h = invProj.mul(vec4(uv.mul(2).sub(1).mul(vec2(1, -1)), 1, 1));
    const vd = h.xyz.div(h.w);
    const vn = vd.div(max(1e-6, vd.z.negate()));
    const w = camWorld.mul(vec4(vn, 0)).xyz;
    const rayLen = w.length();
    return vec4(w.div(rayLen), rayLen);
  });

  /**
   * Build the fog node. `color` is the world colour node; `depth` is the linear
   * positive view depth in metres; `invProj`/`camWorld` are the camera matrices
   * (the caller may pass the built-in `cameraProjectionMatrixInverse` /
   * `cameraWorldMatrix` nodes); `visibility` is optional.
   */
  function createNode({ color, depth, invProj = cameraProjectionMatrixInverse,
    camWorld = cameraWorldMatrix, camPos = cameraPosition, visibility, frame = float(0),
    uv = screenUV, coordinate = screenCoordinate }: VolumetricBuildOptions): Node<'vec3'> {
    const fogged = Fn(() => {
      // TSL evaluates expressions where they are consumed, not where JS
      // declares them. Materialise the ray so the march cannot rebuild it.
      const ray = skRayFor(uv, invProj, camWorld).toVar('fogRay');
      const dir = ray.xyz;
      const rayLen = ray.w;

      // `color`/`depth` may be texture nodes (a `PassNode`'s getTextureNode()) or
      // values already evaluated for this fragment (e.g. TSL's `linearDepth`).
      const colorNode = ('sample' in color && typeof color.sample === 'function' ? color.sample(uv) : color) as Node<'vec3'> | Node<'vec4'>;
      const depthValue = ('sample' in depth && typeof depth.sample === 'function' ? depth.sample(uv).r : depth) as Node<'float'>;
      const sky = depthValue.lessThanEqual(1e-6);
      // The sky dome already integrates atmospheric scattering over the full
      // view ray. Fogging its cleared-depth pixels a second time replaces the
      // clouds and blue sky with a featureless grey haze.
      const dist = sky.select(float(0), min(depthValue.mul(rayLen), uFog.w)) as Node<'float'>;
      const outCol = colorNode.rgb.toVar();

      If(dist.greaterThan(0.02), () => {
        const cosKey = dot(dir, uKeyDir).toVar();
        const phase = skFogInscatterPhase(cosKey).toVar();
        const ambient = skFogAmbient(cosKey).mul(uFog2.z).toVar();

        const od = skHeightIntegral(camPos.y, dir.y, dist);
        const trans = exp(uFogExt.mul(od).negate());

        const inscatter = vec3(0).toVar();
        if (march) {
          const dith = skIGN(coordinate.add(frame.mul(5.588238))).toVar();
          // Static per-pixel shadow-filter rotation is also invariant over the
          // march. Passing it in prevents a callback from rebuilding it per step.
          const shadowNoise = visibility ? skIGN(coordinate).toVar('fogShadowNoise') : null;
          // Explicit variables keep both expensive cloud taps outside Loop.
          // Build them only for the marched path, not analytic-only quality.
          const cloudNear = skCloudShadow(camPos.xz, uKeyDir).toVar();
          const cloudFar = skCloudShadow(camPos.add(dir.mul(dist)).xz, uKeyDir).toVar();
          const L = vec3(0).toVar();
          const T = float(1).toVar();
          const prev = float(0).toVar();
          Loop(steps, ({ i }) => {
            const f = i.toFloat().add(dith).div(steps);
            const t = dist.mul(f.mul(f).mul(float(3).sub(f.mul(2))).mul(0.35))
              .add(dist.mul(f.mul(f).mul(f)).mul(0.65));
            const dt = t.sub(prev).toVar();
            prev.assign(t);
            If(dt.greaterThan(1e-5), () => {
              const wp = camPos.add(dir.mul(t));
              const dens = skFogDensity(wp);
              If(dens.greaterThan(1e-4), () => {
                const sigmaS = uFog.x.mul(dens).mul(skFogNearRamp(t));
                const sigmaE = max(1e-7, uFog2.x.mul(dens));
                let vis = mix(cloudNear, cloudFar, f);
                if (visibility) vis = vis.mul(visibility(wp, shadowNoise));
                // Ambient occlusion proxy: a shadowed sample sees far less sky.
                const ambOcc = float(0.42).add(vis.mul(0.58));
                const j = uKeyIrr.mul(vis.mul(phase)).add(ambient.mul(ambOcc));
                const aT = exp(sigmaE.mul(dt).negate());
                L.addAssign(T.mul(j).mul(sigmaS).mul(float(1).sub(aT)).div(sigmaE));
                T.mulAssign(aT);
              });
            });
          });
          inscatter.assign(L);
        } else {
          // No raymarch: single scattering with a uniform visibility term, with
          // the near-field ramp folded in analytically (it averages 0.5 over the
          // first twelve metres).
          const odNear = skHeightIntegral(camPos.y, dir.y, min(dist, 12.0));
          const odS = max(0, od.sub(odNear.mul(0.5)));
          const mono = float(1).sub(exp(uFog2.x.mul(odS).negate()));
          inscatter.assign(
            uKeyIrr.mul(phase.mul(0.55)).add(ambient)
              .mul(uFog.x.div(max(1e-6, uFog2.x))).mul(mono)
          );
        }

        outCol.assign(outCol.mul(trans).add(inscatter));
      });
      return outCol;
    });
    return fogged();
  }

  return { createNode, skFogDensity, skFogAmbient, skHeightIntegral };
}
