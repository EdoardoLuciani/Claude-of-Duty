import { Color, MeshStandardNodeMaterial, Vector3, Vector4 } from 'three/webgpu';
import type { Renderer, Texture, Node } from 'three/webgpu';
import type { BufferGeometry } from 'three';
import type { SurfaceParams } from './shader-tsl.ts';
import { float, uniform, uv, vec3, vec4 } from 'three/tsl';
import { bakeDetail, bakeMacro, bakeSurface } from './forge-tsl.ts';
import type { SurfaceNode } from './forge-tsl.ts';
import { LIBRARY, resolveName } from './library.ts';
import { DEFAULT_PARAMS } from './params.ts';
import { GENERATED_SURFACES, SURFACES_TSL } from './surfaces-index-tsl.js';
import { createSurfaceNodeMaterial } from './shader-tsl.js';
import { bakeMasks, setMask } from './masks.ts';

/**
 * Production material library for the strict-WebGPU renderer.
 *
 * `src/materials/index.js` re-exports this as `MaterialSystem`; it is the only
 * production material path (there is no WebGL backend toggle). `init()`
 * requires an initialized strict-WebGPU renderer and bakes the shared detail
 * and macro maps, then bakes each authored surface lazily into packed
 * albedo+height / ORM / normal render targets on first request.
 */
interface MaterialTextureSet { name: string; size: number; worldSize: number; albedo: Texture; normal: Texture; orm: Texture }
interface MaterialSharedData { detailNormal: Texture; detailAlbedo: Texture; macro: Texture; keyDir: Node<'vec3'> & { value: Vector3 }; keyColor: Node<'vec3'> & { value: Vector3 } }
interface MaterialContext {
  config?: { quality?: 'low' | 'medium' | 'high' | 'ultra'; q?: { anisotropy?: number } };
  peek?(id: 'render'): { renderer?: Renderer; sunDir?: Vector3; activeSun?: { color: Color; intensity: number } } | null;
  peek?(id: 'sky'): { keyDirection?: Vector3; keyLight?: { color: Color; intensity: number } } | null;
}
interface MaterialOptions extends Partial<SurfaceParams> {
  [key: string]: unknown;
  bake?: Partial<{ size: number; worldSize: number; relief: number; seed: number; param: number[]; tintA: number; tintB: number }>;
  three?: Record<string, unknown>; groundY?: number;
}
interface MaterialChanges { scale?: number; tint?: number; parallax?: number; normalStrength?: number; weather?: [number, number, number, number]; groundY?: number }
interface MaterialControls { tile: { value: number }; tint: { value: Color }; parallax: { value: number }; normal: { value: number }; ground: { value: number }; weather: { value: Vector4 } }

export class MaterialSystemNode {
  declare _injectedRenderer: Renderer | undefined; declare renderer: Renderer; declare ctx: MaterialContext;
  declare _sets: Map<string, MaterialTextureSet>; declare _materials: Map<string, MeshStandardNodeMaterial>;
  declare _targets: Array<{ dispose(): void }>; declare _shared: MaterialSharedData | null; declare _groundY: number;
  declare _quality: number; declare _anisotropy: number; declare _missing: Set<string>;

  static id = 'materials';
  static deps = ['render'];

  constructor({ renderer }: { renderer?: Renderer } = {}) {
    this._injectedRenderer = renderer;
    this._sets = new Map();
    this._materials = new Map();
    this._targets = [];
    this._shared = null;
    this._groundY = 0;
  }

  async init(ctx: MaterialContext): Promise<void> {
    this.ctx = ctx;
    const renderer = this._injectedRenderer ?? ctx.peek?.('render')?.renderer;
    const backend = renderer?.backend as (Renderer['backend'] & { isWebGPUBackend?: boolean }) | undefined;
    if (!renderer || backend?.isWebGPUBackend !== true)
      throw new Error('[materials] WebGPU renderer required');
    this.renderer = renderer;
    const q = ctx?.config?.q;
    const quality = ctx?.config?.quality;
    this._quality = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
    this._anisotropy = q?.anisotropy ?? 8;
    const detail = bakeDetail(this.renderer, this._size(1024));
    const macro = bakeMacro(this.renderer, 256);
    this._targets.push(detail.albedo, detail.normal, macro);
    this._shared = { detailNormal: detail.normal.texture,
      detailAlbedo: detail.albedo.texture, macro: macro.texture,
      keyDir: uniform(ctx?.peek?.('sky')?.keyDirection ?? ctx?.peek?.('render')?.sunDir ??
        new Vector3(0.4, 0.8, 0.4).normalize()),
      keyColor: uniform(new Vector3(1, 0.9, 0.8)) };
  }

  update(_dt: number, ctx: MaterialContext): void {
    const light = ctx.peek?.('sky')?.keyLight ?? ctx.peek?.('render')?.activeSun;
    if (!light || !this._shared) return;
    const direction = ctx.peek?.('sky')?.keyDirection ?? ctx.peek?.('render')?.sunDir;
    if (direction) this._shared.keyDir.value = direction;
    this._shared.keyColor.value.set(light.color.r, light.color.g, light.color.b)
      .multiplyScalar(light.intensity);
  }

