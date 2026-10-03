/** Contact centres in weapon metres. Thumb centres sit one glove radius off
 * the surface; trigger contacts use the palmar pad, not the fingertip endpoint.
 * leftThumbPole controls the knuckle's bend plane independently of contact;
 * forward poles on the long handguards avoid pulling the saddle sideways.
 * Kept separate from timing/IK so fitting cannot change reload/fire events. */
export const FIRING_FINGER_SPREAD = [0, .60, .62, .64];
export const GRIP_CONTACTS = {
  rifle: { rightThumb: [-.025,.048,.046], leftThumb: [-.0134,.1065,-.252], leftThumbPole: [0,0,-1], trigger: [0,.0235,.004] },
  smg: { rightThumb: [-.025,.050,.050], leftThumb: [.012,.035,-.210], trigger: [0,.034,-.001] },
  pistol: {
    // P320 authored grip contacts (tools/p320-hand-reference.mjs).
    rightThumb: [-.023,.012,.024], leftThumb: [-.024,.010,-.014], trigger: [0,-.008,-.035],
    rightFingers: [[-.1,.69,1.11],[.70,1.15,.65],[.78,1.20,.68],[.85,1.24,.65]],
    leftSpread: [.35,.40,.45,.50],
    leftFingers: [[.75,1.05,.85],[.80,1.10,.85],[.85,1.10,.85],[.90,1.10,.80]],
  },
  lmg: { rightThumb: [-.027,.020,.039], leftThumb: [-.028,.089,-.318], trigger: [0,-.001,-.019] },
  shotgun: { rightThumb: [-.024,.032,.062], leftThumb: [-.0251,.0591,-.365], trigger: [0,.024,.0025] },
  sniper: { rightThumb: [-.025,.042,.066], leftThumb: [-.017,.095,-.244], leftThumbPole: [0,0,-1], trigger: [0,.037,.016] },
  mcx: { rightThumb: [-.024,.040,.022], leftThumb: [-.022,.096,-.302], leftThumbPole: [0,0,-1], trigger: [0,.019,-.060] },
};
