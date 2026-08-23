import * as THREE from 'three';
import { Accum, trs } from './util.js';
import { PALETTE } from './palette.js';

/**
 * WORLD — the assembler.
 *
 * Every world builder writes into this assembler instead of touching the scene.
 * Static geometry is merged by palette and repeated props become instanced
 * meshes. Blender derives collision from the resulting visual scene.
 */
const _m = new THREE.Matrix4();
const _xm = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * Spatial bucket size for chunked instance clouds (frustum culling + LOD).
 * Sized so a 120 m map splits into a handful of buckets: finer chunking culls a
 * little better but multiplies draw calls through the prepass and four shadow
 * cascades, which is the wrong trade at this map size.
 */
const CHUNK = 64;

export class Assembler {
  constructor({ materials, rng }) {
    this.materials = materials;
    this.rng = rng;
    this._mats = new Map(); // palette key -> THREE.Material
    this._static = new Map(); // palette key -> Accum
    this._protos = new Map(); // id -> { geo, key, instances[], masks[], opts }
    this._geoCache = new Map(); // kit piece key -> BufferGeometry
    this.meshes = [];
    /**
     * LEVEL -> WORLD. The map is authored around a street running down -Z, then
     * placed in the world so the canonical hero camera looks straight along it.
     * Baking the transform in here (rather than rotating a parent Object3D)
     * keeps every merged vertex, instance matrix, light and LOD bounding sphere
     * in true world space — physics, culling and the
     * world-space triplanar materials all stay honest.
     */
    this.xform = new THREE.Matrix4();
    this._identity = true;
    /** Filled by interiors.js: where a bare bulb wants a point light. */
    this.interiorLights = [];
    /** Filled by dressing.js: where a street lamp wants a point light. */
    this.lampAnchors = [];
    /**
     * Per-instance placement jitter, armed for the set-dressing pass:
     * { rng, yaw, scale }. Per-prop tilt and sink come from the prototype.
     */
    this.jitter = null;
    this._suppressPlacements = false;
    /**
     * Whether put() drops a contact fillet under skirted prototypes. Turn it
     * off around a stack — the second crate in a pile is standing on the first,
     * not on the ground, and a dust ring floating at 60 cm is worse than none.
     */
    this.skirts = true;
    this.stats = { staticTris: 0, instTris: 0, instances: 0, drawCalls: 0 };
  }

  // -------------------------------------------------------------- transform --
  /**
   * Place LEVEL space into WORLD space. The map is authored around a street
   * running down -Z; the transform rotates and offsets it so the street lies on
   * the canonical camera axis. Baking it into every vertex, instance matrix
   * and light (rather than rotating a parent Object3D) keeps physics,
   * culling and the world-space triplanar materials honest.
   */
  setTransform(ry, tx = 0, tz = 0) {
    _q.setFromAxisAngle(_UP, ry);
    _v.set(tx, 0, tz);
    _one.set(1, 1, 1);
    this.xform.compose(_v, _q, _one);
    this._identity = ry === 0 && tx === 0 && tz === 0;
    this.ry = ry;
    return this;
  }

  /** Compose the level transform onto a level-space matrix (shared scratch). */
  _x(matrix) {
    if (this._identity) return matrix ?? null;
    if (!matrix) return this.xform;
    return _xm.copy(this.xform).multiply(matrix);
  }

  // ------------------------------------------------------------- materials --
  mat(key) {
    let m = this._mats.get(key);
    if (m) return m;
    const def = PALETTE[key];
    if (!def) {
      console.warn(`[world] unknown palette key "${key}"`);
      return this.mat('concrete');
    }
    m = this.materials.get(def.name, def.opts);
    this._mats.set(key, m);
    return m;
  }

  surfaceOf(key) {
    return PALETTE[key]?.surface ?? 'concrete';
  }

  // --------------------------------------------------------- static batch --
  /** Merge a transformed geometry into the batch for `key`. */
  add(key, geo, matrix = null, opts = null) {
    let a = this._static.get(key);
    if (!a) {
      a = new Accum(`world:${key}`);
      this._static.set(key, a);
    }
    a.add(geo, this._x(matrix), opts);
    return this;
  }

