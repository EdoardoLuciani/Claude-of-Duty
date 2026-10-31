/** Contact centres in weapon metres. Thumb centres sit one glove radius off
 * the surface; trigger contacts use the palmar pad, not the fingertip endpoint.
 * leftThumbPole controls the knuckle's bend plane independently of contact;
 * forward poles on the long handguards avoid pulling the saddle sideways.
 * Kept separate from timing/IK so fitting cannot change reload/fire events. */
export const FIRING_FINGER_SPREAD = [0, 0.6, 0.62, 0.64];
export const GRIP_CONTACTS = {
  rifle: {
    rightThumb: [-0.025, 0.048, 0.046],
    leftThumb: [-0.0134, 0.1065, -0.252],
    leftThumbPole: [0, 0, -1],
    trigger: [0, 0.0235, 0.004],
  },
  smg: {
    rightThumb: [-0.025, 0.05, 0.05],
    leftThumb: [0.012, 0.035, -0.21],
    trigger: [0, 0.034, -0.001],
  },
  pistol: {
    // P320 authored grip contacts (tools/blender/p320/hand-reference.mjs).
    rightThumb: [-0.023, 0.012, 0.024],
    leftThumb: [-0.024, 0.01, -0.014],
    trigger: [0, -0.008, -0.035],
    rightFingers: [
      [-0.1, 0.69, 1.11],
      [0.7, 1.15, 0.65],
      [0.78, 1.2, 0.68],
      [0.85, 1.24, 0.65],
    ],
    leftSpread: [0.35, 0.4, 0.45, 0.5],
    leftFingers: [
      [0.75, 1.05, 0.85],
      [0.8, 1.1, 0.85],
      [0.85, 1.1, 0.85],
      [0.9, 1.1, 0.8],
    ],
  },
  lmg: {
    rightThumb: [-0.027, 0.02, 0.039],
    leftThumb: [-0.028, 0.089, -0.318],
    trigger: [0, -0.001, -0.019],
  },
  shotgun: {
    rightThumb: [-0.024, 0.032, 0.062],
    leftThumb: [-0.0251, 0.0591, -0.365],
    trigger: [0, 0.024, 0.0025],
  },
  sniper: {
    rightThumb: [-0.025, 0.042, 0.066],
    leftThumb: [-0.017, 0.095, -0.244],
    leftThumbPole: [0, 0, -1],
    trigger: [0, 0.037, 0.016],
  },
  mcx: {
    rightThumb: [-0.024, 0.04, 0.022],
    leftThumb: [-0.022, 0.096, -0.302],
    leftThumbPole: [0, 0, -1],
    trigger: [0, 0.019, -0.06],
  },
};
