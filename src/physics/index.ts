/**
 * PHYSICS — broadphase, raycasts, character collision, rigid bodies, ragdolls,
 * bullet penetration.
 *
 * No physics library: a binned-SAH BVH over the level's triangle soup, a swept
 * capsule character controller, an impulse rigid-body solver and a PBD ragdoll
 * solver, all stepped at 120 Hz from `fixedUpdate` and all deterministic off
 * `ctx.rng`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLIC API  —  const phys = ctx.get('physics')
 * ────────────────────────────────────────────────────────────────────────────
 * STATIC WORLD
 *   addStatic(mesh, surfaceType?, opts?)   -> handle   (world: call me!)
 *   addStaticGroup(object3D, surfaceType?) -> handle[]  traverses children
 *   removeStatic(handleOrMesh)
 *   rebuildStatic()                        force an immediate BVH rebuild
 *
 * QUERIES  (world space, metres; `dir` need not be normalised)
 *   raycast(origin, dir, maxDist, mask?)   -> Hit   (always an object; check .hit)
 *   raycastAny(origin, dir, maxDist, mask?)-> bool  cheap visibility test
 *   lineOfSight(from, to, mask?)           -> bool
 *   explosionExposure(origin, feet, eye)   -> 0..1, including short detours
 *   sphereCast(origin, dir, radius, maxDist, mask?)  -> Hit
 *   capsuleCast(p0, p1, radius, dir, maxDist, mask?) -> Hit
 *   overlapCapsule(p0, p1, radius, mask?)  -> contact count
 *   checkCapsule(p0, p1, radius, mask?)    -> bool, true when clear
 *   groundHeight(x, z, fromY?, mask?)      -> y of the floor, or -Infinity
 *
 *   Hit = { hit, point:Vector3, normal:Vector3, distance, surface:string,
 *           surfaceIndex, object, collider, body, ragdoll, actor, part,
 *           triangle, frontFace, fraction }
 *   Records come from a 64-deep ring pool: read or copy now, never stash.
 *
 * CHARACTER  (player / ai)
 *   createCharacter({radius, height, position, stepHeight, slopeLimit}) -> CharacterController
 *   removeCharacter(c)
 *   c.move(dx,dy,dz)  c.position  c.velocity  c.grounded  c.groundNormal
 *   c.groundSurfaceName  c.touchingCeiling  c.setHeight(h)  c.canFit(h)
 *   c.teleport(x,y,z)  c.landingSpeed  c.steppedUp  c.lastMoveBlocked
 *
 * BALLISTICS  (weapons)
 *   fireBullet({origin, dir, shooter, damage, penetration, maxDist, ...}) -> ShotResult
 *   ShotResult: {impacts, segments, end, stopReason, ...}, pooled until next shot.
 *   emits resolved `bullet:segment`, `bullet:impact`, and `damage:dealt`.
 *   explode({position, radius, damage, impulse})
 *
 * DYNAMICS  (fx, weapons)
 *   addRigidBody({shape, halfExtents|radius, mass, position, velocity, ...}) -> RigidBody
 *   spawnDebris(position, velocity, {size, surface, lifetime, object3D})
 *   removeRigidBody(b)   b.applyImpulse(ix,iy,iz, px,py,pz)   b.sleeping
 *
 * RAGDOLLS  (ai)
 *   createRagdoll({bones?, transform, height, mass, velocity, impulse, point}) -> Ragdoll
 *   createRagdollFromSkeleton(skinnedMesh, {impulse, point, actor}) -> Ragdoll
 *   removeRagdoll(r)
 *
 * HITBOXES / DYNAMIC COLLIDERS  (ai)
 *   addCollider({shape:'capsule'|'sphere'|'box', layer, surface, owner, part}) -> collider
 *   collider.setSegment(ax,ay,az,bx,by,bz)  collider.setSphere(x,y,z,r)
 *   collider.setFromObject(object3D, hx,hy,hz)   removeCollider(c)
 *
 * DEBUG
 *   setDebugDraw(bool, {triangles, nodes, rays, radius})   toggleDebugDraw()
 *   stats -> { triangles, nodes, buildMs, bodies, awake, ragdolls, ... }
 *
 * CONSTANTS
 *   phys.LAYER, phys.MASK, phys.SURFACE, phys.SURFACE_NAMES, phys.SURFACE_PROPS
 */

import * as THREE from 'three';
import type { Rng } from '../core/rng.ts';
import { UNITS } from '../core/config.js';
import { StaticWorld } from './bvh.js';
import { CharacterController } from './character.js';
import { RigidBody, RigidBodyWorld } from './rigidbody.js';
import { Ragdoll, humanoidSpec, specFromSkeleton } from './ragdoll.js';
import { Ballistics } from './penetration.js';
import {
  LAYER, MASK, SURFACE, SURFACE_NAMES, SURFACE_PROPS,
  surfaceIndex, surfaceName,
} from './surfaces.ts';
import {
  makeHitRecord, raySphere, rayCapsule, rayObb, closestPtSegSeg, makeClosest,
} from './math.ts';

const HIT_POOL = 64;
const IMPACT_POOL = 48;
interface Vector3Like { x: number; y: number; z: number }
type PhysicsRigidBodyOptions = { shape?: 'box' | 'sphere' | 'capsule'; halfExtents?: Vector3Like; radius?: number; halfHeight?: number; mass?: number; restitution?: number; friction?: number; linearDamping?: number; angularDamping?: number; gravityScale?: number; surface?: number; surfaceType?: string; mask?: number; layer?: number; ccd?: boolean; lifetime?: number; position?: Vector3Like; quaternion?: THREE.Quaternion; velocity?: Vector3Like; angularVelocity?: Vector3Like; object3D?: THREE.Object3D | null; userData?: unknown; onSleep?: ((body: RigidBody) => void) | null; onImpact?: RigidBody['onImpact'] };
interface PhysicsHit {
  hit: boolean; point: THREE.Vector3; normal: THREE.Vector3; distance: number; fraction: number;
  surface: string; surfaceIndex: number; ballisticSurfaceIndex: number; staticObject: number; solid: number; sheetThickness: number; ragdollBone: number;
  object: unknown; collider: Collider | null; body: RigidBody | null; ragdoll: Ragdoll | null; actor: unknown; part: string | null; triangle: number; frontFace: boolean;
}
interface StaticOptions { mask?: number; layer?: number; ballisticSurface?: string | number; sheetThickness?: number; userData?: unknown }
interface ExplosionEvent { position: THREE.Vector3; radius?: number; damage?: number; impulse?: number }

function isCollisionMesh(object: THREE.Object3D): object is THREE.Mesh | THREE.InstancedMesh {
  return (object as THREE.Mesh).isMesh === true;
}

