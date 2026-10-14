/**
 * Shared terminal resolver. Resolve the entire shot before dispatching effects
 * or damage: listeners may kill actors, remove hitboxes and create ragdolls.
 * A finish drives FX; the ballistic material and measured thickness drive energy.
 * No exit means unknown thickness, never an invented penetrable sheet.
 */
import * as THREE from 'three';
import type { PhysicsSystem } from './index.ts';
import type { EventWeapon } from '../core/events.ts';
import { SURFACE_PROPS, surfaceName, MASK } from './surfaces.ts';
import { rayCapsule, rayCapsuleFar, rayObbFar, makeHitRecord } from './math.ts';

export const MAX_BULLET_LAYERS = 6;
const EPS = 0.0001;
const STEP = 0.0002;
type Vec3Like = { x: number; y: number; z: number };
type Collider = PhysicsSystem['colliders'][number];
type PhysicsBody = PhysicsSystem['bodies']['bodies'][number];
type RagdollBody = PhysicsSystem['ragdolls'][number];
interface ShotImpact {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  incident: THREE.Vector3;
  surface: string;
  surfaceIndex: number;
  exit: boolean;
  damage: number;
  amount: number;
  distance: number;
  object: unknown;
  actor: unknown;
  part: string | null;
  collider: Collider | null;
  body: PhysicsBody | null;
  ragdoll: RagdollBody | null;
}
interface TraceSegment {
  from: THREE.Vector3;
  to: THREE.Vector3;
  impact: number;
}
interface FlightContinuation {
  position: THREE.Vector3;
  dir: THREE.Vector3;
  travelled: number;
  damage: number;
  penetration: number;
}
interface ShotResult {
  deferActorDamage: boolean;
  continuation: FlightContinuation | null;
  impacts: ShotImpact[];
  segments: TraceSegment[];
  origin: THREE.Vector3;
  end: THREE.Vector3;
  shooter: unknown;
  weapon: EventWeapon;
  shot: number;
  speed: number;
  tracer: boolean;
  stopReason: string;
}
interface ShotOptions {
  deferActorDamage?: boolean;
  stopAtExit?: boolean;
  ignoreActors?: unknown[];
  layers?: number;
  from?: Vec3Like;
  origin: Vec3Like;
  dir: Vec3Like;
  shooter?: unknown;
  weapon?: EventWeapon;
  shot?: number;
  speed?: number;
  tracer?: boolean;
  maxDist?: number;
  travelled?: number;
  maxRange?: number;
  dropoff?: number;
  damage?: number;
  penetration?: number;
  rng?: { gauss(): number } | null;
  mask?: number;
  emit?: boolean;
  impulse?: number;
}
type BallisticsPhysics = Pick<
  PhysicsSystem,
  | 'colliders'
  | 'staticWorld'
  | 'nextShotId'
  | 'raycast'
  | 'emitImpact'
  | 'emitBulletSegment'
  | 'rng'
>;
interface ThicknessResult {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
}
export type ActorRegionImpact = Pick<
  ShotImpact,
  'point' | 'normal' | 'incident' | 'damage' | 'amount' | 'distance' | 'actor' | 'part' | 'collider'
>;
interface ResolvedPath {
  from: THREE.Vector3;
  to: THREE.Vector3;
  distance: number;
  damage: number;
  endDamage: number;
}

export class Ballistics {
  declare phys: BallisticsPhysics;
  declare rng: { gauss(): number } | null;
  declare _impacts: ShotImpact[];
  declare _segments: TraceSegment[];
  declare result: ShotResult;
  declare _continuation: FlightContinuation;
  declare _hitActors: unknown[];
  declare _exit: ReturnType<typeof makeHitRecord>;
  declare _paths: ResolvedPath[];
  declare _pathCount: number;
  declare _thick: ThicknessResult;
  declare _matrix: THREE.Matrix4;
  declare _inverse: THREE.Matrix4;
  declare _one: THREE.Vector3;

