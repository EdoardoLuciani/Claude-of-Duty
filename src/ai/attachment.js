// Shared native motor oracle: both synchronous authoring and worker queries use this code.
import { INFANTRY } from './capabilities.ts';
import { NAV_PROFILE } from './nav-format.ts';
export const WALK_STEP = 1.5 / 60;
/** @param {number} [radius] @param {number} [height] */
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
    let px, py, pz, pvy, grounded, vx, velocityY, vz;
    let span = 0, power = 1;
    // Match the controller gate's 60 Hz / 1.5 m/s execution. Attachments stay
    // bounded to 80 steps; lineOfWalk budgets the full continuation distance.
    for (let i = 0; i < maxSteps; i++) {
      const x = c.position.x, z = c.position.z;
      const dx = to.x - x, dz = to.z - z, d = Math.hypot(dx, dz);
      if ((i > 0 || (fromFits && toFits)) && d < .12 && Math.abs(to.y - c.position.y) <= INFANTRY.arrivalHeight) return true;
      // An incomplete bounded prefix is UNKNOWN, never physical failure.
      // The worker always executes the original complete budget.
      if (i >= yieldAfter) return null;
      // Only position, grounded and the requested vertical velocity affect the
      // next motor displacement. Include clipped velocity conservatively too;
      // contact reports/scratch are overwritten or do not feed movement.
      // Compare after the arrival/prefix gates, and only normal (i > 0) states:
      // the initial overlapping pose has a different arrival condition.
      if (this.repeatState !== false && i > 0) {
        if (Object.is(x, px) && Object.is(c.position.y, py) && Object.is(z, pz)
          && Object.is(vy, pvy) && c.grounded === grounded
          && Object.is(c.velocity.x, vx) && Object.is(c.velocity.y, velocityY) && Object.is(c.velocity.z, vz)) {
          this.stats.repeatedStates = (this.stats.repeatedStates ?? 0) + 1;
          this.stats.savedMoves = (this.stats.savedMoves ?? 0) + maxSteps - i;
          return false;
        }
        // Brent-style checkpoints also catch exact multi-step oscillation.
        // One comparison per step, constant storage, no epsilon or history map.
        if (++span === power) {
          px = x; py = c.position.y; pz = z; pvy = vy; grounded = c.grounded;
          vx = c.velocity.x; velocityY = c.velocity.y; vz = c.velocity.z;
          span = 0; power *= 2;
        }
      }
      const step = Math.min(d, WALK_STEP);
      vy += this.physics.gravity / 60;
      c.move(d > 1e-6 ? dx / d * step : 0, vy / 60, d > 1e-6 ? dz / d * step : 0);
      if (Math.hypot(c.position.x - x, c.position.z - z) > step + radius) return false;
      if (c.grounded) vy = 0;
      if (Math.abs(c.position.y - from.y) > INFANTRY.stepHeight + .1) return false;
    }
    return false;
  }

