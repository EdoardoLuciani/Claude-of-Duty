/**
 * Two procedural cloud decks on the sky shell — CPU half.
 *
 * The shader lives in `clouds-tsl.js`. This file keeps the deterministic CPU
 * twin of the low-frequency coverage field, because the sun's cloud-occlusion
 * factor has to be sampled on the CPU (it drives the `DirectionalLight`) from
 * the same field the sky shader draws. Correlated, not faked.
 *
 *   cumulus  1.5 km   coverage-eroded fbm with a fake vertical extent produced
 *                     by parallax-shifting the sample along the view ray, so the
 *                     deck has billows and a silhouette instead of reading as a
 *                     printed pattern. Self-shadowed with three taps toward the
 *                     sun, powder-darkened bases, silver rims from a forward
 *                     Henyey-Greenstein lobe.
 *   cirrus   7.8 km   two decorrelated families of ridged fbm, each stretched
 *                     3.5:1 about its own bearing, each bearing 75 degrees from
 *                     the other, cut into fallstreaks and gated by its own
 *                     kilometre-scale patch mask so the layer arrives in fronts.
 *
 * Both are intersected against the planet shell rather than a flat plane, and
 * both fade out with the *distance* to that intersection, which is what stops a
 * grazing deck collapsing into a hard grey wall along the horizon.
 *
 * The low-frequency coverage field `skCloudMacro` is four analytic waves rather
 * than noise, for one specific reason: it has to be evaluated identically on the
 * CPU (see cloudMacro below) so the sun's cloud-occlusion factor matches the
 * cloud the shader is actually drawing.
 */

/**
 * CPU twin of `skCloudMacro` in clouds-tsl.js. Identical expression, so the
 * sun-occlusion factor the DirectionalLight uses is the same field the shader
 * draws. float32 vs float64 differ in the last few bits; nothing here is
 * sensitive to that.
 */
export function cloudMacro(x: number, y: number): number {
  const a = Math.sin(x * 0.412 + 0.7) * Math.cos(y * 0.331 - 0.4);
  const b = Math.sin(x * 0.173 - y * 0.209 + 1.9);
  const c = Math.cos(x * 0.0871 + y * 0.1123 - 0.6);
  return Math.min(1, Math.max(0, 0.5 + 0.5 * (0.42 * a + 0.36 * b + 0.3 * c)));
}

/**
 * Approximate fraction of direct sunlight surviving the cumulus deck above a
 * world point. Uses the macro field only: the fbm detail modulates *within* a
 * cloud, but whether the sun is behind a cloud at all is a weather-scale
 * question, which is exactly what the macro field answers.
 */
interface CloudSunDirection { x: number; y: number; z: number }
interface CloudParams { windX: number; windZ: number; time: number; coverage: number; density: number }

export function cloudSunOcclusion(worldX: number, worldZ: number, sunDir: CloudSunDirection, params: CloudParams): number {
  const h = 1.5;
  const k = h / Math.max(0.1, sunDir.y);
  const px = worldX * 0.001 + sunDir.x * k + params.windX * params.time;
  const pz = worldZ * 0.001 + sunDir.z * k + params.windZ * params.time;
  const macro = cloudMacro(px * 0.22, pz * 0.22);
  const cov = Math.min(1, Math.max(0, params.coverage * (0.34 + 1.3 * macro)));
  // Expected density for a coverage threshold applied to a [0,1] fbm.
  const d = Math.min(1, Math.max(0, (cov - 0.42) / 0.62));
  return Math.exp(-d * params.density * 1.55);
}
