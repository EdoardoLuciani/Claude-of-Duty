import { Color, Vector4 } from 'three/webgpu';
import { float, uniform, uv, vec3, vec4 } from 'three/tsl';
import { bakeDetail, bakeMacro, bakeSurface } from './forge-tsl.js';
import { LIBRARY, resolveName } from './library.js';
import { DEFAULT_PARAMS } from './params.js';
import { GENERATED_SURFACES, SURFACES_TSL } from './surfaces-index-tsl.js';
import { createSurfaceNodeMaterial } from './shader-tsl.js';
import { bakeMasks, setMask } from './masks.js';

/**
 * Material library for the strict WebGPU renderer. Staged separately until the
 * render/game boot is WebGPU-only; never instantiate this beside the WebGL
 * MaterialSystem in production. `init()` requires an initialized renderer.
 */
export class MaterialSystemNode {
  static id = 'materials';
  static deps = ['render'];

  constructor({ renderer } = {}) {
    this._injectedRenderer = renderer;
    this._sets = new Map();
    this._materials = new Map();
    this._targets = [];
    this._shared = null;
    this._groundY = 0;
  }

  async init(ctx) {
    this.ctx = ctx;
    this.renderer = this._injectedRenderer ?? ctx.peek('render')?.renderer;
    if (!this.renderer || this.renderer.backend?.constructor?.name !== 'WebGPUBackend')
      throw new Error('[materials] WebGPU renderer required');
    const q = ctx?.config?.q;
    this._quality = { low: 0.5, medium: 0.75 }[ctx?.config?.quality] ?? 1;
    this._anisotropy = q?.anisotropy ?? 8;
    const detail = bakeDetail(this.renderer, this._size(1024));
    const macro = bakeMacro(this.renderer, 256);
    this._targets.push(detail.albedo, detail.normal, macro);
    this._shared = { detailNormal: detail.normal.texture,
      detailAlbedo: detail.albedo.texture, macro: macro.texture };
  }

  _size(base) {
    const s = Math.max(128, Math.round((base * this._quality) / 128) * 128);
    return 1 << Math.round(Math.log2(s));
  }

  _resolve(name) {
    const key = resolveName(name);
    if (SURFACES_TSL[key]) return key;
    if (!this._missing) this._missing = new Set();
    if (!this._missing.has(name)) {
      this._missing.add(name);
      console.warn(`[materials] unknown surface "${name}" — falling back to concrete`);
    }
    return 'concrete';
  }

  getTextureSet(name, opts = {}) {
    if (!this._shared) throw new Error('[materials] init before requesting textures');
    const key = this._resolve(name);
    const bake = { ...LIBRARY[key].bake, ...opts.bake };
    bake.size = this._size(bake.size);
    const cacheKey = `${key}|${bake.size}|${bake.seed}|${bake.tintA ?? ''}|${bake.tintB ?? ''}|${(
      bake.param ?? []).join('_')}`;
    let set = this._sets.get(cacheKey);
    if (set) return set;
    const tintA = new Color(bake.tintA ?? 0xffffff);
    const tintB = new Color(bake.tintB ?? 0xffffff);
    const args = [uv(), float(bake.seed ?? 1)];
    if (GENERATED_SURFACES.has(key)) {
      const p = bake.param ?? [0, 0, 0, 0];
      args.push(vec3(tintA.r, tintA.g, tintA.b), vec3(tintB.r, tintB.g, tintB.b),
        vec4(p[0], p[1], p[2], p[3]));
    }
    const targets = bakeSurface(this.renderer, { size: bake.size,
      worldSize: bake.worldSize, relief: bake.relief,
      surface: SURFACES_TSL[key](...args) });
    for (const target of Object.values(targets)) {
      target.texture.anisotropy = this._anisotropy;
      this._targets.push(target);
    }
    set = { name: key, size: bake.size, worldSize: bake.worldSize,
      albedo: targets.albedo.texture, normal: targets.normal.texture,
      orm: targets.orm.texture };
    this._sets.set(cacheKey, set);
    return set;
  }

  get(name, opts = {}) {
    const key = this._resolve(name);
    const matKey = key + '|' + Object.keys(opts).sort()
      .map((k) => `${k}=${JSON.stringify(opts[k])}`).join(',');
    const cached = this._materials.get(matKey);
    if (cached) return cached;
    const def = LIBRARY[key];
    const set = this.getTextureSet(key, opts);
    const p = { ...DEFAULT_PARAMS, ...def.mat, ...opts };
    delete p.bake;
    delete p.three;
    p.groundY = opts.groundY ?? this._groundY;
    const layerCap = { low: 8, medium: 12, high: 16, ultra: 32 }[this.ctx?.config?.quality] ?? 16;
    p.parallaxLayers = Math.min(p.parallaxLayers ?? 22, layerCap);
    const tileScale = p.uvMode === 'mesh' ? p.scale : 1 / p.scale;
    const controls = {
      tile: uniform(tileScale),
      tint: uniform(new Color(p.tint)),
      parallax: uniform(p.parallax),
      normal: uniform(p.normalStrength),
      ground: uniform(p.groundY),
      weather: uniform(new Vector4(...p.weather)),
    };
    p.tileNode = controls.tile;
    p.tintNode = controls.tint;
    p.parallaxNode = controls.parallax;
    p.normalAmpNode = controls.normal;
    p.groundNode = controls.ground;
    p.weatherNode = controls.weather;
    const mat = createSurfaceNodeMaterial(set, p, this._shared,
      { ...def.three, ...opts.three });
    mat.name = matKey;
    mat.userData.owParams = p;
    mat.userData.owControls = controls;
    this._materials.set(matKey, mat);
    return mat;
  }

  variant(name, opts = {}) { return this.get(name, opts); }
  names() { return Object.keys(SURFACES_TSL); }
  surfaceOf(name) { return LIBRARY[resolveName(name)]?.surface ?? 'concrete'; }
  bakeMasks(geometry, opts) { return bakeMasks(geometry, opts); }
  setMask(geometry, opts) { return setMask(geometry, opts); }
  get detailNormal() { return this._shared?.detailNormal ?? null; }
  get macroTexture() { return this._shared?.macro ?? null; }
  update() {} // Scratch height targets are released immediately by bakeSurface.

  tune(material, changes = {}) {
    const c = material.userData.owControls;
    if (!c) return material;
    const p = material.userData.owParams;
    if (changes.scale !== undefined) {
      c.tile.value = p.uvMode === 'mesh' ? changes.scale : 1 / changes.scale;
      p.scale = changes.scale;
    }
    if (changes.tint !== undefined) c.tint.value.set(changes.tint);
    if (changes.parallax !== undefined) c.parallax.value = changes.parallax;
    if (changes.normalStrength !== undefined) c.normal.value = changes.normalStrength;
    if (changes.weather !== undefined) c.weather.value.fromArray(changes.weather);
    if (changes.groundY !== undefined) c.ground.value = changes.groundY;
    return material;
  }

  setGroundLevel(y) {
    this._groundY = y;
    for (const material of this._materials.values()) this.tune(material, { groundY: y });
  }

  dispose() {
    for (const material of this._materials.values()) material.dispose();
    for (const target of this._targets) target.dispose();
    this._materials.clear();
    this._sets.clear();
    this._targets.length = 0;
    this._shared = null;
  }
}
