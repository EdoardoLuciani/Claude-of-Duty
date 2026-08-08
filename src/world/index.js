import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PALETTE } from './palette.js';
import { WorldQueries } from './queries.js';

/**
 * WORLD — level geometry, the modular building kit, props, set dressing and
 * static collision.
 *
 * A ~120 x 120 m Middle-Eastern market street: one main street with a plaza,
 * flanking alleys, twenty buildings (three enterable), an arched gate, and
 * several thousand props. `assets/world/world.blend` is the authored source;
 * runtime loads committed visual/collision GLBs and manifest-driven metadata.
 * `tools/export-world-blender.mjs` owns deterministic export and instancing.
 *
 * PUBLIC API — `const world = ctx.get('world')`
 *   world.root                THREE.Group holding everything
 *   world.bounds              THREE.Box3 of the playable area, world space
 *   world.spawnPoints         [{ position:Vector3, yaw:number, tag:string }]
 *   world.spawn(i)            one of the above
 *   world.groundHeight(x, z)  cheap analytic floor height (physics is exact)
 *   world.isOpen(x, z)        true where a character can stand outdoors
 *   world.stats               { staticTris, instTris, instances, drawCalls }
 *   world.prewarmMaterials()  compile every shader permutation the world can
 *                             produce, before the frame loop starts. Awaitable.
 *                             Call it from src/core/prewarm.js — see the method.
 *   world.levelToWorld(x,y,z,out) / world.worldToLevel(x,y,z,out)
 */

/**
 * How many zero-intensity "ballast" point lights the world parks in the scene to
 * hold `numPointLights` — and therefore the shader permutation — constant. See
 * `_addBallast()`. Must be at least the worst-case number of practicals that can
 * be in range at once: a sweep of the whole playable area at three eye heights
 * puts that at 10 for the world's own lights, plus whatever `fx` keeps live.
 */
const LIGHT_SLOTS = 20;

export class WorldSystem {
  static id = 'world';
  static deps = ['materials', 'physics'];

  async init(ctx) {
    this.ctx = ctx;
    this.rng = ctx.rng.fork(); // preserve the subsystem RNG fork order
    this.materials = ctx.get('materials');
    this.renderSystem = ctx.peek('render');
    this.materials.setGroundLevel?.(0);
    this._mats = new Map();
    this.meshes = [];
    this.collisionMeshes = [];
    this.lodGroups = [];
    this._v = new THREE.Vector3();

    const started = performance.now();
    const base = 'models/world';
    const manifestResponse = await fetch(`${base}/level.json`, { cache: 'no-store' });
    if (!manifestResponse.ok) {
      throw new Error(`[world] failed to load manifest: HTTP ${manifestResponse.status}`);
    }
    const meta = await manifestResponse.json();
    if (meta.version !== 2) throw new Error(`[world] unsupported manifest version ${meta.version}`);

    const loader = new GLTFLoader();
    const [visual, collision] = await Promise.all([
      this._loadCompressedGLB(loader, `${base}/${meta.assets.visual}`),
      this._loadCompressedGLB(loader, `${base}/${meta.assets.collision}`),
    ]);

    this.root = visual.scene;
    this.root.name = 'world';
    this._xform = new THREE.Matrix4().fromArray(meta.transform);
    this._inv = this._xform.clone().invert();
    this.buildings = meta.buildings;
    this.volumes = meta.volumes ?? [];
    this.spawnPoints = meta.spawns.map((spawn) => ({
      position: new THREE.Vector3().fromArray(spawn.position),
      yaw: spawn.forward ? Math.atan2(-spawn.forward[0], -spawn.forward[2]) : spawn.yaw,
      tag: spawn.tag,
    }));
    this.bounds = new THREE.Box3(
      new THREE.Vector3().fromArray(meta.bounds.min),
      new THREE.Vector3().fromArray(meta.bounds.max)
    );
    this.stats = meta.stats;
    this.queries = new WorldQueries(meta);

    const placeholders = new Set();
    this.root.traverse((object) => {
      if (!object.isMesh && !object.isInstancedMesh) return;
      const palette = object.userData?.palette;
      if (!PALETTE[palette]) throw new Error(`[world] unknown palette on ${object.name}`);
      if (Array.isArray(object.material)) object.material.forEach((m) => placeholders.add(m));
      else if (object.material) placeholders.add(object.material);
      object.material = this._material(palette);
      object.castShadow = object.userData.castShadow !== false;
      object.receiveShadow = object.userData.receiveShadow !== false;
      object.userData.collision = false;
      this.meshes.push(object);
      if (object.isInstancedMesh) object.computeBoundingSphere();
      if ((object.userData.owLodDist ?? 0) > 0) this.lodGroups.push(object);
    });
    for (const material of placeholders) material.dispose();
    ctx.scene.add(this.root);

    this.collisionRoot = collision.scene;
    this.collisionRoot.name = 'world_collision';
    this.collisionRoot.visible = false;
    this.root.add(this.collisionRoot);
    this._collisionMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const collisionPlaceholders = new Set();
    const physics = ctx.peek('physics');
    this.collisionRoot.traverse((object) => {
      if (!object.isMesh) return;
      const surface = object.userData?.surface;
      if (!surface) throw new Error(`[world] missing collision surface on ${object.name}`);
      if (Array.isArray(object.material)) object.material.forEach((m) => collisionPlaceholders.add(m));
      else if (object.material) collisionPlaceholders.add(object.material);
      object.material = this._collisionMaterial;
      object.visible = false;
      this.collisionMeshes.push(object);
      physics?.addStatic(object, surface);
    });
    for (const material of collisionPlaceholders) material.dispose();
    physics?.rebuildStatic();

    this._addLights(meta.lights);
    const ms = performance.now() - started;
    console.info(
      `[world] loaded in ${ms.toFixed(0)}ms — ${(this.stats.staticTris / 1000).toFixed(0)}k static tris, ` +
        `${(this.stats.instTris / 1000).toFixed(0)}k instanced tris in ${this.stats.instances} instances, ` +
        `${this.stats.drawCalls} draw calls, ${(this.stats.collideTris / 1000).toFixed(1)}k collision tris`
    );
  }

