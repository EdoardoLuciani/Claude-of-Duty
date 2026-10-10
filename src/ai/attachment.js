// Shared native motor oracle: both synchronous authoring and worker queries use this code.
import { INFANTRY } from './capabilities.ts';
import { NAV_PROFILE } from './nav-format.ts';
export const WALK_STEP = 1.5 / 60;
export function canStand(p, radius = NAV_PROFILE.radius, height = NAV_PROFILE.height) {
    this._p0.set(p.x, p.y + .02 + radius, p.z);
    this._p1.set(p.x, p.y + .02 + height - radius, p.z);
    return this.physics.checkCapsule(this._p0, this._p1, radius - .005, this.physics.MASK.CHARACTER);
  }


export function checkAttachment(from, to, radius, height, maxSteps, yieldAfter = Infinity) {
    const fromFits = this.canStand(from, radius, height), toFits = this.canStand(to, radius, height);
    // Let the real controller settle small contact/quantization errors. A deep
    // overlap must not become an accepted attachment via a large depenetration.
    if (fromFits && toFits && Math.hypot(to.x - from.x, to.z - from.z) < .001 && Math.abs(to.y - from.y) <= INFANTRY.arrivalHeight) return true;
    this.stats.endpointChecks++;
    const c = this._probe;
    if (!c) return false;
    c.radius = radius; c.height = height; c.setPosition(from.x, from.y, from.z);
    c.velocity.x = c.velocity.y = c.velocity.z = 0; c.probeGround();
    let vy = 0;
    // Match the controller gate's 60 Hz / 1.5 m/s execution. Attachments stay
    // bounded to 80 steps; lineOfWalk budgets the full continuation distance.
    for (let i = 0; i < maxSteps; i++) {
      const x = c.position.x, z = c.position.z;
      const dx = to.x - x, dz = to.z - z, d = Math.hypot(dx, dz);
      if ((i > 0 || (fromFits && toFits)) && d < .12 && Math.abs(to.y - c.position.y) <= INFANTRY.arrivalHeight) return true;
      // An incomplete bounded prefix is UNKNOWN, never physical failure.
      // The worker always executes the original complete budget.
      if (i >= yieldAfter) return null;
      const step = Math.min(d, WALK_STEP);
      vy += this.physics.gravity / 60;
      c.move(d > 1e-6 ? dx / d * step : 0, vy / 60, d > 1e-6 ? dz / d * step : 0);
      if (Math.hypot(c.position.x - x, c.position.z - z) > step + radius) return false;
      if (c.grounded) vy = 0;
      if (Math.abs(c.position.y - from.y) > INFANTRY.stepHeight + .1) return false;
    }
    return false;
  }

