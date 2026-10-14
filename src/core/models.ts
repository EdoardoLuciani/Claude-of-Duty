/**
 * MODELS — runtime loader for the exported GLB assets.
 *
 * The weapon and soldier meshes are no longer built procedurally at boot: the
 * same builders run offline in `tools/export-models.mjs` and write GLB files
 * under `public/models/`. This system loads them (and their metadata JSON) and
 * hands out ready-to-use records.
 *
 * Load contract (see the exporter header for the round-trip guarantees):
 *  - weapon records keep the exact shape the viewmodel consumed from the
 *    builders: `{ id, label, fxClass, body, moving, nodes, shell, magSize }`
 *    where `body`/`moving` are Groups of one mesh per material slot, each
 *    carrying `userData.mat`.
 *  - soldier records are one merged, skinned BufferGeometry with material
 *    groups in slot order, plus the slot names, bone order and weapon anchors
 *    the animator needs. Agents bind this geometry to their own RIG skeleton
 *    (same bone order — asserted at load), so animation and ragdoll code is
 *    untouched.
 *
 * Everything is cached; the weapon and soldier APIs are async, so subsystems
 * preload during `init()`.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { EngineContext } from './context.ts';
import {
  parseWeaponMetadata,
  parseSoldierMetadata,
  parseWorldManifest,
  parseWorldAssets,
} from './model-metadata.ts';
import type { WeaponRecord, SoldierRecord, WorldPrefetch } from './model-metadata.ts';
export type {
  WeaponRecord,
  WeaponMetadata,
  WeaponNodes,
  SoldierRecord,
  SoldierMetadata,
  SoldierWeapon,
  SoldierVariant,
  WorldManifest,
  WorldPrefetch,
  WorldBuilding,
  WorldLadder,
  ModelVec3,
} from './model-metadata.ts';

const BASE = 'models';

/** Observe a prefetch so a rejection is not unhandled before the consumer awaits it. */
function watch<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

export class ModelSystem {
  declare ctx: EngineContext;
  declare loader: GLTFLoader;
  declare _weapons: Map<string, Promise<WeaponRecord>>;
  declare _soldiers: Map<string, Promise<SoldierRecord>>;
  declare worldPrefetch: Promise<WorldPrefetch>;
  declare worldNav: ArrayBuffer;

  static id = 'models';
  static deps = [];

  async init(ctx: EngineContext) {
    this.ctx = ctx;
    this.loader = new GLTFLoader();
    this._weapons = new Map();
    this._soldiers = new Map();
    this.worldPrefetch = watch(this._prefetchWorld());
    // All player weapons are weapon-owned, committed Blender assets.
    for (const name of ['vanguard', 'irregular', 'breacher']) void watch(this.getSoldier(name));
  }

  async _prefetchWorld(): Promise<WorldPrefetch> {
    const base = `${BASE}/world`;
    const manifestResponse = await fetch(`${base}/level.json`, { cache: 'no-cache' });
    if (!manifestResponse.ok) {
      throw new Error(`[models] failed to load world manifest: HTTP ${manifestResponse.status}`);
    }
    const metadata: unknown = await manifestResponse.json();
    const assets = parseWorldAssets(metadata);
    const [visual, collision, nav] = await Promise.all([
      this._loadWorldGLB(`${base}/${assets.visual}`),
      this._loadWorldGLB(`${base}/${assets.collision}`),
      this._loadWorldBytes(`${base}/${assets.nav}`),
    ]);
    const meta = parseWorldManifest(metadata);
    this.worldNav = nav;
    return { meta, visual, collision };
  }

