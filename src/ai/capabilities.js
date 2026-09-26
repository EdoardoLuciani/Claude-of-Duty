// Infantry dimensions in metres. Controllers take radians; Recast takes degrees.
// The bake covers the largest shipped variant plus a small radius margin.
const slopeDegrees = 48;
export const INFANTRY = Object.freeze({
  radius: 0.34,
  height: 1.78,
  crouchHeight: 1.16,
  maxScale: 1.025,
  navRadius: 0.36,
  stepHeight: 0.42,
  arrivalHeight: 0.18,
  cornerRadius: 0.25,
  arrivalRadius: 0.45,
  precisionRadius: 0.15,
  recoveryDistance: 1.2,
  recoveryTimeout: 3,
  vaultDistance: 1.5,
  vaultDuration: 0.8,
  vaultRise: 0.42,
  slopeDegrees,
  slopeRadians: slopeDegrees * Math.PI / 180,
});

// Shared by the detached feasibility probe and live collision-swept execution.
export function vaultPoint(from, to, t, out) {
  out.lerpVectors(from, to, t);
  out.y += Math.sin(t * Math.PI) * INFANTRY.vaultRise;
  return out;
}
