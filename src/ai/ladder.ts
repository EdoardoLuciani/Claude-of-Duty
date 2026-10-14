// Shared by offline/worker proofs and live execution; never a walking shortcut.
import type { WorldLadder } from '../core/model-metadata.ts';
import type { CharacterController } from '../physics/character.ts';
import { makeHitRecord } from '../physics/math.ts';
import { MASK } from '../physics/surfaces.ts';

export const LADDER_MOTOR_VERSION = 1;
export const LADDER = Object.freeze({
  speed: 2.2, step: 1 / 60, maxSubsteps: 8, maxFrameTime: .25,
  footClearance: .008, lowerOffset: .605, upperOffset: 1.1,
  supportDistance: .04,
});
// Numerical equality only, not permission to slide around an obstruction.
const EPS = 1e-6;
type Point = Readonly<{ x: number; y: number; z: number }>;
export type LadderDirection = 'up' | 'down';
export type LadderPhase = 'align' | 'shaft' | 'dismount';
export interface LadderDescriptor {
  readonly id: number;
  readonly volumeIndex: number;
  readonly normal: Point;
  readonly radius: number;
  readonly points: readonly [Point, Point, Point, Point]; // lower, shaft bottom/top, upper
}
export interface LadderCursor {
  segment: number; distance: number; pendingTime: number; moves: number;
}
export type LadderStatus = 'active' | 'complete' | 'failed' | 'cancelled';
export type LadderFailure = 'entry' | 'overlap' | 'support' | 'trajectory' | 'budget' | 'time' | 'controller';

/** IDs bind to the exact ordered authored volume list, never proximity. */
export function createLadderDescriptors(volumes: readonly WorldLadder[]): readonly LadderDescriptor[] {
  if (volumes.length > 1024) throw new Error('Too many ladders');
  return Object.freeze(volumes.map((v, volumeIndex) => {
    const { x, z, y0, y1, radius, nx, nz } = v;
    if (v.kind !== 'ladder' || ![x, z, y0, y1, radius, nx, nz].every(Number.isFinite)
      || nx === undefined || nz === undefined || Math.abs(Math.hypot(nx, nz) - 1) > EPS
      || y1 <= y0 || y1 - y0 > 12 || radius <= 0 || radius > 2) throw new Error('Invalid ladder volume');
    const p = (offset: number, y: number): Point => Object.freeze({
      x: x + nx * offset, y: y + LADDER.footClearance, z: z + nz * offset,
    });
    return Object.freeze({ id: volumeIndex + 1, volumeIndex,
      normal: Object.freeze({ x: nx, y: 0, z: nz }), radius,
      points: Object.freeze([p(LADDER.lowerOffset, y0), p(0, y0), p(0, y1), p(LADDER.upperOffset, y1)]) as LadderDescriptor['points'],
    });
  }));
}