  _size(base: number): number {
    const s = Math.max(128, Math.round((base * this._quality) / 128) * 128);
    return 1 << Math.round(Math.log2(s));
  }

  _resolve(name: string): keyof typeof SURFACES_TSL {
    const key = resolveName(name);
    if (Object.hasOwn(SURFACES_TSL, key)) return key as keyof typeof SURFACES_TSL;
    if (!this._missing) this._missing = new Set();
    if (!this._missing.has(name)) {
      this._missing.add(name);
      console.warn(`[materials] unknown surface "${name}" — falling back to concrete`);
    }
    return 'concrete';
  }

  getTextureSet(name: string, opts: MaterialOptions = {}): MaterialTextureSet {
    if (!this._shared) throw new Error('[materials] init before requesting textures');
    const key = this._resolve(name);
    const bake = { ...LIBRARY[key].bake, ...opts.bake };
    bake.size = this._size(bake.size);
    const cacheKey = `${key}|${bake.size}|${bake.seed}|${bake.worldSize}|${bake.relief}|${bake.tintA ?? ''}|${bake.tintB ?? ''}|${(
      bake.param ?? []).join('_')}`;
    let set = this._sets.get(cacheKey);
    if (set) return set;
    const tintA = new Color(bake.tintA ?? 0xffffff);
    const tintB = new Color(bake.tintB ?? 0xffffff);
    const args: Node[] = [uv(), float(bake.seed ?? 1)];
    if (GENERATED_SURFACES.has(key)) {
      const p = bake.param ?? [0, 0, 0, 0];
      args.push(vec3(tintA.r, tintA.g, tintA.b), vec3(tintB.r, tintB.g, tintB.b),
        vec4(p[0], p[1], p[2], p[3]));
    }
    const targets = bakeSurface(this.renderer, { size: bake.size,
      worldSize: bake.worldSize, relief: bake.relief,
      surface: (SURFACES_TSL[key] as unknown as (...nodes: Node[]) => Node)(...args) as unknown as SurfaceNode });
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

  get(name: string, opts: MaterialOptions = {}): MeshStandardNodeMaterial {
    const key = this._resolve(name);
    const matKey = key + '|' + Object.keys(opts).sort()
      .map((k) => `${k}=${JSON.stringify(opts[k])}`).join(',');
    const cached = this._materials.get(matKey);
    if (cached) return cached;
    const def = LIBRARY[key];
    const set = this.getTextureSet(key, opts);
    const p = { ...DEFAULT_PARAMS, ...def.mat, ...opts } as unknown as SurfaceParams & { bake?: MaterialOptions['bake']; three?: MaterialOptions['three'] };
    delete p.bake;
    delete p.three;
    p.groundY = opts.groundY ?? this._groundY;
    const layerCap = this.ctx?.config?.quality === 'low' ? 8 : this.ctx?.config?.quality === 'medium' ? 12 : this.ctx?.config?.quality === 'ultra' ? 32 : 16;
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
    p.tintNode = controls.tint as unknown as Node<'vec3'>;
    p.parallaxNode = controls.parallax;
    p.normalAmpNode = controls.normal;
    p.groundNode = controls.ground;
    p.weatherNode = controls.weather;
    const shared = this._shared;
    if (!shared) throw new Error('[materials] init before requesting materials');
    const mat = createSurfaceNodeMaterial(set, p, shared,
      { ...def.three, ...opts.three });
    mat.name = matKey;
    mat.userData.owParams = p;
    mat.userData.owControls = controls;
    this._materials.set(matKey, mat);
    return mat;
  }

  variant(name: string, opts: MaterialOptions = {}): MeshStandardNodeMaterial { return this.get(name, opts); }
  names(): string[] { return Object.keys(SURFACES_TSL); }
  surfaceOf(name: string): string { return LIBRARY[resolveName(name)]?.surface ?? 'concrete'; }
  bakeMasks(geometry: BufferGeometry, opts: Parameters<typeof bakeMasks>[1]): ReturnType<typeof bakeMasks> { return bakeMasks(geometry, opts); }
  setMask(geometry: BufferGeometry, opts: Parameters<typeof setMask>[1]): ReturnType<typeof setMask> { return setMask(geometry, opts); }
  get detailNormal() { return this._shared?.detailNormal ?? null; }
  get macroTexture() { return this._shared?.macro ?? null; }

  tune(material: MeshStandardNodeMaterial, changes: MaterialChanges = {}): MeshStandardNodeMaterial {
    const c = material.userData.owControls as MaterialControls | undefined;
    if (!c) return material;
    const p = material.userData.owParams as SurfaceParams;
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

  setGroundLevel(y: number): void {
    this._groundY = y;
    for (const material of this._materials.values()) this.tune(material, { groundY: y });
  }

  dispose(): void {
    for (const material of this._materials.values()) material.dispose();
    for (const target of this._targets) target.dispose();
    this._materials.clear();
    this._sets.clear();
    this._targets.length = 0;
    this._shared = null;
  }
}

export { MaterialSystemNode as MaterialSystem };
export { bakeMasks, setMask } from './masks.ts';
export { LIBRARY, resolveName } from './library.js';
