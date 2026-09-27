import * as THREE from 'three';
import { PMREMGenerator } from 'three/webgpu';
import { uniform, uv, vec2 } from 'three/tsl';
import { BakePass, hdrTarget } from './bake.js';
import {
  ATMO,
  SCENE_LUX,
  SUN_ILLUMINANCE_TOP,
  MOON_ILLUMINANCE_NIGHT,
  transmittanceToSpace,
} from './atmosphere.js';
import { createAtmosphereNodes, createRaymarchSky, createSkyViewLookup } from './atmosphere-tsl.js';
import { createCloudNodes } from './clouds-tsl.js';
import { createNightSkyNodes } from './stars.js';
import { createSkySample, dirFromEquirectUv, createSkyDome } from './dome.js';
import { createVolumetricNodes } from './volumetrics.js';
import { SkyLuts } from './luts.js';
import { Celestial } from './celestial.js';
import { cloudSunOcclusion } from './clouds.js';
import { CLOCK, SKY_REBAKE_COS } from './tuning.js';

/**
 * Floor on the beam's *luminous* transmittance, as a fraction of unity — see
 * the beam-floor note in `_updateCelestial`. 0.35 puts a 4-degree sun about a
 * stop of luminance under a noon sun (whose luminous transmittance is 0.77)
 * while leaving its physical hue untouched, which is what keeps a golden hour
 * reading as a key light instead of as an ambient wash.
 */
const SUN_LUM_FLOOR = 0.35;

/**
 * Gain on the sun's DIRECTIONAL LIGHT only — not on the irradiance the
 * atmosphere scatters, and not on the sky.
 *
 * Correcting the level's dark albedos is the materials subsystem's job; until
 * then this is the one place the deficit can be paid, and paying it here moves
 * the key and nothing else. See the long note in the WebGL original.
 */
const SUN_KEY_GAIN = 1.55;

/**
 * Whole-sky diffuse illuminance as a fraction of the beam. Real clear-sky
 * daylight runs 12-18% of the direct component; this is the CPU stand-in the
 * renderer scales its sky-fill band off (see `ambientColor`).
 */
const SKY_AMBIENT_FRACTION = 0.15;

/** Cool night hue for the published ambient — moonlight after the Purkinje shift. */
const NIGHT_AMBIENT_HUE = [0.35, 0.5, 1.0];