function length(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
/** Original complete budget, independent of frame rate and interrupted cursor. */
export function ladderMoveBudget(d: LadderDescriptor): number {
  return d.points.slice(1).reduce((n, p, i) => n + Math.ceil(length(d.points[i], p) / (LADDER.speed * LADDER.step)), 0) + 3;
}

/**
 * Controller must already be at the entry (or exact resumed cursor foot).
 * Only detached fixture initialization may position it; this motor never does.
 * Owns step/snap for its lifetime, restoring both on EVERY terminal path.
 * A failed midshaft pose is not a walking recovery point: caller retains ladder
 * occupancy and must obtain a fresh proof before moving it again.
 */
export class LadderMotor {
  private readonly state: LadderCursor;
  get cursor(): Readonly<LadderCursor> { return this.state; }
  readonly controller: CharacterController;
  readonly descriptor: LadderDescriptor;
  readonly direction: LadderDirection;
  readonly maxMoves: number;
  status: LadderStatus = 'active';
  failure: LadderFailure | null = null;
  verticalTravel = 0;
  private readonly stepHeight: number;
  private readonly snapDistance: number;
  private readonly radius: number;
  private readonly height: number;
  private readonly revision: number;
  private readonly slopeLimit: number;
  private readonly maxIterations: number;
  private readonly hit = makeHitRecord();

  constructor(controller: CharacterController, descriptor: LadderDescriptor,
    direction: LadderDirection, maxMoves = ladderMoveBudget(descriptor), cursor?: Readonly<LadderCursor>) {
    this.controller = controller; this.descriptor = descriptor;
    this.direction = direction; this.maxMoves = maxMoves;
    const c = controller;
    this.stepHeight = c.stepHeight; this.snapDistance = c.snapDistance;
    this.radius = c.radius; this.height = c.height; this.revision = c.world.version;
    this.slopeLimit = c.slopeLimit; this.maxIterations = c.maxIterations;
    this.state = cursor ? { ...cursor } : { segment: 0, distance: 0, pendingTime: 0, moves: 0 };
    const s = this.state;
    if ((direction !== 'up' && direction !== 'down') || !Number.isInteger(maxMoves) || maxMoves < 1
      || maxMoves > ladderMoveBudget(descriptor) || !Number.isInteger(s.segment) || s.segment < 0 || s.segment > 2
      || !Number.isInteger(s.moves) || s.moves < 0 || s.moves > maxMoves
      || !Number.isFinite(s.distance) || s.distance < 0 || s.distance > length(this.start, this.target)
      || !Number.isFinite(s.pendingTime) || s.pendingTime < 0 || s.pendingTime > maxMoves * LADDER.step) {
      this.finish('failed', 'entry'); return;
    }
    if (!this.validController()) { this.finish('failed', 'controller'); return; }
    if (this.pathError() > EPS) { this.finish('failed', 'entry'); return; }
    if (!this.fits()) { this.finish('failed', 'overlap'); return; }
    if (s.segment === 0 && s.distance === 0 && !this.supported()) { this.finish('failed', 'support'); return; }
    c.stepHeight = c.snapDistance = 0;
  }

  get phase(): LadderPhase { return this.cursor.segment === 0 ? 'align' : this.cursor.segment === 1 ? 'shaft' : 'dismount'; }
  private get start(): Point {
    return this.descriptor.points[this.direction === 'up' ? this.cursor.segment : 3 - this.cursor.segment];
  }
  private get target(): Point {
    return this.descriptor.points[this.direction === 'up' ? this.cursor.segment + 1 : 2 - this.cursor.segment];
  }
  private validController(): boolean {
    const c = this.controller;
    return Number.isFinite(c.position.x) && Number.isFinite(c.position.y) && Number.isFinite(c.position.z)
      && c.enabled && !c.world.dirty && c.world.version === this.revision && c.mask === MASK.CHARACTER
      && c.radius === this.radius && c.height === this.height && Number.isFinite(c.radius) && c.radius > 0
      && Number.isFinite(c.height) && c.height >= 2 * c.radius && Number.isFinite(c.slopeLimit)
      && c.slopeLimit === this.slopeLimit && c.maxIterations === this.maxIterations
      && Number.isInteger(c.maxIterations) && c.maxIterations > 0;
  }
  private fits(): boolean {
    const c = this.controller, p = c.position;
    return c.world.overlapCapsule(p.x, c.p0y, p.z, p.x, c.p1y, p.z, c.radius, c.mask, 0) === 0;
  }
  private supported(): boolean {
    const c = this.controller, p = c.position;
    return c.world.sweepCapsule(p.x, c.p0y, p.z, p.x, c.p1y, p.z, c.radius,
      0, -1, 0, LADDER.supportDistance, c.mask, this.hit) && this.hit.ny >= c.cosSlope;
  }
  private pathError(): number {
    const a = this.start, b = this.target, t = this.cursor.distance / length(a, b), p = this.controller.position;
    return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t), p.z - (a.z + (b.z - a.z) * t));
  }
  private finish(status: LadderStatus, failure: LadderFailure | null = null): LadderStatus {
    this.status = status; this.failure = failure;
    this.controller.stepHeight = this.stepHeight; this.controller.snapDistance = this.snapDistance;
    this.controller.velocity.x = this.controller.velocity.y = this.controller.velocity.z = 0;
    return status;
  }
  cancel(): void { if (this.status === 'active') this.finish('cancelled'); }

  /** Fixed native quanta; long frames carry time, at most eight moves per call.
   * dt=0 freezes even an existing backlog. Frames above .25s fail, not clamp.
   */
  advance(dt: number): LadderStatus {
    if (this.status !== 'active' || dt === 0) return this.status;
    if (!Number.isFinite(dt) || dt < 0 || dt > LADDER.maxFrameTime) return this.finish('failed', 'time');
    const c = this.controller, s = this.state;
    if (!this.validController() || c.stepHeight !== 0 || c.snapDistance !== 0) return this.finish('failed', 'controller');
    if (this.pathError() > EPS) return this.finish('failed', 'trajectory');
    s.pendingTime += dt;
    for (let i = 0; i < LADDER.maxSubsteps && s.pendingTime + EPS >= LADDER.step; i++) {
      if (s.moves >= this.maxMoves) return this.finish('failed', 'budget');
      if (!this.fits()) return this.finish('failed', 'overlap');
      const p = c.position, a = this.start, b = this.target, span = length(a, b);
      const remaining = span - s.distance;
      const travel = Math.min(remaining, LADDER.speed * LADDER.step);
      const dx = (b.x - a.x) / span * travel, dy = (b.y - a.y) / span * travel, dz = (b.z - a.z) / span * travel;
      const x = p.x, y = p.y, z = p.z;
      c.move(dx, dy, dz);
      s.moves++; s.pendingTime = Math.max(0, s.pendingTime - LADDER.step);
      if (Math.hypot(p.x - x - dx, p.y - y - dy, p.z - z - dz) > EPS) return this.finish('failed', 'trajectory');
      // Record actual swept progress, never a timer-interpolated position.
      this.verticalTravel += Math.abs(p.y - y);
      s.distance += ((p.x - x) * (b.x - a.x) + (p.y - y) * (b.y - a.y) + (p.z - z) * (b.z - a.z)) / span;
      if (this.pathError() > EPS || !this.fits()) return this.finish('failed', 'trajectory');
      if (remaining - travel <= EPS) {
        if (s.segment === 2) {
          if (!this.supported()) return this.finish('failed', 'support');
          c.probeGround();
          return this.finish('complete');
        }
        s.segment++; s.distance = 0;
      }
    }
    return this.status;
  }
}
