import { Color, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { Fn, abs, cameraPosition, cameraViewMatrix, clamp, dot, float, fract, frontFacing,
  length, max, mix, modelWorldMatrixInverse, normalLocal, normalMap,
  normalWorldGeometry, normalize, positionLocal, positionWorld, smoothstep,
  step, texture, transformNormalToView,
  struct, uv, vec2, vec3, vec4, vertexColor } from 'three/tsl';
import { hash11 } from './noise-tsl.js';

const MaterialChannels = struct({ color: 'vec3', opacity: 'float', normal: 'vec3',
  rough: 'float', metal: 'float', ao: 'float' });

const tint = (hex) => {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
};
const sample = (map, coords) => texture(map, coords);
const axisNormal = (n, axis, sign) => axis === 0
  ? vec3(sign.mul(n.z), n.y, sign.negate().mul(n.x))
  : axis === 1 ? vec3(n.x, sign.mul(n.z), sign.negate().mul(n.y))
    : vec3(sign.mul(n.x), n.y, sign.mul(n.z));

// Geometry-based frame, independent of the sampled normal and the derivative
// of the fragment UV. World projection works on GLBs with no useful UVs.
function axisFrame(p, n, axis, scale, offset) {
  const s = step(0, n.element(axis)).mul(2).sub(1);
  const coords = axis === 0 ? vec2(p.z.negate().mul(s), p.y)
    : axis === 1 ? vec2(p.x, p.z.negate().mul(s))
      : vec2(p.x.mul(s), p.y);
  return { uv: coords.mul(scale).add(offset), sign: s, axis };
}

function runoff(sAxis, y, wobble) {
  const u = sAxis.mul(1.55), cell = u.floor(), lat = fract(u);
  const r0 = hash11(cell.mul(1.37).add(3.1));
  const r1 = hash11(cell.mul(2.71).add(11.7));
  const src = smoothstep(0.30, 0.62, r0).mul(r1.mul(0.45).add(0.55))
    .mul(lat.mul(3.14159265).sin().pow(2)).mul(r0.mul(0.45).add(0.8));
  const jitter = r1.mul(1.2).add(r0.mul(0.5));
  const below = y.add(jitter).div(2.85).floor().add(1).mul(2.85)
    .sub(jitter).add(wobble.mul(0.2)).sub(y);
  const run = smoothstep(0, 0.15, below)
    .mul(smoothstep(0.15, 1.65, below).oneMinus());
  return { amount: clamp(run.mul(src), 0, 1), random: r1, below };
}

/**
 * Strict-WebGPU node material for the packed procedural surface textures.
 * `p` is the merged library/variant parameter record; `shared` holds the
 * detail albedo/normal and macro maps. Owns neither the input textures nor the
 * baked geometry. Keeps vertex RGBA as wear/grime/AO/tint masks, not albedo.
 */
export function createSurfaceNodeMaterial(set, p, shared, threeProps = {}) {
  const { physical, ...props } = threeProps;
  const Ctor = physical ? MeshPhysicalNodeMaterial : MeshStandardNodeMaterial;
  const mat = new Ctor({ color: 0xffffff, roughness: 1, metalness: 1,
    dithering: true, ...props });
  const channels = Fn(() => {
  const projected = p.uvMode !== 'mesh';
  const scale = p.tileNode ?? (projected ? 1 / p.scale : p.scale);
  const normalAmp = p.normalAmpNode ?? p.normalStrength;
  const weather = p.weatherNode ?? vec4(...p.weather);
  const offset = vec2(...p.offset);
  const worldP = positionWorld, worldN = normalize(normalWorldGeometry);
  const localP = positionLocal, localN = normalize(normalLocal);
  const surfP = p.localSpace ? localP : worldP;
  const surfN = p.localSpace ? localN : worldN;
  const faceN = frontFacing.select(surfN, surfN.negate());

  const fx = axisFrame(surfP, faceN, 0, scale, offset);
  const fy = axisFrame(surfP, faceN, 1, scale, offset);
  const fz = axisFrame(surfP, faceN, 2, scale, offset);
  const weight = abs(faceN).pow(vec3(5));
  const w = weight.div(max(weight.x.add(weight.y).add(weight.z), 0.0001));
  const dominant = w.x.greaterThan(w.y).and(w.x.greaterThan(w.z)).select(float(0),
    w.y.greaterThan(w.z).select(float(1), float(2)));
  const frame = {
    uv: dominant.equal(0).select(fx.uv, dominant.equal(1).select(fy.uv, fz.uv)),
    sign: dominant.equal(0).select(fx.sign, dominant.equal(1).select(fy.sign, fz.sign)),
  };
  const baseUV = projected ? frame.uv : uv().mul(scale).add(offset);
  const dist = length(cameraPosition.sub(worldP));
  let coords = baseUV;
  // Single offset sample: keeps close-up tile relief without a divergent march
  // or unstable implicit mip gradients. Parallax fades to zero at range.
  if (p.parallax > 0 && p.uvMode === 'planar') {
    const view = p.localSpace
      ? normalize(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.sub(localP))
      : normalize(cameraPosition.sub(worldP));
    const s = frame.sign;
    const vT = dominant.equal(0).select(vec2(view.z.negate().mul(s), view.y),
      dominant.equal(1).select(vec2(view.x, view.z.negate().mul(s)),
        vec2(view.x.mul(s), view.y)));
    const vZ = max(abs(dot(view, faceN)), 0.3);
    const fade = smoothstep(p.parallaxFade[0], p.parallaxFade[1], dist).oneMinus();
    const h = sample(set.albedo, baseUV).a;
    coords = baseUV.sub(vT.div(vZ).mul(h.sub(0.5))
      .mul(float(p.parallaxNode ?? p.parallax).mul(scale)).mul(fade));
  }

  let alb, orm, nT, nP;
  const unpack = (tex) => normalize(vec3(tex.r.mul(2).sub(1).mul(normalAmp),
    tex.g.mul(2).sub(1).mul(normalAmp), tex.b.mul(2).sub(1)));
  const mapAt = (f) => sample(set.albedo, f.uv);
  const ormAt = (f) => sample(set.orm, f.uv).rgb;
  const normalAt = (f) => unpack(sample(set.normal, f.uv));
  if (p.uvMode === 'triplanar') {
    alb = mapAt(fx).mul(w.x).add(mapAt(fy).mul(w.y)).add(mapAt(fz).mul(w.z)).toVar();
    orm = ormAt(fx).mul(w.x).add(ormAt(fy).mul(w.y)).add(ormAt(fz).mul(w.z)).toVar();
    nP = normalize(axisNormal(normalAt(fx), 0, fx.sign).mul(w.x)
      .add(axisNormal(normalAt(fy), 1, fy.sign).mul(w.y))
      .add(axisNormal(normalAt(fz), 2, fz.sign).mul(w.z))).toVar();
  } else {
    alb = sample(set.albedo, coords).toVar();
    orm = sample(set.orm, coords).rgb.toVar();
    nT = unpack(sample(set.normal, coords)).toVar();
    if (p.detile > 0) {
      const coords2 = vec2(coords.x.mul(0.803).sub(coords.y.mul(0.596)),
        coords.x.mul(0.596).add(coords.y.mul(0.803))).mul(0.617)
        .add(vec2(0.37, 0.71));
      const alb2 = sample(set.albedo, coords2);
      const orm2 = sample(set.orm, coords2).rgb;
      const n2 = unpack(sample(set.normal, coords2));
      const blend = clamp(sample(shared.macro, surfP.xz.add(surfP.y.mul(0.7))
        .mul(p.macro[0] * 5).add(0.21)).g.sub(0.36).mul(2.4), 0, 1)
        .mul(p.detile);
      const weightA = float(1).sub(blend).add(alb.a.mul(0.6)).toVar();
      const weightB = blend.add(alb2.a.mul(0.6)).toVar();
      const threshold = max(weightA, weightB).sub(0.18);
      weightA.assign(max(weightA.sub(threshold), 0));
      weightB.assign(max(weightB.sub(threshold), 0));
      const inv = float(1).div(max(weightA.add(weightB), 0.0001));
      alb.assign(alb.mul(weightA).add(alb2.mul(weightB)).mul(inv));
      orm.assign(orm.mul(weightA).add(orm2.mul(weightB)).mul(inv));
      nT.assign(normalize(nT.mul(weightA).add(n2.mul(weightB))));
    }
    nP = dominant.equal(0).select(axisNormal(nT, 0, fx.sign),
      dominant.equal(1).select(axisNormal(nT, 1, fy.sign),
        axisNormal(nT, 2, fz.sign))).toVar();
  }

  const detailTiles = p.uvMode === 'mesh' || !(p.detailWorld > 0) || p.scale < 0.3
    ? p.detail[0] : Math.max(1.2, p.scale / p.detailWorld);
  const detUV = (p.uvMode === 'triplanar' ? frame.uv : coords).mul(detailTiles);
  const detFade = smoothstep(p.detail[3] * 0.45, p.detail[3], dist).oneMinus();
  const micro = sample(shared.detailAlbedo, detUV);
  const tooth = micro.a.sub(0.5).mul(2);
  const dn = sample(shared.detailNormal, detUV).rgb.mul(2).sub(1);
  alb.rgb.mulAssign(float(1).add(tooth.mul(0.95)
    .add(micro.r.sub(0.5).mul(1.25)).mul(p.detail[2]).mul(detFade)));
  orm.r.mulAssign(float(1).sub(max(tooth.negate(), 0)
    .mul(0.30 * p.detail[2]).mul(detFade)));
  const height = clamp(alb.a.add(tooth.mul(0.16).mul(detFade)), 0, 1).toVar();
  if (p.uvMode === 'mesh') {
    nT = normalize(vec3(nT.xy.add(dn.xy.mul(p.detail[1]).mul(detFade)), nT.z));
  } else {
    const dP = dominant.equal(0).select(axisNormal(dn, 0, fx.sign),
      dominant.equal(1).select(axisNormal(dn, 1, fy.sign),
        axisNormal(dn, 2, fz.sign)));
    const component = dP.sub(faceN.mul(dot(dP, faceN)));
    nP.assign(normalize(nP.add(component.mul(p.detail[1]).mul(detFade))));
  }

  // Broad and huge bands use WORLD coordinates even on locally projected props.
  const macroUV = step(0.62, abs(worldN.y)).greaterThan(0.5)
    .select(worldP.xz, vec2(worldP.x.add(worldP.z.mul(0.63)), worldP.y));
  const mac1 = sample(shared.macro, macroUV.mul(p.macro[0]));
  const mac2 = sample(shared.macro, macroUV.mul(p.macro[0] * 0.211).add(0.37));
  const macro = clamp(mac1.r.mul(0.55).add(mac2.b.mul(0.45)).sub(0.5)
    .mul(p.macroBig[0]).add(0.5), 0, 1);
  alb.rgb.mulAssign(mix(1, macro.mul(0.92).add(0.55), p.macro[1]));
  if (p.macroBig[1] > 0) {
    const bigUV = macroUV.mul(p.macroBig[2]);
    const big = clamp(sample(shared.macro, bigUV).r.mul(0.62)
      .add(sample(shared.macro, bigUV.mul(0.37).add(0.61)).b.mul(0.38))
      .sub(0.5).mul(2.3), -1, 1);
    alb.rgb.mulAssign(big.mul(p.macroBig[1]).add(1));
    orm.g.assign(clamp(orm.g.sub(big.mul(p.macroBig[1] * 0.55)), 0, 1));
  }
  alb.rgb.mulAssign(mix(vec3(1), vec3(1.05, 1, 0.93), mac2.r.sub(0.5).mul(p.macro[3])));
  orm.g.assign(clamp(orm.g.add(mac1.g.sub(0.5).mul(p.macro[2]))
    .add(mac1.a.sub(0.5).mul(0.16)).sub(tooth.mul(0.07).mul(detFade)), 0, 1));
  if (p.macroRelief > 0 && projected && !p.localSpace) {
    const mUV = macroUV.mul(p.macro[0]);
    const dx = sample(shared.macro, mUV.add(vec2(0.035, 0))).b.sub(mac1.b);
    const dy = sample(shared.macro, mUV.add(vec2(0, 0.035))).b.sub(mac1.b);
    const up = step(0.62, abs(worldN.y));
    const tilt = vec3(dx.negate(), 0, dy.negate()).mul(p.macroRelief).mul(up);
    nP.assign(normalize(nP.add(tilt.sub(worldN.mul(dot(worldN, tilt))))));
    alb.rgb.mulAssign(float(1).sub(mac1.b.sub(0.5).mul(0.16).mul(up)));
  }

  const vertical = smoothstep(0.34, 0.72, abs(worldN.y)).oneMinus();
  const sAxis = worldP.z.mul(worldN.x).sub(worldP.x.mul(worldN.z));
  if (p.patch?.[0] > 0) {
    const cell = vec2(sAxis, worldP.y).div(Math.max(p.patch[1], 0.4))
      .add(mac2.rg.sub(0.5).mul(0.35));
    const id = cell.floor(), cf = cell.sub(id);
    const r0 = hash11(id.x.mul(7.31).add(id.y.mul(13.77)).add(5.1));
    const r1 = hash11(id.x.mul(3.17).add(id.y.mul(9.41)).add(21.3));
    const r2 = hash11(id.x.mul(11.93).add(id.y.mul(4.73)).add(37.7));
    const r3 = hash11(id.x.mul(5.51).add(id.y.mul(17.29)).add(53.9));
    const lo = vec2(r1.mul(0.30).add(0.05), r2.mul(0.30).add(0.05));
    const hi = vec2(r2.mul(0.26).negate().add(0.95),
      r3.mul(0.26).negate().add(0.95));
    const feather = r1.mul(0.030).add(0.028);
    const a0 = smoothstep(lo, lo.add(feather), cf);
    const a1 = smoothstep(hi.sub(feather), hi, cf).oneMinus();
    const mask = a0.x.mul(a0.y).mul(a1.x).mul(a1.y)
      .mul(step(1 - p.patch[0], r0)).mul(vertical);
    const warm = r3.greaterThan(0.48);
    const sign = warm.select(float(1), float(-1));
    alb.rgb.mulAssign(float(1).add(sign.mul(p.patch[2]).mul(mask)));
    alb.rgb.mulAssign(mix(vec3(1), warm.select(vec3(0.975, 0.988, 1.020),
      vec3(1.030, 1.008, 0.968)), mask));
    orm.g.assign(clamp(orm.g.add(mask.mul(p.patch[3])), 0, 1));
    const lip = mask.mul(float(1).sub(mask)).mul(4);
    alb.rgb.mulAssign(lip.mul(0.13).add(1));
    height.assign(clamp(height.add(mask.mul(0.07)).add(lip.mul(0.05)), 0, 1));
  }
  if (p.weather.some((x) => x > 0)) {
    const dust = clamp(worldN.y, 0, 1).pow(2).mul(weather.x)
      .mul(smoothstep(0.30, 0.80, mac1.b.mul(0.7).add(mac2.g.mul(0.5))));
    alb.rgb.assign(mix(alb.rgb, tint(p.dustColor), dust.mul(0.75)));
    orm.g.assign(clamp(orm.g.add(dust.mul(0.30)), 0, 1));
    orm.b.mulAssign(float(1).sub(dust.mul(0.85)));
    const sN = sample(shared.macro, vec2(sAxis.mul(0.46), worldP.y.mul(0.155))).a;
    const sFine = sample(shared.macro, vec2(sAxis.mul(1.35).add(0.4), worldP.y.mul(0.42))).g;
    const run = runoff(sAxis, worldP.y, sN.sub(0.5));
    const streak = clamp(vertical.mul(run.amount)
      .mul(clamp(weather.y.mul(2.2), 0, 1.15))
      .mul(smoothstep(0.30, 0.66, sN.mul(0.72).add(sFine.mul(0.38)))), 0, 1).toVar();
    if (p.vertexMasks) {
      const v = vertexColor();
      streak.assign(clamp(streak.mul(clamp(v.g.mul(1.5).add(v.b.mul(0.6)),
        0, 1).mul(0.75).add(0.45)).add(smoothstep(0.58, 0.98, v.g)
        .mul(vertical).mul(smoothstep(0.20, 0.70, sN.mul(0.6)
          .add(sFine.mul(0.55))).mul(0.45).add(0.55))), 0, 1));
    }
    const rust = clamp(step(0.86, run.random).mul(0.9)
      .add(orm.b.mul(0.5)), 0, 1).mul(float(1).sub(smoothstep(0.1, 0.9,
      run.below)).mul(0.70).add(0.30));
    const runoffColor = mix(alb.rgb.mul(0.72), tint(p.grimeColor), 0.26);
    alb.rgb.assign(mix(alb.rgb, mix(runoffColor,
      mix(alb.rgb.mul(0.94), tint(p.rustColor), 0.5), rust), streak));
    orm.g.assign(clamp(orm.g.add(streak.mul(0.09)), 0, 1));
    orm.b.mulAssign(float(1).sub(streak.mul(0.35)));
    const above = worldP.y.sub(p.groundNode ?? p.groundY);
    const band = smoothstep(0.02, 0.22, above).oneMinus();
    const spray = smoothstep(0.10, max(weather.z, 0.101), above).oneMinus();
    const splash = vertical.mul(max(band, spray.pow(2).mul(0.85)))
      .mul(step(0.0001, weather.z))
      .mul(smoothstep(0.25, 0.72, mac1.b.mul(0.7).add(mac2.g.mul(0.4)))
        .mul(0.45).add(0.55));
    alb.rgb.assign(mix(alb.rgb.mul(float(1).sub(splash.mul(0.35))),
      mix(tint(p.grimeColor), tint(p.dustColor).mul(0.9), 0.35), splash.mul(0.42)));
    orm.g.assign(clamp(orm.g.add(splash.mul(0.16)).sub(band.mul(vertical).mul(0.10)), 0, 1));
    orm.r.mulAssign(float(1).sub(splash.mul(0.18)));
    orm.b.mulAssign(float(1).sub(splash.mul(0.70)));
    const wedgeH = mac1.r.mul(0.6).add(mac2.b.mul(0.7)).mul(0.18).add(0.26);
    const wedge = vertical.mul(smoothstep(wedgeH.mul(0.25), wedgeH, above).oneMinus());
    const dustWedge = clamp(wedge.pow(2).mul(smoothstep(0.2, 0.8, mac2.g)
      .mul(0.5).add(0.7)), 0, 1).mul(step(0.0001, weather.z));
    alb.rgb.assign(mix(alb.rgb, tint(p.dustColor), dustWedge.mul(0.46)));
    orm.g.assign(clamp(orm.g.add(dustWedge.mul(0.07)), 0, 1));
    orm.b.mulAssign(float(1).sub(dustWedge.mul(0.9)));
  }
  const cav = float(1).sub(height);
  alb.rgb.assign(mix(alb.rgb, tint(p.grimeColor), cav.pow(2).mul(weather.w)));
  orm.r.mulAssign(float(1).sub(cav.mul(weather.w).mul(0.5)));
  if (p.vertexMasks) {
    const v = vertexColor();
    const wearN = smoothstep(0.25, 0.85, mac1.b.mul(0.65).add(mac2.a.mul(0.55)));
    const wear = clamp(v.r.mul(p.wear[0]).mul(smoothstep(0.30, 0.80, height)
      .mul(0.45).add(0.55)).mul(wearN.mul(1.15).add(0.25)), 0, 1);
    alb.rgb.assign(mix(alb.rgb, tint(p.wearColor), wear.mul(p.wearMaterial[3])));
    orm.g.assign(mix(orm.g, p.wearMaterial[0], wear));
    orm.b.assign(mix(orm.b, p.wearMaterial[1], wear));
    const grime = v.g.mul(p.wear[1]).mul(cav.mul(0.65).add(0.35))
      .mul(mac2.g.mul(0.9).add(0.45));
    alb.rgb.assign(mix(alb.rgb, tint(p.grimeColor), grime.mul(0.8)));
    orm.g.assign(clamp(orm.g.add(grime.mul(0.22)), 0, 1));
    orm.b.mulAssign(float(1).sub(grime.mul(0.8)));
    orm.r.mulAssign(float(1).sub(v.b.mul(p.wear[2])));
  }
  if (p.cloth?.[1] < 1) {
    const underside = smoothstep(-0.70, 0.10, worldN.y).oneMinus();
    alb.rgb.mulAssign(mix(1, p.cloth[1], underside));
    orm.g.assign(clamp(orm.g.add(underside.mul(0.05)), 0, 1));
    if (p.cloth[2] > 0 && projected && !p.localSpace) {
      const foldUV = vec2(worldP.x.add(worldP.z.mul(0.63)),
        worldP.y.mul(0.7).add(worldP.z.mul(0.4))).mul(3.4);
      const f0 = sample(shared.macro, foldUV).b;
      const dx = sample(shared.macro, foldUV.add(vec2(0.05, 0))).b.sub(f0);
      const dy = sample(shared.macro, foldUV.add(vec2(0, 0.05))).b.sub(f0);
      nP.assign(normalize(nP.add(vec3(dx.negate(), dy.negate(), 0)
        .mul(p.cloth[2] * 9))));
      alb.rgb.mulAssign(float(1).sub(f0.sub(0.5).mul(p.cloth[2] * 0.9)));
    }
  }
  alb.rgb.mulAssign(p.tintNode ?? tint(p.tint));
  const rough = clamp(orm.g.mul(p.roughness[0]).add(p.roughness[1]),
    Math.max(p.roughness[2] ?? 0.06, 0.015), 1);
  const ao = float(1).add(orm.r.sub(1).mul(p.aoStrength));
  const normal = p.uvMode === 'mesh' ? normalMap(nT.mul(0.5).add(0.5))
    : p.localSpace ? normalize(transformNormalToView(nP))
      : normalize(cameraViewMatrix.mul(vec4(nP, 0)).xyz);
  return MaterialChannels(alb.rgb, alb.a, normal, rough, clamp(orm.b, 0, 1), ao);
  })();
  mat.colorNode = channels.get('color');
  if (p.alphaMask) mat.opacityNode = channels.get('opacity');
  mat.normalNode = channels.get('normal');
  mat.roughnessNode = channels.get('rough');
  mat.metalnessNode = channels.get('metal');
  mat.aoNode = channels.get('ao');
  mat.name = `ow_${set.name ?? 'surface'}`;
  return mat;
}