function makePublicHit(): PhysicsHit {
  return {
    hit: false,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    distance: Infinity,
    fraction: 1,
    surface: 'concrete',
    surfaceIndex: 0,
    ballisticSurfaceIndex: 0,
    staticObject: -1,
    solid: -1,
    sheetThickness: 0,
    ragdollBone: -1,
    object: null,
    collider: null,
    body: null,
    ragdoll: null,
    actor: null,
    part: null,
    triangle: -1,
    frontFace: true,
  };
}

let _colliderId = 1;
interface ColliderOptions {
  shape?: 'capsule' | 'sphere' | 'box'; radius?: number; hx?: number; hy?: number; hz?: number;
  layer?: number; surface?: string; ballisticSurface?: string; sheetThickness?: number; owner?: unknown; part?: string;
  damageScale?: number; enabled?: boolean; onHit?: ((hit: unknown) => void) | null; userData?: Record<string, unknown> | null;
  p0?: THREE.Vector3; p1?: THREE.Vector3; center?: THREE.Vector3;
}
class Collider {
  declare id: number; declare shape: 'capsule' | 'sphere' | 'box';
  declare ax: number; declare ay: number; declare az: number; declare bx: number; declare by: number; declare bz: number;
  declare radius: number; declare hx: number; declare hy: number; declare hz: number; declare matrix: THREE.Matrix4; declare inverse: THREE.Matrix4;
  declare layer: number; declare surfaceIndex: number; declare ballisticSurfaceIndex: number; declare sheetThickness: number;
  declare owner: unknown; declare part: string | null; declare damageScale: number; declare enabled: boolean;
  declare onHit: ((hit: unknown) => void) | null; declare userData: Record<string, unknown> | null;

  constructor(opts: ColliderOptions) {
    this.id = _colliderId++;
    this.shape = opts.shape ?? 'capsule';
    this.ax = 0; this.ay = 0; this.az = 0;
    this.bx = 0; this.by = 0; this.bz = 0;
    this.radius = opts.radius ?? 0.2;
    this.hx = opts.hx ?? 0.2; this.hy = opts.hy ?? 0.2; this.hz = opts.hz ?? 0.2;
    this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.layer = opts.layer ?? LAYER.ACTOR;
    this.surfaceIndex = surfaceIndex(opts.surface ?? 'flesh');
    this.ballisticSurfaceIndex = surfaceIndex(opts.ballisticSurface, this.surfaceIndex);
    this.sheetThickness = opts.sheetThickness ?? 0;
    this.owner = opts.owner ?? null;
    this.part = opts.part ?? null;
    this.damageScale = opts.damageScale ?? 1;
    this.enabled = opts.enabled !== false;
    this.onHit = opts.onHit ?? null;
    this.userData = opts.userData ?? null;
    if (opts.p0 && opts.p1) {
      this.setSegment(opts.p0.x, opts.p0.y, opts.p0.z, opts.p1.x, opts.p1.y, opts.p1.z);
    }
    if (opts.center) this.setSphere(opts.center.x, opts.center.y, opts.center.z, this.radius);
  }

  setSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r?: number): this {
    this.ax = ax; this.ay = ay; this.az = az;
    this.bx = bx; this.by = by; this.bz = bz;
    if (r !== undefined) this.radius = r;
    return this;
  }

  setSphere(x: number, y: number, z: number, r?: number): this {
    this.ax = this.bx = x;
    this.ay = this.by = y;
    this.az = this.bz = z;
    if (r !== undefined) this.radius = r;
    this.shape = 'sphere';
    return this;
  }

  /** Box proxy driven by an Object3D's world matrix. */
  setFromObject(obj: THREE.Object3D, hx?: number, hy?: number, hz?: number): this {
    obj.updateWorldMatrix(true, false);
    this.matrix.copy(obj.matrixWorld);
    this.inverse.copy(this.matrix).invert();
    if (hx !== undefined && hy !== undefined && hz !== undefined) { this.hx = hx; this.hy = hy; this.hz = hz; }
    this.shape = 'box';
    return this;
  }

  setMatrix(m: THREE.Matrix4): this {
    this.matrix.copy(m);
    this.inverse.copy(m).invert();
    return this;
  }
}

const _v = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _m4i = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

// [side, up] detours around the first blocker, shortest first.
const BLAST_ROUTE_OFFSETS = [
  0, 1, -1, 0.35, 1, 0.35, -1, 1, 1, 1, 0, 2, -2, 0.5, 2, 0.5,
];
const BLAST_INDIRECT_EXPOSURE = 0.65;
const BLAST_WAYPOINT_CLEARANCE = 0.08;

interface PhysicsContext {
  scene: THREE.Scene | null; camera: THREE.PerspectiveCamera | null; rng: { fork(): Rng };
  time: { elapsed?: number; dt?: number; alpha?: number };
  events: {
    on(name: 'explosion', callback: (event: { position: THREE.Vector3; radius: number; damage: number; impulse?: number }) => void): () => void;
    on(name: 'shot:applied', callback: () => void): () => void;
    off(name: 'explosion', callback: (event: { position: THREE.Vector3; radius: number; damage: number; impulse?: number }) => void): void;
    emit(name: string, payload: object): void;
  };
}
interface PhysicsStats { triangles: number; nodes: number; objects: number; buildMs: number; bodies: number; awake: number; ragdolls: number; characters: number; colliders: number; raycasts: number; stepMs: number }
interface ImpactRecord { point: THREE.Vector3; normal: THREE.Vector3; incident: THREE.Vector3; surface: string; surfaceIndex: number; damage: number; exit: boolean; object: unknown; body: unknown; actor: unknown; part: unknown; shooter?: unknown; shot?: number }

export class PhysicsSystem {
  declare staticWorld: StaticWorld; declare bodies: RigidBodyWorld; declare characters: CharacterController[]; declare ragdolls: Ragdoll[]; declare colliders: Collider[]; declare ballistics: Ballistics;
  declare LAYER: typeof LAYER; declare MASK: typeof MASK; declare SURFACE: typeof SURFACE; declare SURFACE_NAMES: typeof SURFACE_NAMES; declare SURFACE_PROPS: typeof SURFACE_PROPS;
  declare gravity: number; declare maxRagdolls: number; declare ctx: PhysicsContext; declare rng: Rng;
  declare _hitPool: Array<ReturnType<typeof makePublicHit>>; declare _hitCursor: number; declare _impactPool: ImpactRecord[]; declare _impactCursor: number;
  declare _shotId: number; declare _segmentEvent: { from: THREE.Vector3; to: THREE.Vector3; shooter: unknown; shot: number; weapon: string | null; speed: number; tracer: boolean };
  declare _raw: ReturnType<typeof makeHitRecord>; declare _raw2: ReturnType<typeof makeHitRecord>; declare _cl: ReturnType<typeof makeClosest>;
  declare _blastTarget: THREE.Vector3; declare _blastWaypoint: THREE.Vector3; declare _explicitStatics: number; declare _pendingDemo: boolean;
  declare debug: import('./debug.ts').PhysicsDebugView | null; declare _debugPromise: Promise<import('./debug.ts').PhysicsDebugView | null> | null;
  declare _disposed: boolean; declare _loggedTris: number; declare _onExplosion: (event: { position: THREE.Vector3; radius: number; damage: number; impulse?: number }) => void;
  declare stats: PhysicsStats; declare _rayCount: number;

