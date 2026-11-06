/** CPU twin of the cloud coverage field; clouds-tsl.ts renders the same field on planetary shells.
 * Cumulus is low, parallax-eroded and self-shadowed; cirrus combines decorrelated stretched ridges.
 * Distance fading avoids a horizon wall. Keep analytic cloudMacro waves identical on CPU/GPU
 * so directional-light occlusion matches the visible deck.
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
interface CloudSunDirection {
  x: number;
  y: number;
  z: number;
}
interface CloudParams {
  windX: number;
  windZ: number;
  time: number;
  coverage: number;
  density: number;
}

export function cloudSunOcclusion(
  worldX: number,
  worldZ: number,
  sunDir: CloudSunDirection,
  params: CloudParams
): number {
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
