import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Discard,
  Fn,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dFdx,
  dFdy,
  exp,
  float,
  floor,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  positionGeometry,
  pow,
  screenUV,
  select,
  sin,
  cos,
  smoothstep,
  sqrt,
  uniform,
  uniformTexture,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  dot,
} from 'three/tsl';

/**
 * GPU particle system — strict WebGPU / TSL.
 *
 * One instanced quad per particle. The whole simulation lives in the vertex
 * stage as a closed-form solution of
 *
 *     dv/dt = -k v + g          =>   v(t) = v0 e^-kt + g/k (1 - e^-kt)
 *                                    x(t) = x0 + (v0 - g/k)(1 - e^-kt)/k + g t / k
 *
 * plus a per-particle turbulence term, so the CPU never touches a particle
 * again after it is spawned: no per-frame simulation, no per-frame allocation,
 * no readback. Spawning writes 32 floats into a preallocated interleaved ring
 * buffer and uploads only the dirty span.
 *
 * Two blend modes share the code:
 *   ADDITIVE  premultiplied ONE/ONE — sparks, muzzle flash, fire, tracers.
 *             Order independent, so no sorting is needed.
 *   LIT/alpha src-alpha over — smoke, dust, blood. Shaded with a spherical
 *             fake normal bent by the sprite's own density gradient, wrapped
 *             sun term plus a forward-scatter lobe, so a puff reads as volume.
 *
 * Both fade softly against `render.depthTexture` (positive view depth in
 * metres) so nothing shows a hard intersection line with the world.
 *
 * The translation is mechanical: the GLSL vertex/fragment pair became TSL node
 * graphs, and every uniform keeps its name and value shape so the rest of the
 * FX subsystem drives it unchanged. `texture()` decodes the sRGB atlas exactly
 * as WebGL's sRGB internal format did, so the sprite radiance is unchanged.
 */

export const STRIDE = 32;

// interleaved slot offsets
const O_PS = 0; // pos.xyz, size0
const O_VS = 4; // vel.xyz, size1
const O_LF = 8; // birth, 1/life, drag, gravity
const O_RT = 12; // rot0, spin, stretch, sizeCurve
const O_C0 = 16; // colour A rgb, intensity A
const O_C1 = 20; // colour B rgb, intensity B
const O_MS = 24; // tile, softness, alpha, alphaCurve
const O_EX = 28; // turbAmp, turbFreq, seed, flags

/** Reusable spawn descriptor — spawning must never allocate. */
export const SP = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  size0: 0.2, size1: 0.3, sizeCurve: 1,
  life: 1, delay: 0, drag: 1.4, gravity: 0,
  rot: 0, spin: 0,
  /** Velocity-aligned smear: length = size * (1 + stretch * speed). ~1 is one
   *  frame of motion blur at 60 Hz for a centimetre-scale sprite. */
  stretch: 0,
  r0: 1, g0: 1, b0: 1, i0: 1,
  r1: 1, g1: 1, b1: 1, i1: 0,
  tile: 0, soft: 0.4, alpha: 1, alphaCurve: 1,
  turb: 0, turbFreq: 1, seed: 0, flags: 0,
};

export function resetSpawn() {
  const s = SP;
  s.x = s.y = s.z = 0;
  s.vx = s.vy = s.vz = 0;
  s.size0 = 0.2; s.size1 = 0.3; s.sizeCurve = 1;
  s.life = 1; s.delay = 0; s.drag = 1.4; s.gravity = 0;
  s.rot = 0; s.spin = 0; s.stretch = 0;
  s.r0 = s.g0 = s.b0 = 1; s.i0 = 1;
  s.r1 = s.g1 = s.b1 = 1; s.i1 = 0;
  s.tile = 0; s.soft = 0.4; s.alpha = 1; s.alphaCurve = 1;
  s.turb = 0; s.turbFreq = 1; s.seed = 0; s.flags = 0;
  return s;
}