  constructor(phys: BallisticsPhysics) {
    this.phys = phys;
    this.rng = null;
    this._impacts = [];
    this._segments = [];
    for (let i = 0; i < MAX_BULLET_LAYERS * 2; i++) {
      this._impacts.push({
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        incident: new THREE.Vector3(),
        surface: 'concrete',
        surfaceIndex: 0,
        exit: false,
        damage: 0,
        amount: 0,
        distance: 0,
        object: null,
        actor: null,
        part: null,
        collider: null,
        body: null,
        ragdoll: null,
      });
    }
    for (let i = 0; i <= MAX_BULLET_LAYERS; i++) {
      this._segments.push({ from: new THREE.Vector3(), to: new THREE.Vector3(), impact: -1 });
    }
    this._continuation = {
      position: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      travelled: 0,
      damage: 0,
      penetration: 0,
    };
    this.result = {
      deferActorDamage: false,
      continuation: null,
      impacts: [],
      segments: [],
      origin: new THREE.Vector3(),
      end: new THREE.Vector3(),
      shooter: null,
      weapon: null,
      shot: 0,
      speed: 800,
      tracer: false,
      stopReason: 'range',
    };
    this._paths = Array.from({ length: MAX_BULLET_LAYERS * 2 }, () => ({
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      distance: 0,
      damage: 0,
      endDamage: 0,
    }));
    this._pathCount = 0;
    this._hitActors = [];
    this._exit = makeHitRecord();
    this._thick = { distance: Infinity, point: new THREE.Vector3(), normal: new THREE.Vector3() };
    this._matrix = new THREE.Matrix4();
    this._inverse = new THREE.Matrix4();
    this._one = new THREE.Vector3(1, 1, 1);
  }

