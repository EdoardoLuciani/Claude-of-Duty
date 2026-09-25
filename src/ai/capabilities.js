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
  slopeDegrees,
  slopeRadians: slopeDegrees * Math.PI / 180,
});