/* ------------------------------------------------------------------------- */
/*  shared resources                                                         */
/* ------------------------------------------------------------------------- */

let farDepthTexture = null;

/**
 * 1x1 "infinitely far" depth stand-in. The soft-depth branch is disabled until
 * the render owner supplies a real depth texture, but the node graph must still
 * have a valid sampler bound or the WebGPU pipeline fails to create.
 */
function farDepth() {
  if (!farDepthTexture) {
    farDepthTexture = new THREE.DataTexture(
      new Float32Array([1e6, 0, 0, 0]),
      1,
      1,
      THREE.RedFormat,
      THREE.FloatType
    );
    farDepthTexture.name = 'fx-far-depth';
    farDepthTexture.needsUpdate = true;
  }
  return farDepthTexture;
}

let quadGeoSource = null;

function quadSource() {
  if (!quadGeoSource) {
    quadGeoSource = new THREE.PlaneGeometry(1, 1, 1, 1);
  }
  return quadGeoSource;
}

/* ------------------------------------------------------------------------- */
/*  TSL material                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Build the particle node material.
 *
 * @param {object} o
 * @param {'additive'|'lit'|'distort'} o.mode
 * @param {THREE.Texture} o.atlas
 * @param {number} o.cols
 * @param {number} [o.renderOrder]
 * @returns {{material: MeshBasicNodeMaterial, uniforms: object}}
 */
