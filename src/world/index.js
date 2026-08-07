import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PALETTE } from './palette.js';
import { groundY, isOpen } from './queries.js';

/**
 * WORLD — level geometry, the modular building kit, props, set dressing and
 * static collision.
 *
 * A ~120 x 120 m Middle-Eastern market street: one main street with a plaza,
 * flanking alleys, eighteen buildings (three of them enterable and furnished
 * across multiple floors), an arched gate closing the vista, and several
 * thousand props. Runtime loads visual and collision GLBs baked from the same
 * builders by tools/export-world.mjs; procedural construction is offline-only.
 *
 * HOW IT FITS TOGETHER
 *   layout.js     the map: footprints, facade programmes, set-piece positions
 *   util.js       geometry toolkit (chamfered boxes, wall panels with real
 *                 holes, cloth grids, catenary tubes, rocks) + vertex masks
 *   kit.js        the modular building kit (facades, windows, doors, balconies,
 *                 stairs, awnings, parapets, drainpipes, damage)
 *   buildings.js  assembles a building from a footprint + a facade programme
 *   interiors.js  furnishes rooms so an interior screenshot is worth taking
 *   props.js      the instanced prop library
 *   dressing.js   places the hundreds of props, cables, laundry and debris
 *   ground.js     terrain, road camber, kerbs, pavement slabs, sand drifts
 *   builder.js    offline Assembler: merges statics, batches instances, authors
 *                 collision proxies, bakes the level->world transform
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
    // Preserve the historical engine RNG fork order even though the baked
    // world consumes no browser-side randomness. Later subsystem streams stay
    // byte-identical to captures made before the asset migration.
    this.rng = ctx.rng.fork();
    this.materials = ctx.get('materials');
    this.renderSystem = ctx.peek('render');
    this.materials.setGroundLevel?.(0);
    this._mats = new Map();
    this.meshes = [];
    this.lodGroups = [];
    this._v = new THREE.Vector3();

    const t0 = performance.now();
    await this._initGLB(ctx);

    this._inv = new THREE.Matrix4().copy(this._xform).invert();
    this._addLights(this._lightData);

    const ms = performance.now() - t0;
    this.mode = 'glb';
    this.initMs = ms;
    const s = this.stats;
    console.info(
      `[world] loaded GLB in ${ms.toFixed(0)}ms — ` +
        `${(s.staticTris / 1000).toFixed(0)}k static tris, ${(s.instTris / 1000).toFixed(0)}k instanced tris ` +
        `in ${s.instances} instances, ${s.drawCalls} draw calls, ${(s.collideTris / 1000).toFixed(1)}k collision tris`
    );
  }

  async _initGLB(ctx) {
    const loader = new GLTFLoader();
    const base = 'models/world';
    const [visual, collision, response] = await Promise.all([
      this._loadGLB(loader, `${base}/level-visual.glb`),
      this._loadGLB(loader, `${base}/level-collision.glb`),
      fetch(`${base}/level.json`),
    ]);
    if (!response.ok) throw new Error(`[world] failed to load manifest: HTTP ${response.status}`);
    const meta = await response.json();
    if (meta.version !== 2) throw new Error(`[world] unsupported manifest version ${meta.version}`);

    this.root = visual.scene;
    this.root.name = 'world';
    this._xform = new THREE.Matrix4().fromArray(meta.transform.matrix);
    this.buildings = meta.buildings;
    this.spawnPoints = meta.spawns.map((s) => ({
      position: new THREE.Vector3().fromArray(s.position), yaw: s.yaw, tag: s.tag,
    }));
    this.bounds = new THREE.Box3(
      new THREE.Vector3().fromArray(meta.bounds.min),
      new THREE.Vector3().fromArray(meta.bounds.max)
    );
    this.stats = meta.stats;
    this._lightData = meta.lights;
    this._queryData = {
      buildings: this.buildings,
      street: meta.queries?.street,
      alleys: meta.queries?.alleys,
    };
    if (!this._queryData.street || !Array.isArray(this._queryData.alleys)) {
      throw new Error('[world] manifest query metadata missing');
    }

    const placeholders = new Set();
    this.root.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (!o.userData?.palette || !PALETTE[o.userData.palette]) {
        throw new Error(`[world] ${o.name}: missing or unknown palette metadata`);
      }
      if (Array.isArray(o.material)) for (const m of o.material) placeholders.add(m);
      else if (o.material) placeholders.add(o.material);
      const authoredNormal = o.geometry.getAttribute('_ow_normal');
      if (authoredNormal) {
        o.geometry.setAttribute('normal', authoredNormal);
        o.geometry.deleteAttribute('_ow_normal');
      }
      o.material = this._mat(o.userData.palette);
      o.castShadow = o.userData.castShadow !== false;
      o.receiveShadow = o.userData.receiveShadow !== false;
      o.userData.collision = false;
      this.meshes.push(o);
      if (o.isInstancedMesh) {
        const matrices = o.userData.owMatrices;
        if (Array.isArray(matrices) && matrices.length === o.count * 16) {
          o.instanceMatrix.array.set(matrices);
          o.instanceMatrix.needsUpdate = true;
          delete o.userData.owMatrices;
        }
        const b = o.userData.owBounds;
        if (Array.isArray(b) && b.length === 4) {
          o.boundingSphere = new THREE.Sphere(new THREE.Vector3(b[0], b[1], b[2]), b[3]);
          delete o.userData.owBounds;
        } else o.computeBoundingSphere();
      }
      if ((o.userData.owLodDist ?? 0) > 0) this.lodGroups.push(o);
    });
    for (const m of placeholders) m.dispose();
    ctx.scene.add(this.root);

    this.collisionRoot = collision.scene;
    this.collisionRoot.name = 'world_collision';
    this.collisionRoot.visible = false;
    this.root.add(this.collisionRoot);
    const physics = ctx.peek('physics');
    this.collisionMeshes = [];
    this._collisionMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const collisionPlaceholders = new Set();
    this.collisionRoot.traverse((o) => {
      if (!o.isMesh) return;
      const surface = o.userData?.surface;
      if (!surface) throw new Error(`[world] ${o.name}: collision surface metadata missing`);
      if (Array.isArray(o.material)) for (const m of o.material) collisionPlaceholders.add(m);
      else if (o.material) collisionPlaceholders.add(o.material);
      o.material = this._collisionMaterial;
      o.visible = false;
      this.collisionMeshes.push(o);
      physics?.addStatic(o, surface);
    });
    for (const m of collisionPlaceholders) m.dispose();
    physics?.rebuildStatic();
  }

  async _loadGLB(loader, rawUrl) {
    if (typeof DecompressionStream === 'undefined') return loader.loadAsync(rawUrl);
    const response = await fetch(`${rawUrl}.gz`);
    if (!response.ok || !response.body) {
      console.warn(`[world] compressed asset unavailable (${response.status}); loading raw GLB`);
      return loader.loadAsync(rawUrl);
    }
    // Servers such as Vite may attach Content-Encoding to an explicit .gz URL,
    // in which case fetch has already inflated the response body for us.
    const encoded = response.headers.get('content-encoding')?.includes('gzip');
    const buffer = encoded
      ? await response.arrayBuffer()
      : await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return loader.parseAsync(buffer, rawUrl.slice(0, rawUrl.lastIndexOf('/') + 1));
  }

  _mat(key) {
    let mat = this._mats.get(key);
    if (mat) return mat;
    const def = PALETTE[key];
    mat = this.materials.get(def.name, def.opts);
    this._mats.set(key, mat);
    return mat;
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
    const register = (light, opts) => {
      this.root.add(light);
      this.renderSystem?.addLight?.(light, opts);
    };

    for (const b of data?.interiors ?? []) {
      // A bare 60 W bulb in an unlit room: the only thing separating an interior
      // from a black hole, so it has to actually carry the room.
      const l = new THREE.PointLight(0xffc07a, 5, 13, 2);
      l.position.set(b.x, b.y, b.z).applyMatrix4(this._xform);
      l.castShadow = false;
      register(l, { range: 13, priority: 2 });
      this.bulbs.push(l);
    }

    for (const p of data?.lamps ?? []) {
      const l = new THREE.PointLight(0xffb765, 0, 22, 2);
      l.position.set(p.x, p.y - 0.12, p.z).applyMatrix4(this._xform);
      l.castShadow = false;
      register(l, { range: 22, priority: 3 });
      this.lamps.push(l);
    }
    this.lampLens = this._mat('lamp_lens');
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
    if (this.A) this.A.updateLod(ctx.camera);
    else {
      for (let i = 0; i < this.lodGroups.length; i++) {
        const mesh = this.lodGroups[i];
        const sphere = mesh.boundingSphere;
        if (!sphere) continue;
        const d = this._v.copy(ctx.camera.position).distanceTo(sphere.center) - sphere.radius;
        mesh.visible = d < mesh.userData.owLodDist;
      }
    }

    // Street lamps come on as the sun goes down, driven by the sky's real solar
    // altitude rather than a timer, so it is right at any time of day.
    const sky = this._sky ?? (this._sky = ctx.peek('sky'));
    const alt = sky?.sunAltitude ?? 0.6;
    const mix = 1 - Math.min(1, Math.max(0, (alt + 0.05) / 0.16));
    if (Math.abs(mix - this._lampMix) > 0.01) {
      this._lampMix = mix;
      for (let i = 0; i < this.lamps.length; i++) this.lamps[i].intensity = 14 * mix;
      if (this.lampLens) this.lampLens.emissiveIntensity = 9 * mix;
      // Bulbs stay on around the clock — but a 60 W bulb is NOT competitive with
      // daylight, and running it at night strength at noon is what made every
      // interior read as pure tungsten (B-R -93) and sit level with the sunlit
      // street instead of 1.5-2.5 stops under it. Gate the bulb on solar
      // altitude: a weak practical by day, the room's only light after dark.
      for (let i = 0; i < this.bulbs.length; i++) this.bulbs[i].intensity = 5 + 17 * mix;
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
    return groundY(this._queryData, p.x, p.z);
  }

  /** True where a character can stand outdoors (street, pavement, alley). */
  isOpen(x, z, margin = 0.4) {
    const p = this.worldToLevel(x, 0, z, this._v);
    return isOpen(this._queryData, p.x, p.z, margin);
  }

  dispose() {
    const geometries = new Set();
    for (const mesh of this.meshes ?? []) if (mesh.geometry) geometries.add(mesh.geometry);
    for (const mesh of this.collisionMeshes ?? []) if (mesh.geometry) geometries.add(mesh.geometry);
    for (const geometry of geometries) geometry.dispose();
    this.root?.parent?.remove(this.root);
    this._collisionMaterial?.dispose();
    this._collisionMaterial = null;
    for (const l of this._ballast ?? []) l.parent?.remove(l);
    this._ballast = null;
    this._pointLights = null;
    this.bulbs = null;
    this.lamps = null;
    this.meshes = null;
    this.collisionMeshes = null;
    this.lodGroups = null;
  }
}
