import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  mix,
  normalMap,
  normalWorldGeometry,
  normalize,
  positionWorld,
  smoothstep,
  texture,
  textureLoad,
  ivec2,
  uint,
  uv,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import {
  Color,
  FrontSide,
  MeshStandardNodeMaterial,
  Vector4,
  DataTexture,
  FloatType,
  RGBAFormat,
} from 'three/webgpu';
import type { DataArrayTexture } from 'three/webgpu';
import type { Node, Texture } from 'three/webgpu';
import type { TextureNode, VaryingNode } from 'three/webgpu';

import { isClosable } from '../core/guards.ts';
import { loadPngTexture } from '../core/pngtex.ts';
import { soldierSurface } from './soldier.ts';
import type { VariantName } from './soldier.ts';
import { soldierTextureArray } from './texture-array.ts';
import { isRecord, isNumber, isStringArray } from './validation.ts';

// Authored silhouette darkening against bright sky: confine it to the grazing
// sliver, using geometric normals so detail-map noise cannot make the band crawl.
const RIM = { strength: 0.62, edge: 0.42, power: 1.9 };

// Extend the documented output hook, before native fog/premultiplied alpha.
// A node property participates in Three's copy and material cache-key paths.
class SoldierNodeMaterial extends MeshStandardNodeMaterial {
  declare rimNode: Node<'float'>;

  constructor(
    parameters: ConstructorParameters<typeof MeshStandardNodeMaterial>[0] = {},
    rimScale: number | Node<'float'> = 1
  ) {
    super(parameters);
    const view = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(view, normalize(normalWorldGeometry)));
    this.rimNode = smoothstep(RIM.edge, 1, float(1).sub(facing))
      .pow(RIM.power)
      .mul(RIM.strength)
      .mul(rimScale);
  }

  override setupOutput(
    builder: Parameters<MeshStandardNodeMaterial['setupOutput']>[0],
    output: Parameters<MeshStandardNodeMaterial['setupOutput']>[1] & {
      rgb: ReturnType<typeof vec3>;
      a: ReturnType<typeof float>;
    }
  ): ReturnType<MeshStandardNodeMaterial['setupOutput']> {
    return super.setupOutput(builder, vec4(mix(output.rgb, vec3(0), this.rimNode), output.a));
  }
}

export interface CamoStats {
  mean: number;
  was: number;
  min: number;
  max: number;
  sd: number;
}
interface SoldierManifest {
  sets?: string[] | undefined;
  details?: string[] | undefined;
  camoStats?: Record<string, CamoStats>;
}
function parseManifest(value: unknown): SoldierManifest {
  if (!isRecord(value)) throw new Error('[ai] invalid proc manifest');
  for (const key of ['sets', 'details']) {
    if (value[key] !== undefined && !isStringArray(value[key]))
      throw new Error(`[ai] invalid proc ${key}`);
  }
  const camoStats: Record<string, CamoStats> = {};
  if (value.camoStats !== undefined) {
    if (!isRecord(value.camoStats)) throw new Error('[ai] invalid camouflage statistics');
    for (const [key, stat] of Object.entries(value.camoStats)) {
      if (
        !isRecord(stat) ||
        !isNumber(stat.mean) ||
        !isNumber(stat.was) ||
        !isNumber(stat.min) ||
        !isNumber(stat.max) ||
        !isNumber(stat.sd)
      )
        throw new Error(`[ai] invalid camouflage statistics: ${key}`);
      camoStats[key] = {
        mean: stat.mean,
        was: stat.was,
        min: stat.min,
        max: stat.max,
        sd: stat.sd,
      };
    }
  }
  return {
    sets: isStringArray(value.sets) ? value.sets : undefined,
    details: isStringArray(value.details) ? value.details : undefined,
    camoStats,
  };
}

interface SoldierTextureSet {
  albedo: Texture;
  orm: Texture;
  normal: Texture;
}
interface SoldierDetail {
  set: string;
  scale: number;
  normal: number;
  rough: number;
  texture?: Texture;
}
export interface SoldierMaterialOptions {
  tint?: readonly [number, number, number];
  side?: typeof FrontSide;
  rough?: number;
  metal?: number;
  ao?: number;
  rim?: number;
  normalScale?: number;
  name?: string;
  key?: string;
  detail?: Omit<SoldierDetail, 'texture'>;
}

