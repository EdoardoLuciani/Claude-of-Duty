import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { SystemId, EngineContext } from './context.ts';
import { parseSoldierMetadata, parseWorldManifest, parseWorldAssets } from './model-metadata.ts';
import type { SoldierRecord, WorldPrefetch } from './model-metadata.ts';
/** Loads cached soldier GLBs/metadata and the cooked world; player weapons own their adapters. */
import { isSkinnedMesh } from './three-guards.ts';
export type {
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
  promise.catch((): void => {});
  return promise;
}

export class ModelSystem {
  declare ctx: EngineContext;
  declare loader: GLTFLoader;
  declare _soldiers: Map<string, Promise<SoldierRecord>>;
  declare worldPrefetch: Promise<WorldPrefetch>;
  declare worldNav: ArrayBuffer;

  static readonly id = 'models';
  static readonly deps: SystemId[] = [];

  async init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.loader = new GLTFLoader();
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
    return new Promise<GLTF>((resolve, reject): void => {
      this.loader.load(url, resolve, undefined, (err: unknown): void => {
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
    gltf.scene.traverse((node: THREE.Object3D): void => {
      if (isSkinnedMesh(node)) meshes.push(node);
    });
    if (!meshes.length) throw new Error(`[models] ${name}.glb: no skinned mesh`);

    const geometry = meshes.length === 1 ? meshes[0].geometry : mergePrimitives(meshes);
    const boneNames = (meshes[0].skeleton?.bones ?? []).map((bone): string => bone.name);

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
  const parts = meshes.map(
    (
      m
    ): {
      g: THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>;
      index: THREE.BufferAttribute<THREE.BufferAttributeEventMap>;
      lo: number;
      count: number;
    } => {
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
    }
  );
  const totalVerts = parts.reduce((s, p): number => s + p.count, 0);
  const totalIdx = parts.reduce((s, p): number => s + p.index.count, 0);

  const first = meshes[0]!;
  const attrNames = Object.keys(first.geometry.attributes);
  const out = new THREE.BufferGeometry();
  for (const name of attrNames) {
    const a0 = first.geometry.attributes[name]!;
    const itemSize = a0.itemSize;
    const source = a0.array;
    const ArrayCtor =
      source instanceof Float32Array
        ? Float32Array
        : source instanceof Float64Array
          ? Float64Array
          : source instanceof Uint32Array
            ? Uint32Array
            : source instanceof Int32Array
              ? Int32Array
              : source instanceof Uint16Array
                ? Uint16Array
                : source instanceof Int16Array
                  ? Int16Array
                  : source instanceof Uint8ClampedArray
                    ? Uint8ClampedArray
                    : source instanceof Int8Array
                      ? Int8Array
                      : Uint8Array;
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