  /** Returns a pooled ShotResult, valid until the next call. Damage is muzzle damage. */
  fire(o: ShotOptions): ShotResult {
    const phys = this.phys;
    const result = this.result;
    const impacts = result.impacts;
    const segments = result.segments;
    impacts.length = segments.length = this._hitActors.length = this._pathCount = 0;
    if (o.ignoreActors) for (const actor of o.ignoreActors) this._hitActors.push(actor);
    result.continuation = null;
    result.deferActorDamage = o.deferActorDamage === true;
    result.origin.copy(o.from ?? o.origin);
    result.shooter = o.shooter ?? null;
    result.weapon = o.weapon ?? null;
    result.shot = o.shot ?? phys.nextShotId();
    result.speed = o.speed ?? 800;
    result.tracer = o.tracer === true;
    result.stopReason = 'layer-limit';

    let ox = o.origin.x,
      oy = o.origin.y,
      oz = o.origin.z;
    let dx = o.dir.x,
      dy = o.dir.y,
      dz = o.dir.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length;
    dy /= length;
    dz /= length;
    let remaining = o.maxDist ?? 400;
    let travelled = o.travelled ?? 0;
    const maxRange = o.maxRange ?? o.maxDist ?? 400;
    const dropoff = o.dropoff ?? 0.55;
    let damage = o.damage ?? 34;
    let power = o.penetration ?? 1;
    const rng = o.rng ?? this.rng;
    const mask = o.mask ?? MASK.BULLET;
    result.end.set(ox, oy, oz);

    const maxLayers = Math.max(0, MAX_BULLET_LAYERS - Math.max(0, o.layers ?? 0));
    for (let layer = 0; layer < maxLayers && remaining > EPS; layer++) {
      const hit = phys.raycast(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        remaining,
        mask,
        result.shooter,
        this._hitActors
      );
      const segment = this._segments[segments.length];
      segment.from.set(ox, oy, oz);
      segment.to.copy(hit.point);
      segment.impact = hit.hit ? impacts.length : -1;
      segments.push(segment);
      this._recordPath(segment.from, segment.to, travelled, damage, damage);
      result.end.copy(hit.point);
      if (!hit.hit) {
        result.stopReason = 'range';
        break;
      }

      travelled += hit.distance;
      remaining -= hit.distance;
      const range = Math.min(1, travelled / maxRange);
      const rangeMul = 1 - (1 - dropoff) * range * range;
      const props = SURFACE_PROPS[hit.ballisticSurfaceIndex] ?? SURFACE_PROPS[0];
      this._push(hit.point, hit.normal, dx, dy, dz, false, damage * rangeMul, travelled, hit);
      if (hit.actor) this._hitActors.push(hit.actor);

      const budget = props.penDepth * power;
      if (budget <= EPS) {
        result.stopReason = 'blocked';
        break;
      }
      const thick = this._measureThickness(hit, dx, dy, dz, remaining, mask);
      if (!Number.isFinite(thick.distance)) {
        result.stopReason = 'unknown-thickness';
        break;
      }
      if (thick.distance > budget || thick.distance > remaining) {
        result.stopReason = 'blocked';
        break;
      }
      // Matching an exit does not authorize jumping past other geometry inside
      // it. Overlapping volumes are ambiguous; stop rather than invent layering.
      if (
        thick.distance > EPS &&
        phys.raycast(
          hit.point.x + dx * EPS,
          hit.point.y + dy * EPS,
          hit.point.z + dz * EPS,
          dx,
          dy,
          dz,
          thick.distance - EPS,
          mask,
          result.shooter,
          this._hitActors,
          hit
        ).hit
      ) {
        result.stopReason = 'overlapping-solids';
        break;
      }

      const fraction = thick.distance / budget;
      const entryDamage = damage,
        entryDistance = travelled;
      damage *= Math.max(0.05, 1 - props.energyLoss * fraction);
      power *= Math.max(0, 1 - fraction);
      travelled += thick.distance;
      remaining -= thick.distance;
      const exitRange = Math.min(1, travelled / maxRange);
      const exitDamage = damage * (1 - (1 - dropoff) * exitRange * exitRange);
      this._recordPath(hit.point, thick.point, entryDistance, entryDamage, damage);
      this._push(thick.point, thick.normal, dx, dy, dz, true, exitDamage, travelled, hit);
      result.end.copy(thick.point);
      if (power < 0.02 || damage < 1) {
        result.stopReason = 'exhausted';
        break;
      }

      if (rng && props.deflect > 0) {
        let ux = 0,
          uy = 1;
        if (Math.abs(dy) > 0.9) {
          ux = 1;
          uy = 0;
        }
        let rx = uy * dz,
          ry = -ux * dz,
          rz = ux * dy - uy * dx;
        const rl = Math.hypot(rx, ry, rz) || 1;
        rx /= rl;
        ry /= rl;
        rz /= rl;
        const sx = dy * rz - dz * ry,
          sy = dz * rx - dx * rz,
          sz = dx * ry - dy * rx;
        const a = rng.gauss() * props.deflect * fraction;
        const b = rng.gauss() * props.deflect * fraction;
        dx += rx * a + sx * b;
        dy += ry * a + sy * b;
        dz += rz * a + sz * b;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl;
        dy /= dl;
        dz /= dl;
      }
      const step = Math.min(STEP, remaining);
      ox = thick.point.x + dx * step;
      oy = thick.point.y + dy * step;
      oz = thick.point.z + dz * step;
      travelled += step;
      remaining -= step;
      if (remaining <= EPS) result.stopReason = 'range';
      else if (o.stopAtExit && layer + 1 < maxLayers) {
        // Player rounds resume timed free flight; instantaneous callers keep
        // resolving the whole trajectory. Material thickness is still resolved
        // atomically, and the caller charges that distance to its flight budget.
        const next = this._continuation;
        next.position.set(ox, oy, oz);
        next.dir.set(dx, dy, dz);
        next.travelled = travelled;
        next.damage = damage;
        next.penetration = power;
        result.continuation = next;
        result.stopReason = 'continue';
        break;
      }
    }

    this._selectActorRegions(maxRange, dropoff);
    if (o.emit !== false) this.publish(result, o);
    return result;
  }

  /** Publish the resolved pooled shot without another raycast or RNG draw. */
  publish(shot: ShotResult, o: { impulse?: number } = {}): void {
    let nextImpact = 0;
    for (const segment of shot.segments) {
      const before = segment.impact < 0 ? shot.impacts.length : segment.impact;
      while (nextImpact < before) this._publish(shot.impacts[nextImpact++], shot, o);
      this.phys.emitBulletSegment(segment.from, segment.to, shot);
      if (segment.impact >= 0) this._publish(shot.impacts[nextImpact++], shot, o);
    }
    while (nextImpact < shot.impacts.length) this._publish(shot.impacts[nextImpact++], shot, o);
  }