  static id = 'physics';
  static deps = [];

  constructor() {
    this.staticWorld = new StaticWorld();
    this.bodies = new RigidBodyWorld(this.staticWorld as unknown as ConstructorParameters<typeof RigidBodyWorld>[0], UNITS.gravity);
    this.characters = [];
    this.ragdolls = [];
    this.colliders = [];
    this.ballistics = new Ballistics(this as unknown as ConstructorParameters<typeof Ballistics>[0]);

    this.LAYER = LAYER;
    this.MASK = MASK;
    this.SURFACE = SURFACE;
    this.SURFACE_NAMES = SURFACE_NAMES;
    this.SURFACE_PROPS = SURFACE_PROPS;

    this.gravity = UNITS.gravity;
    this.maxRagdolls = 8;

    this._hitPool = [];
    for (let i = 0; i < HIT_POOL; i++) this._hitPool.push(makePublicHit());
    this._hitCursor = 0;

    this._impactPool = [];
    for (let i = 0; i < IMPACT_POOL; i++) {
      this._impactPool.push({
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        incident: new THREE.Vector3(),
        surface: 'concrete',
        surfaceIndex: 0,
        damage: 0,
        exit: false,
        object: null,
        body: null,
        actor: null,
        part: null,
      });
    }
    this._impactCursor = 0;
    this._shotId = 0;
    this._segmentEvent = { from: new THREE.Vector3(), to: new THREE.Vector3(), shooter: null,
      shot: 0, weapon: null, speed: 800, tracer: false };

    this._raw = makeHitRecord();
    this._raw2 = makeHitRecord();
    this._cl = makeClosest();
    this._blastTarget = new THREE.Vector3();
    this._blastWaypoint = new THREE.Vector3();
    this._explicitStatics = 0;
    this._pendingDemo = false;

    this.debug = null;
    this._debugPromise = null;
    this._disposed = false;
    this._loggedTris = -1;
    this.stats = {
      triangles: 0, nodes: 0, objects: 0, buildMs: 0,
      bodies: 0, awake: 0, ragdolls: 0, characters: 0, colliders: 0,
      raycasts: 0, stepMs: 0,
    };
    this._rayCount = 0;
  }

