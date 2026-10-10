export const OUTAGE = Object.freeze({
  hour: 21,
  flickerSeconds: 2.1,
  flickerCycles: 3,
  darkSeconds: 180,
});

// One failure per run; elapsed starts at -1. Caller supplies scaled time.
export function tickStreetlightOutage(state: { elapsed: number }, dt: number, hour: number): number {
  if (state.elapsed < 0) {
    if (hour >= OUTAGE.hour) state.elapsed = 0;
    else return 1;
  } else {
    state.elapsed += dt;
  }
  if (state.elapsed < OUTAGE.flickerSeconds) {
    const phase = state.elapsed * OUTAGE.flickerCycles / OUTAGE.flickerSeconds;
    return phase % 1 < 0.5 ? 1 : 0;
  }
  return state.elapsed < OUTAGE.flickerSeconds + OUTAGE.darkSeconds ? 0 : 1;
}