  _publish(hit: ShotImpact, shot: ShotResult, o: { impulse?: number }): void {
    this.phys.emitImpact(hit, shot, !shot.deferActorDamage);
    if (hit.exit) return;
    hit.collider?.onHit?.(hit, hit.damage, hit.incident.x, hit.incident.y, hit.incident.z);
    if (hit.body) {
      const j = (o.impulse ?? 6) * hit.damage * 0.02;
      hit.body.applyImpulse(
        hit.incident.x * j,
        hit.incident.y * j,
        hit.incident.z * j,
        hit.point.x,
        hit.point.y,
        hit.point.z
      );
    }
    if (hit.ragdoll) {
      hit.ragdoll.applyImpulse(
        hit.point.x,
        hit.point.y,
        hit.point.z,
        hit.incident.x * hit.damage * 0.9,
        hit.incident.y * hit.damage * 0.9,
        hit.incident.z * hit.damage * 0.9,
        0.35
      );
    }
  }

  _recordPath(
    from: THREE.Vector3,
    to: THREE.Vector3,
    distance: number,
    damage: number,
    endDamage: number
  ): void {
    const p = this._paths[this._pathCount++];
    p.from.copy(from);
    p.to.copy(to);
    p.distance = distance;
    p.damage = damage;
    p.endDamage = endDamage;
  }

  /** Actor deduplication must not look through a stop or past a deflection.
   * Include only free flight and interiors with an authorized, reached exit. */
  _selectActorRegions(maxRange: number, dropoff: number): void {
    for (const hit of this.result.impacts) {
      if (hit.actor && !hit.exit) this.selectActorRegion(hit, maxRange, dropoff);
    }
  }

  /** Promote a retained actor contact only along actual reached paths. */
  selectActorRegion(
    hit: ActorRegionImpact,
    maxRange: number,
    dropoff: number,
    path?: ResolvedPath
  ): void {
    let scale = hit.collider?.damageScale ?? 1;
    for (const c of this.phys.colliders) {
      if (!c.enabled || c.owner !== hit.actor || c.shape === 'box' || c.damageScale <= scale)
        continue;
      for (let i = 0; i < (path ? 1 : this._pathCount); i++) {
        const p = path ?? this._paths[i],
          length = p.from.distanceTo(p.to);
        if (length < EPS) continue;
        const dx = (p.to.x - p.from.x) / length;
        const dy = (p.to.y - p.from.y) / length;
        const dz = (p.to.z - p.from.z) / length;
        const t = rayCapsule(
          p.from.x,
          p.from.y,
          p.from.z,
          dx,
          dy,
          dz,
          c.ax,
          c.ay,
          c.az,
          c.bx,
          c.by,
          c.bz,
          c.radius,
          length
        );
        if (t < 0) continue;
        scale = c.damageScale;
        hit.point.copy(p.from).addScaledVector(hit.incident.set(dx, dy, dz), t);
        const ax = c.bx - c.ax,
          ay = c.by - c.ay,
          az = c.bz - c.az;
        const along = Math.max(
          0,
          Math.min(
            1,
            ((hit.point.x - c.ax) * ax + (hit.point.y - c.ay) * ay + (hit.point.z - c.az) * az) /
              (ax * ax + ay * ay + az * az || 1)
          )
        );
        hit.normal
          .set(
            hit.point.x - c.ax - ax * along,
            hit.point.y - c.ay - ay * along,
            hit.point.z - c.az - az * along
          )
          .normalize();
        if (hit.normal.lengthSq() < EPS) hit.normal.copy(hit.incident).negate();
        hit.distance = p.distance + t;
        const range = Math.min(1, hit.distance / maxRange);
        hit.damage =
          (p.damage + ((p.endDamage - p.damage) * t) / length) *
          (1 - (1 - dropoff) * range * range);
        hit.amount = hit.damage * scale;
        hit.part = c.part;
        hit.collider = c;
        break;
      }
    }
  }