function buildParticleMaterial(o) {
  const additive = o.mode === 'additive';
  const distort = o.mode === 'distort';

  const uniforms = {
    uTime: uniform(0),
    uAtlas: uniform(new THREE.Vector2(o.cols, 1 / o.cols)),
    uSprite: uniformTexture(o.atlas),
    uDepth: uniformTexture(farDepth()),
    uRes: uniform(new THREE.Vector2(1920, 1080)),
    uSoftEnable: uniform(new THREE.Vector2(0, 0)),
    uSunDir: uniform(new THREE.Vector3(0, 1, 0)),
    uSunCol: uniform(new THREE.Vector3(1, 0.95, 0.86)),
    uAmbTop: uniform(new THREE.Vector3(0.35, 0.42, 0.55)),
    uAmbBot: uniform(new THREE.Vector3(0.16, 0.14, 0.12)),
    uUpView: uniform(new THREE.Vector3(0, 1, 0)),
    uFog: uniform(new THREE.Vector4(0.6, 0.65, 0.72, 0.0)),
  };

  // Per-instance simulation slots.
  const aPS = attribute('aPS', 'vec4');
  const aVS = attribute('aVS', 'vec4');
  const aLife = attribute('aLife', 'vec4');
  const aRot = attribute('aRot', 'vec4');
  const aCol0 = attribute('aCol0', 'vec4');
  const aCol1 = attribute('aCol1', 'vec4');
  const aMisc = attribute('aMisc', 'vec4');
  const aExtra = attribute('aExtra', 'vec4');

  // Interpolated values shared by the vertex and fragment stages.
  const vUv = varying(vec2(0), 'vUv');
  const vCol = varying(vec4(0), 'vCol');
  const vViewZ = varying(float(0), 'vViewZ');
  const vSoft = varying(float(1), 'vSoft');
  const vQ = varying(vec2(0), 'vQ');
  const vAge = varying(float(0), 'vAge');

  const vertex = Fn(() => {
    const t = uniforms.uTime.sub(aLife.x);
    const n = t.mul(aLife.y);
    const alive = t.greaterThanEqual(0).and(n.lessThan(1));

    const k = max(aLife.z, 0.02);
    const e = exp(t.negate().mul(k));
    const gk = vec3(0, aLife.w, 0).div(k);
    const wpos = aPS.xyz
      .add(aVS.xyz.sub(gk).mul(float(1).sub(e).div(k)))
      .add(gk.mul(t))
      .toVar();
    const wvel = aVS.xyz.mul(e).add(gk.mul(float(1).sub(e))).toVar();

    // Turbulence: three decorrelated sines. Grows in so particles do not
    // teleport on their first frame, and contributes to the velocity used for
    // stretch orientation so drifting smoke leans the right way.
    const ph = aExtra.z.mul(6.2831853);
    const f = aExtra.y;
    const grow = smoothstep(0.0, 0.4, n);
    const amp = aExtra.x.mul(grow);
    wpos.addAssign(
      vec3(
        sin(t.mul(f).mul(1.13).add(ph)),
        sin(t.mul(f).mul(0.79).add(ph.mul(2.1))),
        cos(t.mul(f).mul(1.31).add(ph.mul(1.7)))
      ).mul(amp)
    );
    wvel.addAssign(
      vec3(
        cos(t.mul(f).mul(1.13).add(ph)),
        cos(t.mul(f).mul(0.79).add(ph.mul(2.1))),
        sin(t.mul(f).mul(1.31).add(ph.mul(1.7))).negate()
      ).mul(amp.mul(f))
    );

    const mv = cameraViewMatrix.mul(vec4(wpos, 1.0)).toVar();
    const velView = cameraViewMatrix.mul(vec4(wvel, 0.0)).xyz;

    const size = mix(aPS.w, aVS.w, pow(n, max(aRot.w, 0.02))).toVar();
    const c = positionGeometry.xy;

    // Ordinary sparks are centred velocity smears. Tracers take the exact
    // perspective-projected path below instead of this view-space approximation.
    const anchored = mod(aExtra.w, 4.0).greaterThanEqual(1.5);
    const d = velView.xy;
    const dl = length(d);
    const along0 = select(dl.greaterThan(1e-5), d.div(dl), vec2(0.0, 1.0));
    const perp0 = vec2(along0.y.negate(), along0.x);

    // Flag bit 1 marks an anchored trail. Project the actual world-space head
    // and tail separately, then reconstruct that segment in the head's camera
    // plane. This preserves the direction under perspective and prevents an
    // incoming tracer from becoming a screen-wide billboard.
    const travelledVec = wpos.xyz.sub(aPS.xyz);
    const travelled = length(travelledVec);
    const maxTrail = size.mul(aRot.z.mul(length(wvel)).add(1.0));
    const trailLen = min(maxTrail, travelled);
    const trailDir = select(
      travelled.greaterThan(1e-5),
      travelledVec.div(travelled),
      normalize(wvel)
    );
    const tailMv = cameraViewMatrix.mul(
      vec4(wpos.xyz.sub(trailDir.mul(trailLen)), 1.0)
    );
    const headClip = cameraProjectionMatrix.mul(mv);
    const tailClip = cameraProjectionMatrix.mul(tailMv);
    const headNdc = headClip.xy.div(max(headClip.w, 1e-4));
    const tailNdc = tailClip.xy.div(max(tailClip.w, 1e-4));
    // P[0][0], P[1][1] — column-major element access, same as GLSL.
    const pdiag = vec2(
      cameraProjectionMatrix.element(0).element(0),
      cameraProjectionMatrix.element(1).element(1)
    );
    const segment = headNdc.sub(tailNdc).mul(headClip.w).div(pdiag);
    const segmentLen = length(segment);
    const alongA = select(segmentLen.greaterThan(1e-5), segment.div(segmentLen), along0);
    const perpA = vec2(alongA.y.negate(), alongA.x);
    const offAnchored = segment
      .mul(c.y.sub(0.5))
      .add(perpA.mul(c.x.mul(size)));

    const len = size.mul(aRot.z.mul(length(velView)).add(1.0));
    const offVelocity = along0
      .mul(c.y.mul(len))
      .add(perp0.mul(c.x.mul(size)));

    const rot = aRot.x.add(aRot.y.mul(t));
    const sr = sin(rot);
    const cr = cos(rot);
    const offRot = vec2(
      c.x.mul(cr).sub(c.y.mul(sr)),
      c.x.mul(sr).add(c.y.mul(cr))
    ).mul(size);

    const offStretch = select(anchored, offAnchored, offVelocity);
    const off = select(aRot.z.greaterThan(0.001), offStretch, offRot);
    mv.xy.addAssign(off);

    vViewZ.assign(mv.z.negate());
    vSoft.assign(max(aMisc.y, 0.002));
    vQ.assign(off.div(max(size, 1e-4)).mul(2.0));
    vAge.assign(n);

    const tuv = vec2(mod(aMisc.x, uniforms.uAtlas.x), floor(aMisc.x.mul(uniforms.uAtlas.y)));
    vUv.assign(uv().add(tuv).mul(uniforms.uAtlas.y));

    const col = mix(aCol0.xyz, aCol1.xyz, n);
    let inten = mix(aCol0.w, aCol1.w, n.mul(n));
    const flicker = mod(aExtra.w, 2.0).greaterThan(0.5);
    inten = select(
      flicker,
      inten.mul(float(0.72).add(float(0.28).mul(sin(t.mul(63.0).add(ph.mul(9.0)))))),
      inten
    );
    const a = aMisc.z
      .mul(pow(max(float(1.0).sub(n), 0.0), max(aMisc.w, 0.02)))
      .mul(smoothstep(0.0, 0.045, n));
    vCol.assign(vec4(col.mul(inten), select(alive, a, 0.0)));

    const clip = cameraProjectionMatrix.mul(mv);
    return select(alive, clip, vec4(0.0, 0.0, 2.0, 1.0));
  })();

  const fragment = Fn(() => {
    Discard(vCol.a.lessThanEqual(0.0));
    const tex = uniforms.uSprite.sample(vUv);
    let a = tex.a.mul(vCol.a);
    Discard(a.lessThan(distort ? 0.004 : 0.0035));

    if (distort) {
      // Soft depth: an occluded distortion sprite is discarded outright rather
      // than faded, so a shockwave cannot bleed through the wall in front of it.
      const softOn = uniforms.uSoftEnable.x.greaterThan(0.5);
      const sceneZ = uniforms.uDepth.sample(screenUV).r;
      const sceneZf = select(sceneZ.greaterThan(0.001), sceneZ, float(1.0e6));
      const visible = sceneZf.greaterThanEqual(vViewZ);
      Discard(softOn.and(visible.not()));
      const softFade = clamp(sceneZf.sub(vViewZ).div(vSoft), 0.0, 1.0);
      a = a.mul(select(softOn, softFade, float(1.0)));

      const ql = length(vQ);
      const dir = select(ql.greaterThan(1e-4), vQ.div(ql), vec2(0.0));
      const signedField = tex.r.sub(0.42).mul(2.0);
      const off = dir.mul(signedField).mul(a).mul(vCol.r);
      return vec4(off, 0.0, 1.0);
    }

    let c = vCol.xyz.mul(tex.xyz);

    if (!additive) {
      const rr = dot(vQ, vQ);
      let nrm = normalize(vec3(vQ, sqrt(max(0.03, float(1.0).sub(rr)))));
      // Bend the fake sphere normal by the sprite's own density gradient: this is
      // what turns a soft blob into something with legible internal form.
      nrm = normalize(nrm.sub(vec3(dFdx(tex.r), dFdy(tex.r), 0.0).mul(7.0)));
      const ndl = dot(nrm, uniforms.uSunDir);
      const wrap = max(float(0.0), ndl.add(0.42).div(1.42));
      const back = max(float(0.0), ndl.negate());
      const up = float(0.5).add(float(0.5).mul(dot(nrm, uniforms.uUpView)));
      // Irradiance -> radiance: the 1/PI is what keeps a dust puff sitting at the
      // same exposure as the wall behind it instead of blowing out white.
      let lit = mix(uniforms.uAmbBot, uniforms.uAmbTop, up)
        .add(uniforms.uSunCol.mul(wrap.mul(0.9).add(pow(back, 4.0).mul(0.55))))
        .mul(0.3183099);
      lit = lit.mul(mix(float(1.0), 0.55, clamp(tex.a.mul(1.1), 0.0, 1.0)));
      c = c.mul(lit);
    }

    const softOn = uniforms.uSoftEnable.x.greaterThan(0.5);
    const sceneZ = uniforms.uDepth.sample(screenUV).r;
    const sceneZf = select(sceneZ.greaterThan(0.001), sceneZ, float(1.0e6));
    a = a.mul(select(softOn, clamp(sceneZf.sub(vViewZ).div(vSoft), 0.0, 1.0), float(1.0)));

    // never let a sprite smear across the lens
    a = a.mul(clamp(vViewZ.sub(0.05).div(0.2), 0.0, 1.0));

    const fogAmt = float(1.0).sub(exp(uniforms.uFog.w.mul(vViewZ).negate()));
    if (additive) {
      c = c.mul(float(1.0).sub(fogAmt));
      return vec4(c.mul(a), a);
    }
    c = mix(c, uniforms.uFog.xyz, fogAmt);
    return vec4(c, a);
  })();

  const material = new MeshBasicNodeMaterial();
  material.name = `fx-particles-${o.mode}`;
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.fog = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = additive || distort ? THREE.OneFactor : THREE.SrcAlphaFactor;
  material.blendDst = additive || distort ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  material.blendEquation = THREE.AddEquation;
  material.vertexNode = vertex;
  material.fragmentNode = fragment;

  return { material, uniforms };
}

