import * as THREE from 'three';

import { UNITS } from '../core/config.ts';
import type { SystemId, EngineContext, EngineSystems } from '../core/context.ts';
import type { EngineEventMap, EngineEventName, EventWeapon } from '../core/events.ts';
import { clamp } from '../core/math.ts';
import type { Rng } from '../core/rng.ts';
import type { FxStage } from '../dev/fx-stage.ts';
import { Ambience } from './ambience.ts';
import { loadFxAtlases, P, D } from './atlas.ts';
import { DecalSystem } from './decals.ts';
import { explode } from './explosions.ts';
import { HazeSystem } from './haze.ts';
import { spawnImpact, spawnExit, spawnIntelSparks } from './impacts.ts';
import { LightPool } from './lights.ts';
import { muzzleFlash, VIEW_FLASH_DECAY, VIEW_FLASH_TIME } from './muzzle.ts';
import {
  ParticleLayer,
  resetSpawn,
  disposeQuadSource,
  SP,
  setSpawnColorRamp,
  setSpawnPosition,
  setSpawnVelocity,
} from './particles.ts';
import { ShellSystem, loadSpentHullGeometry, type ShellOptions } from './shells.ts';
import { spawnTracer } from './tracers.ts';
import { V, cone } from './util.ts';

/** Bounded GPU particle/decal rings, instanced casings and haze; quality settings set hard caps.
 * Forward transparent FX stay out of the opaque prepass. Soft FX borrow positive view-depth
 * in metres with screenUV; absent depth disables softness.
 * Render draws haze's private half-resolution RG target, then warps the resolved world texture
 * before the first-person composite and bloom. The warp needs a texture, not a colour expression.
 */
type FxEventMap = EngineEventMap;
export type FxContext = Pick<
  EngineContext,
  'scene' | 'viewScene' | 'camera' | 'viewCamera' | 'config' | 'time' | 'rng' | 'events' | 'peek'
>;
type DecalOptions = Parameters<DecalSystem['add']>[0];
/** Projection inputs and world/time bookkeeping belong to FX, not its callers. */
export type FxDecalOptions = Partial<
  Omit<DecalOptions, 'point' | 'normal' | 'world' | 'now' | 'mask'>