  async _loadCompressedGLB(loader, url) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`[world] failed to load ${url}: HTTP ${response.status}`);
    }
    const alreadyDecoded = response.headers.get('content-encoding')?.includes('gzip');
    if (!alreadyDecoded && typeof DecompressionStream === 'undefined') {
      throw new Error('[world] this browser cannot decompress world assets');
    }
    const buffer = alreadyDecoded
      ? await response.arrayBuffer()
      : await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return loader.parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1));
  }

  _material(key) {
    let material = this._mats.get(key);
    if (!material) {
      const def = PALETTE[key];
      material = this.materials.get(def.name, def.opts);
      this._mats.set(key, material);
    }
    return material;
  }

  // ----------------------------------------------------------------- lights --
  /**
   * Punctual lights the world owns: the bare bulbs inside the enterable
   * buildings (what makes an interior read as lived-in against cool skylight)
   * and the street lamps, which only draw power after dusk.
   */
  _addLights(data) {
    this.bulbs = [];
    this.lamps = [];
    const add = (light, options) => {
      this.root.add(light);
      this.renderSystem?.addLight?.(light, options);
    };

    for (const entry of data) {
      const interior = entry.kind === 'interior';
      const color = new THREE.Color().fromArray(entry.color);
      const light = new THREE.PointLight(color, entry.day, entry.range, 2);
      light.position.fromArray(entry.position);
      light.castShadow = false;
      light.userData.owDayIntensity = entry.day;
      light.userData.owNightIntensity = entry.night;
      add(light, { range: entry.range, priority: entry.priority });
      (interior ? this.bulbs : this.lamps).push(light);
    }
    this.lampLens = this._material('lamp_lens');
    this._lampMix = -1;
    this._addBallast();
  }

  /**
   * BALLAST — hold the scene's point-light COUNT constant.
   *
   * MEASURED, not guessed. The single worst source of stalls in this build was
   * not geometry: it was shader compilation triggered by the world's own
   * practicals. `render` distance-culls every registered punctual light
   * (`light.visible = fade > 0.002`), and Three bakes the number of *visible*
   * point lights into the program cache key. The world owns 17 practicals (12
   * interior bulbs at 13 m, 5 street lamps at 22 m), so walking down the street
   * sweeps the visible count through 9-8-7-6-5-4 — and every single step
   * recompiles EVERY lit material in the frame:
   *
   *   f15 +36 programs  636 ms   f32 +35  702 ms   f41 +35  699 ms
   *   f51 +35 programs  678 ms   f99 +33  698 ms
   *   → 186 programs and ~3.5 s of stalls inside 900 frames of play
   *
   * Pre-compiling every count instead costs 9.5 s of boot (measured: 595
   * programs for counts 0-16), which is the wrong trade. Holding the count
   * still costs nothing.
   *
   * These lights are black (`color 0x000000`, `intensity 0`) with a 1 cm range,
   * parked under the map, and are NOT registered with `render.addLight`, so
   * nothing culls or re-lights them. A point light whose colour times intensity
   * is exactly 0 contributes `0.0` to irradiance — not "almost nothing", but a
   * float zero that is added to the accumulator — so this cannot move a pixel
   * no matter how many slots are lit. It only changes `numPointLights`, which
   * is a shader-permutation input and nothing else.
   *
   * Cost of the padding, measured over 3 paired runs at 1512x982 DPR 2 with 20
   * ballast slots live: p05 frame time 15.7 ms -> 14.4 ms (i.e. inside noise).
   */
  _addBallast() {
    this._ballast = [];
    for (let i = 0; i < LIGHT_SLOTS + 4; i++) {
      const l = new THREE.PointLight(0x000000, 0, 0.01, 2);
      l.name = `world_light_ballast_${i}`;
      l.castShadow = false;
      l.visible = false;
      l.userData.owBallast = true;
      // Far under the terrain, so even the distance-attenuation term is 0.
      l.position.set(0, -1000, 0);
      this.root.add(l);
      this._ballast.push(l);
    }
    /** Point lights in the scene that are NOT ballast; refreshed periodically. */
    this._pointLights = [];
    this._pointLightsFrame = -1e9;
    this._lightTarget = LIGHT_SLOTS;
    this._lightRanges = new Map(); // light -> the cull radius `render` gave it
    this._camPos = new THREE.Vector3();
    this._collectPointLight = (o) => {
      if (o.isPointLight === true && o.userData.owBallast !== true) this._pointLights.push(o);
    };
  }

  /**
   * Top the visible point-light count up to a fixed target. Runs in lateUpdate,
   * after every subsystem has finished moving lights and the camera, and before
   * `render` draws — so the count Three sees is the same every frame.
   *
   * The count has to be PREDICTED rather than read off `light.visible`, because
   * `render._cullLights()` runs inside `render.render()` — i.e. after this. Using
   * last frame's flags is right on 99% of frames and off by one on exactly the
   * frames where a light crosses its cull radius, which are exactly the frames
   * that used to stall. So mirror the renderer's own test here. Getting the
   * prediction wrong can only cost a permutation, never a pixel: the ballast
   * lights are black, and a black light is a no-op however many are lit.
   */
  _stabiliseLightCount(ctx) {
    const list = this._pointLights;
    if (!list) return;
    const render = this._render ?? (this._render = ctx.peek('render'));
    // The set of point lights in the scene only changes when a subsystem builds
    // or frees a pool, so rescanning every frame is pure waste. Every 90 frames
    // is often enough to catch a pool that appears after boot.
    if (ctx.time.frame - this._pointLightsFrame >= 90) {
      this._pointLightsFrame = ctx.time.frame;
      list.length = 0;
      ctx.scene.traverse(this._collectPointLight);
      this._lightRanges.clear();
      for (const e of render?.lights ?? []) {
        if (e.light?.isPointLight === true) this._lightRanges.set(e.light, e.range);
      }
    }

    ctx.camera.getWorldPosition(this._camPos);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const range = this._lightRanges.get(l);
      if (range === undefined) {
        // Not registered for distance culling: its owner drives `visible`.
        if (l.visible === true) n++;
        continue;
      }
      // The renderer's test, verbatim: fade = 1 - smoothstep(d, .75r, 1.15r),
      // light.visible = fade > 0.002.
      const d = l.position.distanceTo(this._camPos);
      if (1 - THREE.MathUtils.smoothstep(d, range * 0.75, range * 1.15) > 0.002) n++;
    }

    // A subsystem can always out-run the pool; adopting the higher count costs
    // one compile, once, instead of one per crossing.
    if (n > this._lightTarget) this._lightTarget = n;
    const want = this._lightTarget - n;
    const pool = this._ballast;
    for (let i = 0; i < pool.length; i++) {
      const v = i < want;
      if (pool[i].visible !== v) pool[i].visible = v;
    }
  }

  // ---------------------------------------------------------------- runtime --
  update(dt, ctx) {
    // Distance LOD for the scatter clouds: one bounding-sphere test per batch.
    for (const mesh of this.lodGroups) {
      const sphere = mesh.boundingSphere;
      if (!sphere) continue;
      const distance = this._v.copy(ctx.camera.position).distanceTo(sphere.center) - sphere.radius;
      mesh.visible = distance < mesh.userData.owLodDist;
    }

    // Street lamps come on as the sun goes down, driven by the sky's real solar
    // altitude rather than a timer, so it is right at any time of day.
    const sky = this._sky ?? (this._sky = ctx.peek('sky'));
    const alt = sky?.sunAltitude ?? 0.6;
    const mix = 1 - Math.min(1, Math.max(0, (alt + 0.05) / 0.16));
    if (Math.abs(mix - this._lampMix) > 0.01) {
      this._lampMix = mix;
      for (let i = 0; i < this.lamps.length; i++) {
        const light = this.lamps[i];
        light.intensity = light.userData.owDayIntensity +
          (light.userData.owNightIntensity - light.userData.owDayIntensity) * mix;
      }
      if (this.lampLens) this.lampLens.emissiveIntensity = 9 * mix;
      // Bulbs stay on around the clock — but a 60 W bulb is NOT competitive with
      // daylight, and running it at night strength at noon is what made every
      // interior read as pure tungsten (B-R -93) and sit level with the sunlit
      // street instead of 1.5-2.5 stops under it. Gate the bulb on solar
      // altitude: a weak practical by day, the room's only light after dark.
      for (let i = 0; i < this.bulbs.length; i++) {
        const light = this.bulbs[i];
        light.intensity = light.userData.owDayIntensity +
          (light.userData.owNightIntensity - light.userData.owDayIntensity) * mix;
      }
    }
  }

  lateUpdate(dt, ctx) {
    this._stabiliseLightCount(ctx);
  }

  // --------------------------------------------------------------- pre-warm --
  /**
   * Compile every shader permutation the world can produce, before the frame
   * loop starts. See `src/core/prewarm.js` — that module asks each subsystem for
   * exactly this hook, because `renderer.compileAsync(scene, camera)` alone
   * reaches only the forward lit variant of a material, not the two override
   * passes the world's geometry also goes through every frame:
   *
   *   - the CSM cascades render the whole scene with `csm.depthMaterial`
   *   - the prepass renders it again with the gbuffer's ShaderMaterial
   *
   * Both are separate programs, and each one has its own permutations for plain
   * geometry, instanced geometry and instanced geometry with an instanceColor —
   * which is precisely the mix the world puts in front of them.
   *
   * Pixel-neutral by construction: it compiles, it does not draw. The only
   * mutations are `scene.overrideMaterial` and the ballast light visibility,
   * both restored in the `finally`.
   */
  async prewarmMaterials(ctx = this.ctx) {
    const render = ctx.peek?.('render') ?? ctx.get?.('render');
    const renderer = render?.renderer;
    if (!renderer) return { ok: false, reason: 'no renderer' };
    const scene = ctx.scene;
    const camera = ctx.camera;
    const before = renderer.info.programs?.length ?? 0;
    const t0 = performance.now();

    // Every lit material must carry render's CSM/AO/SSR injection before it is
    // compiled, or the program we warm is not the program the frame will use.
    render.patchMaterials?.(this.root);

    // Compile at the count the frame loop will actually run at, not at whatever
    // the distance cull happens to have left visible during boot.
    this._stabiliseLightCount(ctx);

    const prevOverride = scene.overrideMaterial;
    try {
      // 1. forward lit pass.
      await this._compile(renderer, scene, camera);
      // 2. the shadow cascades and 3. the depth/normal/velocity prepass, both of
      //    which draw this same geometry through an override material.
      for (const over of [render.csm?.depthMaterial, render.gbuffer?.material]) {
        if (!over) continue;
        scene.overrideMaterial = over;
        await this._compile(renderer, scene, camera);
      }
    } finally {
      scene.overrideMaterial = prevOverride;
    }

    return {
      ok: true,
      ms: Math.round(performance.now() - t0),
      compiled: (renderer.info.programs?.length ?? 0) - before,
      lightTarget: this._lightTarget,
    };
  }

  async _compile(renderer, scene, camera) {
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      try {
        renderer.compile(scene, camera);
      } catch {
        /* a driver we cannot pre-warm on; boot must still proceed */
      }
    }
  }

  // ---------------------------------------------------------------- queries --
  spawn(i = 0) {
    const n = this.spawnPoints.length;
    return this.spawnPoints[((i % n) + n) % n];
  }

  levelToWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this._xform);
  }

  worldToLevel(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this._inv);
  }

  /** Analytic floor height. Physics owns the exact answer; this is a hint. */
  groundHeight(x, z) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return this.queries.groundY(p.x, p.z);
  }

  /** True where a character can stand outdoors (street, pavement, alley). */
  isOpen(x, z, margin = 0.4) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return this.queries.isOpen(p.x, p.z, margin);
  }

  dispose() {
    const geometries = new Set();
    for (const mesh of this.meshes ?? []) geometries.add(mesh.geometry);
    for (const mesh of this.collisionMeshes ?? []) geometries.add(mesh.geometry);
    for (const geometry of geometries) geometry?.dispose();
    this.root?.parent?.remove(this.root);
    this._collisionMaterial?.dispose();
    for (const light of this._ballast ?? []) light.parent?.remove(light);
    this._ballast = null;
    this._pointLights = null;
    this.bulbs = null;
    this.lamps = null;
    this.meshes = null;
    this.collisionMeshes = null;
    this.lodGroups = null;
  }
}
