import { Color, MeshStandardNodeMaterial } from 'three/webgpu';
import { loadPngTexture } from '../core/pngtex.js';
import { abs, cameraPosition, clamp, dot, float, mix, normalMap,
  normalWorldGeometry, normalize, positionWorld, smoothstep, texture, uv,
  vec3, vec4 } from 'three/tsl';

/** Soldier maps retain their CPU-authored camouflage, packed ORM and GLB UVs. */
export function createSoldierNodeMaterial(set, opts = {}, detail = null) {
  const color = opts.tint ? new Color(opts.tint[0], opts.tint[1], opts.tint[2]) : new Color(1, 1, 1);
  const mat = new MeshStandardNodeMaterial({ vertexColors: true,
    side: opts.side, dithering: true, roughness: opts.rough ?? 1,
    metalness: opts.metal ?? 1, color });
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
  attachSilhouetteRim(mat, opts.rim ?? 1);
  mat.name = opts.name ?? 'ai_node';
  return mat;
}

function attachSilhouetteRim(mat, rimScale) {
  // Match the authored RIM values in textures.js; darken the *lit* result,
  // including metal specular. Normal-map noise cannot shift this rim band.
  const strength = 0.62 * rimScale;
  const previous = mat.setupOutput;
  mat.setupOutput = function (builder, output) {
    const view = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(view, normalize(normalWorldGeometry)));
    const rim = smoothstep(0.42, 1, float(1).sub(facing)).pow(1.9).mul(strength);
    return previous.call(this, builder, vec4(mix(output.rgb, vec3(0), rim), output.a));
  };
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
      opts.metal ?? ''}|${detail ? `${detail.set},${detail.scale},${detail.normal},${detail.rough}` : ''}`;
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
    let mat = this.materials.get('glass');
    if (mat) return mat;
    mat = new MeshStandardNodeMaterial({
      color: new Color(...tint), roughness: 0.11, metalness: 0,
      vertexColors: true, envMapIntensity: 1.4,
    });
    mat.name = 'ai_glass';
    attachSilhouetteRim(mat, 0.5);
    this.materials.set('glass', mat);
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