/** Soldier maps retain their CPU-authored camouflage, packed ORM and GLB UVs. */
export function createSoldierNodeMaterial(
  set: SoldierTextureSet,
  opts: SoldierMaterialOptions = {},
  detail: SoldierDetail | null = null
): SoldierNodeMaterial {
  const color = opts.tint
    ? new Color(opts.tint[0], opts.tint[1], opts.tint[2])
    : new Color(1, 1, 1);
  const mat = new SoldierNodeMaterial(
    {
      vertexColors: true,
      side: opts.side ?? FrontSide,
      dithering: true,
      roughness: opts.rough ?? 1,
      metalness: opts.metal ?? 1,
      color,
    },
    opts.rim ?? 1
  );
  const baseUv = uv();
  const orm = texture(set.orm, baseUv);
  mat.colorNode = texture(set.albedo, baseUv).rgb.mul(vec3(color.r, color.g, color.b));
  mat.aoNode = float(1).add(orm.r.sub(1).mul(opts.ao ?? 0.85));
  const detailSample = detail ? texture(detail.texture, baseUv.mul(detail.scale)) : null;
  mat.roughnessNode = clamp(
    orm.g
      .mul(opts.rough ?? 1)
      .add(detailSample ? detailSample.a.sub(0.5).mul(detail?.rough ?? 0) : 0),
    0.04,
    1
  );
  mat.metalnessNode = orm.b.mul(opts.metal ?? 1);
  const n = texture(set.normal, baseUv).rgb.mul(2).sub(1);
  const slope = detailSample
    ? detailSample.xy
        .mul(2)
        .sub(1)
        .mul(detail?.normal ?? 0)
    : 0;
  const combined = normalize(vec3(n.xy.mul(opts.normalScale ?? 1).add(slope), n.z));
  mat.normalNode = normalMap(combined.mul(0.5).add(0.5));
  mat.name = opts.name ?? 'ai_node';
  return mat;
}

/** Committed procedural GLB maps, no WebGL material or shader dependency. */
export class SoldierMaterialsNode {
  declare sets: Record<string, SoldierTextureSet>;
  declare details: Record<string, Texture>;
  declare camoStats: Record<string, CamoStats>;
  declare bakeMs: number;
  declare materials: Map<string, SoldierNodeMaterial>;
  declare combined: Map<VariantName, SoldierNodeMaterial>;
  declare layers: Map<string, number>;
  declare surfaceTables: DataTexture[];
  declare arrays: Record<'albedo' | 'orm' | 'normal' | 'detail', DataArrayTexture> | null;

  static async fromCache({
    base = 'models/proc',
    anisotropy = 8,
  }: { base?: string; anisotropy?: number } = {}): Promise<SoldierMaterialsNode> {
    const response = await fetch(`${base}/manifest.json`);
    if (!response.ok) throw new Error(`[ai] proc manifest HTTP ${response.status}`);
    const data: unknown = await response.json();
    const manifest = parseManifest(data);
    const load = (name: string, srgb: boolean): Promise<Texture> =>
      loadPngTexture(`${base}/${name}.png`, { srgb, aniso: anisotropy });
    const sets: Record<string, SoldierTextureSet> = {};
    await Promise.all(
      (manifest.sets ?? []).map(async (name): Promise<void> => {
        const [albedo, orm, normal] = await Promise.all([
          load(`ai-${name}-albedo`, true),
          load(`ai-${name}-orm`, false),
          load(`ai-${name}-normal`, false),
        ]);
        sets[name] = { albedo, orm, normal };
      })
    );
    const details: Record<string, Texture> = {};
    await Promise.all(
      (manifest.details ?? []).map(async (name): Promise<void> => {
        details[name] = await load(`ai-detail-${name}`, false);
      })
    );
    const library = new SoldierMaterialsNode(sets, details, manifest.camoStats ?? {});
    const names = Object.keys(sets);
    library.layers = new Map([...names, 'glass'].map((name, i): [string, number] => [name, i]));
    const maps = (field: keyof SoldierTextureSet): (Texture | null)[] => [
      ...names.map((name): Texture => sets[name][field]),
      null,
    ];
    library.arrays = {
      albedo: soldierTextureArray(maps('albedo'), [255, 255, 255, 255], true, anisotropy),
      orm: soldierTextureArray(maps('orm'), [255, 255, 0, 255], false, anisotropy),
      normal: soldierTextureArray(maps('normal'), [128, 128, 255, 255], false, anisotropy),
      detail: soldierTextureArray(
        [details.cloth, details.nylon],
        [128, 128, 255, 128],
        false,
        anisotropy
      ),
    };
    return library;
  }

  constructor(
    sets: Record<string, SoldierTextureSet>,
    details: Record<string, Texture>,
    camoStats: Record<string, CamoStats> = {}
  ) {
    this.sets = sets;
    this.details = details;
    this.camoStats = camoStats;
    this.bakeMs = 0;
    this.materials = new Map();
    this.combined = new Map();
    this.layers = new Map();
    this.surfaceTables = [];
    this.arrays = null;
  }

  get(setName: string, opts: SoldierMaterialOptions = {}): SoldierNodeMaterial {
    const detail = opts.detail;
    const key = `${setName}|${opts.key ?? ''}|${(opts.tint ?? []).join(',')}|${opts.rough ?? ''}|${
      opts.metal ?? ''
    }|${opts.ao ?? 0.85}|${opts.normalScale ?? 1}|${opts.rim ?? 1}|${opts.side ?? FrontSide}|${
      detail ? `${detail.set},${detail.scale},${detail.normal},${detail.rough}` : ''
    }`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    const set = this.sets[setName];
    if (!set) throw new Error(`[ai] unknown material set "${setName}"`);
    const d =
      detail && this.details[detail.set] ? { ...detail, texture: this.details[detail.set] } : null;
    mat = createSoldierNodeMaterial(set, { ...opts, name: `ai_${setName}` }, d);
    this.materials.set(key, mat);
    return mat;
  }

