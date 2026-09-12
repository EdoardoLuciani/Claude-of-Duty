/**
 * Ladder climb. Unlike mantle this is not a rooted curve — W/S slides the
 * capsule along an authored axis until the player steps off or jumps away.
 *
 * Collision is skipped while climbing (the rungs sit against the wall, behind
 * the capsule). Dismount lands on the slab beside the hatch and depenetrates.
 */

export class ClimbMotion {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.y0 = 0;
    this.y1 = 0;
    this.nx = 1;
    this.nz = 0;
    this.radius = 0.42;
  }

  begin(ladder, y) {
    this.active = true;
    this.x = ladder.x;
    this.z = ladder.z;
    this.y0 = ladder.y0;
    this.y1 = ladder.y1;
    this.nx = ladder.nx;
    this.nz = ladder.nz;
    this.radius = ladder.radius;
    this.y = y < ladder.y0 ? ladder.y0 : y > ladder.y1 ? ladder.y1 : y;
  }

  end() {
    this.active = false;
  }
}
