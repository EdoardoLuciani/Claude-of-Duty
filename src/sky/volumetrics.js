import {
  Fn, If, Loop, abs, cameraPosition, cameraProjectionMatrixInverse,
  cameraWorldMatrix, clamp, dot, exp, float, frameId, max, min, mix,
  screenCoordinate, screenUV, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { skIGN, skVal3 } from './noise.js';
import { skHG, SK_PI } from './atmosphere-tsl.js';

/**
 * Volumetric fog, light shafts and aerial perspective — TSL port.
 *
 * In the WebGL renderer this was three full-screen passes registered through
 * `registerPass`. In the strict WebGPU frame graph it is a *node* injected where
 * the world colour is composed, because there is no separate pass chain to
 * register into. The three steps are preserved:
 *
 *   1  march     exponentially distributed steps, interleaved-gradient dithered
 *                start offset, dual-lobe Henyey-Greenstein phase, shadowed by
 *                the cumulus deck and — through the caller's `visibility`
 *                callback — by the upstream cascades
 *   2  resolve   temporal accumulation with velocity reprojection and a 3x3
 *                neighbourhood clamp (exposed as `createResolveNode`; the
 *                caller owns the ping-pong history)
 *   3  composite full resolution: analytic per-channel transmittance from the
 *                closed-form exponential-height integral, so the haze on
 *                distant geometry is crisp and noise-free
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
export function createVolumetricNodes(shared, { steps = 40, march = true } = {}) {
  const {
    uFog, uFog2, uFogExt, uPhase, uKeyDir, uKeyIrr, uFogDrift,
    ambientTex, skCloudShadow,
  } = shared;

  /**
   * Colour of the haze as a function of the angle to the key. The two texels of
   * the ambient LUT are the two ends of that axis — whole-sky average (cool) and
   * horizon band average (warm) — so distance separates by hue, not by grey.
   */
  const skFogAmbient = Fn(([cosKey]) => {
    const cool = texture(ambientTex, vec2(0.25, 0.5)).rgb;
    const hor = texture(ambientTex, vec2(0.75, 0.5)).rgb;
    const keyHue = uKeyIrr.div(max(1e-4, max(uKeyIrr.x, max(uKeyIrr.y, uKeyIrr.z))));
    const f = float(0.5).add(clamp(cosKey, -1, 1).mul(0.5));
    const warm = hor.mul(mix(vec3(1), keyHue, 0.55)).mul(1.3);
    return mix(cool, warm, f.mul(f));
  });

  /** Dual-lobe HG: a forward peak for the shafts, a broad back lobe behind you. */
  const skFogPhase = (cosTheta) =>
    mix(skHG(cosTheta, uPhase.x), skHG(cosTheta, uPhase.y), uPhase.z);

  /**
   * The shaft gain applied to the *anisotropic excess only*, so the knob lifts
   * the forward peak without veiling every pixel with the isotropic floor.
   */
  const skFogInscatterPhase = Fn(([cosTheta]) => {
    const iso = 1 / (4 * SK_PI);
    const p = skFogPhase(cosTheta);
    return p.add(max(0, p.sub(iso)).mul(uFog2.y.sub(1)));
  });

  /** Near-field ramp: twelve metres of real air scatters nothing measurable. */
  const skFogNearRamp = Fn(([t]) => smoothstep(0, 12, t));

  /** Normalised density: 1 at the fog base, exponential above, wind-torn. */
  const skFogDensity = Fn(([p]) => {
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
  const skHeightIntegral = Fn(([y0, dy, t]) => {
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
  const skRayFor = Fn(([uv, invProj, camWorld]) => {
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
    camWorld = cameraWorldMatrix, camPos = cameraPosition, visibility, frame = frameId }) {
    const fogged = Fn(() => {
      const uv = screenUV;
      // TSL evaluates expressions where they are consumed, not where JS
      // declares them. Materialise the ray so the march cannot rebuild it.
      const ray = skRayFor(uv, invProj, camWorld).toVar('fogRay');
      const dir = ray.xyz;
      const rayLen = ray.w;

      // `color`/`depth` may be texture nodes (a `PassNode`'s getTextureNode()) or
      // values already evaluated for this fragment (e.g. TSL's `linearDepth`).
      const colorNode = typeof color.sample === 'function' ? color.sample(uv) : color;
      const depthValue = typeof depth.sample === 'function' ? depth.sample(uv).r : depth;
      const sky = depthValue.lessThanEqual(1e-6);
      // The sky dome already integrates atmospheric scattering over the full
      // view ray. Fogging its cleared-depth pixels a second time replaces the
      // clouds and blue sky with a featureless grey haze.
      const dist = sky.select(0, min(depthValue.mul(rayLen), uFog.w));
      const outCol = colorNode.rgb.toVar();

      If(dist.greaterThan(0.02), () => {
        const cosKey = dot(dir, uKeyDir).toVar();
        const phase = skFogInscatterPhase(cosKey).toVar();
        const ambient = skFogAmbient(cosKey).mul(uFog2.z).toVar();

        const od = skHeightIntegral(camPos.y, dir.y, dist);
        const trans = exp(uFogExt.mul(od).negate());

        const inscatter = vec3(0).toVar();
        if (march) {
          const dith = skIGN(screenCoordinate.add(frame.mul(5.588238))).toVar();
          // Static per-pixel shadow-filter rotation is also invariant over the
          // march. Passing it in prevents a callback from rebuilding it per step.
          const shadowNoise = visibility ? skIGN(screenCoordinate).toVar('fogShadowNoise') : null;
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

  /**
   * Temporal resolve. `history` is the previous frame's result, `velocity` a
   * screen-space UV delta. Returns a node that clamps the history to the 3x3
   * neighbourhood of the current frame and blends a little wider than a hard
   * clamp, exactly as the GLSL resolve did. The caller owns the ping-pong.
   */
  function createResolveNode({ current, history, velocity, texel, blend = 0.9 }) {
    const texelNode = Array.isArray(texel) ? vec2(texel[0], texel[1]) : texel;
    return Fn(() => {
      const uv = screenUV;
      const cur = current.sample(uv);
      const vel = velocity.sample(uv).rg;
      const huv = uv.sub(vel);
      const lo = cur.toVar();
      const hi = cur.toVar();
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          if (xx === 0 && yy === 0) continue;
          const n = current.sample(uv.add(vec2(xx, yy).mul(texelNode)));
          lo.assign(min(lo, n));
          hi.assign(max(hi, n));
        }
      }
      const c = lo.add(hi).mul(0.5);
      const e = hi.sub(lo).mul(0.5).mul(1.6).add(1e-5);
      const his = clamp(history.sample(huv), c.sub(e), c.add(e));
      const inside = huv.x.greaterThanEqual(0).and(huv.x.lessThanEqual(1))
        .and(huv.y.greaterThanEqual(0)).and(huv.y.lessThanEqual(1));
      return mix(cur, his, inside.select(blend, 0));
    })();
  }

  return { createNode, createResolveNode, skFogDensity, skFogAmbient, skHeightIntegral };
}
