import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import { WorldQueries } from './queries.ts';
import { tickStreetlightOutage } from './lighting.js';

// The WebGL renderer applied this to room bulbs and street lamps after the
// world's day/night mix. Preserve that authored practical-to-sun ratio here;
// the WebGPU owner intentionally no longer culls or rewrites light identities.
const PRACTICAL_GAIN = 0.55;

/**
 * WORLD — level geometry, the modular building kit, props, set dressing and
 * static collision.
 *
 * A ~120 x 120 m Middle-Eastern market street: one main street with a plaza,
 * flanking alleys, twenty buildings (three enterable), an arched gate, and
 * several thousand props. `tools/worldgen/` is the authored source; runtime
 * loads committed visual/collision GLBs and manifest-driven metadata.
 * `tools/export-world.mjs` owns deterministic export and collision cooking.
 *
 * PUBLIC API — `const world = ctx.get('world')`
 *   world.setStreetlightPower(0..1) capture/debug power override
 *   world.root                THREE.Group holding everything
 *   world.bounds              THREE.Box3 of the playable area, world space
 *   world.spawnPoints         [{ position:Vector3, yaw:number, tag:string }]
 *   world.spawn(i)            one of the above
 *   world.groundHeight(x, z)  cheap analytic floor height (physics is exact)
 *   world.isOpen(x, z)        true where a character can stand outdoors
 *   world.stats               { staticTris, instTris, instances, drawCalls }
 *   world.levelToWorld(x,y,z,out) / world.worldToLevel(x,y,z,out)
 *   world.ladderAt(x,y,z)     authored ladder catch, world space, or null
 *   world.intelMarkers        [{ id, tag, x, y, z }] from WORLD/MARKERS/INTEL
 */

export class WorldSystem {
  static id = 'world';
  static deps = ['materials', 'physics', 'models'];

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
    const { meta, visual, collision } = await ctx.get('models').worldPrefetch;

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
    this.intelMarkers = (meta.WORLD?.MARKERS?.INTEL ?? []).map((marker) => ({
      id: marker.id,
      tag: marker.tag ?? marker.id,
      x: marker.position[0],
      y: marker.position[1],
      z: marker.position[2],
    }));

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
      object.matrixAutoUpdate = false; // GLB does not persist the assembler's flag
      object.userData.owStatic = true;
      // Cutout cards must stay out of the solid prepass/CSM overrides or they
      // write rectangular depth and GTAO outlines the intersecting quads.
      if (PALETTE[palette].surface === 'foliage') {
        object.userData.owNoPrepass = true;
        object.castShadow = false;
      }
      this.meshes.push(object);
      if (object.isInstancedMesh) object.computeBoundingSphere();
      if ((object.userData.owLodDist ?? 0) > 0) this.lodGroups.push(object);
    });
    for (const material of placeholders) material.dispose();
    this.root.matrixAutoUpdate = false;
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
      object.matrixAutoUpdate = false;
      this.collisionMeshes.push(object);
      physics?.addStatic(object, surface);
    });
    for (const material of collisionPlaceholders) material.dispose();
    physics?.rebuildStatic();

    this._addLights(meta.lights);
    this._outage = { elapsed: -1 };
    this._streetlightPower = 1;
    this._offRestart = ctx.events.on('game:restart', () => {
      this._outage.elapsed = -1;
      this.setStreetlightPower(1);
    });
    const ms = performance.now() - started;
    console.info(
      `[world] loaded in ${ms.toFixed(0)}ms — ${(this.stats.staticTris / 1000).toFixed(0)}k static tris, ` +
        `${(this.stats.instTris / 1000).toFixed(0)}k instanced tris in ${this.stats.instances} instances, ` +
        `${this.stats.drawCalls} draw calls, ${(this.stats.collideTris / 1000).toFixed(1)}k collision tris`
    );
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
    this._lampPower = -1;
    // Keep these same PointLight instances visible on WebGPU. TSL hashes light
    // IDs (not just the count): toggling the old black ballast or distance
    // culling practicals rebuilt every lit material during moving combat.
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

    const sky = this._sky ?? (this._sky = ctx.peek('sky'));
    if (!ctx.config.deterministic && dt > 0 && !ctx.peek('player')?.dead) {
      this._streetlightPower = tickStreetlightOutage(this._outage, dt, sky?.timeOfDay ?? 0);
    }
    this._updateLights(sky?.sunAltitude ?? 0.6);
  }

  /** Capture/debug control; automatic outages are disabled in captures. */
  setStreetlightPower(power) {
    this._streetlightPower = Math.max(0, Math.min(1, power));
    this._updateLights(this.ctx.peek('sky')?.sunAltitude ?? 0.6);
  }

  _updateLights(alt) {
    // Solar altitude turns lamps on at dusk; power only affects streetlights.
    const mix = 1 - Math.min(1, Math.max(0, (alt + 0.05) / 0.16));
    const mixChanged = Math.abs(mix - this._lampMix) > 0.01;
    if (mixChanged || this._lampPower !== this._streetlightPower) {
      this._lampPower = this._streetlightPower;
      for (let i = 0; i < this.lamps.length; i++) {
        const light = this.lamps[i];
        light.intensity = (light.userData.owDayIntensity +
          (light.userData.owNightIntensity - light.userData.owDayIntensity) * mix) * this._streetlightPower * PRACTICAL_GAIN;
      }
      if (this.lampLens) this.lampLens.emissiveIntensity = 9 * mix * this._streetlightPower;
    }
    if (mixChanged) {
      this._lampMix = mix;
      // Bulbs stay on around the clock — but a 60 W bulb is NOT competitive with
      // daylight, and running it at night strength at noon is what made every
      // interior read as pure tungsten (B-R -93) and sit level with the sunlit
      // street instead of 1.5-2.5 stops under it. Gate the bulb on solar
      // altitude: a weak practical by day, the room's only light after dark.
      for (let i = 0; i < this.bulbs.length; i++) {
        const light = this.bulbs[i];
        light.intensity = (light.userData.owDayIntensity +
          (light.userData.owNightIntensity - light.userData.owDayIntensity) * mix) * PRACTICAL_GAIN;
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

  /** World-space ladder catch containing this point, or null. */
  ladderAt(x, y, z) {
    return this.queries.ladderAt(x, y, z);
  }

  dispose() {
    this._offRestart?.();
    const geometries = new Set();
    for (const mesh of this.meshes ?? []) geometries.add(mesh.geometry);
    for (const mesh of this.collisionMeshes ?? []) geometries.add(mesh.geometry);
    for (const geometry of geometries) geometry?.dispose();
    this.root?.parent?.remove(this.root);
    this._collisionMaterial?.dispose();
    this.bulbs = null;
    this.lamps = null;
    this.meshes = null;
    this.collisionMeshes = null;
    this.lodGroups = null;
  }
}