/**
 * OVERWATCH sky, atmosphere and global lighting — strict WebGPU / TSL port.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS OWNS (unchanged identity)
 * ---------------------------------------------------------------------------
 *   - A Hillaire/Bruneton atmosphere evaluated through three TSL-baked LUTs.
 *   - Sun and moon positions from real spherical astronomy.       celestial.js
 *   - A starfield and Milky Way with magnitude, colour, extinction, scintillation.
 *   - Two procedural cloud decks, self-shadowed and correctly lit.
 *   - Raymarched volumetric fog with cloud-shadowed shafts, plus analytic
 *     aerial perspective on all geometry.
 *   - A PMREM environment map regenerated from the sky whenever the sun moves.
 *   - The sun/moon `DirectionalLight`s the renderer's cascades follow.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC API — `const sky = ctx.get('sky')`
 * ---------------------------------------------------------------------------
 *   sky.setTimeOfDay(hours)      0..24, local solar time. Rebakes everything.
 *   sky.timeOfDay                current hour
 *   sky.setTimeRate(hoursPerSec) animate the sun (0 = frozen; captures default 0)
 *   sky.sunDirection             Vector3 pointing AT the sun   (read only)
 *   sky.moonDirection            Vector3 pointing AT the moon  (read only)
 *   sky.sunAltitude              radians above the horizon
 *   sky.keyLight                 whichever of sun/moon the cascades follow
 *   sky.sunLight  sky.moonLight  THREE.DirectionalLight
 *   sky.envMap                   the PMREM currently published
 *   sky.ambientColor             Color, approximate whole-sky tint AND level:
 *                                the sky's own model of whole-sky irradiance
 *                                (15% of the beam by day, moonlit at night).
 *                                The renderer scales its sky-fill band off it.
 *   sky.indirectScale            indirect-light budget for the current sun
 *                                elevation: ~0.45 at golden hour, 1 by day, 2.2
 *                                after dark. See _updateCelestial. `render`
 *                                multiplies its IBL diffuse budget by this.
 *   sky.exposureBias             EV of metering compensation for this sun
 *                                elevation (+ is darker). `render` adds it to
 *                                settings.exposureBias.
 *   sky.cloudShadowAt(x, z)      0..1 direct sunlight reaching a ground point
 *   sky.setWeather({ ... })      coverage, cirrus, turbidity, fogDensity,
 *                                fogHeight, windSpeed, windAngle, shaftGain
 *   sky.fog                      live fog tuning object (see _fog below)
 *
 * New WebGPU integration surface — the render owner wires this:
 *
 *   const worldPass = pass(scene, camera, { samples: 0 });
 *   const fogged = sky.createFogNode({
 *     color: worldPass.getTextureNode(),          // or the pass node itself
 *     depth: worldPass.getTextureNode('depth'),   // LINEAR VIEW METRES, > 0
 *     visibility: (wp) => myShadowLookup(wp),      // optional CSM
 *   });
 *   const composite = fogged.mul(viewPass.a.oneMinus()).add(viewPass);
 *
 * The world pass must be rendered with a depth attachment, and its depth must
 * reach the fog node as **linear view depth in metres, positive**, with the
 * cleared background reading zero — the contract the WebGL renderer published
 * as `r.depthTexture`. A raw nonlinear depth buffer has to be linearised first
 * (TSL's `linearDepth` is the natural wrapper). Without the key light fitted to
 * `sky.keyLight` the shafts are masked from the wrong direction; the existing
 * sky contract already publishes `sky.keyLight`, `sky.sunDirection`,
 * `sky.indirectScale`, `sky.exposureBias` and `sky.envMap` unchanged.
 *
 *   sky.createFogResolveNode({ current, history, velocity, texel, blend })
 *     does the velocity reprojection + 3x3 clamp of the half-res marched
 *     shafts. The caller owns the ping-pong history; without it the marched
 *     node can be used directly (per-frame shafts, no temporal accumulation).
 *
 * The visible sky is a full-screen `sky-dome` mesh in `ctx.scene` that draws
 * first (`renderOrder -10000`, depth test/write off, `owNoPrepass`/
 * `owNoShadow`), and `sky.envMap` is a PMREM cube-UV texture ready for
 * `scene.environment` / `viewScene.environment`.
 *
 * ---------------------------------------------------------------------------
 * STRICT WEBGPU ONLY
 * ---------------------------------------------------------------------------
 * This system requires the strict device (`src/render/webgpu-device.js`), adds
 * the `sky-dome` mesh to `ctx.scene` and installs a PMREM environment. It
 * deliberately does NOT fall back to the legacy WebGL renderer: booting it
 * against one is a hard, explanatory error, so the migration cannot silently
 * keep GLSL passes.
 */
export class SkySystem {
  static id = 'sky';
  static deps = ['render', 'materials'];