/* ------------------------------------------------------------------------- */
/*  ring-buffer storage                                                      */
/* ------------------------------------------------------------------------- */

/**
 * A fixed-capacity ring of particles backed by one interleaved buffer.
 * Allocation happens exactly once, in the constructor.
 */
export class ParticleLayer {
  /**
   * @param {object} o
   * @param {number} o.capacity     hard cap, from config.q.particleBudget
   * @param {'additive'|'lit'|'distort'} o.mode
   * @param {THREE.Texture} o.atlas
   * @param {number} o.cols         atlas columns
   * @param {number} [o.renderOrder]
   */
  constructor(o) {
    this.capacity = Math.max(16, o.capacity | 0);
    this.mode = o.mode;
    this.cursor = 0;
    this.highWater = 0;
    this.expireAt = -1;
    this.spawned = 0;

    this.array = new Float32Array(this.capacity * STRIDE);
    this.ibuf = new THREE.InstancedInterleavedBuffer(this.array, STRIDE, 1);
    this.ibuf.setUsage(THREE.DynamicDrawUsage);

    const src = quadSource();
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = src.index;
    geo.setAttribute('position', src.getAttribute('position'));
    geo.setAttribute('uv', src.getAttribute('uv'));
    const bind = (name, offset) =>
      geo.setAttribute(name, new THREE.InterleavedBufferAttribute(this.ibuf, 4, offset));
    bind('aPS', O_PS);
    bind('aVS', O_VS);
    bind('aLife', O_LF);
    bind('aRot', O_RT);
    bind('aCol0', O_C0);
    bind('aCol1', O_C1);
    bind('aMisc', O_MS);
    bind('aExtra', O_EX);
    geo.instanceCount = 0;
    // Particles are world-space in the shader; the mesh transform is identity
    // and culling must never remove it.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geometry = geo;

    const built = buildParticleMaterial(o);
    this.material = built.material;
    this.uniforms = built.uniforms;

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = o.renderOrder ?? (this.mode === 'additive' ? 12 : 10);
    this.mesh.visible = false;
    this.mesh.name = `fx-particles-${o.mode}`;
    // FX are not level content: keep development scene scanners' "is the world empty?"
    // heuristic from counting our sprites as geometry.
    this.mesh.userData.owProbe = true;
    this.mesh.userData.owNoShadow = true;

    this._dirtyLo = Infinity;
    this._dirtyHi = -Infinity;
    this._wrapped = false;
  }

