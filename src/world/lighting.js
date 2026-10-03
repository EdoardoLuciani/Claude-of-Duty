export const OUTAGE = Object.freeze({
  hour: 21,
  flickerSeconds: 2.1,
  flickerCycles: 3,
  darkSeconds: 180,
});

// One failure per run. The caller supplies scaled (active gameplay) time.
export function tickStreetlightOutage(state, dt, hour) {
  if (!state.triggered && hour >= OUTAGE.hour) {
    state.triggered = true;
    state.elapsed = 0;
  } else if (state.triggered) {
    state.elapsed += dt;
  }
  if (!state.triggered) return 1;
  if (state.elapsed < OUTAGE.flickerSeconds) {
    const phase = state.elapsed * OUTAGE.flickerCycles / OUTAGE.flickerSeconds;
    return phase % 1 < 0.5 ? 1 : 0;
  }
  return state.elapsed < OUTAGE.flickerSeconds + OUTAGE.darkSeconds ? 0 : 1;
}