  async init(ctx) {
    this.ctx = ctx;
    const r = ctx.get('render');
    this.render = r;
    this.renderer = r.renderer;
    if (!isStrictWebGpu(this.renderer)) {
      throw new Error(
        '[sky] the TSL sky requires the strict WebGPU renderer from ' +
        'src/render/webgpu-device.js. No WebGL fallback is provided.'
      );
    }
    const q = ctx.config.q;

    this.celestial = new Celestial();
    this.hour = CLOCK.startHour;
    this.timeRate = ctx.config.deterministic ? 0 : CLOCK.hoursPerSecond;

    // ---- weather / atmosphere state ---------------------------------------
    this.weather = {
      /** Aerosol multiplier. 1 clear, 2-3 hazy, 5 dust storm. */
      turbidity: 1.35,
      cloudCoverage: 0.30,
      cloudDensity: 1.9,
      cirrusCoverage: 0.21,
      cirrusOpacity: 0.30,
      windSpeed: 0.0042, // km/s at the cloud deck (~4 m/s)
      windAngle: 0.7,
      horizonMurk: 0.13,
    };

    /** Ground fog. `scatter` and `extinction` are intentionally independent. */
    this._fog = {
      scatter: 3.6e-3, // 1/m at the fog base
      extinction: 1.45e-3, // 1/m at the fog base
      heightScale: 18.0,
      baseY: -2.0,
      maxDistance: 900.0,
      shaftGain: 2.6,
      ambientGain: 0.22,
      noise: 0.55,
      noiseScale: 0.045,
      phaseForward: 0.76,
      phaseBackward: -0.36,
      phaseBackWeight: 0.34,
      extinctionTint: new THREE.Vector3(0.94, 1.02, 1.24),
    };

    // ---- shared uniform nodes --------------------------------------------
    // Every pass, the background and the environment material reference these
    // same TSL uniform nodes, so one write updates the entire subsystem.
    const viewR = ATMO.groundRadiusMM + ATMO.viewAltitudeMM;
    this.shared = {
      uMieScale: uniform(this.weather.turbidity),
      uViewPos: uniform(new THREE.Vector3(0, viewR, 0)),

      uSunDir: uniform(new THREE.Vector3(0, 1, 0)),
      uMoonDir: uniform(new THREE.Vector3(0, -1, 0)),
      uSunIrradiance: uniform(new THREE.Vector3()),
      uMoonIrradiance: uniform(new THREE.Vector3()),
      uSunDiscRadiance: uniform(new THREE.Vector3()),
      uMoonDiscRadiance: uniform(new THREE.Vector3()),
      uSunAltitude: uniform(0),
      uMoonAltitude: uniform(0),
      uMoonRelAz: uniform(0),
      // x/y true angular radii of sun/moon; z/w draw scale. 3.0 puts the solar
      // disc at 1.6 degrees across. skSunDisc divides by z*z so enlarging adds
      // no energy.
      uDisc: uniform(new THREE.Vector4(0.004654, 0.004516, 3.0, 4.2)),
      uGroundAlbedo: uniform(new THREE.Vector3(0.33, 0.29, 0.225)),
      uHorizonMurk: uniform(this.weather.horizonMurk),
      uSkyRolloff: uniform(new THREE.Vector2(0.30, 1.5)),

      uStarParams: uniform(new THREE.Vector4(0, 0.5, 0, 0)),
      uCelestial: uniform(new THREE.Matrix3()),

      uCloudParams: uniform(new THREE.Vector4(
        this.weather.cloudCoverage, this.weather.cloudDensity, 1, 0)),
      uCloudParams2: uniform(new THREE.Vector4(
        this.weather.cirrusCoverage, this.weather.cirrusOpacity, 0.004, 0.0016)),

      uFog: uniform(new THREE.Vector4()),
      uFog2: uniform(new THREE.Vector4()),
      uFogExt: uniform(new THREE.Vector3()),
      uPhase: uniform(new THREE.Vector4()),
      uKeyDir: uniform(new THREE.Vector3(0, 1, 0)),
      uKeyIrr: uniform(new THREE.Vector3()),
      uFogDrift: uniform(new THREE.Vector3()),
    };

    // ---- LUTs -------------------------------------------------------------
    // Ultra keeps the 48-step chain; high/medium use 20. The LUT raymarch itself
    // is always 40 steps, as it was.
    const steps = q.volumetrics ? (ctx.config.quality === 'ultra' ? 48 : 20) : 0;
    this.luts = new SkyLuts(this.shared);
    const atmo = createAtmosphereNodes(this.shared);
    const skyView = createSkyViewLookup(this.shared);
    this.raymarchSky = createRaymarchSky(
      { ...atmo, uViewPos: this.shared.uViewPos, uMieScale: this.shared.uMieScale }, 40);
    this.luts.build({
      uMieScale: this.shared.uMieScale,
      skTransmittance: atmo.skTransmittance,
      skRaymarchSky: this.raymarchSky,
      skSkyView: skyView,
    });
    this.luts.bakeStatic(this.renderer);

    // ---- visible sky ------------------------------------------------------
    const cloudsScreen = createCloudNodes(this.shared, { detail: true, octC: 2 });
    const cloudsEnv = createCloudNodes(this.shared, { detail: false, octC: 2 });
    const nightScreen = createNightSkyNodes(this.shared, { points: true, mwOctaves: 5 });
    const nightEnv = createNightSkyNodes(this.shared, { points: false, mwOctaves: 3 });
    const common = { ...atmo, skSkyView: skyView };
    this.skyScreen = createSkySample(this.shared,
      { ...common, ...cloudsScreen, skNightSky: nightScreen },
      { points: true, moonOct: 4 });
    const skyEnv = createSkySample(this.shared,
      { ...common, ...cloudsEnv, skNightSky: nightEnv },
      { points: false, moonOct: 2 });

    // The sky is a full-screen dome triangle in the world scene, exactly as the
    // GLSL version was: it keeps its own ray reconstruction, so it cannot be
    // rotated by an object transform and it jitters with the frame.
    ctx.scene.background = null;
    this.dome = createSkyDome(this.skyScreen);
    ctx.scene.add(this.dome);
    // The equirect bake needs the same v-flip as the LUT bakes: a render target
    // is sampled with the opposite v to the uv it was drawn with, and the PMREM
    // samples this texture with three's equirect convention.
    this.envPass = new BakePass('sky-env',
      skyEnv(dirFromEquirectUv(vec2(uv().x, uv().y.oneMinus()))));

    // ---- lights -----------------------------------------------------------
    // The renderer takes over shadowing for whichever directional light is
    // brightest, so castShadow stays off: its cascades beat three's single
    // shadow frustum by a mile.
    this.sunLight = new THREE.DirectionalLight(0xffffff, 4.0);
    this.sunLight.name = 'sky-sun';
    this.sunLight.castShadow = false;
    this.sunLight.target.name = 'sky-sun-target';
    ctx.scene.add(this.sunLight, this.sunLight.target);
    r.addLight(this.sunLight, { range: 1e9, priority: 10 });

    this.moonLight = new THREE.DirectionalLight(0x9fc0ff, 0.0);
    this.moonLight.name = 'sky-moon';
    this.moonLight.castShadow = false;
    ctx.scene.add(this.moonLight, this.moonLight.target);
    r.addLight(this.moonLight, { range: 1e9, priority: 9 });

    this.keyLight = this.sunLight;

    // ---- IBL --------------------------------------------------------------
    // 512x256 equirect -> PMREM, baked from the *same* shader and uniform nodes
    // as the visible sky, so the IBL can never disagree with it.
    this.envEquirect = hdrTarget(512, 256, { name: 'sky-equirect' });
    this.envEquirect.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.pmrem = new PMREMGenerator(this.renderer);
    this._pmremTarget = null;
    this.envMap = null;

    // ---- volumetrics ------------------------------------------------------
    // A node factory, not a registered pass: the WebGPU frame graph has no pass
    // chain to register into. `skCloudShadow` rides along in `shared`.
    this.shared.skCloudShadow = cloudsScreen.skCloudShadow;
    this.volumetrics = createVolumetricNodes(this.shared, {
      volumetrics: q.volumetrics,
      steps: Math.max(8, steps),
      march: q.volumetrics,
    });

    // ---- bookkeeping ------------------------------------------------------
    this.ambientColor = new THREE.Color(0, 0, 0);
    this.indirectScale = 1;
    this.exposureBias = 0;
    this._beamLuminance = 0;
    this._sunT = [0, 0, 0];
    this._moonT = [0, 0, 0];
    this._envSunDir = new THREE.Vector3(0, -1, 0);
    this._envMoonDir = new THREE.Vector3(0, -1, 0);
    this._skySunDir = new THREE.Vector3(0, -1, 0);
    this._skyMoonDir = new THREE.Vector3(0, -1, 0);
    this._tmp = new THREE.Vector3();
    this._cloudOcclusion = 1;
    this._cloudOccTarget = 1;
    this._baseSunIntensity = 0;
    this._envAge = 1e9;
    this._skyDirty = true;
    this._envDirty = true;
    this._cloudTime = 0;
    this._occParams = { coverage: 0, density: 0, windX: 0, windZ: 0, time: 0 };

    this._applyWeather();
    this._applyFog();
    this.setTimeOfDay(this.hour);
    this._offRestart = ctx.events.on('game:restart', () => {
      this.timeRate = ctx.config.deterministic ? 0 : CLOCK.hoursPerSecond;
      this.setTimeOfDay(CLOCK.startHour);
    });

    console.info(
      `[sky] TSL atmosphere ready · lat ${this.celestial.site.latitudeDeg} · ` +
        `vol ${q.volumetrics ? steps + ' steps' : 'analytic'} · ` +
        `1 unit = ${SCENE_LUX} lx`
    );
  }

