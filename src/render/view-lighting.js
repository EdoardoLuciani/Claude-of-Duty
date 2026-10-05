// Intentional readability policy, not material/exposure compensation. The fill
// is at most 10% of the estimated local incident RGB (sky + visible key + the
// selected practicals), with no absolute day/night brightness floor.
export const VIEW_LIGHTING = Object.freeze({
  readability: 0.10,
  fillDirection: Object.freeze([-0.45, 0.75, 0.55]),
  practicalCount: 2,
  skySamples: 12,
  // Unmodelled diffuse bounce when every sky ray is blocked; same floor as the
  // world's indoor fill, not an absolute light or exposure floor.
  skyBounceFloor: 0.035,
  visibilitySeconds: 0.08,
  rayDistance: 1000,
  rayBias: 0.02,
});

/** Update existing light identities only. Occlusion is a camera-position proxy,
 * not per-fragment CSM or self-shadowing; world depth/history stays separate. */
export function updateViewLighting(r, ctx) {
  const camera = ctx.camera, p = camera.position, key = r.activeSun, f = r.indirect;
  const physics = ctx.peek('physics'), tuning = VIEW_LIGHTING;
  // Fixed world-space hemisphere, so turning alone cannot change visibility.
  // Cache only identical static-world/position inputs, never navigation queries.
  if (!physics) r._viewSkyVisibility = 1;
  else if (r._viewProbeWorld !== physics.staticWorld || r._viewProbeVersion !== physics.staticWorld.version ||
      !r._viewProbePosition.equals(p)) {
    let open = 0;
    for (const d of r._viewSkyDirections) if (!physics.raycastAny(
      p.x + d.x * tuning.rayBias, p.y + d.y * tuning.rayBias, p.z + d.z * tuning.rayBias,
      d.x, d.y, d.z, tuning.rayDistance, physics.MASK.SIGHT)) open++;
    r._viewSkyVisibility = tuning.skyBounceFloor + (1 - tuning.skyBounceFloor) * open / tuning.skySamples;
    r._viewProbePosition.copy(p); r._viewProbeWorld = physics.staticWorld; r._viewProbeVersion = physics.staticWorld.version;
  }
  const alpha = r._viewVisibilityFrame === null ? 1 : r._viewVisibilityFrame !== ctx.time.frame
    ? 1 - Math.exp(-Math.max(0, ctx.time.dt) / tuning.visibilitySeconds) : 0;
  f.viewVisibility.value += (r._viewSkyVisibility - f.viewVisibility.value) * alpha;
  ctx.viewScene.environmentIntensity = ctx.scene.environmentIntensity;
  const blocked = physics?.raycastAny(p.x + r.sunDir.x * tuning.rayBias,
    p.y + r.sunDir.y * tuning.rayBias, p.z + r.sunDir.z * tuning.rayBias,
    r.sunDir.x, r.sunDir.y, r.sunDir.z, tuning.rayDistance, physics.MASK.SIGHT);
  const visibility = blocked ? 0 : 1;
  r._viewVisibility += (visibility - r._viewVisibility) * alpha;
  r._viewVisibilityFrame = ctx.time.frame;
  r.viewSun.color.copy(key.color);
  r.viewSun.intensity = key.intensity * r._viewVisibility;
  r.viewSun.target.position.copy(p);
  r.viewSun.position.copy(p).add(r.sunDir);

  // Stable two-light pool: copy the strongest unoccluded authored point lights.
  // Do not duplicate FX flashes, which already have their own view-light pool.
  for (const slot of r.viewPracticals) { slot.source = null; slot.score = 0; }
  for (const entry of r.lights) {
    const light = entry.light;
    if (!light.isPointLight || !light.visible || light.intensity <= 0 ||
        light.userData.owDayIntensity === undefined) continue;
    light.getWorldPosition(r._viewLightPosition);
    r._viewToLight.copy(r._viewLightPosition).sub(p);
    const distance = r._viewToLight.length();
    // Match native punctual attenuation for selection and the fill budget.
    let attenuation = 1 / Math.max(distance ** light.decay, .01);
    if (light.distance > 0) attenuation *= Math.max(0, 1 - (distance / light.distance) ** 4) ** 2;
    const irradiance = light.intensity * attenuation;
    const score = irradiance * Math.max(light.color.r, light.color.g, light.color.b);
    let slot = r.viewPracticals[0];
    for (const candidate of r.viewPracticals) if (candidate.score < slot.score) slot = candidate;
    if (score <= slot.score) continue;
    r._viewToLight.divideScalar(Math.max(distance, 1e-6));
    // Match the world's shadow policy. Authored practicals are currently
    // unshadowed; adding view-only shadows would disagree with the lit room.
    if (light.castShadow && distance > tuning.rayBias * 2 && physics?.raycastAny(
      p.x + r._viewToLight.x * tuning.rayBias, p.y + r._viewToLight.y * tuning.rayBias,
      p.z + r._viewToLight.z * tuning.rayBias, r._viewToLight.x, r._viewToLight.y, r._viewToLight.z,
      distance - tuning.rayBias * 2, physics.MASK.SIGHT)) continue;
    slot.source = light; slot.score = score; slot.irradiance = irradiance;
    slot.light.position.copy(r._viewLightPosition);
  }

  r.viewFill.color.setRGB(f.sky.value.x, f.sky.value.y, f.sky.value.z).multiplyScalar(f.viewVisibility.value);
  r.viewFill.color.r += key.color.r * r.viewSun.intensity;
  r.viewFill.color.g += key.color.g * r.viewSun.intensity;
  r.viewFill.color.b += key.color.b * r.viewSun.intensity;
  for (const slot of r.viewPracticals) {
    const source = slot.source, light = slot.light;
    light.intensity = source ? source.intensity : 0;
    if (!source) continue;
    light.color.copy(source.color); light.distance = source.distance; light.decay = source.decay;
    r.viewFill.color.r += source.color.r * slot.irradiance;
    r.viewFill.color.g += source.color.g * slot.irradiance;
    r.viewFill.color.b += source.color.b * slot.irradiance;
  }
  // FX derives its existing relative flash strength from the whole local
  // budget, not a sun key that can now be fully occluded inside a lit room.
  r.viewLightLevel = Math.max(r.viewFill.color.r, r.viewFill.color.g, r.viewFill.color.b);
  r.viewFill.intensity = tuning.readability;
  r.viewFill.target.position.copy(p);
  r.viewFill.position.copy(r._viewFillDirection).applyQuaternion(camera.quaternion).add(p);
}
