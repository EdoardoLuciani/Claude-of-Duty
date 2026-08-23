/**
 * NAVMESH — Recast/Detour multi-level pathfinding over the baked collision world.
 *
 * Built on top of the physics StaticWorld's baked triangle soup, so it needs no
 * separate mesh pass: `phys.staticWorld.pos` already holds every collision
 * triangle in world space with instances and the level transform applied, and
 * the sky/probe/particle junk already filtered out. We hand that identical soup
 * to Recast and wind up with a connected walkable mesh that can route across
 * floors and around lifts/stairs once the world has them (via off-mesh links in
 * a future pass).
 *
 * It is deliberately a *complement* to `NavGrid`, not a replacement:
 *   • `NavGrid` stays for `CoverMap` (cover needs the grid's per-cell
 *     `enclosure`/`flags`) and as a synchronous fallback.
 *   • This runs async and takes over pathfinding once ready; `requestPath`
 *     prefers it, and falls back to the grid if it isn't built yet or a query
 *     fails, so gameplay never blocks on it.
 *
 * PUBLIC API   — `ai.navmesh` (a NavMeshPathfinding, or null until built)
 *   navmesh.ready               bool — mesh built and queryable
 *   navmesh.findPath(from, to, out) -> int  (grid-compatible: writes into `out`,
 *                                           returns waypoint count, 0 = no path)
 *
 * Determinism: generation and query are pure functions of the baked soup, so the
 * same world always produces the same mesh and the same routes for the same
 * inputs. It is not seeded off `ctx.rng` (it needs no randomness), which is fine
 * — we never draw from the game RNG for navigation here.
 */

import * as THREE from 'three';
import { init, NavMesh, NavMeshQuery, QueryFilter, UnsignedCharArray } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';

/** Single source of truth for the navmesh build parameters (bake + runtime). */
export const NAVMESH_CONFIG = {
  cellSize: 0.6,
  cellHeight: 0.3,
  agentHeight: 1.78,
  agentRadius: 0.36,
  agentMaxSlope: (46 * Math.PI) / 180,
  agentMaxClimb: 0.45,
};

export class NavMeshPathfinding {
  /** Shared WASM init — one promise for every instance. */
  static _initPromise = null;
  static _ensureInit() {
    if (!this._initPromise) this._initPromise = init();
    return this._initPromise;
  }

  constructor(opts = {}) {
    this.ready = false;
    this.error = null;
    this.query = null;
    this.filter = null;
    this.cell = opts.cell ?? NAVMESH_CONFIG.cellSize;
    this.cellHeight = opts.cellHeight ?? NAVMESH_CONFIG.cellHeight;
    this.agentHeight = opts.agentHeight ?? NAVMESH_CONFIG.agentHeight;
    this.agentRadius = opts.agentRadius ?? NAVMESH_CONFIG.agentRadius;
    this.agentMaxSlope = opts.agentMaxSlope ?? NAVMESH_CONFIG.agentMaxSlope;
    this.agentMaxClimb = opts.agentMaxClimb ?? NAVMESH_CONFIG.agentMaxClimb;
    this.maxPathPolys = opts.maxPathPolys ?? 256;
    this.stats = { buildMs: 0, tris: 0 };
  }

  /**
   * Load a pre-baked navmesh asset (serialized Detour bytes, gzipped). This is the
   * fast path: no Recast generation at runtime — just decompress + initSolo, so
   * the boot cost drops from ~500ms to sub-millisecond. Falls through to
   * `buildFromBvh` if the asset is missing or fails to load.
   */
  async loadFromAsset(url) {
    await NavMeshPathfinding._ensureInit();
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`navmesh asset HTTP ${resp.status}`);
    const gz = await resp.arrayBuffer();
    const bytes = new Uint8Array(gz);
    const row = (typeof DecompressionStream !== 'undefined')
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      : gz;
    const arr = new UnsignedCharArray();
    arr.copy(new Uint8Array(row));
    const nm = new NavMesh();
    if (!nm.initSolo(arr)) throw new Error('navmesh initSolo failed');
    this.query = new NavMeshQuery(nm, 4096);
    this.filter = new QueryFilter();
    this.ready = true;
    this.error = null;
    this.stats.buildMs = 0;
    this.stats.tris = 0;
    this._asset = true;
    return this;
  }

  /**
   * Build the navmesh straight out of the physics StaticWorld's baked triangle
   * soup. `pos` is Float32Array[triCount * 9] in world space (non-indexed).
   * Async: WASM init + Recast generation.
   */
  async buildFromBvh(staticWorld) {
    const t0 = performance.now();
    await NavMeshPathfinding._ensureInit();
    const pos = staticWorld.pos;
    const triCount = staticWorld.triCount;
    if (!pos || triCount <= 0) throw new Error('no static collision triangles to build navmesh from');

    const indices = new Uint32Array(triCount * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;

    const nm = generateSoloNavMesh(pos, indices, {
      cellSize: this.cell,
      cellHeight: this.cellHeight,
      agentHeight: this.agentHeight,
      agentRadius: this.agentRadius,
      agentMaxSlope: this.agentMaxSlope,
      agentMaxClimb: this.agentMaxClimb,
    }, false);

    if (!nm.success) throw new Error('recast navmesh generation failed');
    if (!nm.navMesh) throw new Error('recast produced no navmesh');

    this.query = new NavMeshQuery(nm.navMesh, 4096);
    this.filter = new QueryFilter();
    this.ready = true;
    this.error = null;
    this.stats.buildMs = performance.now() - t0;
    this.stats.tris = triCount;
    return this;
  }

  /**
   * Grid-compatible path query. Writes world-space waypoints into the reused
   * `out` array (allocating a Vector3 only when the slot is empty) and returns
   * the waypoint count, or 0 when there is no route. Start/goal are clamped to
   * the nearest polygon internally, so a point that is slightly off-walkable
   * still resolves.
   */
  findPath(from, to, out) {
    if (!this.ready || !this.query) return 0;
    const r = this.query.computePath(
      { x: from.x, y: from.y, z: from.z },
      { x: to.x, y: to.y, z: to.z },
      { filter: this.filter, maxPathPolys: this.maxPathPolys }
    );
    if (!r.success || r.path.length === 0) return 0;
    const n = r.path.length;
    for (let i = 0; i < n; i++) {
      if (!out[i]) out[i] = new THREE.Vector3();
      const p = r.path[i];
      out[i].set(p.x, p.y, p.z);
    }
    return n;
  }
}