  // =========================================================================
  //  public API
  // =========================================================================

  get timeOfDay() {
    return this.hour;
  }
  get sunDirection() {
    return this.celestial.sun;
  }
  get moonDirection() {
    return this.celestial.moon;
  }
  get sunAltitude() {
    return this.celestial.sunAlt;
  }
  get fog() {
    return this._fog;
  }

  /**
   * Build the graph-injected fog node. The render owner calls this once with
   * the world pass colour/depth and attaches the result where the world colour
   * is composed (before the view pass).
   */
  createFogNode(options) {
    return this.volumetrics.createNode(options);
  }

  /** Temporal resolve for the half-res marched shafts; caller owns the history. */
  createFogResolveNode(options) {
    return this.volumetrics.createResolveNode(options);
  }

  /** Hour of day, 0..24 local solar time. Rebakes the sky and the IBL. */
  setTimeOfDay(hours) {
    this.hour = ((hours % 24) + 24) % 24;
    this._skyDirty = true;
    this._envDirty = true;
    this._updateCelestial();
    this._bakeSky();
    this._bakeEnv();
    this.ctx.events.emit('sky:changed', {
      hour: this.hour,
      sunDir: this.celestial.sun,
      sunIntensity: this.sunLight.intensity,
      moonIntensity: this.moonLight.intensity,
    });
    if (this.ctx.config.deterministic === true) {
      const c = this.celestial;
      const sc = this.sunLight.color;
      console.info(
        `[sky] t=${this.hour.toFixed(2)} sunAlt=${((c.sunAlt * 180) / Math.PI).toFixed(1)} ` +
          `sunI=${this.sunLight.intensity.toFixed(3)} sunCol=${sc.r.toFixed(2)},${sc.g.toFixed(2)},${sc.b.toFixed(2)} ` +
          `moonI=${this.moonLight.intensity.toFixed(4)} beamLum=${(this._beamLuminance ?? 0).toFixed(3)} ` +
          `amb=${this.ambientColor.r.toFixed(3)},${this.ambientColor.g.toFixed(3)},${this.ambientColor.b.toFixed(3)} ` +
          `indirect=${this.indirectScale.toFixed(2)} evBias=${this.exposureBias.toFixed(2)} ` +
          `knee=${this.shared.uSkyRolloff.value.x.toFixed(3)}`
      );
    }
    return this;
  }

