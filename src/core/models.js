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

const BASE = 'models';

export class ModelSystem {
  static id = 'models';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    this.loader = new GLTFLoader();
    this._weapons = new Map();
    this._soldiers = new Map();
  }

  async _loadGLB(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, (err) =>
        reject(new Error(`[models] failed to load ${url}: ${err?.message ?? err}`))
      );
    });
  }

  async _loadJSON(url) {
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
  async getWeapon(id) {
    const cached = this._weapons.get(id);
    if (cached) return cached;
    const [gltf, meta] = await Promise.all([
      this._loadGLB(`${BASE}/weapons/${id}.glb`),
      this._loadJSON(`${BASE}/weapons/${id}.json`),
    ]);
    const record = {
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
    root.traverse((o) => {
      if (o.isMesh) return;
      if (o.name === `${id}-body`) record.body = o;
      else if (o.name.startsWith(`${id}-`) && o.name !== `${id}-model`) {
        record.moving[o.name.slice(id.length + 1)] = o;
      }
    });
    if (!record.body) throw new Error(`[models] ${id}.glb: no "${id}-body" group`);
    // The viewmodel bakes curvature masks per material at build time, so the
    // loaded geometry must be writable (never shared with another weapon).
    this._weapons.set(id, record);
    return record;
  }

  /* ================================================================== */
  /*  soldiers                                                           */
  /* ================================================================== */

  /**
   * @param {string} name  variant name ('vanguard' | 'irregular' | 'breacher')
   * @returns {Promise<object>} soldier record:
   *   { geometry, slots, boneNames, weapon, stats, variant }
   */
  async getSoldier(name) {
    const cached = this._soldiers.get(name);
    if (cached) return cached;
    const [gltf, meta] = await Promise.all([
      this._loadGLB(`${BASE}/soldiers/${name}.glb`),
      this._loadJSON(`${BASE}/soldiers/${name}.json`),
    ]);

    const meshes = [];
    let skeleton = null;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        meshes.push(o);
        if (!skeleton && o.skeleton) skeleton = o.skeleton;
      }
    });
    if (!meshes.length) throw new Error(`[models] ${name}.glb: no skinned mesh`);

    const geometry = meshes.length === 1 ? meshes[0].geometry : mergePrimitives(meshes);
    const boneNames = (skeleton?.bones ?? []).map((b) => b.name);

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
    this._soldiers.set(name, record);
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
export function mergePrimitives(meshes) {
  const parts = meshes.map((m) => {
    const g = m.geometry;
    const index = g.getIndex();
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

  const first = meshes[0];
  const attrNames = Object.keys(first.geometry.attributes);
  const out = new THREE.BufferGeometry();
  for (const name of attrNames) {
    const a0 = first.geometry.attributes[name];
    const itemSize = a0.itemSize;
    const ArrayCtor = a0.array.constructor;
    const arr = new ArrayCtor(totalVerts * itemSize);
    let off = 0;
    for (const p of parts) {
      const a = p.g.attributes[name];
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