  glass(tint: readonly [number, number, number] = [0.06, 0.07, 0.08]): SoldierNodeMaterial {
    const key = `glass|${tint.join(',')}`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    // Half-strength rim preserves the goggle sheen without blooming into sky.
    mat = new SoldierNodeMaterial(
      {
        color: new Color(...tint),
        roughness: 0.11,
        metalness: 0,
        vertexColors: true,
        envMapIntensity: 1.4,
      },
      0.5
    );
    mat.name = 'ai_glass';
    this.materials.set(key, mat);
    return mat;
  }

  /** One opaque material per variant; every triangle selects its authored finish. */
  soldier(name: VariantName, slots: readonly string[]): SoldierNodeMaterial {
    const cached = this.combined.get(name);
    if (cached) return cached;
    if (!this.arrays) throw new Error('[ai] soldier texture arrays are not loaded');
    const colors: Vector4[] = [],
      base: Vector4[] = [],
      detail: Vector4[] = [];
    for (const slot of slots) {
      const { set, options: o } = soldierSurface(name, slot);
      const layer = this.layers.get(set);
      if (layer === undefined) throw new Error(`[ai] missing soldier texture layer ${set}`);
      colors.push(new Vector4(...(o.tint ?? [1, 1, 1]), layer));
      base.push(new Vector4(o.rough ?? 1, o.metal ?? 1, o.ao ?? 0.85, o.normalScale ?? 1));
      detail.push(
        new Vector4(
          o.detail?.scale ?? 0,
          o.detail?.set === 'nylon' ? 1 : 0,
          o.detail?.normal ?? 0,
          o.detail?.rough ?? 0
        )
      );
    }
    const surface = varying(attribute('soldierSurface', 'float')).setInterpolation('flat').toUint();
    // A tiny immutable lookup texture stays in the native material bindings.
    // Another shared uniform group would exceed the game's four-group limit.
    const pixels = new Float32Array(slots.length * 3 * 4);
    [colors, base, detail].forEach((row, y): void =>
      row.forEach((value, x): ArrayLike<number> =>
        value.toArray(pixels, (y * slots.length + x) * 4)
      )
    );
    const table = new DataTexture(pixels, slots.length, 3, RGBAFormat, FloatType);
    table.needsUpdate = true;
    this.surfaceTables.push(table);
    // Resolve finishes at vertices, not with dependent lookups at every pixel.
    const read = (row: number): VaryingNode<'vec4'> =>
      varying(textureLoad(table, ivec2(surface.toInt(), row))).setInterpolation('flat');
    const c = read(0),
      b = read(1),
      d = read(2);
    const rim = surface.equal(uint(slots.indexOf('glass'))).select(0.5, 1);
    const mat = new SoldierNodeMaterial(
      { vertexColors: true, side: FrontSide, dithering: true },
      rim
    );
    const coords = uv();
    const sample = (map: DataArrayTexture): TextureNode<'vec4'> => texture(map, coords).depth(c.w);
    const orm = sample(this.arrays.orm);
    const micro = texture(this.arrays.detail, coords.mul(d.x)).depth(d.y);
    mat.colorNode = sample(this.arrays.albedo).rgb.mul(c.rgb);
    mat.aoNode = float(1).add(orm.r.sub(1).mul(b.z));
    mat.roughnessNode = clamp(orm.g.mul(b.x).add(micro.a.sub(0.5).mul(d.w)), 0.04, 1);
    mat.metalnessNode = orm.b.mul(b.y);
    const n = sample(this.arrays.normal).rgb.mul(2).sub(1);
    const slope = micro.xy.mul(2).sub(1).mul(d.z);
    const normal = normalize(vec3(n.xy.mul(b.w).add(slope), n.z));
    mat.normalNode = normalMap(normal.mul(0.5).add(0.5));
    mat.name = `ai_${name}`;
    this.combined.set(name, mat);
    return mat;
  }

  dispose(): void {
    for (const mat of this.combined.values()) mat.dispose();
    for (const array of Object.values(this.arrays ?? {})) array.dispose();
    this.arrays = null;
    for (const table of this.surfaceTables) table.dispose();
    this.surfaceTables.length = 0;
    for (const mat of this.materials.values()) mat.dispose();
    for (const set of Object.values(this.sets)) {
      for (const texture of [set.albedo, set.orm, set.normal]) {
        texture.dispose();
        const image = texture.image;
        if (isClosable(image)) image.close();
      }
    }
    for (const texture of Object.values(this.details)) {
      texture.dispose();
      const image = texture.image;
      if (isClosable(image)) image.close();
    }
    this.materials.clear();
    this.combined.clear();
  }
}