  /** Hours of sky time per second of wall clock. 0 freezes the sun. */
  setTimeRate(hoursPerSecond) {
    this.timeRate = hoursPerSecond || 0;
    return this;
  }

  setWeather(patch = {}) {
    Object.assign(this.weather, patch);
    if (patch.fogDensity !== undefined) {
      const k = patch.fogDensity;
      this._fog.scatter = 3.6e-3 * k;
      this._fog.extinction = 1.45e-3 * k;
    }
    if (patch.fogHeight !== undefined) this._fog.heightScale = patch.fogHeight;
    if (patch.shaftGain !== undefined) this._fog.shaftGain = patch.shaftGain;
    this._applyWeather();
    this._applyFog();
    // Turbidity is baked into all three LUTs, so it needs the static bake too.
    if (patch.turbidity !== undefined) {
      this.luts.bakeStatic(this.renderer);
      this._skyDirty = true;
      this._envDirty = true;
    }
    this._skyDirty = true;
    this._envDirty = true;
    return this;
  }

  /** Fraction of direct sunlight reaching a ground point through the clouds. */
  cloudShadowAt(x, z) {
    const p = this._occParams;
    p.coverage = this.weather.cloudCoverage;
    p.density = this.weather.cloudDensity;
    p.windX = this.shared.uCloudParams2.value.z;
    p.windZ = this.shared.uCloudParams2.value.w;
    p.time = this._cloudTime;
    return cloudSunOcclusion(x, z, this.celestial.sun, p);
  }

  // =========================================================================
  //  frame
  // =========================================================================