  async init(ctx: PhysicsContext): Promise<void> {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.ballistics.rng = this.rng;

    this._onExplosion = (e) => this.explode(e);
    ctx.events.on('explosion', this._onExplosion);

    // Dev escape hatch: ?physdebug=1 turns the collision wireframe on from the
    // URL, and ?physdemo=1 also drops a ragdoll and some debris. Neither is
    // reachable in normal play.
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search);
      const debugRequested = q.get('physdebug') === '1';
      const demoRequested = q.get('physdemo') === '1';
      if (debugRequested || demoRequested) await this._ensureDebugView();
      if (debugRequested) this.setDebugDraw(true, { triangles: true, radius: 30 });
      if (demoRequested) {
        this._pendingDemo = true;
        // Shots re-pose the camera after boot; respawn in front of the new view.
        ctx.events.on('shot:applied', () => {
          this.bodies.clear();
          for (const rd of this.ragdolls) rd.dispose();
          this.ragdolls.length = 0;
          this._pendingDemo = true;
        });
      }
    }
  }

  /* ================================================================== */
  /* Static world registration                                          */
  /* ================================================================== */

  /**
   * Register a mesh as static collision. `surfaceType` is one of the twelve
   * names in ARCHITECTURE.md; omit it and we infer per material group, so a
   * multi-material mesh gets per-triangle surfaces.
   * opts: { mask, layer, userData, ballisticSurface, sheetThickness }
   */
  addStatic(mesh: THREE.Mesh | THREE.InstancedMesh, surfaceType?: string | number, opts: StaticOptions = {}): number {
    if (!mesh) return -1;
    const mask = opts.mask ?? opts.layer ?? LAYER.STATIC;
    const id = this.staticWorld.addMesh(mesh, surfaceType as string | number, mask, opts);
    if (id >= 0) this._explicitStatics++;
    return id;
  }

  /** Register every Mesh under an Object3D. Returns the handle list. */
  addStaticGroup(root: THREE.Object3D, surfaceType?: string | number, opts: StaticOptions = {}): number[] {
    const ids: number[] = [];
    if (!root) return ids;
    root.updateWorldMatrix(true, true);
    root.traverse((o: THREE.Object3D) => {
      if (!isCollisionMesh(o)) return;
      if (o.userData?.collision === false || o.userData?.noCollision) return;
      const id = this.addStatic(o, surfaceType ?? o.userData?.surface, opts);
      if (id >= 0) ids.push(id);
    });
    return ids;
  }

  removeStatic(handle: number | THREE.Mesh | THREE.InstancedMesh): boolean {
    if (typeof handle === 'number') return this.staticWorld.removeObject(handle);
    const id = this.staticWorld.findByMesh(handle);
    return id >= 0 ? this.staticWorld.removeObject(id) : false;
  }

  rebuildStatic() {
    this.staticWorld.build();
    this._syncStats();
  }

  get triangleCount() {
    return this.staticWorld.triCount;
  }

  /* ================================================================== */
  /* Queries                                                            */
  /* ================================================================== */

  _nextHit(): PhysicsHit {
    const h = this._hitPool[this._hitCursor];
    this._hitCursor = (this._hitCursor + 1) % HIT_POOL;
    h.hit = false;
    h.distance = Infinity;
    h.fraction = 1;
    h.object = null;
    h.collider = null;
    h.body = null;
    h.ragdoll = null;
    h.actor = null;
    h.part = null;
    h.triangle = -1;
    h.frontFace = true;
    h.surfaceIndex = 0;
    h.ballisticSurfaceIndex = 0;
    h.staticObject = -1;
    h.solid = -1;
    h.sheetThickness = 0;
    h.ragdollBone = -1;
    return h;
  }

  /**
   * Closest-hit ray. Accepts vectors or raw scalars:
   *   raycast(origin, dir, maxDist, mask)
   *   raycast(ox, oy, oz, dx, dy, dz, maxDist, mask)
   * Always returns a Hit record — test `.hit`. Optional ignoreHit excludes
   * only that collider/body/bone or authored static solid, not its whole mesh.
   */
  raycast(a: number | THREE.Vector3, b: number | THREE.Vector3, c?: number, d?: number, e?: unknown, f?: unknown, g?: unknown, h?: number, ignoreOwner: unknown = null, ignoreActors: unknown[] | null = null, ignoreHit: Partial<PhysicsHit> | null = null): PhysicsHit {
    let ox: number, oy: number, oz: number, dx: number, dy: number, dz: number;
    let maxDist: number, mask: number;
    if (typeof a === 'number') {
      oy = b as number; oz = c ?? 0; dx = d ?? 0; dy = e as number ?? 0; dz = f as number ?? 0;
      ox = a; maxDist = typeof g === 'number' ? g : 1000; mask = h ?? MASK.ALL;
    } else {
      const origin = a as THREE.Vector3, direction = b as THREE.Vector3;
      ox = origin.x; oy = origin.y; oz = origin.z;
      dx = direction.x; dy = direction.y; dz = direction.z;
      maxDist = c ?? 1000; mask = d ?? MASK.ALL;
      ignoreOwner = e ?? null;
      ignoreActors = (f as unknown[] | null) ?? null;
      ignoreHit = (g as Partial<PhysicsHit> | null) ?? null;
    }
    const out = this._nextHit();
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-9) {
      out.point.set(ox, oy, oz);
      out.distance = 0;
      return out;
    }
    dx /= l; dy /= l; dz /= l;
    this._rayCount++;
    let best = maxDist;

    const raw = this._raw;
    if (this.staticWorld.raycast(ox, oy, oz, dx, dy, dz, best, mask, raw,
      ignoreHit?.staticObject ?? -1, -1, -1, ignoreHit?.solid ?? -1)) {
      best = raw.t;
      out.hit = true;
      out.distance = raw.t;
      out.point.set(raw.px, raw.py, raw.pz);
      out.normal.set(raw.nx, raw.ny, raw.nz);
      out.surfaceIndex = raw.surface;
      out.triangle = raw.tri;
      out.frontFace = raw.frontFace;
      const object = this.staticWorld.objects[raw.object];
      out.object = object?.mesh ?? null;
      out.staticObject = raw.object;
      out.solid = this.staticWorld.solid[raw.tri];
      out.ballisticSurfaceIndex = object?.ballisticSurface ?? raw.surface;
      out.sheetThickness = object?.sheetThickness ?? 0;
    }

    best = this._raycastColliders(ox, oy, oz, dx, dy, dz, best, mask, out, ignoreOwner, ignoreActors, ignoreHit?.collider);
    best = this._raycastBodies(ox, oy, oz, dx, dy, dz, best, mask, out, ignoreHit?.body);
    this._raycastRagdolls(ox, oy, oz, dx, dy, dz, best, mask, out, ignoreOwner, ignoreActors, ignoreHit);

    if (out.hit) {
      out.fraction = out.distance / maxDist;
      out.surface = surfaceName(out.surfaceIndex);
    } else {
      out.point.set(ox + dx * maxDist, oy + dy * maxDist, oz + dz * maxDist);
      out.normal.set(-dx, -dy, -dz);
      out.distance = maxDist;
      out.surface = 'concrete';
    }
    if (this.debug?.enabled) {
      this.debug.logRay(ox, oy, oz, out.point.x, out.point.y, out.point.z);
    }
    return out;
  }

  _raycastColliders(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, best: number, mask: number, out: PhysicsHit, ignoreOwner: unknown, ignoreActors: unknown[] | null, ignoreCollider: Collider | null | undefined): number {
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (!c.enabled || c === ignoreCollider || (c.layer & mask) === 0) continue;
      if (c.owner && (c.owner === ignoreOwner || ignoreActors?.includes(c.owner))) continue;
      const t = c.shape === 'box'
        ? rayObb(ox, oy, oz, dx, dy, dz, c.inverse.elements, c.hx, c.hy, c.hz, best)
        : rayCapsule(ox, oy, oz, dx, dy, dz, c.ax, c.ay, c.az, c.bx, c.by, c.bz, c.radius, best);
      if (t < 0 || t >= best) continue;
      best = t;
      out.hit = true;
      out.distance = t;
      out.point.set(ox + dx * t, oy + dy * t, oz + dz * t);
      this._colliderNormal(c, out.point, out.normal, dx, dy, dz);
      out.surfaceIndex = c.surfaceIndex;
      out.ballisticSurfaceIndex = c.ballisticSurfaceIndex;
      out.sheetThickness = c.sheetThickness;
      out.staticObject = out.solid = -1;
      out.object = c.owner;
      out.collider = c;
      out.actor = c.owner;
      out.part = c.part;
      out.body = null;
      out.ragdoll = null;
      out.triangle = -1;
      out.frontFace = true;
    }
    return best;
  }

  _colliderNormal(c: Collider, point: THREE.Vector3, outN: THREE.Vector3, dx: number, dy: number, dz: number): void {
    if (c.shape === 'box') {
      _v.copy(point).applyMatrix4(c.inverse);
      const ax = Math.abs(_v.x) / c.hx;
      const ay = Math.abs(_v.y) / c.hy;
      const az = Math.abs(_v.z) / c.hz;
      if (ax >= ay && ax >= az) outN.set(Math.sign(_v.x) || 1, 0, 0);
      else if (ay >= az) outN.set(0, Math.sign(_v.y) || 1, 0);
      else outN.set(0, 0, Math.sign(_v.z) || 1);
      outN.transformDirection(c.matrix);
    } else {
      closestPtSegSeg(
        point.x, point.y, point.z, point.x, point.y, point.z,
        c.ax, c.ay, c.az, c.bx, c.by, c.bz, this._cl
      );
      outN.set(point.x - this._cl.bx, point.y - this._cl.by, point.z - this._cl.bz);
      if (outN.lengthSq() < 1e-12) outN.set(-dx, -dy, -dz);
      else outN.normalize();
    }
    if (outN.x * dx + outN.y * dy + outN.z * dz > 0) outN.multiplyScalar(-1);
  }

  _raycastBodies(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, best: number, mask: number, out: PhysicsHit, ignoreBody: RigidBody | null | undefined): number {
    if ((mask & LAYER.DEBRIS) === 0) return best;
    const list = this.bodies.bodies;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b === ignoreBody) continue;
      let t;
      if (b.shape === 'sphere') {
        t = raySphere(ox, oy, oz, dx, dy, dz, b.position.x, b.position.y, b.position.z, b.radius, best);
      } else {
        _m4.compose(b.position, b.quaternion, _one);
        _m4i.copy(_m4).invert();
        t = b.shape === 'capsule'
          ? rayObb(ox, oy, oz, dx, dy, dz, _m4i.elements, b.radius, b.halfHeight + b.radius, b.radius, best)
          : rayObb(ox, oy, oz, dx, dy, dz, _m4i.elements, b.hx, b.hy, b.hz, best);
      }
      if (t < 0 || t >= best) continue;
      best = t;
      out.hit = true;
      out.distance = t;
      out.point.set(ox + dx * t, oy + dy * t, oz + dz * t);
      out.normal.set(
        out.point.x - b.position.x,
        out.point.y - b.position.y,
        out.point.z - b.position.z
      );
      if (out.normal.lengthSq() < 1e-12) out.normal.set(-dx, -dy, -dz);
      else out.normal.normalize();
      out.surfaceIndex = b.surface;
      out.ballisticSurfaceIndex = b.surface;
      out.sheetThickness = 0;
      out.staticObject = out.solid = -1;
      out.actor = out.part = null;
      out.frontFace = true;
      out.object = b.object3D ?? null;
      out.body = b;
      out.collider = null;
      out.ragdoll = null;
      out.triangle = -1;
    }
    return best;
  }

  _raycastRagdolls(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, best: number, mask: number, out: PhysicsHit, ignoreOwner: unknown, ignoreActors: unknown[] | null, ignoreHit: Partial<PhysicsHit> | null | undefined): number {
    if ((mask & LAYER.RAGDOLL) === 0) return best;
    for (let r = 0; r < this.ragdolls.length; r++) {
      const rd = this.ragdolls[r];
      if (rd.actor && (rd.actor === ignoreOwner || ignoreActors?.includes(rd.actor))) continue;
      if (!segmentHitsAabb(ox, oy, oz, dx, dy, dz, best, rd.aabb, 0.2)) continue;
      for (let i = 0; i < rd.boneCount; i++) {
        if (rd === ignoreHit?.ragdoll && i === ignoreHit.ragdollBone) continue;
        const a = rd.boneHead[i], c = rd.boneTail[i];
        const t = rayCapsule(
          ox, oy, oz, dx, dy, dz,
          rd.px[a], rd.py[a], rd.pz[a],
          rd.px[c], rd.py[c], rd.pz[c],
          rd.boneRadius[i], best
        );
        if (t < 0 || t >= best) continue;
        best = t;
        out.hit = true;
        out.distance = t;
        out.point.set(ox + dx * t, oy + dy * t, oz + dz * t);
        closestPtSegSeg(
          out.point.x, out.point.y, out.point.z, out.point.x, out.point.y, out.point.z,
          rd.px[a], rd.py[a], rd.pz[a], rd.px[c], rd.py[c], rd.pz[c], this._cl
        );
        out.normal.set(
          out.point.x - this._cl.bx,
          out.point.y - this._cl.by,
          out.point.z - this._cl.bz
        );
        if (out.normal.lengthSq() < 1e-12) out.normal.set(-dx, -dy, -dz);
        else out.normal.normalize();
        out.surfaceIndex = SURFACE.flesh;
        out.ragdoll = rd;
        out.object = rd.actor;
        out.actor = null; // Corpses affect ballistics, not living-actor damage.
        out.ballisticSurfaceIndex = out.surfaceIndex;
        out.staticObject = out.solid = -1;
        out.sheetThickness = 0;
        out.ragdollBone = i;
        out.frontFace = true;
        out.part = rd.spec[i]?.name ?? null;
        out.collider = null;
        out.body = null;
        out.triangle = -1;
      }
    }
    return best;
  }

  /** Cheap occlusion test — statics only, no ordering, no record. */
  raycastAny(a: number | THREE.Vector3, b: number | THREE.Vector3, c?: number, d?: number, e?: unknown, f?: unknown, g?: number, h?: number): boolean {
    let ox: number, oy: number, oz: number, dx: number, dy: number, dz: number;
    let maxDist: number, mask: number;
    if (typeof a === 'number') {
      ox = a; oy = b as number; oz = c ?? 0; dx = d ?? 0; dy = e as number ?? 0; dz = f as number ?? 0;
      maxDist = g ?? 1000; mask = h ?? MASK.SIGHT;
    } else {
      const origin = a as THREE.Vector3, direction = b as THREE.Vector3;
      ox = origin.x; oy = origin.y; oz = origin.z;
      dx = direction.x; dy = direction.y; dz = direction.z;
      maxDist = c ?? 1000; mask = d ?? MASK.SIGHT;
    }
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-9) return false;
    this._rayCount++;
    return this.staticWorld.raycastAny(
      ox, oy, oz, dx / l, dy / l, dz / l,
      maxDist ?? 1000, mask ?? MASK.SIGHT
    );
  }

  /** True when nothing blocks the straight line between two points. */
  lineOfSight(from: Vector3Like, to: Vector3Like, mask = MASK.SIGHT): boolean {
    return !this._linecast(from, to, mask);
  }

  /** Segment hit, padded so a surface carrying either endpoint is ignored. */
  _linecast(from: Vector3Like, to: Vector3Like, mask: number, out: ReturnType<typeof makeHitRecord> | null = null): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return false;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    const pad = Math.min(0.01, d * 0.25);
    this._rayCount++;
    const ox = from.x + nx * pad, oy = from.y + ny * pad, oz = from.z + nz * pad;
    const maxDist = d - pad * 2;
    return out
      ? this.staticWorld.raycast(ox, oy, oz, nx, ny, nz, maxDist, mask, out)
      : this.staticWorld.raycastAny(ox, oy, oz, nx, ny, nz, maxDist, mask);
  }

  /** Standing-target exposure, including short detours around the first hit. */
  explosionExposure(origin: Vector3Like, feet: Vector3Like, eye: Vector3Like): number {
    const eyeExposure = this._explosionSampleExposure(origin, eye);
    const chest = this._blastTarget.set(feet.x, feet.y + (eye.y - feet.y) * 0.55, feet.z);
    const chestExposure = this._explosionSampleExposure(origin, chest);
    let exposure = (eyeExposure + chestExposure) * 0.5;
    if (eyeExposure === BLAST_INDIRECT_EXPOSURE || chestExposure === BLAST_INDIRECT_EXPOSURE) {
      exposure = Math.max(exposure, BLAST_INDIRECT_EXPOSURE);
    }
    return exposure;
  }

  _explosionSampleExposure(origin: Vector3Like, target: Vector3Like): number {
    const hit = this._raw2;
    if (!this._linecast(origin, target, MASK.EXPLOSION, hit)) return 1;

    const dx = target.x - origin.x, dz = target.z - origin.z;
    const distance = Math.hypot(dx, target.y - origin.y, dz);
    const horizontal = Math.hypot(dx, dz);
    const sx = horizontal > 1e-5 ? -dz / horizontal : 1;
    const sz = horizontal > 1e-5 ? dx / horizontal : 0;
    const step = Math.max(0.45, Math.min(1.1, distance * 0.22));
    const waypoint = this._blastWaypoint;
    const bx = hit.px + hit.nx * BLAST_WAYPOINT_CLEARANCE;
    const by = hit.py + hit.ny * BLAST_WAYPOINT_CLEARANCE;
    const bz = hit.pz + hit.nz * BLAST_WAYPOINT_CLEARANCE;

    for (let i = 0; i < BLAST_ROUTE_OFFSETS.length; i += 2) {
      const side = BLAST_ROUTE_OFFSETS[i] * step;
      const up = BLAST_ROUTE_OFFSETS[i + 1] * step;
      waypoint.set(bx + sx * side, by + up, bz + sz * side);
      if (!this.lineOfSight(origin, waypoint, MASK.EXPLOSION)) continue;
      if (this.lineOfSight(waypoint, target, MASK.EXPLOSION)) return BLAST_INDIRECT_EXPOSURE;
    }
    return 0;
  }

  sphereCast(origin: Vector3Like, dir: Vector3Like, radius: number, maxDist = 100, mask = MASK.WORLD): PhysicsHit {
    return this.capsuleCast(origin, origin, radius, dir, maxDist, mask);
  }

  capsuleCast(p0: Vector3Like, p1: Vector3Like, radius: number, dir: Vector3Like, maxDist = 100, mask = MASK.CHARACTER): PhysicsHit {
    const out = this._nextHit();
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-9) return out;
    dx /= l; dy /= l; dz /= l;
    this._rayCount++;
    const raw = this._raw2;
    if (this.staticWorld.sweepCapsule(
      p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, radius, dx, dy, dz, maxDist, mask, raw
    )) {
      out.hit = true;
      out.distance = raw.t;
      out.fraction = raw.t / maxDist;
      out.point.set(raw.px, raw.py, raw.pz);
      out.normal.set(raw.nx, raw.ny, raw.nz);
      out.surfaceIndex = raw.surface;
      out.surface = surfaceName(raw.surface);
      out.triangle = raw.tri;
      out.object = this.staticWorld.objects[raw.object]?.mesh ?? null;
    } else {
      out.distance = maxDist;
      out.point.set(p0.x + dx * maxDist, p0.y + dy * maxDist, p0.z + dz * maxDist);
      out.normal.set(-dx, -dy, -dz);
    }
    return out;
  }

  /** Contact count; details live in `physics.staticWorld.contacts`. */
  overlapCapsule(p0: Vector3Like, p1: Vector3Like, radius: number, mask = MASK.CHARACTER): number {
    return this.staticWorld.overlapCapsule(
      p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, radius, mask, 0
    );
  }

  checkCapsule(p0: Vector3Like, p1: Vector3Like, radius: number, mask = MASK.CHARACTER): boolean {
    return this.overlapCapsule(p0, p1, radius, mask) === 0;
  }

  overlapSphere(center: Vector3Like, radius: number, mask = MASK.CHARACTER): number {
    return this.staticWorld.overlapCapsule(
      center.x, center.y, center.z, center.x, center.y, center.z, radius, mask, 0
    );
  }

  /** Floor height under (x, z). Returns -Infinity if there is no floor. */
  groundHeight(x: number, z: number, fromY = 200, mask = MASK.WORLD): number {
    const h = this.raycast(x, fromY, z, 0, -1, 0, 1000, mask);
    return h.hit ? h.point.y : -Infinity;
  }

  /* ================================================================== */
  /* Characters                                                         */
  /* ================================================================== */

  createCharacter(opts = {}) {
    const c = new CharacterController(this.staticWorld, {
      radius: UNITS.playerRadius,
      height: UNITS.playerHeight,
      ...opts,
    });
    this.characters.push(c);
    return c;
  }

  removeCharacter(c: CharacterController): void {
    const i = this.characters.indexOf(c);
    if (i >= 0) this.characters.splice(i, 1);
  }

  /* ================================================================== */
  /* Ballistics                                                         */
  /* ================================================================== */

  /**
   * Trace a round through the world, penetrating what it can.
   * Emits `bullet:impact` for every entry and every exit.
   * Returns a resolved shot (reused; copy what you keep). Shooter is excluded
   * explicitly, and all geometry is resolved before any events are dispatched.
   */
  fireBullet(opts: Parameters<Ballistics['fire']>[0]): ReturnType<Ballistics['fire']> {
    return this.ballistics.fire(opts);
  }

  nextShotId() {
    return ++this._shotId;
  }

  /** Actual travel only: audio, suppression and optional tracers never raycast. */
  emitBulletSegment(from: THREE.Vector3, to: THREE.Vector3, shot: ReturnType<Ballistics['fire']>): void {
    const e = this._segmentEvent;
    e.from.copy(from);
    e.to.copy(to);
    e.shot = shot.shot;
    e.shooter = shot.shooter ?? null;
    e.weapon = shot.weapon ?? null;
    e.speed = shot.speed ?? 800;
    e.tracer = shot.tracer === true;
    this.ctx.events.emit('bullet:segment', e);
  }

  emitImpact(hit: ReturnType<Ballistics['fire']>['impacts'][number], shot: ReturnType<Ballistics['fire']>): void {
    const { exit } = hit;
    const p = this._impactPool[this._impactCursor];
    this._impactCursor = (this._impactCursor + 1) % IMPACT_POOL;
    p.point.copy(hit.point);
    p.normal.copy(hit.normal);
    p.incident.copy(hit.incident);
    p.surfaceIndex = hit.surfaceIndex;
    p.surface = hit.surface;
    p.damage = hit.damage;
    p.exit = exit;
    p.object = hit.object;
    p.body = hit.body;
    p.actor = hit.actor;
    p.part = hit.part;
    p.shooter = shot.shooter;
    p.shot = shot.shot;
    this.ctx.events.emit('bullet:impact', p);

    if (p.actor && !exit) {
      this.ctx.events.emit('damage:dealt', {
        target: p.actor,
        amount: hit.amount,
        headshot: hit.part === 'head',
        part: hit.part,
        killed: false,
        point: p.point,
        incident: p.incident,
        from: shot.origin,
        source: shot.shooter,
        weapon: shot.weapon,
        shot: shot.shot,
      });
    }
  }

  /**
   * Radial blast: shoves rigid bodies and ragdolls, occluded by the world so a
   * grenade behind a wall doesn't throw the crate in front of it.
   */
  explode(e: ExplosionEvent | THREE.Vector3): void {
    if (!e) return;
    const pos = 'position' in e ? e.position : e;
    const radius = 'radius' in e ? e.radius ?? 5 : 5;
    const strength = 'impulse' in e ? e.impulse ?? (e.damage ?? 100) * 0.9 : 90;
    this.bodies.applyRadialImpulse(pos.x, pos.y, pos.z, radius, strength * 0.06);
    for (const rd of this.ragdolls) {
      const cx = (rd.aabb.minx + rd.aabb.maxx) * 0.5;
      const cy = (rd.aabb.miny + rd.aabb.maxy) * 0.5;
      const cz = (rd.aabb.minz + rd.aabb.maxz) * 0.5;
      const dx = cx - pos.x, dy = cy - pos.y, dz = cz - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      _v.set(cx, cy, cz);
      if (!this.lineOfSight(pos, _v, MASK.EXPLOSION)) continue;
      const f = (1 - d / radius) * strength * 0.5;
      const inv = 1 / (d || 1e-4);
      rd.applyImpulse(pos.x, pos.y, pos.z, dx * inv * f, dy * inv * f + f * 0.4, dz * inv * f, radius);
    }
  }

  /* ================================================================== */
  /* Rigid bodies                                                       */
  /* ================================================================== */

  addRigidBody(opts: PhysicsRigidBodyOptions = {}): RigidBody {
    const b = new RigidBody(opts as ConstructorParameters<typeof RigidBody>[0]);
    if (opts.surfaceType) b.surface = surfaceIndex(opts.surfaceType);
    this.bodies.add(b);
    return b;
  }

  removeRigidBody(b: RigidBody): void {
    this.bodies.remove(b);
  }

  /** Convenience for fx: a tumbling chunk with sensible defaults. */
  spawnDebris(position: Vector3Like, velocity: Vector3Like, opts: { size?: number; surface?: string; shape?: 'box' | 'sphere' | 'capsule'; mass?: number; restitution?: number; friction?: number; lifetime?: number; object3D?: THREE.Object3D | null; onImpact?: RigidBody['onImpact'] } = {}): RigidBody {
    const s = opts.size ?? 0.08;
    const si = surfaceIndex(opts.surface ?? 'concrete');
    const b = this.addRigidBody({
      shape: opts.shape ?? 'box',
      halfExtents: { x: s, y: s * 0.7, z: s * 0.85 },
      radius: s,
      mass: opts.mass ?? Math.max(0.01, s * s * s * 4 * (SURFACE_PROPS[si]?.density ?? 2000)),
      position,
      velocity,
      restitution: opts.restitution ?? SURFACE_PROPS[si].restitution,
      friction: opts.friction ?? SURFACE_PROPS[si].friction,
      lifetime: opts.lifetime ?? 20,
      surface: si,
      object3D: opts.object3D ?? null,
      onImpact: opts.onImpact ?? null,
    });
    const r = this.rng;
    b.angularVelocity.set(r.signed() * 14, r.signed() * 14, r.signed() * 14);
    return b;
  }

  /* ================================================================== */
  /* Ragdolls                                                           */
  /* ================================================================== */

  createRagdoll(opts: ConstructorParameters<typeof Ragdoll>[1] & { velocity?: Vector3Like; impulse?: Vector3Like; point?: Vector3Like; impulseRadius?: number; actor?: unknown } = {}): Ragdoll {
    while (this.ragdolls.length >= this.maxRagdolls) {
      this.ragdolls.shift()?.dispose();
    }
    const rd = new Ragdoll(this.staticWorld, { gravity: this.gravity, ...opts });
    if (opts.velocity) rd.setVelocity(opts.velocity.x, opts.velocity.y, opts.velocity.z);
    if (opts.impulse && opts.point) {
      rd.applyImpulse(
        opts.point.x, opts.point.y, opts.point.z,
        opts.impulse.x, opts.impulse.y, opts.impulse.z,
        opts.impulseRadius ?? 0.45
      );
    }
    this.ragdolls.push(rd);
    return rd;
  }

  /**
   * Take over a SkinnedMesh's skeleton. `ai` calls this on death and stops
   * driving the animation; from then on we write bone transforms every frame.
   */
  createRagdollFromSkeleton(skinnedMesh: THREE.SkinnedMesh, opts: ConstructorParameters<typeof Ragdoll>[1] & { actor?: unknown } = {}): Ragdoll | null {
    const skeleton = skinnedMesh?.skeleton ?? skinnedMesh;
    if (!skeleton?.bones?.length) return null;
    const { spec, boneMap } = specFromSkeleton(skeleton, opts);
    if (!spec.length) return null;
    const rd = this.createRagdoll({ ...opts, bones: spec, transform: undefined });
    rd.adoptSkeleton(skeleton, boneMap.map((bone) => bone ?? null));
    rd.actor = opts.actor ?? skinnedMesh;
    return rd;
  }

  removeRagdoll(rd: Ragdoll): void {
    const i = this.ragdolls.indexOf(rd);
    if (i >= 0) this.ragdolls.splice(i, 1);
    rd.dispose();
  }

  /* ================================================================== */
  /* Dynamic colliders / hitboxes                                       */
  /* ================================================================== */

  addCollider(opts: ColliderOptions = {}): Collider {
    const c = new Collider(opts);
    this.colliders.push(c);
    return c;
  }

  removeCollider(c: Collider): void {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  /* ================================================================== */
  /* Frame                                                              */
  /* ================================================================== */

  fixedUpdate(h: number): void {
    const t0 = performance.now();

    if (this.staticWorld.dirty) {
      this.staticWorld.build();
      this._syncStats();
    }

    if (this._pendingDemo && this.staticWorld.triCount > 0) {
      this._pendingDemo = false;
      this._spawnDemo();
    }

    this.bodies.step(h);
    for (let i = 0; i < this.ragdolls.length; i++) this.ragdolls[i].step(h);

    this.stats.stepMs = performance.now() - t0;
    this.stats.awake = this.bodies.awakeCount;
    this.stats.raycasts = this._rayCount;
    this._rayCount = 0;
  }

  update(dt: number, ctx: PhysicsContext): void {
    // Interpolate rigid bodies into their render transforms using the engine's
    // physics alpha so debris never strobes when the frame rate dips.
    const alpha = ctx.time.alpha ?? 0;
    const list = this.bodies.bodies;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const o = b.object3D;
      if (!o) continue;
      if (b.sleeping) {
        o.position.copy(b.position);
        o.quaternion.copy(b.quaternion);
      } else {
        o.position.lerpVectors(b.prevPosition, b.position, alpha);
        o.quaternion.copy(b.prevQuaternion).slerp(b.quaternion, alpha);
      }
    }
  }

  lateUpdate(dt: number, ctx: PhysicsContext): void {
    for (let i = 0; i < this.ragdolls.length; i++) {
      const rd = this.ragdolls[i];
      if (rd.bones3D) rd.writeToSkeleton();
    }
    if (this.debug?.enabled) this.debug.rebuild(this, ctx.camera, dt);
    this.stats.bodies = this.bodies.bodies.length;
    this.stats.ragdolls = this.ragdolls.length;
    this.stats.characters = this.characters.length;
    this.stats.colliders = this.colliders.length;
  }

  _syncStats() {
    this.stats.triangles = this.staticWorld.triCount;
    this.stats.nodes = this.staticWorld.nodeCount;
    this.stats.buildMs = this.staticWorld.buildMs;
    let n = 0;
    for (const o of this.staticWorld.objects) if (o && o.alive) n++;
    this.stats.objects = n;
    // One line per meaningful rebuild so other agents can see, in the capture
    // log, whether their geometry actually reached the collision world.
    if (this.stats.triangles !== this._loggedTris) {
      this._loggedTris = this.stats.triangles;
      console.info(
        `[physics] ${this.stats.triangles} tris / ${this.stats.nodes} nodes · ` +
        `${this.staticWorld.buildMs.toFixed(1)}ms · ${this._explicitStatics} registered`
      );
    }
  }

  /* ================================================================== */
  /* Debug                                                              */
  /* ================================================================== */

  async _ensureDebugView(): Promise<import('./debug.ts').PhysicsDebugView | null> {
    if (this.debug) return this.debug;
    if (!this._debugPromise) {
      this._debugPromise = import('./debug.js').then(({ PhysicsDebugView }) => {
        if (this._disposed || !this.ctx.scene) return null;
        this.debug = new PhysicsDebugView(this.ctx.scene);
        return this.debug;
      });
    }
    return this._debugPromise;
  }

  /**
   * Toggle the collision wireframe. Its multi-megabyte buffers are loaded and
   * allocated only on first use.
   *   phys.setDebugDraw(true, { nodes: true, radius: 25 })
   */
  setDebugDraw(on: boolean, opts: { triangles?: boolean; nodes?: boolean; rays?: boolean; radius?: number } = {}): boolean {
    if (on && !this.debug) {
      void this._ensureDebugView().then((view) => {
        if (view) this.setDebugDraw(true, opts);
      });
      return false;
    }
    if (!this.debug) return false;
    if (opts.triangles !== undefined) this.debug.showTriangles = opts.triangles;
    if (opts.nodes !== undefined) this.debug.showNodes = opts.nodes;
    if (opts.rays !== undefined) this.debug.showRays = opts.rays;
    if (opts.radius !== undefined) this.debug.radius = opts.radius;
    this.debug.setEnabled(on);
    return this.debug.enabled;
  }

  toggleDebugDraw(): boolean {
    this.setDebugDraw(!this.debug?.enabled);
    return this.debug?.enabled ?? false;
  }

  /** Named states for dev overlays / the capture harness. */
  debugState(name: string): PhysicsStats {
    if (name === 'collision') this.setDebugDraw(true, { triangles: true, nodes: false });
    else if (name === 'bvh') this.setDebugDraw(true, { triangles: false, nodes: true });
    else if (name === 'demo') this._spawnDemo();
    else if (name === 'off') this.setDebugDraw(false);
    return this.stats;
  }

  /**
   * Drop a ragdoll and a pile of debris in front of the camera and turn the
   * wireframe on. Purely a verification aid for whoever is looking at the
   * collision system; nothing in the game calls it.
   */
  _spawnDemo() {
    this.setDebugDraw(true, { triangles: true, radius: 30 });
    const cam = this.ctx.camera;
    if (!cam) return this.stats;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const cx = cam.position.x + fwd.x * 6;
    const cz = cam.position.z + fwd.z * 6;
    const floor = this.groundHeight(cx, cz, cam.position.y + 20);
    const base = Number.isFinite(floor) ? floor : 0;
    const r = this.rng;
    for (let i = 0; i < 14; i++) {
      this.spawnDebris(
        { x: cx + r.signed() * 1.6, y: base + 1.2 + i * 0.22, z: cz + r.signed() * 1.6 },
        { x: r.signed() * 2, y: 0, z: r.signed() * 2 },
        { size: 0.09 + r.float() * 0.06, surface: r.pick(['concrete', 'wood', 'metal']), lifetime: 1e9 }
      );
    }
    const m = _m4.makeTranslation(cx + 1.5, base + 1.15, cz);
    const rd = this.createRagdoll({ transform: m, height: 1.82, mass: 84 });
    rd.setVelocity(-1.2, 0.2, 0.4);
    return this.stats;
  }

  dispose(): void {
    this._disposed = true;
    this.ctx?.events.off('explosion', this._onExplosion);
    this.debug?.dispose();
    this.debug = null;
    this._debugPromise = null;
    this.bodies.clear();
    for (const rd of this.ragdolls) rd.dispose();
    this.ragdolls.length = 0;
    this.characters.length = 0;
    this.colliders.length = 0;
    this.staticWorld.dispose();
  }
}

/* ------------------------------------------------------------------ */

function segmentHitsAabb(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, ab: { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number }, pad = 0): boolean {
  const ix = 1 / (dx !== 0 ? dx : 1e-30);
  const iy = 1 / (dy !== 0 ? dy : 1e-30);
  const iz = 1 / (dz !== 0 ? dz : 1e-30);
  let t0 = (ab.minx - pad - ox) * ix, t1 = (ab.maxx + pad - ox) * ix;
  let lo = Math.min(t0, t1), hi = Math.max(t0, t1);
  t0 = (ab.miny - pad - oy) * iy; t1 = (ab.maxy + pad - oy) * iy;
  lo = Math.max(lo, Math.min(t0, t1));
  hi = Math.min(hi, Math.max(t0, t1));
  t0 = (ab.minz - pad - oz) * iz; t1 = (ab.maxz + pad - oz) * iz;
  lo = Math.max(lo, Math.min(t0, t1));
  hi = Math.min(hi, Math.max(t0, t1));
  return hi >= Math.max(0, lo) && lo <= len;
}

export { LAYER, MASK, SURFACE, SURFACE_NAMES, SURFACE_PROPS, humanoidSpec, CharacterController, RigidBody, Ragdoll };