  async _loadWorldBytes(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`[models] failed to load ${url}: HTTP ${response.status}`);
    }
    const alreadyDecoded = response.headers.get('content-encoding')?.includes('gzip');
    if (!alreadyDecoded && typeof DecompressionStream === 'undefined') {
      throw new Error('[models] this browser cannot decompress world assets');
    }
    return alreadyDecoded
      ? await response.arrayBuffer()
      : await new Response(
          response.body.pipeThrough(new DecompressionStream('gzip'))
        ).arrayBuffer();
  }

  async _loadWorldGLB(url: string): Promise<GLTF> {
    const buffer = await this._loadWorldBytes(url);
    return this.loader.parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1));
  }

  async _loadGLB(url: string): Promise<GLTF> {
    return new Promise<GLTF>((resolve, reject) => {
      this.loader.load(url, resolve, undefined, (err: unknown) => {
        const message =
          typeof err === 'object' && err !== null && 'message' in err ? err.message : err;
        reject(new Error(`[models] failed to load ${url}: ${String(message ?? err)}`));
      });
    });
  }

  async _loadJSON(url: string): Promise<unknown> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`[models] failed to fetch ${url}: HTTP ${r.status}`);
    return r.json();
  }

  /* ================================================================== */
  /*  weapons                                                            */
  /* ================================================================== */

  /**
   * @returns {Promise<object>} weapon record — see the header contract.
   */
  getWeapon(id: string): Promise<WeaponRecord> {
    const cached = this._weapons.get(id);
    if (cached) return cached;
    const pending = this._loadWeapon(id);
    this._weapons.set(id, pending);
    return pending;
  }

  async _loadWeapon(id: string): Promise<WeaponRecord> {
    const [gltf, metadata] = await Promise.all([
      this._loadGLB(`${BASE}/weapons/${id}.glb`),
      this._loadJSON(`${BASE}/weapons/${id}.json`),
    ]);
    const meta = parseWeaponMetadata(metadata);
    const record: Omit<WeaponRecord, 'body'> & { body: THREE.Object3D | null } = {
      id,
      label: meta.label,
      fxClass: meta.fxClass,
      body: null,
      moving: {},
      nodes: meta.nodes,
      shell: meta.shell,
      magSize: meta.magSize,
    };
    // The exporter writes `root -> {id}-body`, `{id}-<movingPart>` groups.
    // GLTFLoader imports empty groups as plain Object3D, so match by name.
    const root = gltf.scene;
    root.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) return;
      if (o.name === `${id}-body`) record.body = o;
      else if (o.name.startsWith(`${id}-`) && o.name !== `${id}-model`) {
        record.moving[o.name.slice(id.length + 1)] = o;
      }
    });
    if (!record.body) throw new Error(`[models] ${id}.glb: no "${id}-body" group`);
    return { ...record, body: record.body };
  }

  /* ================================================================== */
  /*  soldiers                                                           */
  /* ================================================================== */

  /**
   * @param {string} name  variant name ('vanguard' | 'irregular' | 'breacher')
   * @returns {Promise<object>} soldier record:
   *   { geometry, slots, boneNames, weapon, stats, variant }
   */
  getSoldier(name: string): Promise<SoldierRecord> {
    const cached = this._soldiers.get(name);
    if (cached) return cached;
    const pending = this._loadSoldier(name);
    this._soldiers.set(name, pending);
    return pending;
  }

  async _loadSoldier(name: string): Promise<SoldierRecord> {
    const [gltf, metadata] = await Promise.all([
      this._loadGLB(`${BASE}/soldiers/${name}.glb`),
      this._loadJSON(`${BASE}/soldiers/${name}.json`),
    ]);

    const meta = parseSoldierMetadata(metadata);
    const meshes: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((node: THREE.Object3D) => {
      if (node instanceof THREE.SkinnedMesh) meshes.push(node as THREE.SkinnedMesh);
    });
    if (!meshes.length) throw new Error(`[models] ${name}.glb: no skinned mesh`);

    const geometry = meshes.length === 1 ? meshes[0].geometry : mergePrimitives(meshes);
    const boneNames = (meshes[0].skeleton?.bones ?? []).map((bone) => bone.name);

    const record = {
      // `name` is what the JSON METADATA claims the variant is (validated by
      // the ai subsystem against the requested name); `requestedName` is what
      // the caller asked for, so the mismatch is never masked.
      requestedName: name,
      name: meta.name,
      geometry,
      slots: meta.slots,
      boneNames,
      weapon: meta.weapon,
      stats: meta.stats ?? { vertices: 0, triangles: 0 },
      variant: meta.variant,
    };
    return record;
  }
}

/**
 * glTF loads multi-material meshes as one object per primitive; the game
 * expects ONE skinned geometry with material groups (one draw call per slot),
 * so stitch the primitives back together in order.
 *
 * Each primitive's accessors span the FULL shared vertex buffer (glTF has no
 * per-primitive vertex range), so the per-primitive geometry must be sliced to
 * the range its indices actually use — otherwise the merged geometry carries
 * N× the vertices. Slice + rebase, then concatenate in primitive order, which
 * reproduces the original authored vertex array exactly.
 */
export function mergePrimitives(meshes: THREE.SkinnedMesh[]): THREE.BufferGeometry {
  const parts = meshes.map((m) => {
    const g = m.geometry;
    const index = g.getIndex()!;
    const src = index.array;
    let lo = Infinity;
    let hi = -1;
    for (let i = 0; i < index.count; i++) {
      const v = src[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { g, index, lo, count: hi - lo + 1 };
  });
  const totalVerts = parts.reduce((s, p) => s + p.count, 0);
  const totalIdx = parts.reduce((s, p) => s + p.index.count, 0);

  const first = meshes[0]!;
  const attrNames = Object.keys(first.geometry.attributes);
  const out = new THREE.BufferGeometry();
  for (const name of attrNames) {
    const a0 = first.geometry.attributes[name]!;
    const itemSize = a0.itemSize;
    const ArrayCtor = a0.array.constructor as { new (length: number): THREE.TypedArray };
    const arr = new ArrayCtor(totalVerts * itemSize);
    let off = 0;
    for (const p of parts) {
      const a = p.g.attributes[name]!;
      const n = p.count * itemSize;
      // Copy the primitive's own slice of the shared buffer (indices are
      // absolute, so the used range is [lo, lo+count)).
      for (let i = 0; i < n; i++) arr[off + i] = a.array[p.lo * itemSize + i];
      off += n;
    }
    const attr = new THREE.BufferAttribute(arr, itemSize);
    attr.normalized = a0.normalized;
    out.setAttribute(name, attr);
  }

  const idxArr = new (totalVerts > 65535 ? Uint32Array : Uint16Array)(totalIdx);
  let voff = 0;
  let ioff = 0;
  for (const p of parts) {
    for (let i = 0; i < p.index.count; i++) idxArr[ioff + i] = p.index.array[i] - p.lo + voff;
    ioff += p.index.count;
    voff += p.count;
  }
  out.setIndex(new THREE.BufferAttribute(idxArr, 1));

  let start = 0;
  for (let i = 0; i < parts.length; i++) {
    out.addGroup(start, parts[i].index.count, i);
    start += parts[i].index.count;
  }
  return out;
}