  update(dt, ctx) {
    // Cloud drift is deterministic (driven by ctx.time.elapsed) so capture mode
    // reproduces the exact same sky every run.
    this._cloudTime = ctx.time.elapsed;
    this.shared.uCloudParams.value.w = this._cloudTime;
    this.shared.uStarParams.value.z = this._cloudTime;
    // Fog advects slower than the cloud deck and mostly horizontally.
    this.shared.uFogDrift.value.set(
      this._cloudTime * 0.09,
      this._cloudTime * 0.015,
      this._cloudTime * 0.045
    );

    if (this.timeRate !== 0 && dt > 0 && !ctx.peek('player')?.dead) {
      this.hour = (this.hour + this.timeRate * dt) % 24;
      this._updateCelestial();
    }

    // A cloud crossing the sun is a real, large-scale lighting change. Sampled
    // on the CPU from the same macro field the shader draws, and eased hard.
    const cam = ctx.camera;
    this._cloudOccTarget = this.cloudShadowAt(cam.position.x, cam.position.z);
    const k = Math.min(1, dt * 0.9);
    this._cloudOcclusion += (this._cloudOccTarget - this._cloudOcclusion) * k;
    this._applyLightIntensities();

    if (this._skyDirty) this._bakeSky();

    this._envAge += dt;
    // Cheap when nothing moves; the dirty flag is only set by a real sun move.
    if (this._envDirty && this._envAge > 0.25) this._bakeEnv();
  }

  // =========================================================================
  //  internals
  // =========================================================================

  _applyWeather() {
    const w = this.weather;
    this.shared.uMieScale.value = w.turbidity;
    this.shared.uHorizonMurk.value = w.horizonMurk;
    const cp = this.shared.uCloudParams.value;
    cp.x = w.cloudCoverage;
    cp.y = w.cloudDensity;
    const cp2 = this.shared.uCloudParams2.value;
    cp2.x = w.cirrusCoverage;
    cp2.y = w.cirrusOpacity;
    cp2.z = Math.cos(w.windAngle) * w.windSpeed;
    cp2.w = Math.sin(w.windAngle) * w.windSpeed;
  }

  _applyFog() {
    const f = this._fog;
    this.shared.uFog.value.set(f.scatter, 1 / f.heightScale, f.baseY, f.maxDistance);
    this.shared.uFog2.value.set(f.extinction, f.shaftGain, f.ambientGain, f.noise);
    this.shared.uFogExt.value.copy(f.extinctionTint).multiplyScalar(f.extinction);
    this.shared.uPhase.value.set(
      f.phaseForward, f.phaseBackward, f.phaseBackWeight, f.noiseScale);
  }