  /** Convenience: a transformed box merged into the static batch. */
  addBox(key, geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, opts = null) {
    return this.add(key, geo, trs(_m, x, y, z, ry, sx, sy, sz), opts);
  }

  /**
   * Geometry cache for kit pieces that repeat (window frames, sills, steps).
   * Merged data is copied, so everything here is freed by releaseCache() once
   * the level is built.
   */
  cache(key, factory) {
    let g = this._geoCache.get(key);
    if (!g) {
      g = factory();
      this._geoCache.set(key, g);
    }
    return g;
  }

  /** Merge a one-off geometry and free it immediately. */
  addOnce(key, geo, matrix = null, opts = null) {
    this.add(key, geo, matrix, opts);
    geo.dispose();
    return this;
  }

  releaseCache() {
    for (const g of this._geoCache.values()) g.dispose();
    this._geoCache.clear();
  }

  // ------------------------------------------------------------ instanced --
  /**
   * @param {string} id
   * @param {object} spec { geo, key, castShadow, chunk, maxDist, collide }
   */
  proto(id, spec) {
    if (this._protos.has(id)) return id;
    this._protos.set(id, {
      id,
      geo: spec.geo,
      /**
       * How far a loose object of this kind is allowed to be knocked out of
       * true, in radians, and how far to sink it so the raised corner does not
       * float. 0 (the default) means "this prop is fixed" — a lamp post, a
       * bullet pock, a bottle standing on a table — and `put()` leaves it alone.
       */
      tilt: spec.tilt ?? 0,
      sink: spec.sink ?? 0,
      key: spec.key,
      /**
       * Radius, in metres, of the swept dust fillet `put()` should drop under
       * every instance of this prototype. Nothing in the frame currently
       * touches anything: a crate meets the road on a razor-straight polygon
       * edge with no darkening, no piled grit and no transition, which is what
       * makes props read as decals pasted on. A low mound of the ground's own
       * material against the base fixes it geometrically (so the AO pass and
       * the sun both see it) rather than by painting a shadow.
       */
      skirt: spec.skirt ?? 0,
      castShadow: spec.castShadow !== false,
      receiveShadow: spec.receiveShadow !== false,
      chunk: spec.chunk !== false,
      maxDist: spec.maxDist ?? 0,
      matrices: [],
      masks: [],
      noPrepass: !!spec.noPrepass,
    });
    return id;
  }

  has(id) {
    return this._protos.has(id);
  }

  /** Add an instance. `masks` scales the geometry's [wear, grime, ao]. */
  place(id, matrix, masks = null) {
    const p = this._protos.get(id);
    if (!p) {
      console.warn(`[world] no prop prototype "${id}"`);
      return this;
    }
    if (this._suppressPlacements) return this;
    p.matrices.push(this._x(matrix).clone());
    p.masks.push(masks ? [masks[0], masks[1], masks[2]] : null);
    return this;
  }

  suppressPlacements(value) {
    this._suppressPlacements = value;
  }

  /**
   * Place with loose transform arguments — the common case.
   *
   * When `jitter` is armed (dressing.js does it for the whole set-dressing pass)
   * every prop declared as loose gets knocked out of true: a little yaw, a
   * little tilt on both horizontal axes and a little scale. Nothing in a real
   * street is square to anything else, and the identical-clone read is the
   * loudest tell in an instanced prop cloud — a barrel dropped by hand is never
   * plumb, and two barrels are never the same size.
   */
  put(id, x, y, z, ry = 0, s = 1, masks = null, rx = 0, rz = 0) {
    const j = this.jitter;
    const p = this._protos.get(id);
    if (j) {
      if (p && p.tilt > 0) {
        const r = j.rng;
        ry += r.range(-j.yaw, j.yaw);
        rx += r.range(-p.tilt, p.tilt);
        rz += r.range(-p.tilt, p.tilt);
        s *= 1 + r.range(-j.scale, j.scale);
        y -= p.sink;
      }
    }
    trs(_m, x, y, z, ry, s, s, s, rx, rz);
    this.place(id, _m, masks);
    // Ground it. The fillet is never tilted and never rotated with the prop:
    // it is a pile of dust, not part of the object.
    if (this.skirts && p && p.skirt > 0 && this._protos.has('dust_skirt')) {
      const rr = p.skirt * s;
      trs(_m, x, y + 0.004, z, (x * 2.7 + z * 1.9) % 6.283, rr, 1, rr);
      this.place('dust_skirt', _m, null);
    }
    return this;
  }

