import { Color, FrontSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { loadPngTexture } from '../core/pngtex.ts';
import { abs, cameraPosition, clamp, dot, float, mix, normalMap,
  normalWorldGeometry, normalize, positionWorld, smoothstep, texture, uv,
  vec3, vec4 } from 'three/tsl';

// Authored silhouette darkening against bright sky: confine it to the grazing
// sliver, using geometric normals so detail-map noise cannot make the band crawl.
const RIM = { strength: 0.62, edge: 0.42, power: 1.9 };

// Extend the documented output hook, before native fog/premultiplied alpha.
// A node property participates in Three's copy and material cache-key paths.
class SoldierNodeMaterial extends MeshStandardNodeMaterial {
  constructor(parameters, rimScale = 1) {
    super(parameters);
    const view = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(view, normalize(normalWorldGeometry)));
    this.rimNode = smoothstep(RIM.edge, 1, float(1).sub(facing))
      .pow(RIM.power).mul(RIM.strength * rimScale);
  }

  setupOutput(builder, output) {
    return super.setupOutput(builder, vec4(mix(output.rgb, vec3(0), this.rimNode), output.a));
  }
}

/** Soldier maps retain their CPU-authored camouflage, packed ORM and GLB UVs. */
export function createSoldierNodeMaterial(set, opts = {}, detail = null) {
  const color = opts.tint ? new Color(opts.tint[0], opts.tint[1], opts.tint[2]) : new Color(1, 1, 1);
  const mat = new SoldierNodeMaterial({ vertexColors: true,
    side: opts.side ?? FrontSide, dithering: true, roughness: opts.rough ?? 1,
    metalness: opts.metal ?? 1, color }, opts.rim ?? 1);
  const baseUv = uv();
  const orm = texture(set.orm, baseUv);
  mat.colorNode = texture(set.albedo, baseUv).rgb.mul(vec3(color.r, color.g, color.b));
  mat.aoNode = float(1).add(orm.r.sub(1).mul(opts.ao ?? 0.85));
  const detailSample = detail ? texture(detail.texture, baseUv.mul(detail.scale)) : null;
  mat.roughnessNode = clamp(orm.g.mul(opts.rough ?? 1)
    .add(detailSample ? detailSample.a.sub(0.5).mul(detail.rough) : 0), 0.04, 1);
  mat.metalnessNode = orm.b.mul(opts.metal ?? 1);
  const n = texture(set.normal, baseUv).rgb.mul(2).sub(1);
  const slope = detailSample ? detailSample.xy.mul(2).sub(1).mul(detail.normal) : 0;
  const combined = normalize(vec3(n.xy.mul(opts.normalScale ?? 1).add(slope), n.z));
  mat.normalNode = normalMap(combined.mul(0.5).add(0.5));
  mat.name = opts.name ?? 'ai_node';
  return mat;
}

/** Committed procedural GLB maps, no WebGL material or shader dependency. */
export class SoldierMaterialsNode {
  static async fromCache({ base = 'models/proc', anisotropy = 8 } = {}) {
    const response = await fetch(`${base}/manifest.json`);
    if (!response.ok) throw new Error(`[ai] proc manifest HTTP ${response.status}`);
    const manifest = await response.json();
    const load = (name, srgb) => loadPngTexture(`${base}/${name}.png`,
      { srgb, aniso: anisotropy });
    const sets = {};
    await Promise.all((manifest.sets ?? []).map(async (name) => {
      const [albedo, orm, normal] = await Promise.all([
        load(`ai-${name}-albedo`, true), load(`ai-${name}-orm`, false),
        load(`ai-${name}-normal`, false),
      ]);
      sets[name] = { albedo, orm, normal };
    }));
    const details = {};
    await Promise.all((manifest.details ?? []).map(async (name) => {
      details[name] = await load(`ai-detail-${name}`, false);
    }));
    return new SoldierMaterialsNode(sets, details, manifest.camoStats ?? {});
  }

  constructor(sets, details, camoStats = {}) {
    this.sets = sets;
    this.details = details;
    this.camoStats = camoStats;
    this.bakeMs = 0;
    this.materials = new Map();
  }

  get(setName, opts = {}) {
    const detail = opts.detail;
    const key = `${setName}|${opts.key ?? ''}|${(opts.tint ?? []).join(',')}|${opts.rough ?? ''}|${
      opts.metal ?? ''}|${opts.ao ?? .85}|${opts.normalScale ?? 1}|${opts.rim ?? 1}|${opts.side ?? FrontSide}|${
      detail ? `${detail.set},${detail.scale},${detail.normal},${detail.rough}` : ''}`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    const set = this.sets[setName];
    if (!set) throw new Error(`[ai] unknown material set "${setName}"`);
    const d = detail && this.details[detail.set]
      ? { ...detail, texture: this.details[detail.set] } : null;
    mat = createSoldierNodeMaterial(set, { ...opts, name: `ai_${setName}` }, d);
    this.materials.set(key, mat);
    return mat;
  }

  glass(tint = [0.06, 0.07, 0.08]) {
    const key = `glass|${tint.join(',')}`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    // Half-strength rim preserves the goggle sheen without blooming into sky.
    mat = new SoldierNodeMaterial({
      color: new Color(...tint), roughness: 0.11, metalness: 0,
      vertexColors: true, envMapIntensity: 1.4,
    }, 0.5);
    mat.name = 'ai_glass';
    this.materials.set(key, mat);
    return mat;
  }

  dispose() {
    for (const mat of this.materials.values()) mat.dispose();
    for (const set of Object.values(this.sets))
      for (const texture of Object.values(set)) texture.dispose();
    for (const texture of Object.values(this.details)) texture.dispose();
    this.materials.clear();
  }
}