> & {
  noFallback?: boolean;
  primaryImpact?: boolean;
};
export class FxSystem {
  declare ctx: FxContext;
  declare rng: Rng;
  declare render: EngineSystems['render'] | null;
  declare _physics: EngineSystems['physics'] | null;
  declare _audio: EngineSystems['audio'] | null;
  gravity: number = UNITS.gravity;
  now: number = 0;
  declare _atlas: { texture: THREE.Texture; cols: number; size: number };
  declare _decalAtlas: {
    albedo: THREE.Texture;
    normal: THREE.Texture;
    orm: THREE.Texture;
    cols: number;
    size: number;
  };
  declare pScale: number;
  declare lit: ParticleLayer;
  declare add: ParticleLayer;
  declare motes: ParticleLayer;
  declare layers: ParticleLayer[];
  declare viewAdd: ParticleLayer;
  declare viewLit: ParticleLayer;
  _viewAttached: boolean = false;
  declare decals: DecalSystem;
  declare hazeSys: HazeSystem;
  declare lights: LightPool;
  /** Mirrored pool inside viewScene; built with the view layers on first use. */
  viewLights: LightPool | null = null;
  declare shells: ShellSystem;
  declare ambience: Ambience;
  declare _ambTop: THREE.Vector3;
  declare _ambBot: THREE.Vector3;
  declare _sunCol: THREE.Vector3;
  declare _sunView: THREE.Vector3;
  declare _upView: THREE.Vector3;
  declare _fog: THREE.Vector4;
  declare _p: THREE.Vector3;
  declare _n: THREE.Vector3;
  declare _d: THREE.Vector3;
  declare _p2: THREE.Vector3;
  declare _d2: THREE.Vector3;
  declare _tmpA: THREE.Vector3;
  declare _tmpB: THREE.Vector3;
  declare _camPos: THREE.Vector3;
  declare _decalOpts: DecalOptions;
  declare _off: Array<() => void>;
  _captureStage: FxStage | null = null;
  declare stats: { spawned: number; decals: number; live: number };
  declare _sunFactor: number;
  _sunW: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };
  declare _suppressDecals: boolean;
  _warmScene: THREE.Scene | null = null;
  static readonly id = 'fx';
  static readonly deps: SystemId[] = ['render', 'materials'];

  async init(ctx: FxContext): Promise<void> {
    this.ctx = ctx;
    this.rng = ctx.rng.fork();
    this.render = ctx.peek('render');
    this._physics = ctx.peek('physics');
    this._audio = ctx.peek('audio');

    const q = ctx.config.q;
    const budget = q.particleBudget;
    const big = budget >= 10000;

    const t0 = performance.now();
    const atlasSize = big ? 1024 : 512;
    // Preserve seeded FX substreams after retiring the runtime atlas bake.
    this.rng.fork();
    this.rng.fork();
    const { particles: particleAtlas, decals: decalAtlas } = await loadFxAtlases(atlasSize);
    this._atlas = particleAtlas;
    this._decalAtlas = decalAtlas;
    const bakeMs = performance.now() - t0;

    const mote = clampI(Math.round(budget * 0.06), 96, 600);
    const hazeCap = clampI(Math.round(budget * 0.04), 48, 320);
    const viewAdd = clampI(Math.round(budget * 0.03), 48, 400);
    const viewLit = clampI(Math.round(budget * 0.02), 32, 256);
    const rest = Math.max(256, budget - mote - hazeCap - viewAdd - viewLit);
    const litCap = Math.round(rest * 0.55);
    const addCap = rest - litCap;

    /** Particles spawned per impact scale with the budget. */
    this.pScale = clamp(budget / 12000, 0.4, 1.25);

    const mk = (
      capacity: number,
      modeName: 'lit' | 'additive',
      renderOrder: number
    ): ParticleLayer =>
      new ParticleLayer({
        capacity,
        mode: modeName,
        atlas: particleAtlas.texture,
        cols: particleAtlas.cols,
        renderOrder,
      });

    this.lit = mk(litCap, 'lit', 10);
    this.add = mk(addCap, 'additive', 12);
    this.motes = mk(mote, 'additive', 9);
    this.layers = [this.lit, this.add, this.motes];
    for (const l of this.layers) ctx.scene.add(l.mesh);

    // Viewmodel-space layers. Attached at the end of init() when the game HAS a
    // viewmodel (see the pre-warm note there), and otherwise on the first
    // first-person effect — so a game with no viewmodel never gets objects in
    // viewScene and never triggers the viewmodel pass.
    this.viewAdd = mk(viewAdd, 'additive', 12);
    this.viewLit = mk(viewLit, 'lit', 10);
    this.viewAdd.uniforms.uSoftEnable.value.x = 0;
    this.viewLit.uniforms.uSoftEnable.value.x = 0;

    this.decals = new DecalSystem({
      capacity: q.decalBudget,
      albedo: decalAtlas.albedo,
      normal: decalAtlas.normal,
      orm: decalAtlas.orm,
      cols: decalAtlas.cols,
    });
    ctx.scene.add(this.decals.mesh);

    this.hazeSys = new HazeSystem({
      capacity: hazeCap,
      atlas: particleAtlas.texture,
      cols: particleAtlas.cols,
    });

    this.lights = new LightPool(ctx.scene, 4);
    if (this.render?.addLight) this.lights.register(this.render);

    this.shells = new ShellSystem(this, await loadSpentHullGeometry());
    ctx.scene.add(this.shells.mesh, this.shells.hullMesh);

    this.ambience = new Ambience(this, {
      motes: mote,
    });

    // lighting inputs (follow the renderer's active sun)
    this._ambTop = new THREE.Vector3(0.42, 0.5, 0.66);
    this._ambBot = new THREE.Vector3(0.2, 0.17, 0.14);
    this._sunCol = new THREE.Vector3(1, 0.93, 0.82);
    this._sunView = new THREE.Vector3(0, 1, 0);
    this._upView = new THREE.Vector3(0, 1, 0);
    this._fog = new THREE.Vector4(0.62, 0.66, 0.72, 0);

    // scratch
    this._p = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._p2 = new THREE.Vector3();
    this._d2 = new THREE.Vector3();
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._decalOpts = {
      point: this._p,
      normal: this._n,
      size: 0.15,
      tile: 0,
      roll: 0,
      life: 60,
      fade: 0.72,
      opacity: 1,
      maxAngle: 62,
      depth: 0.08,
      flip: false,
      world: null,
      mask: 0xffff,
      now: 0,
    };

    // events
    const on = <K extends EngineEventName>(type: K, fn: (event: FxEventMap[K]) => void): void => {
      const off = ctx.events.on(type, fn);
      this._off.push(off);
    };
    this._off = [];
    on('bullet:impact', (e): void => this.onImpact(e));
    on('intel:secured', (e): void => this.onIntelSpark(e));
    on('intel:spark', (e): void => this.onIntelSpark(e));
    on('bullet:segment', (e): void => {
      if (e.tracer) this.tracer(e.from, e.to, e.speed);
    });
    on('weapon:fire', (e): void => this.onWeaponFire(e));
    on('weapon:shell', (e): void => this.spawnShell(e.position, e.velocity, e));
    on('explosion', (e): void => this.explosion(e));
    on('actor:death', (e): void => this.onActorDeath(e));
    on('player:land', (e): void => this.onLand(e));
    on('player:footstep', (e): void => this.onFootstep(e));

    this._captureStage?.clear();

    this.stats = { spawned: 0, decals: 0, live: 0 };

    // Attach stable view light identities before native graph prewarm to avoid
    // rebuilding first-person lighting on the first shot. Pooled lights start dark.
    // Without a viewmodel, defer attachment until first use: adding children here
    // would otherwise enable the separate first-person pass in FX-only scenes.
    if (this._viewmodelPresent()) this._attachView();

    console.info(
      `[fx] atlases ${atlasSize}px in ${bakeMs.toFixed(0)}ms · particles ` +
        `lit ${litCap} add ${addCap} motes ${mote} haze ${hazeCap} · decals ${this.decals.capacity}`
    );
  }

  resize(): void {
    // RenderSystem.resize runs first; haze's offsets live at half the internal
    // drawing resolution, not half the CSS viewport size.
    const { width, height } = this.render!.screenSize;
    this.hazeSys.resize(width, height);
  }

  emitAdd = (s: typeof SP): number => this.add.emit(s, this.now);
  emitLit = (s: typeof SP): number => this.lit.emit(s, this.now);
  emitMote = (s: typeof SP): number => this.motes.emit(s, this.now);
  /** View flame may be as brief as the muzzle pulse, below the default life floor. */
  emitViewAdd = (s: typeof SP): number => {
    this._attachView();
    return this.viewAdd.emit(s, this.now, VIEW_FLASH_TIME);
  };
  emitViewLit = (s: typeof SP): number => {
    this._attachView();
    return this.viewLit.emit(s, this.now);
  };

  _attachView(): void {
    if (this._viewAttached) return;
    this._viewAttached = true;
    this.ctx.viewScene.add(this.viewAdd.mesh);
    this.ctx.viewScene.add(this.viewLit.mesh);
    // viewScene cannot see world punctual lights. Keep its two pooled lights
    // attached and dark between shots so native lighting identities stay stable.
    if (!this.viewLights) {
      this.viewLights = new LightPool(this.ctx.viewScene, 2);
      // NOT registered with render.addLight: that budgets/culls against world
      // positions, and these live in view space.
    }
  }

  /** Does viewScene already draw something of its own (i.e. is there a weapon)? */
  _viewmodelPresent(): boolean {
    let found = false;
    this.ctx.viewScene.traverse((o): void => {
      if (found || !(o instanceof THREE.Mesh)) return;
      if (o === this.viewAdd.mesh || o === this.viewLit.mesh) return;
      found = true;
    });
    return found;
  }

  /**
   * Compile real FX meshes without reparenting them or spawning particles.
   * Haze separately warms its actual RG-target context with zero draw ranges.
   */
  async prewarmMaterials(): Promise<{ ok: boolean; reason?: string; haze?: unknown }> {
    const renderer = this.render?.renderer;
    if (!renderer) return { ok: false, reason: 'no renderer' };
    const ctx = this.ctx;

    // Reaching the viewmodel layers means attaching them; see the note in init().
    if (!this._viewAttached && this._viewmodelPresent()) this._attachView();

    const scratch = (this._warmScene ??= new THREE.Scene());
    const compile = async (
      meshes: Array<THREE.Object3D | null | undefined>,
      camera: THREE.Camera
    ): Promise<void> => {
      scratch.children.length = 0;
      for (const m of meshes) if (m) scratch.children.push(m);
      if (!scratch.children.length) return;
      try {
        await renderer.compileAsync(scratch, camera);
      } finally {
        scratch.children.length = 0;
      }
    };

    await compile(
      [
        this.lit.mesh,
        this.add.mesh,
        this.motes.mesh,
        this.decals.mesh,
        this.shells.mesh,
        this.shells.hullMesh,
      ],
      ctx.camera
    );
    if (this._viewAttached) {
      await compile([this.viewAdd.mesh, this.viewLit.mesh], ctx.viewCamera);
    }
    // The refraction sprites live in the haze system's own private scene, which
    // no scene-graph walk from outside can reach.
    const render = this.render;
    const haze = await this.hazeSys.prewarm(
      renderer,
      ctx.camera,
      render ? (): ReturnType<EngineSystems['render']['warmGraph']> => render.warmGraph() : null
    );
    return { ok: haze.ok, haze };
  }

  /** View-scene spill tracks the viewmodel key for consistent relative brightness.
   * Inverse-square falloff gives a bright crown and a softer wash toward the magwell.
   */
  viewFlash(x: number, y: number, z: number, r: number, g: number, b: number, strength = 1): void {
    this._attachView();
    const pool = this.viewLights;
    if (!pool) return;
    const key = this.render?.viewLightLevel ?? this.render?.viewSun.intensity ?? 2.5;
    // Peak candela per key unit, before the muzzle's exposure carried in `strength`.
    const peak = key * 0.4 * clamp(strength, 0, 2.2);
    // Lift 4 cm off the bore: an on-axis source grazes the receiver (N.L ~0.15).
    pool.flash(x, y + 0.04, z, r, g, b, peak, VIEW_FLASH_TIME, VIEW_FLASH_DECAY, 1.6, 2);
  }

  get physics(): EngineSystems['physics'] | undefined {
    if (!this._physics) this._physics = this.ctx.peek('physics');
    return this._physics ?? undefined;
  }

  /** Electrical arcs from the exposed cache controller, also on completion. */
  onIntelSpark(e: FxEventMap['intel:spark']): void {
    this.now = this.ctx.time.elapsed;
    spawnIntelSparks(this, e.position);
  }

  /** Handle a `bullet:impact` payload. */
  onImpact(e: FxEventMap['bullet:impact']): void {
    this.now = this.ctx.time.elapsed;
    let energy = clamp(0.7 + e.damage / 55, 0.7, 1.7);
    if (e.exit) energy *= 0.75;
    const spawn = e.exit ? spawnExit : spawnImpact;
    spawn(this, e.point, e.normal, e.incident, e.surface, energy);
    this.stats.spawned++;
  }

  /** `weapon:fire` — set `e.fx === false` to suppress and drive FX yourself. */
  onWeaponFire(e: FxEventMap['weapon:fire']): void {
    if (e.fx === false) return;
    this.now = this.ctx.time.elapsed;
    this._camPos.setFromMatrixPosition(this.ctx.camera.matrixWorld);
    const firstPerson = this._camPos.distanceToSquared(e.origin) < 2.25;
    this.muzzleFlash({
      position: e.origin,
      direction: e.dir,
      weapon: e.weapon,
      view: firstPerson,
      intensity: e.intensity,
      light: e.light,
      scale: e.flashScale,
    });
  }

  /**
   * Muzzle flash + barrel smoke + light + heat haze.
   * `view: true` emits into the viewmodel scene (converted through the two
   * cameras) so the flash composites over the weapon rather than under it.
   */
  muzzleFlash(o: {
    position: THREE.Vector3;
    direction: THREE.Vector3;
    weapon?: EventWeapon;
    view?: boolean;
    viewSpace?: boolean;
    intensity?: number | undefined;
    light?: number | undefined;
    scale?: number | undefined;
  }): ReturnType<typeof muzzleFlash> {
    this.now = this.ctx.time.elapsed;
    let pos = o.position;
    let dir = o.direction;
    // The light always lives in the world, even when the sprites are drawn in
    // viewmodel space, because it is the world it has to illuminate.
    if (o.viewSpace) {
      // Caller handed us a point already in viewmodel space (the usual case for
      // a weapon whose muzzle is a bone in viewScene): map it back out for the
      // light and leave the sprites where they are.
      this._fromView(pos);
      this._lightPos.copy(this._p2);
    } else {
      this._lightPos.copy(pos);
      if (o.view) {
        this._toView(pos, dir);
        pos = this._p2;
        dir = this._d2;
      }
    }
    this._flashArg.position = pos;
    this._flashArg.direction = dir;
    this._flashArg.lightPos = this._lightPos;
    this._flashArg.weapon = o.weapon ?? undefined;
    this._flashArg.intensity = o.intensity;
    this._flashArg.light = o.light;
    this._flashArg.scale = o.scale;
    this._flashArg.view = o.view === true || o.viewSpace === true;
    return muzzleFlash(this, this._flashArg);
  }

  _flashArg: Parameters<typeof muzzleFlash>[1] = {
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    lightPos: new THREE.Vector3(),
    weapon: undefined,
    intensity: 1,
    light: 1,
    scale: undefined,
    view: false,
  };
  _lightPos = new THREE.Vector3();

  /** Viewmodel-scene point -> world space (for the punctual light). */
  _fromView(pos: THREE.Vector3Like): THREE.Vector3 {
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    cam.updateMatrixWorld();
    vcam.updateMatrixWorld();
    this._p2.copy(pos);
    vcam.worldToLocal(this._p2);
    cam.localToWorld(this._p2);
    return this._p2;
  }

  /** Convert a world-space point+dir into viewmodel-scene space. */
  _toView(pos: THREE.Vector3, dir: THREE.Vector3): void {
    const cam = this.ctx.camera;
    const vcam = this.ctx.viewCamera;
    cam.updateMatrixWorld();
    vcam.updateMatrixWorld();
    this._p2.copy(pos);
    cam.worldToLocal(this._p2);
    vcam.localToWorld(this._p2);
    this._d2
      .copy(dir)
      .transformDirection(cam.matrixWorldInverse)
      .transformDirection(vcam.matrixWorld);
    this._d2.normalize();
  }

  /** A travelling tracer round. */
  tracer(
    from: THREE.Vector3,
    to: THREE.Vector3,
    speed: number | undefined,
    opts: Parameters<typeof spawnTracer>[4] = {}
  ): void {
    this.now = this.ctx.time.elapsed;
    spawnTracer(this, from, to, speed ?? 0, opts);
  }

  /** Full explosion: fireball, shockwave, debris, smoke column, light, scorch. */
  explosion(e: FxEventMap['explosion']): void {
    this.now = this.ctx.time.elapsed;
    explode(this, e);
  }

  /** Clear every projected impact decal; weapon state is untouched. */
  clearDecals(): void {
    this.decals.clear();
  }

  /** Eject a casing or spent shotgun hull as a pooled physics body. */
  spawnShell(position: THREE.Vector3, velocity: THREE.Vector3, opts: ShellOptions = {}): void {
    this.now = this.ctx.time.elapsed;
    this.shells.spawn(position, velocity, opts);
  }

  /** Project a decal onto the static world. */
  addDecal(
    point: THREE.Vector3Like,
    normal: THREE.Vector3Like,
    opts: FxDecalOptions = {}
  ): boolean {
    if (this._suppressDecals) return false;
    const o = this._decalOpts;
    this._p.copy(point);
    this._n.copy(normal);
    o.size = opts.size ?? 0.15;
    o.tile = opts.tile ?? 0;
    o.roll = opts.roll ?? this.rng.float() * Math.PI * 2;
    o.life = opts.life ?? 60;
    // Use the ordinary projected impact (not a second ray from the camera).
    // Keep the primary mark readable downrange until reset or budget eviction.
    if (opts.primaryImpact && this.ctx.peek('world')?.queries.rangeTargetAt(point, normal)) {
      o.life = Infinity;
      o.size = Math.max(o.size, 0.18);
    }
    o.fade = opts.fade ?? 0.72;
    o.opacity = opts.opacity ?? 1;
    o.maxAngle = opts.maxAngle ?? 62;
    o.depth = opts.depth ?? Math.max(0.04, o.size * 0.32);
    o.flip = opts.flip ?? this.rng.float() < 0.5;
    o.now = this.now;
    const ph = this.physics;
    o.world = ph?.staticWorld ?? null;
    o.mask = ph?.MASK.WORLD ?? 0xffff;
    if (opts.noFallback && !o.world) return false;
    const ok = this.decals.add(o);
    if (ok) this.stats.decals++;
    return ok;
  }

  /** Soot ring under an explosion. */
  scorch(x: number, y: number, z: number, radius: number): void {
    const ph = this.physics;
    this._tmpA.set(x, y + 0.4, z);
    this._tmpB.set(0, -1, 0);
    let px = x;
    let py = y;
    let pz = z;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (ph?.raycast) {
      const hit = ph.raycast(this._tmpA, this._tmpB, radius * 1.5 + 1, ph.MASK.WORLD);
      if (hit.hit) {
        px = hit.point.x;
        py = hit.point.y;
        pz = hit.point.z;
        nx = hit.normal.x;
        ny = hit.normal.y;
        nz = hit.normal.z;
      }
    }
    this._tmpA.set(px, py, pz);
    this._tmpB.set(nx, ny, nz);
    this.addDecal(this._tmpA, this._tmpB, {
      tile: D.SCORCH,
      size: radius * 1.05,
      life: 120,
      fade: 0.55,
      opacity: 0.9,
      maxAngle: 80,
      depth: radius * 0.35,
    });
  }

  /** Blood on whatever is behind the body we just hit. */
  bloodSpatterBehind(point: THREE.Vector3Like, incident: THREE.Vector3Like): void {
    const ph = this.physics;
    if (!ph?.raycast) return;
    this._tmpA.copy(point);
    this._tmpB.copy(incident);
    const hit = ph.raycast(this._tmpA, this._tmpB, 2.6, ph.MASK.WORLD);
    if (!hit.hit) return;
    this.addDecal(hit.point, hit.normal, {
      tile: this.rng.float() < 0.5 ? D.BLOOD_A : D.BLOOD_B,
      size: this.rng.range(0.32, 0.62),
      life: 90,
      fade: 0.8,
      opacity: this.rng.range(0.7, 1),
      maxAngle: 70,
    });
  }

  /** World-space sun direction for recipe-level cluster self-shadowing: sub-puffs
   * thrown away from the light start darker. Per-sprite lighting alone gives every
   * sub-puff the same treatment. Falls back to up until sky is available.
   */
  sunWorld(): { x: number; y: number; z: number } {
    const d = this.render?.sunDir;
    const o = this._sunW;
    if (d) {
      o.x = d.x;
      o.y = d.y;
      o.z = d.z;
    }
    return o;
  }

  /** Refraction sprite (hot gas, shimmer). */
  haze(
    x: number,
    y: number,
    z: number,
    radius: number,
    grow: number,
    life: number,
    strength: number,
    tile = P.SMOKE_A
  ): void {
    this.hazeSys.emit(this.now, x, y, z, radius, grow, life, strength, tile, this.rng.float());
  }

  /** Expanding shockwave ring in the refraction buffer. */
  hazeRing(
    x: number,
    y: number,
    z: number,
    radius: number,
    grow: number,
    life: number,
    strength: number
  ): void {
    this.hazeSys.emit(this.now, x, y, z, radius, grow, life, strength, P.RING, this.rng.float());
  }

  addSmokeColumn(x: number, y: number, z: number, o: object): void {
    this.ambience.addColumn(x, y, z, o);
  }

  audioPing(x: number, y: number, z: number, gain: number): void {
    const a = this._audio ?? (this._audio = this.ctx.peek('audio'));
    if (!a) return;
    this._tmpA.set(x, y, z);
    a.playShell(this._tmpA, gain);
  }

  onActorDeath(e: FxEventMap['actor:death']): void {
    this.now = this.ctx.time.elapsed;
    const rng = this.rng;
    // a heavier burst of mist than a body shot, plus spatter on the ground
    for (let i = 0; i < Math.round(8 * this.pScale) + 3; i++) {
      cone(V, rng, 0, 1, 0, 1.4, 0.7);
      const s = resetSpawn();
      setSpawnPosition(s, e.point.x, e.point.y, e.point.z);
      s.vx = V.x * rng.range(0.6, 2.4);
      s.vy = V.y * rng.range(0.4, 1.6);
      s.vz = V.z * rng.range(0.6, 2.4);
      s.tile = i % 2 ? P.MIST : P.SMOKE_A;
      s.size0 = rng.range(0.05, 0.1);
      s.size1 = rng.range(0.2, 0.4);
      s.sizeCurve = 0.5;
      s.life = rng.range(0.4, 0.8);
      s.drag = 5;
      s.gravity = -3.5;
      s.rot = rng.float() * 6.283;
      setSpawnColorRamp(s, 0.3, 0.03, 0.026, 0.15, 0.015, 0.013);
      s.alpha = rng.range(0.4, 0.75);
      s.alphaCurve = 1.5;
      s.soft = 0.2;
      s.seed = rng.float();
      this.emitLit(s);
    }
    const ph = this.physics;
    if (ph?.groundHeight) {
      const gy = ph.groundHeight(e.point.x, e.point.z, e.point.y + 1);
      if (Number.isFinite(gy)) {
        this._tmpA.set(e.point.x, gy, e.point.z);
        this._tmpB.set(0, 1, 0);
        this.addDecal(this._tmpA, this._tmpB, {
          tile: this.rng.float() < 0.5 ? D.BLOOD_A : D.BLOOD_B,
          size: this.rng.range(0.5, 0.9),
          life: 120,
          fade: 0.85,
          maxAngle: 80,
        });
      }
    }
  }

  onLand(e: FxEventMap['player:land']): void {
    const v = Math.abs(e.velocity);
    if (v < 3.2) return;
    this.now = this.ctx.time.elapsed;
    const rng = this.rng;
    const cam = this.ctx.camera;
    const ph = this.physics;
    const x = cam.position.x;
    const z = cam.position.z;
    let y = cam.position.y - UNITS.playerHeight + UNITS.eyeOffset;
    if (ph?.groundHeight) {
      const gy = ph.groundHeight(x, z, cam.position.y + 1);
      if (Number.isFinite(gy)) y = gy;
    }
    const strength = clamp((v - 3) / 7, 0.2, 1.3);
    for (let i = 0; i < Math.round(7 * this.pScale * strength) + 2; i++) {
      const a = rng.float() * 6.283;
      const sp = rng.range(0.7, 2.4) * strength;
      const s = resetSpawn();
      setSpawnPosition(s, x + Math.cos(a) * 0.22, y + 0.03, z + Math.sin(a) * 0.22);
      setSpawnVelocity(s, Math.cos(a) * sp, rng.range(0.1, 0.6), Math.sin(a) * sp);
      s.tile = P.DUST;
      s.size0 = rng.range(0.05, 0.1);
      s.size1 = rng.range(0.3, 0.55);
      s.sizeCurve = 0.45;
      s.life = rng.range(0.5, 1.0);
      s.drag = 3.2;
      s.gravity = -0.6;
      s.rot = rng.float() * 6.283;
      s.spin = rng.signed() * 1.2;
      setSpawnColorRamp(s, 0.48, 0.44, 0.39, 0.4, 0.37, 0.33);
      s.alpha = rng.range(0.25, 0.5) * strength;
      s.alphaCurve = 1.6;
      s.soft = 0.3;
      s.turb = 0.05;
      s.turbFreq = 2;
      s.seed = rng.float();
      this.emitLit(s);
    }
  }

  onFootstep(e: FxEventMap['player:footstep']): void {
    if (!e.running) return;
    if (this.rng.float() > 0.55) return;
    this.now = this.ctx.time.elapsed;
    const rng = this.rng;
    const s = resetSpawn();
    s.x = e.position.x + rng.signed() * 0.08;
    s.y = e.position.y + 0.02;
    s.z = e.position.z + rng.signed() * 0.08;
    s.vy = rng.range(0.1, 0.35);
    s.vx = rng.signed() * 0.3;
    s.vz = rng.signed() * 0.3;
    s.tile = P.DUST;
    s.size0 = 0.04;
    s.size1 = rng.range(0.18, 0.32);
    s.sizeCurve = 0.45;
    s.life = rng.range(0.4, 0.75);
    s.drag = 3.4;
    s.gravity = -0.5;
    s.rot = rng.float() * 6.283;
    setSpawnColorRamp(s, 0.46, 0.42, 0.37, 0.4, 0.36, 0.32);
    s.alpha = rng.range(0.1, 0.22);
    s.alphaCurve = 1.7;
    s.soft = 0.25;
    s.seed = rng.float();
    this.emitLit(s);
  }

  update(dt: number, ctx: FxContext): void {
    this.now = ctx.time.elapsed;
    this._syncLighting(ctx);
    this.lights.update(dt);
    this.viewLights?.update(dt);
    this._captureStage?.tick(dt);
    this.ambience.sunFactor = this._sunFactor;
    this.ambience.update(dt, this.now, ctx.camera);
  }

  lateUpdate(dt: number, ctx: FxContext): void {
    this.now = ctx.time.elapsed;
    this.shells.update(dt);
    const depth = this.render?.depthTexture ?? null;
    for (const l of this.layers) {
      l.setDepth(depth);
      l.uniforms.uSoftEnable.value.x = depth ? 1 : 0;
      l.flush(this.now);
    }
    if (this._viewAttached) {
      this.viewAdd.flush(this.now);
      this.viewLit.flush(this.now);
    }
    this.decals.flush(this.now);
    this.hazeSys.update(this.now, depth, ctx.camera);
    this.stats.live = this.add.spawned + this.lit.spawned;
  }

  _syncLighting(ctx: FxContext): void {
    const r = this.render;
    const cam = ctx.camera;
    // Sun direction and colour come from whatever light the renderer decided is
    // the sun, so smoke is lit by the same key as the world.
    // Render-owned light proxies synchronize at draw time. FX updates earlier:
    // read the authored key now, not the previous draw's intensity (which would
    // change emitted mote data during clock changes and capture setup).
    const sun = ctx.peek('sky')?.keyLight ?? r?.activeSun;
    if (r?.sunDir) {
      this._sunView.copy(r.sunDir).transformDirection(cam.matrixWorldInverse).normalize();
    }
    let sunI = 4.3;
    if (sun) {
      sunI = sun.intensity;
      this._sunCol.set(sun.color.r * sunI, sun.color.g * sunI, sun.color.b * sunI);
    }
    this._sunFactor = clamp(sunI / 4.3, 0, 1.6);

    // Clear-sky irradiance is roughly a fifth of direct sun, blue above and
    // bounced-warm below.
    const a = clamp(sunI * 0.22, 0.02, 3.0);
    this._ambTop.set(a * 0.78, a * 0.92, a * 1.25);
    this._ambBot.set(a * 0.5, a * 0.44, a * 0.38);
    this._upView.set(0, 1, 0).transformDirection(cam.matrixWorldInverse).normalize();

    const fog = ctx.scene.fog;
    if (fog) {
      this._fog.set(
        fog.color.r,
        fog.color.g,
        fog.color.b,
        fog instanceof THREE.FogExp2 ? fog.density : 1 / Math.max(1, fog.far)
      );
    } else {
      this._fog.w = 0;
    }

    for (const l of this.layers) this._pushLighting(l);
    if (this._viewAttached) {
      // The viewmodel camera has its own basis; recompute against it.
      const vcam = this.ctx.viewCamera;
      this._pushLighting(this.viewAdd);
      this._pushLighting(this.viewLit);
      if (r?.sunDir) {
        this.viewLit.uniforms.uSunDir.value
          .copy(r.sunDir)
          .transformDirection(vcam.matrixWorldInverse)
          .normalize();
        this.viewAdd.uniforms.uSunDir.value.copy(this.viewLit.uniforms.uSunDir.value);
      }
      this.viewLit.uniforms.uUpView.value
        .set(0, 1, 0)
        .transformDirection(vcam.matrixWorldInverse)
        .normalize();
    }
  }

  _pushLighting(l: ParticleLayer): void {
    l.uniforms.uSunDir.value.copy(this._sunView);
    l.uniforms.uSunCol.value.copy(this._sunCol);
    l.uniforms.uAmbTop.value.copy(this._ambTop);
    l.uniforms.uAmbBot.value.copy(this._ambBot);
    l.uniforms.uUpView.value.copy(this._upView);
    l.uniforms.uFog.value.copy(this._fog);
  }

  // Engine teardown disposes every system, even one whose init never ran or failed.
  /* oxlint-disable typescript/no-unnecessary-condition */
  dispose(): void {
    for (const off of this._off ?? []) off();
    this._off = [];
    for (const l of [this.lit, this.add, this.motes, this.viewAdd, this.viewLit]) {
      l.mesh.parent?.remove(l.mesh);
      l.dispose();
    }
    this.decals.mesh.parent?.remove(this.decals.mesh);
    this.decals.dispose();
    if (this.shells) {
      this.shells.mesh.parent?.remove(this.shells.mesh);
      this.shells.hullMesh.parent?.remove(this.shells.hullMesh);
      this.shells.dispose();
    }
    this.hazeSys.dispose();
    this.lights.dispose();
    this.viewLights?.dispose();
    this.viewLights = null;
    this._atlas.texture.dispose();
    this._decalAtlas.albedo.dispose();
    this._decalAtlas.normal.dispose();
    this._decalAtlas.orm.dispose();
    disposeQuadSource();
  }
  /* oxlint-enable typescript/no-unnecessary-condition */
}

const clampI = (v: number, a: number, b: number): number => Math.round(clamp(v, a, b));