  /** True while anything might still be alive. */
  get active() {
    return this.mesh.visible;
  }

  /**
   * Point the soft-depth test at the renderer's linear view depth. `null`
   * leaves the 1x1 far-depth stand-in bound and `uSoftEnable` gates the branch.
   */
  setDepth(texture) {
    this.uniforms.uDepth.value = texture ?? farDepth();
  }

  /**
   * Write one particle. `s` is the shared {@link SP} descriptor — pass it after
   * resetSpawn() so nothing leaks between call sites.
   */
  emit(s, now) {
    const i = this.cursor;
    this.cursor = i + 1;
    if (this.cursor >= this.capacity) {
      this.cursor = 0;
      this._wrapped = true;
    }
    if (i + 1 > this.highWater) this.highWater = i + 1;

    const a = this.array;
    const b = i * STRIDE;
    const life = Math.max(0.016, s.life);
    const birth = now + s.delay;

    a[b + O_PS] = s.x;
    a[b + O_PS + 1] = s.y;
    a[b + O_PS + 2] = s.z;
    a[b + O_PS + 3] = s.size0;

    a[b + O_VS] = s.vx;
    a[b + O_VS + 1] = s.vy;
    a[b + O_VS + 2] = s.vz;
    a[b + O_VS + 3] = s.size1;

    a[b + O_LF] = birth;
    a[b + O_LF + 1] = 1 / life;
    a[b + O_LF + 2] = s.drag;
    a[b + O_LF + 3] = s.gravity;

    a[b + O_RT] = s.rot;
    a[b + O_RT + 1] = s.spin;
    a[b + O_RT + 2] = s.stretch;
    a[b + O_RT + 3] = s.sizeCurve;

    a[b + O_C0] = s.r0;
    a[b + O_C0 + 1] = s.g0;
    a[b + O_C0 + 2] = s.b0;
    a[b + O_C0 + 3] = s.i0;

    a[b + O_C1] = s.r1;
    a[b + O_C1 + 1] = s.g1;
    a[b + O_C1 + 2] = s.b1;
    a[b + O_C1 + 3] = s.i1;

    a[b + O_MS] = s.tile;
    a[b + O_MS + 1] = s.soft;
    a[b + O_MS + 2] = s.alpha;
    a[b + O_MS + 3] = s.alphaCurve;

    a[b + O_EX] = s.turb;
    a[b + O_EX + 1] = s.turbFreq;
    a[b + O_EX + 2] = s.seed;
    a[b + O_EX + 3] = s.flags;

    if (i < this._dirtyLo) this._dirtyLo = i;
    if (i > this._dirtyHi) this._dirtyHi = i;
    const end = birth + life;
    if (end > this.expireAt) this.expireAt = end;
    this.spawned++;
    return i;
  }

  /** Upload the dirty span and update per-frame uniforms. Call once per frame. */
  flush(now) {
    if (this._dirtyHi >= this._dirtyLo) {
      const start = this._dirtyLo * STRIDE;
      const count = (this._dirtyHi - this._dirtyLo + 1) * STRIDE;
      this.ibuf.addUpdateRange(start, count);
      this.ibuf.needsUpdate = true;
      this._dirtyLo = Infinity;
      this._dirtyHi = -Infinity;
    }
    this.uniforms.uTime.value = now;
    this.geometry.instanceCount = this._wrapped ? this.capacity : this.highWater;
    this.mesh.visible = now < this.expireAt && this.geometry.instanceCount > 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Dispose the module-level quad prototype (called by the FX system). */
export function disposeQuadSource() {
  if (quadGeoSource) {
    quadGeoSource.dispose();
    quadGeoSource = null;
  }
  farDepthTexture?.dispose();
  farDepthTexture = null;
}