  putS(id, x, y, z, ry, sx, sy, sz, masks = null, rx = 0, rz = 0) {
    trs(_m, x, y, z, ry, sx, sy, sz, rx, rz);
    return this.place(id, _m, masks);
  }

  // ------------------------------------------------------------- finalize --
  /** Build the visual meshes and add them to `root`. */
  finalize(root) {
    // --- merged static geometry ---
    for (const [key, acc] of this._static) {
      if (acc.empty) continue;
      const geo = acc.build();
      const mesh = new THREE.Mesh(geo, this.mat(key));
      mesh.name = `world_${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.surface = this.surfaceOf(key);
      mesh.userData.palette = key;
      mesh.userData.collision = false; // cooked into a separate derived asset
      mesh.updateMatrix();
      root.add(mesh);
      this.meshes.push(mesh);
      this.stats.staticTris += geo.index.count / 3;
      this.stats.drawCalls++;
    }

    // --- instanced props ---
    for (const p of this._protos.values()) {
      const n = p.matrices.length;
      if (n === 0) {
        p.geo.dispose();
        continue;
      }
      const buckets = new Map();
      if (p.chunk && n > 24) {
        for (let i = 0; i < n; i++) {
          const m = p.matrices[i];
          const gx = Math.floor(m.elements[12] / CHUNK);
          const gz = Math.floor(m.elements[14] / CHUNK);
          const k = gx * 97 + gz;
          let b = buckets.get(k);
          if (!b) buckets.set(k, (b = []));
          b.push(i);
        }
      } else {
        buckets.set(0, [...Array(n).keys()]);
      }

      const mat = this.mat(p.key);
      for (const list of buckets.values()) {
        const im = new THREE.InstancedMesh(p.geo, mat, list.length);
        im.name = `prop_${p.id}`;
        im.castShadow = p.castShadow;
        im.receiveShadow = p.receiveShadow;
        im.matrixAutoUpdate = false;
        im.userData.surface = this.surfaceOf(p.key);
        im.userData.palette = p.key;
        im.userData.castShadow = p.castShadow;
        im.userData.receiveShadow = p.receiveShadow;
        im.userData.collision = false;
        if (p.noPrepass) im.userData.owNoPrepass = true;
        let needColor = false;
        for (let j = 0; j < list.length; j++) if (p.masks[list[j]]) needColor = true;
        if (needColor) {
          const arr = new Float32Array(list.length * 3);
          for (let j = 0; j < list.length; j++) {
            const mk = p.masks[list[j]] ?? [1, 1, 1];
            arr[j * 3] = mk[0];
            arr[j * 3 + 1] = mk[1];
            arr[j * 3 + 2] = mk[2];
          }
          im.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
        }
        for (let j = 0; j < list.length; j++) im.setMatrixAt(j, p.matrices[list[j]]);
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.updateMatrix();
        root.add(im);
        this.meshes.push(im);
        this.stats.drawCalls++;
        this.stats.instances += list.length;
        const tri = (p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count) / 3;
        this.stats.instTris += tri * list.length;
        if (p.maxDist > 0) im.userData.owLodDist = p.maxDist;
      }
      p.matrices.length = 0;
      p.masks.length = 0;
    }

    return this;
  }

  dispose() {
    this.releaseCache();
    for (const m of this.meshes) {
      // instanced meshes share a prototype geometry — the prototype frees it
      if (!m.isInstancedMesh) m.geometry?.dispose();
      m.parent?.remove(m);
    }
    this.meshes.length = 0;
    for (const p of this._protos.values()) p.geo?.dispose();
    this._protos.clear();
    this._static.clear();
  }
}
