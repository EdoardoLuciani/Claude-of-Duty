/** Contact centres in weapon metres. Thumb centres sit one glove radius off
 * the surface; trigger contacts use the palmar pad, not the fingertip endpoint.
 * Kept separate from timing/IK so fitting cannot change reload/fire events. */
export const FIRING_FINGER_SPREAD = [0, .60, .62, .64];
export const GRIP_CONTACTS = {
  rifle: { rightThumb: [-.025,.048,.046], leftThumb: [-.020,.104,-.245], trigger: [0,.037,-.005] },
  smg: { rightThumb: [-.025,.050,.050], leftThumb: [.012,.035,-.210], trigger: [0,.034,-.001] },
  pistol: {
    rightThumb: [-.023,.015,.028], leftThumb: [-.024,.002,-.006], trigger: [0,.014,-.016],
    rightFingers: [[-.1,.69,1.11],[.70,1.15,.65],[.78,1.20,.68],[.85,1.24,.65]],
    leftSpread: [.35,.40,.45,.50],
    leftFingers: [[.75,1.05,.85],[.80,1.10,.85],[.85,1.10,.85],[.90,1.10,.80]],
  },
  lmg: { rightThumb: [-.024,.040,.049], leftThumb: [-.014,.094,-.257], trigger: [0,.041,-.001] },
  shotgun: { rightThumb: [-.027,.020,.040], leftThumb: [-.016,.065,-.304], trigger: [0,.024,.016] },
  sniper: { rightThumb: [-.025,.042,.066], leftThumb: [-.017,.098,-.244], trigger: [0,.037,.016] },
  mcx: { rightThumb: [-.024,.015,.035], leftThumb: [-.022,.099,-.302], trigger: [0,.003,-.052] },
};
