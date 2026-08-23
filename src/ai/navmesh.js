/**
 * NAVMESH — Recast/Detour pathfinding over the baked collision world.
 *
 * The mesh is pre-baked by `tools/export-world.mjs` and loaded here; `buildFromBvh`
 * is the runtime fallback that builds it straight from the physics StaticWorld's
 * baked soup (`phys.staticWorld.pos`, already world-space with instances and the
 * level transform applied). One source of truth for build parameters:
 * `NAVMESH_CONFIG`.
 *
 * `NavGrid` stays for `CoverMap` and as a synchronous fallback; `requestPath`
 * prefers this and falls back to the grid if it isn't built yet or a query fails.
 *
 * PUBLIC API — `ai.navmesh` (a NavMeshPathfinding, or null until built)
 *   navmesh.ready               bool — mesh built and queryable
 *   navmesh.findPath(from, to, out) -> int  (writes into `out`, returns count)
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

  constructor() {
    this.ready = false;
    this.query = null;
    this.filter = null;
    this.maxPathPolys = 256;
    this.stats = { buildMs: 0, tris: 0 };
  }

  /** Load a pre-baked navmesh asset: decompress + initSolo, no Recast generation. */
  async loadFromAsset(url) {
    await NavMeshPathfinding._ensureInit();
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`navmesh asset HTTP ${resp.status}`);
    const gz = await resp.arrayBuffer();
    const row = typeof DecompressionStream !== 'undefined'
      ? await new Response(new Blob([new Uint8Array(gz)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      : gz;
    const arr = new UnsignedCharArray();
    arr.copy(new Uint8Array(row));
    const nm = new NavMesh();
    if (!nm.initSolo(arr)) throw new Error('navmesh initSolo failed');
    this.query = new NavMeshQuery(nm, 4096);
    this.filter = new QueryFilter();
    this.ready = true;
    this._asset = true;
    return this;
  }

  /** Build the navmesh from the physics StaticWorld's baked triangle soup. */
  async buildFromBvh(staticWorld) {
    const t0 = performance.now();
    await NavMeshPathfinding._ensureInit();
    const pos = staticWorld.pos;
    const triCount = staticWorld.triCount;
    if (!pos || triCount <= 0) throw new Error('no static collision triangles to build navmesh from');
    const indices = new Uint32Array(triCount * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    const nm = generateSoloNavMesh(pos, indices, NAVMESH_CONFIG, false);
    if (!nm.success || !nm.navMesh) throw new Error('recast navmesh generation failed');
    this.query = new NavMeshQuery(nm.navMesh, 4096);
    this.filter = new QueryFilter();
    this.ready = true;
    this.stats.buildMs = performance.now() - t0;
    this.stats.tris = triCount;
    return this;
  }

  /** Grid-compatible path query; returns the waypoint count, or 0 on no route. */
  findPath(from, to, out) {
    if (!this.ready || !this.query) return 0;
    const r = this.query.computePath(
      { x: from.x, y: from.y, z: from.z },
      { x: to.x, y: to.y, z: to.z },
      { filter: this.filter, maxPathPolys: this.maxPathPolys }
    );
    if (!r.success || r.path.length === 0) return 0;
    for (let i = 0; i < r.path.length; i++) {
      if (!out[i]) out[i] = new THREE.Vector3();
      const p = r.path[i];
      out[i].set(p.x, p.y, p.z);
    }
    return r.path.length;
  }
}