  /** Sun/moon geometry, colours and intensities for the current hour. */
  _updateCelestial() {
    const c = this.celestial.setHour(this.hour);
    const s = this.shared;

    s.uSunDir.value.copy(c.sun);
    s.uMoonDir.value.copy(c.moon);
    s.uSunAltitude.value = c.sunAlt;
    s.uMoonAltitude.value = c.moonAlt;
    // The sky-view LUT is baked with the sun at azimuth 0, so the moon only
    // needs its azimuth *relative* to the sun.
    let rel = c.moonAz - c.sunAz;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    s.uMoonRelAz.value = rel;
    c.celestialMatrix(s.uCelestial.value);

    const mie = this.weather.turbidity;

    // ---- sun ---------------------------------------------------------------
    const muS = Math.sin(c.sunAlt);
    // Fraction of the solar disc above the horizon: without this the key light
    // snaps off at sunset instead of dimming through the last half degree.
    const discS = THREE.MathUtils.clamp(0.5 + muS / (2 * 0.004654), 0, 1);
    transmittanceToSpace(Math.max(muS, 0.0008), mie, this._sunT);
    const tint = [1.0, 0.975, 0.94];
    const T = this._sunT;
    // The key is the disc PLUS its aureole: raising the transmittance to a power
    // below one keeps the ordering and hue direction while pulling the
    // saturation back to what a golden hour photograph shows.
    const aureoleP = THREE.MathUtils.lerp(
      0.55, 1.0, THREE.MathUtils.smoothstep(THREE.MathUtils.radToDeg(c.sunAlt), 0, 16));
    const sr = Math.pow(T[0], aureoleP) * tint[0];
    const sg = Math.pow(T[1], aureoleP) * tint[1];
    const sb = Math.pow(T[2], aureoleP) * tint[2];
    const smax = Math.max(1e-6, sr, sg, sb);
    this.sunLight.color.setRGB(sr / smax, sg / smax, sb / smax);

    const lumT = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
    const altDeg = THREE.MathUtils.radToDeg(c.sunAlt);
    // 1 while the disc still lights the street, 0 by the time it is 6 deg under.
    const beamAlive = THREE.MathUtils.smoothstep(altDeg, -6.0, -1.0);
    const lumFloor = SUN_LUM_FLOOR * beamAlive;
    const beamGain = Math.max(1, lumFloor / Math.max(lumT, 1e-5));
    this._baseSunIntensity = SUN_ILLUMINANCE_TOP * smax * discS * beamGain;
    this._beamLuminance = SUN_ILLUMINANCE_TOP * Math.max(lumT * beamGain, 1e-6) * discS;

    s.uSunIrradiance.value.set(
      SUN_ILLUMINANCE_TOP * tint[0],
      SUN_ILLUMINANCE_TOP * tint[1],
      SUN_ILLUMINANCE_TOP * tint[2]
    );

    // Solar disc radiance is E/omega = 75000 units; clamped to 4000 so it does
    // not overflow a half-float target once bloom touches it.
    const discRad = 4000;
    s.uSunDiscRadiance.value.set(discRad * tint[0], discRad * tint[1], discRad * tint[2]);

    // ---- night ramps -------------------------------------------------------
    const keyRamp = THREE.MathUtils.smoothstep(-altDeg, -3, 5);
    const nightRamp = THREE.MathUtils.smoothstep(-altDeg, 0, 9);

    // ---- moon --------------------------------------------------------------
    const muM = Math.sin(c.moonAlt);
    const discM = THREE.MathUtils.clamp(0.5 + muM / (2 * 0.004516), 0, 1);
    transmittanceToSpace(Math.max(muM, 0.0008), mie, this._moonT);
    const MT = this._moonT;
    // Moonlight reads cool because scotopic vision peaks blue (Purkinje shift).
    const cool = [0.66, 0.80, 1.0];
    const mr = MT[0] * cool[0];
    const mg = MT[1] * cool[1];
    const mb = MT[2] * cool[2];
    const mmax = Math.max(1e-6, mr, mg, mb);
    this.moonLight.color.setRGB(mr / mmax, mg / mmax, mb / mmax);
    const moonI = MOON_ILLUMINANCE_NIGHT * c.moonPhase * mmax * discM * keyRamp;
    this.moonLight.intensity = moonI;

    const moonIrr = MOON_ILLUMINANCE_NIGHT * c.moonPhase * keyRamp;
    s.uMoonIrradiance.value.set(moonIrr * cool[0], moonIrr * cool[1], moonIrr * cool[2]);

    const moonDisc = THREE.MathUtils.lerp(0.35, 3.5, nightRamp);
    s.uMoonDiscRadiance.value.set(moonDisc, moonDisc * 0.985, moonDisc * 0.95);

    // ---- ambient colour (published, not used for lighting) -----------------
    const warm = (1 - THREE.MathUtils.smoothstep(altDeg, 1, 22)) * beamAlive;
    const night = 1 - beamAlive;
    const nh = NIGHT_AMBIENT_HUE;
    const ar = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.36, nh[0], night), this.sunLight.color.r, warm);
    const ag = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.56, nh[1], night), this.sunLight.color.g, warm);
    const ab = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(1.0, nh[2], night), this.sunLight.color.b, warm);
    const aLevel = SKY_AMBIENT_FRACTION * this._baseSunIntensity + 0.9 * moonI;
    this.ambientColor.setRGB(ar * aLevel, ag * aLevel, ab * aLevel);

    // Sky shoulder. The knee tracks the beam's luminance because autoexposure
    // does: a daylight zenith passes untouched while a sunset horizon glow is
    // rolled off into a gradient instead of a plateau.
    const kneeFrac = THREE.MathUtils.lerp(
      0.045, 0.11, THREE.MathUtils.smoothstep(altDeg, 2.0, 15.0));
    s.uSkyRolloff.value.set(
      Math.max(kneeFrac * this._beamLuminance, 0.02 + 6.0 * moonI), 0.34);

    // ---- exposure compensation for the time of day --------------------------
    this.exposureBias =
      1.35 * (1 - THREE.MathUtils.smoothstep(altDeg, 1.0, 13.0)) * beamAlive +
      0.55 * (1 - beamAlive);

    this.indirectScale = THREE.MathUtils.lerp(
      2.2,
      THREE.MathUtils.lerp(0.45, 1.0, THREE.MathUtils.smoothstep(altDeg, 0.0, 14.0)),
      beamAlive
    );

    // ---- stars -------------------------------------------------------------
    s.uStarParams.value.x = 0.07 * nightRamp;
    s.uStarParams.value.y = 0.55;
    s.uStarParams.value.w = 0.16 * nightRamp;

    // ---- light transforms --------------------------------------------------
    this._placeLight(this.sunLight, c.sun, 0.006);
    this._placeLight(this.moonLight, c.moon, 0.026);

    this._applyLightIntensities();
    if (this._skySunDir.dot(c.sun) < SKY_REBAKE_COS ||
        this._skyMoonDir.dot(c.moon) < SKY_REBAKE_COS) this._skyDirty = true;
    if (this._envSunDir.dot(c.sun) < SKY_REBAKE_COS ||
        this._envMoonDir.dot(c.moon) < SKY_REBAKE_COS) this._envDirty = true;
  }

  _placeLight(light, dir, minY) {
    this._tmp.copy(dir);
    if (this._tmp.y < minY) {
      this._tmp.y = minY;
      this._tmp.normalize();
    }
    light.position.copy(this._tmp).multiplyScalar(600);
    light.target.position.set(0, 0, 0);
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
  }

  _applyLightIntensities() {
    // A cloud crossing the sun dims the whole street, so the range stays narrow:
    // 0.58..1.0 is about a stop of broken cover.
    const occ = 0.58 + 0.42 * this._cloudOcclusion;
    this.sunLight.intensity = this._baseSunIntensity * occ * SUN_KEY_GAIN;

    const sunI = this.sunLight.intensity;
    const moonI = this.moonLight.intensity;
    const moonKey = moonI > sunI;
    this.keyLight = moonKey ? this.moonLight : this.sunLight;

    // The fog's key must be the light the renderer fitted its cascades to.
    const key = this.keyLight;
    const dir = moonKey ? this.celestial.moon : this.celestial.sun;
    this.shared.uKeyDir.value.copy(dir);
    const i = key.intensity;
    this.shared.uKeyIrr.value.set(key.color.r * i, key.color.g * i, key.color.b * i);
  }

  _bakeSky() {
    this.luts.bakeSkyView(this.renderer);
    this._skySunDir.copy(this.celestial.sun);
    this._skyMoonDir.copy(this.celestial.moon);
    this._skyDirty = false;
  }

  _bakeEnv() {
    // One equirect draw of the same sky shader, then PMREM. The first call
    // allocates; every later call reuses the target so nothing churns.
    this.envPass.render(this.renderer, this.envEquirect);
    this._pmremTarget = this.pmrem.fromEquirectangular(
      this.envEquirect.texture, this._pmremTarget);
    this._pmremTarget.texture.name = 'sky-env';
    this.envMap = this._pmremTarget.texture;
    if (this.render.setEnvMap) this.render.setEnvMap(this.envMap);
    else {
      this.ctx.scene.environment = this.envMap;
      this.ctx.viewScene.environment = this.envMap;
    }

    this._envSunDir.copy(this.celestial.sun);
    this._envMoonDir.copy(this.celestial.moon);
    this._envDirty = false;
    this._envAge = 0;
    this.ctx.events.emit('sky:env', { envMap: this.envMap, sunDir: this.celestial.sun });
  }

  dispose() {
    this._offRestart?.();
    this.luts.dispose();
    this.ctx.scene.remove(this.dome);
    this.dome.material.dispose();
    this.envPass.dispose();
    this.envEquirect.dispose();
    this._pmremTarget?.dispose();
    this.pmrem.dispose();
    this.ctx.scene.remove(this.sunLight, this.sunLight.target);
    this.ctx.scene.remove(this.moonLight, this.moonLight.target);
    this.render.removeLight?.(this.sunLight);
    this.render.removeLight?.(this.moonLight);
    this.sunLight.dispose();
    this.moonLight.dispose();
  }
}

/** True only for the strict device built by `src/render/webgpu-device.js`. */
function isStrictWebGpu(renderer) {
  return !!renderer && (renderer.isWebGPURenderer === true ||
    renderer.backend?.constructor?.name === 'WebGPUBackend' ||
    renderer.backend?.isWebGPUBackend === true);
}