  _measureThickness(
    entry: ReturnType<BallisticsPhysics['raycast']>,
    dx: number,
    dy: number,
    dz: number,
    probe: number,
    mask: number
  ): ThicknessResult {
    const out = this._thick;
    out.distance = Infinity;
    const p = entry.point;
    const c = entry.collider;
    let distance = -1;
    if (c) {
      distance =
        c.shape === 'box'
          ? rayObbFar(p.x, p.y, p.z, dx, dy, dz, c.inverse.elements, c.hx, c.hy, c.hz, probe)
          : rayCapsuleFar(
              p.x,
              p.y,
              p.z,
              dx,
              dy,
              dz,
              c.ax,
              c.ay,
              c.az,
              c.bx,
              c.by,
              c.bz,
              c.radius,
              probe
            );
    } else if (entry.body) {
      const b = entry.body;
      if (b.shape === 'sphere') {
        distance = rayCapsuleFar(
          p.x,
          p.y,
          p.z,
          dx,
          dy,
          dz,
          b.position.x,
          b.position.y,
          b.position.z,
          b.position.x,
          b.position.y,
          b.position.z,
          b.radius,
          probe
        );
      } else {
        this._matrix.compose(b.position, b.quaternion, this._one);
        this._inverse.copy(this._matrix).invert();
        distance = rayObbFar(
          p.x,
          p.y,
          p.z,
          dx,
          dy,
          dz,
          this._inverse.elements,
          b.shape === 'capsule' ? b.radius : b.hx,
          b.shape === 'capsule' ? b.halfHeight + b.radius : b.hy,
          b.shape === 'capsule' ? b.radius : b.hz,
          probe
        );
      }
    } else if (entry.ragdoll) {
      const r = entry.ragdoll,
        i = entry.ragdollBone;
      const a = r.boneHead[i],
        b = r.boneTail[i];
      distance = rayCapsuleFar(
        p.x,
        p.y,
        p.z,
        dx,
        dy,
        dz,
        r.px[a],
        r.py[a],
        r.pz[a],
        r.px[b],
        r.py[b],
        r.pz[b],
        r.boneRadius[i],
        probe
      );
    } else if (entry.staticObject >= 0 && entry.solid >= 0 && entry.frontFace) {
      const h = this._exit;
      const found = this.phys.staticWorld.raycast(
        p.x + dx * EPS,
        p.y + dy * EPS,
        p.z + dz * EPS,
        dx,
        dy,
        dz,
        probe,
        mask,
        h,
        -1,
        entry.staticObject,
        entry.solid
      );
      if (found && !h.frontFace) {
        out.distance = h.t + EPS;
        out.point.set(h.px, h.py, h.pz);
        out.normal.set(-h.nx, -h.ny, -h.nz);
        return out;
      }
    }
    if (distance > EPS) out.distance = distance;
    else if (entry.sheetThickness > 0) {
      const cos = Math.abs(entry.normal.x * dx + entry.normal.y * dy + entry.normal.z * dz);
      out.distance = entry.sheetThickness / Math.max(0.001, cos);
    } else return out;
    out.point.set(p.x + dx * out.distance, p.y + dy * out.distance, p.z + dz * out.distance);
    out.normal.copy(entry.normal).negate();
    return out;
  }

  _push(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    dx: number,
    dy: number,
    dz: number,
    exit: boolean,
    damage: number,
    distance: number,
    hit: ReturnType<BallisticsPhysics['raycast']>
  ): void {
    const result = this.result.impacts;
    const r = this._impacts[result.length];
    r.point.copy(point);
    r.normal.copy(normal);
    r.incident.set(dx, dy, dz);
    r.surfaceIndex = hit.surfaceIndex;
    r.surface = surfaceName(hit.surfaceIndex);
    r.exit = exit;
    r.damage = damage;
    r.amount = damage * (hit.collider?.damageScale ?? 1);
    r.distance = distance;
    r.object = hit.object;
    r.actor = hit.actor;
    r.part = hit.part;
    r.collider = hit.collider;
    r.body = hit.body;
    r.ragdoll = hit.ragdoll;
    result.push(r);
  }
}
