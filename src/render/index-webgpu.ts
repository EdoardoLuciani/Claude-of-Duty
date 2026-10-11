import { AmbientLight, Color, DataTexture, DirectionalLight, EquirectangularReflectionMapping,
  PointLight, PCFShadowMap, RGBAFormat, RenderTarget, SRGBColorSpace, StorageInstancedBufferAttribute,
  Vector2, Vector3 } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { StableCSMShadowNode } from './csm-webgpu.ts';
import { createVolumetricShadow } from './volumetric-shadow.ts';
import { lightPosition, lightTargetPosition, sharedUniformGroup, uniform } from 'three/tsl';
import { createWebGpuRenderer } from './webgpu-device.ts';
import { createWorldViewPipeline } from './webgpu-pipeline.ts';
import type { FogInputs, PipelineOptions, PostPass } from './webgpu-pipeline.ts';
import { createGradeLut } from './lut.ts';
import { createHdrMeter } from './meter-webgpu.ts';
import { IndirectFill } from './indirect-webgpu.ts';
import { warmFrame } from './warm-frame.ts';
import { VIEW_LIGHTING, updateViewLighting } from './view-lighting.ts';
import { Light, SpotLight } from 'three/webgpu';
import type { BufferGeometry, Camera, Material, Mesh, Object3D, Texture } from 'three';
import type MeshStandardNodeMaterial from 'three/src/materials/nodes/MeshStandardNodeMaterial.js';
import type { Renderer, Node, UniformNode } from 'three/webgpu';

// Preserve the old 60-FPS response (24% per 16 frames), now in seconds.
const METER_INTERVAL = 16 / 60;
const WARM_GRAPH_TIMEOUT_MS = 120000;
const EXPOSURE_RATE = -Math.log(1 - 0.24) / METER_INTERVAL;

interface RenderQuality {
  anisotropy: number; shadowMapSize: number; cascades: number; shadowDistance: number;
  volumetrics: boolean; gtao: boolean; ssr: boolean; taa: boolean; bloom: boolean; dprCap: number; renderScale: number;
}
interface RenderSkyContext {
  keyLight?: DirectionalLight; sunLight: DirectionalLight; moonLight: DirectionalLight; keyDirection: Vector3;
  ambientColor?: { r: number; g: number; b: number }; indirectScale?: number;
  createFogNode?: (inputs: FogInputs) => Node<'vec3'> | Node<'vec4'>;
}
interface RenderFxContext { hazeSys?: { warpNode(node: Node): Node; render(renderer: Renderer, camera: Camera): void } }
interface RenderPhysicsContext { staticWorld: { version: number }; MASK: { SIGHT: number }; raycastAny(...args: number[]): boolean }
interface RenderContext {
  canvas: HTMLCanvasElement; scene: import('three').Scene; viewScene: import('three').Scene;
  camera: import('three').PerspectiveCamera; viewCamera: import('three').PerspectiveCamera;
  config: { q: RenderQuality }; time: { frame: number; dt: number };
  engine: { fail(system: string, method: string, error: unknown): void; stop(): void };
  peek(id: 'sky'): RenderSkyContext | null; peek(id: 'fx'): RenderFxContext | null;
  peek(id: 'physics'): RenderPhysicsContext | null;
  peek(id: 'world'): { buildings?: Array<{ spec?: { enterable?: boolean; collapse?: boolean; ruin?: boolean; x: number; z: number; w: number; d: number; setback?: { from?: number } } | null; roofY?: number; floorY?: number[] }>; levelToWorld?(x: number, y: number, z: number, out: Vector3): Vector3 } | null;
  peek(id: 'render'): { sunDir: Vector3; activeSun: DirectionalLight } | null;
  peek(id: string): unknown;
}
interface RenderSettings { bloomStrength: number; bloomThreshold: number; exposureBias: number; exposureKey: number; autoExposure: boolean }
interface RegisteredLight { light: DirectionalLight | PointLight; range?: number; priority?: number }
type RenderGraph = ReturnType<typeof createWorldViewPipeline>;
type GroupedPositionNode = Omit<Node, 'groupNode' | 'setGroup'> & {
  groupNode: Node | null; setGroup(group: Node | null): void;
};

function copyDirectional(target: DirectionalLight, source: DirectionalLight): void {
  target.color.copy(source.color); target.intensity = source.intensity;
  target.position.copy(source.position); target.target.position.copy(source.target.position);
  target.updateMatrixWorld(); target.target.updateMatrixWorld();
}

/** One strict WebGPU owner; no WebGL context, shader patching, or runtime toggle. */
export class RenderSystem {
  declare ctx: RenderContext; declare q: RenderQuality; declare _warmAbort: AbortController; declare renderer: Renderer;
  declare maxAnisotropy: number; declare screenSize: { width: number; height: number }; declare displaySize: { width: number; height: number };
  declare passes: PostPass[]; declare lights: RegisteredLight[]; declare _lightPositionGroup: ReturnType<typeof sharedUniformGroup>;
  declare _lightUniformGroups: Map<GroupedPositionNode, Node | null>; declare grade: ReturnType<typeof createGradeLut>; declare settings: RenderSettings;
  declare _exposure: number; declare _exposureTarget: number; declare _metering: boolean; declare _meterReady: boolean; declare _meterElapsed: number;
  declare _graph: RenderGraph | null; declare _meterPass: ReturnType<typeof createHdrMeter> | null;
  declare _lightsReady: boolean; declare _size: Vector2; declare _fallbackEnv: DataTexture; declare _fallbackBackground: Color;
  declare sun: DirectionalLight; declare _skyKey: DirectionalLight; declare _skySecondary: DirectionalLight; declare _ambient: AmbientLight;
  declare indirect: IndirectFill; declare activeSun: DirectionalLight & { shadow: DirectionalLight['shadow'] & { shadowNode: StableCSMShadowNode } }; declare _fallbackSunDir: Vector3; declare sunDir: Vector3;
  declare viewSun: DirectionalLight; declare viewFill: DirectionalLight; declare _viewFillDirection: Vector3; declare _viewLightPosition: Vector3; declare _viewToLight: Vector3;
  declare _viewVisibility: number; declare _viewVisibilityFrame: number | null; declare _viewProbePosition: Vector3; declare _viewProbeWorld: unknown;
  declare _viewProbeVersion: number; declare _viewSkyVisibility: number; declare _viewSkyDirections: Vector3[];
  declare viewPracticals: Array<{ light: PointLight; source: PointLight | null; score: number; irradiance: number }>;
  declare viewLightLevel: number; declare _fogFrame: UniformNode<'float', number>; declare _volumeShadow: ReturnType<typeof createVolumetricShadow> | null;
  declare depthTexture: Texture | null; declare velocityTexture: Texture | null; declare normalTexture: Texture | null; declare aoTexture: Texture | null;
  declare hdrTexture: Texture; declare hdrRt: RenderTarget; declare viewRt: RenderTarget;
  declare _disposing: boolean; declare _warmTask: Promise<{ ms: number; geometries: number; frameUnchanged: boolean }> | null;
  declare _meterTask: Promise<void> | null;

  static id = 'render';
  static deps = [];

  async init(ctx: RenderContext): Promise<void> {
    this.ctx = ctx;
    this.q = ctx.config.q;
    this._warmAbort = new AbortController();
    this._fogFrame = uniform(0);
    this.renderer = await createWebGpuRenderer(ctx.canvas, error => {
      if (this._disposing) return;
      this._warmAbort.abort(error);
      ctx.engine.fail('render', 'deviceLost', error);
      ctx.engine.stop();
    });
    this.renderer.setClearColor(0, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.maxAnisotropy = this.q.anisotropy;
    this.screenSize = { width: 1, height: 1 };
    this.displaySize = { width: 1, height: 1 };
    this.passes = [];
    this.lights = [];
    // Share the public world-space light/target uniforms. View positions are now
    // camera-dependent Fn nodes; leave their internal uniforms owned by Three.
    this._lightPositionGroup = sharedUniformGroup('owLightPositions', 0, 'render');
    this._lightUniformGroups = new Map();
    this.grade = createGradeLut('default');
    this.settings = { bloomStrength: 0.14, bloomThreshold: 1.6, exposureBias: 0,
      exposureKey: 1.06, autoExposure: true };
    this._exposure = 1;
    this._exposureTarget = 1;
    this._metering = false;
    this._meterReady = false;
    this._meterElapsed = 0;
    this._graph = null;
    this._meterPass = null;
    this._lightsReady = false;
    this._size = new Vector2();
    // Until sky initializes, keep a legible world and a shared IBL for weapon.
    const data = new Uint8Array(32 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const sky = y < 8;
      data[i] = sky ? 152 : 130;
      data[i + 1] = sky ? 175 : 119;
      data[i + 2] = sky ? 200 : 104;
      data[i + 3] = 255;
    }
    this._fallbackEnv = new DataTexture(data, 32, 16, RGBAFormat);
    this._fallbackEnv.mapping = EquirectangularReflectionMapping;
    this._fallbackEnv.colorSpace = SRGBColorSpace;
    this._fallbackEnv.needsUpdate = true;
    ctx.scene.environment = this._fallbackEnv;
    ctx.viewScene.environment = this._fallbackEnv;
    this._fallbackBackground = new Color(0x86a1b4);
    ctx.scene.background = this._fallbackBackground;

    this.sun = new DirectionalLight(0xffe8c4, 4.3);
    this.sun.position.set(-42, 46, 26);
    // Sky lights remain authored data. Render through stable key/secondary IDs
    // so a sun/moon handoff changes values, not every lit shader's topology.
    this._skyKey = new DirectionalLight(0xffffff, 0);
    this._skySecondary = new DirectionalLight(0xffffff, 0);
    this._skyKey.name = 'ow-world-key';
    this._skySecondary.name = 'ow-world-secondary';
    ctx.scene.add(this._skyKey, this._skyKey.target, this._skySecondary, this._skySecondary.target);
    // The scene's white ambient used to overwhelm the authored blue sky fill.
    // Keep its light ID stable; the TSL indirect node supplies the actual fill.
    this._ambient = new AmbientLight(0xffffff, 0);
    ctx.scene.add(this.sun, this.sun.target, this._ambient);
    this.indirect = new IndirectFill(ctx);
    this.activeSun = this.sun as typeof this.activeSun;
    this._fallbackSunDir = new Vector3().copy(this.sun.position).normalize();
    this.sunDir = this._fallbackSunDir;
    this.viewSun = new DirectionalLight(0xffffff, 0);
    this.viewFill = new DirectionalLight(0xffffff, 0);
    this.viewSun.name = 'ow-view-world-key';
    this.viewFill.name = 'ow-view-readability';
    this._viewFillDirection = new Vector3().fromArray(VIEW_LIGHTING.fillDirection).normalize();
    this._viewLightPosition = new Vector3();
    this._viewToLight = new Vector3();
    this._viewVisibility = 1;
    this._viewVisibilityFrame = null;
    this._viewProbePosition = new Vector3(Infinity, Infinity, Infinity);
    this._viewProbeWorld = null;
    this._viewProbeVersion = -1;
    this._viewSkyVisibility = 1;
    this._viewSkyDirections = Array.from({ length: VIEW_LIGHTING.skySamples }, (_, i) => {
      const y = (i + .5) / VIEW_LIGHTING.skySamples;
      const radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
      return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    });
    this.viewPracticals = Array.from({ length: VIEW_LIGHTING.practicalCount }, () => {
      const light = new PointLight(0xffffff, 0);
      light.name = 'ow-view-practical';
      ctx.viewScene.add(light);
      return { light, source: null, score: 0, irradiance: 0 };
    });
    ctx.viewScene.add(this.viewSun, this.viewSun.target, this.viewFill, this.viewFill.target);
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720);
  }

  _setupShadows(light: DirectionalLight): void {
    // A cached CSM belongs to this light, but render() disables the old key
    // when day turns to night. Re-enable it every time that key comes back.
    light.castShadow = true;
    // CSM now updates in the lit world pass, not the unlit prepass. Preserve
    // its opaque layer-1 caster set instead of inheriting the world's layers.
    light.shadow.camera.layers.set(1);
    if (light.shadow.shadowNode instanceof CSMShadowNode) return;
    light.shadow.mapSize.set(this.q.shadowMapSize, this.q.shadowMapSize);
    light.shadow.bias = -0.00008;
    light.shadow.normalBias = 0.02;
    light.shadow.shadowNode = new StableCSMShadowNode(light,
      { cascades: this.q.cascades, maxFar: this.q.shadowDistance, lightMargin: 50 });
  }

  _getGraph(): RenderGraph {
    if (this._graph) return this._graph;
    const haze = this.ctx.peek('fx')?.hazeSys;
    const sky = this.ctx.peek('sky');
    if (this.q.volumetrics) this._volumeShadow ??= createVolumetricShadow(this as Parameters<typeof createVolumetricShadow>[0]);
    const options: PipelineOptions = {
      gtao: this.q.gtao, ssrEnabled: this.q.ssr, taa: this.q.taa,
      bloomStrength: this.q.bloom ? this.settings.bloomStrength : 0,
      bloomThreshold: this.settings.bloomThreshold, grade: this.grade,
      // Postprocessing draws with an orthographic fullscreen camera. Its
      // built-in camera accessors are NOT the gameplay camera used by fog.
      fog: sky?.createFogNode ? (inputs: FogInputs) => sky.createFogNode!({ ...inputs,
        invProj: uniform(this.ctx.camera.projectionMatrixInverse),
        camWorld: uniform(this.ctx.camera.matrixWorld),
        camPos: uniform(this.ctx.camera.position),
        frame: this._fogFrame,
        visibility: this._volumeShadow?.visibility,
      }) : null,
      fogCompute: this.q.volumetrics,
      warp: haze ? (node: Node) => haze.warpNode(node) : null,
      afterDepth: haze ? () => haze.render(this.renderer, this.ctx.camera) : null,
      postPasses: this.passes,
    };
    this._graph = createWorldViewPipeline(this.renderer, this.ctx.scene, this.ctx.camera,
      this.ctx.viewScene, this.ctx.viewCamera, options);
    this.depthTexture = this._graph.linearDepth.value;
    this.velocityTexture = this.q.taa ? this._graph.prePass.getTextureNode('velocity').value : null;
    this.normalTexture = this._graph.prePass.getTextureNode().value;
    this.aoTexture = this._graph.aoBlur?.textureNode.value ?? null;
    this.hdrTexture = this._graph.worldPass.renderTarget.texture;
    this.hdrRt = this._graph.worldPass.renderTarget;
    this.viewRt = this._graph.viewPass.renderTarget;
    this._meterPass = createHdrMeter(this.renderer, this.hdrRt.texture, this.depthTexture!);
    return this._graph;
  }

  _shareLightPosition(node: Node): void {
    const grouped = node as GroupedPositionNode;
    if (this._lightUniformGroups.has(grouped)) return;
    this._lightUniformGroups.set(grouped, grouped.groupNode);
    grouped.setGroup(this._lightPositionGroup);
  }

  _tagLight(light: Light): void {
    if (light instanceof DirectionalLight || light instanceof SpotLight) {
      this._shareLightPosition(lightPosition(light));
      this._shareLightPosition(lightTargetPosition(light));
    }
  }

  _tagPrepassMesh = (object: Object3D): void => {
    if (object instanceof Light) { this._tagLight(object); object.layers.enable(1); return; }
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const instanced = object as import('three').InstancedMesh;
    if (instanced.isInstancedMesh && mesh.userData.owStatic &&
        !(instanced.instanceMatrix as typeof instanced.instanceMatrix & { isStorageInstancedBufferAttribute?: boolean }).isStorageInstancedBufferAttribute) {
      // Native instancing otherwise uploads small matrix arrays as per-object
      // uniforms in every pass. Storage keeps immutable world arrays resident
      // and still honours needsUpdate/version if an owner edits an instance.
      const source = instanced.instanceMatrix;
      const storage = new StorageInstancedBufferAttribute(source.array, source.itemSize);
      storage.setUsage(source.usage);
      storage.normalized = source.normalized;
      storage.meshPerAttribute = source.meshPerAttribute;
      instanced.instanceMatrix = storage;
    }
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) this.indirect.patch(entry as MeshStandardNodeMaterial);
    } else this.indirect.patch(material as MeshStandardNodeMaterial | null);
    let opaque = !!material && !Array.isArray(material) && !material.transparent;
    if (Array.isArray(material)) {
      opaque = true;
      for (const entry of material) {
        if (!entry || entry.transparent) { opaque = false; break; }
      }
    }
    if (opaque && !mesh.userData.owNoPrepass) mesh.layers.enable(1);
    else mesh.layers.disable(1);
  };

  _tagViewMesh = (object: Object3D): void => {
    if (object instanceof Light) { this._tagLight(object); return; }
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) this.indirect.patch(entry as MeshStandardNodeMaterial);
    } else this.indirect.patch(material as MeshStandardNodeMaterial | null);
  };

  _syncSun(ctx: RenderContext): void {
    const sky = ctx.peek('sky');
    const source = sky?.keyLight;
    const key = source ? this._skyKey : this.sun;
    if (source) {
      const secondary = source === sky.sunLight ? sky.moonLight : sky.sunLight;
      copyDirectional(this._skyKey, source);
      copyDirectional(this._skySecondary, secondary);
      sky.sunLight.visible = sky.moonLight.visible = false;
      this.sunDir = sky.keyDirection;
    } else {
      this.sunDir = this._fallbackSunDir;
      this.sunDir.copy(key.position).sub(key.target.position).normalize();
    }
    this.indirect.sunDir.value = this.sunDir;
    if (key !== this.activeSun || !this._lightsReady) {
      this.sun.visible = key === this.sun;
      this.activeSun.castShadow = false;
      this.activeSun = key as typeof this.activeSun;
      this._setupShadows(key);
      this._lightsReady = true;
    }
  }

  render(ctx: RenderContext): void {
    ctx.scene.traverseVisible(this._tagPrepassMesh);
    this._syncSun(ctx);
    const shadowNode = this.activeSun.shadow.shadowNode;
    if (shadowNode instanceof StableCSMShadowNode) shadowNode.refreshCameraFrustums();
    this.indirect.update(this.activeSun, ctx.peek('sky') ?? undefined);
    updateViewLighting(this, ctx);
    ctx.viewScene.traverseVisible(this._tagViewMesh);
    const graph = this._getGraph();
    // Idle native rAF/compile activity must not advance capture fog noise.
    this._fogFrame.value = ctx.time.frame;
    graph.exposure.value = this._exposure * 2 ** -this.settings.exposureBias;
    this.renderer.setRenderTarget(null);
    graph.render();
    this._updateExposure(ctx.time.dt);
  }

  _updateExposure(dt: number): void {
    if (!this.settings.autoExposure || !(dt > 0)) return;
    if (this._meterReady)
      this._exposure += (this._exposureTarget - this._exposure) * -Math.expm1(-EXPOSURE_RATE * dt);
    // Sparse async measurements set a target; adaptation continues between
    // them. Time-based cadence bounds detection delay even at low frame rates.
    this._meterElapsed += dt;
    if (this._meterElapsed >= METER_INTERVAL && !this._metering) {
      this._meterElapsed %= METER_INTERVAL;
      this._meterTask = this._meter();
      this._meterTask.catch((e) => console.warn('[render] exposure meter', e));
    }
  }

  async _meter(): Promise<void> {
    this._metering = true;
    try {
      const meter = this._meterPass;
      if (!meter) return;
      const luminance = await meter.sample();
      if (!this.settings.autoExposure || luminance == null || !Number.isFinite(luminance) || luminance <= 0) return;
      // Preserve the existing EV100 conversion (1.2 * (100/12.5) = 9.6)
      // and approved target limits; only the adaptation timing changes.
      const target = Math.max(.003, Math.min(5, this.settings.exposureKey / (9.6 * luminance)));
      this._exposureTarget = target;
      if (!this._meterReady) this._exposure = target;
      this._meterReady = true;
    } finally { this._metering = false; }
  }

  resize(w: number, h: number): void {
    const pr = Math.min(globalThis.devicePixelRatio || 1, this.q.dprCap) * this.q.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const size = this.renderer.getDrawingBufferSize(this._size);
    this.screenSize.width = size.x;
    this.screenSize.height = size.y;
    this.displaySize.width = w;
    this.displaySize.height = h;
    for (const pass of this.passes) pass.resize?.(size.x, size.y);
  }

  addLight(light: DirectionalLight | PointLight, opts: { range?: number; priority?: number } = {}): DirectionalLight | PointLight {
    if (!this.lights.some((l) => l.light === light)) this.lights.push({ light, ...opts });
    return light;
  }
  removeLight(light: DirectionalLight | PointLight): void { this.lights = this.lights.filter((l) => l.light !== light); }
  async prewarmLightShadow(light: DirectionalLight): Promise<unknown> {
    const { autoUpdate, needsUpdate } = light.shadow;
    try {
      // Actual forward/MRT/shadow variants, including the caller's skinned
      // stand-in. Zero draw ranges: no geometry, clock/RNG or light-ID changes.
      light.shadow.autoUpdate = true;
      light.shadow.needsUpdate = true;
      return await this._warmGraph();
    } finally {
      light.shadow.autoUpdate = autoUpdate;
      light.shadow.needsUpdate = needsUpdate;
    }
  }
  setEnvMap(texture: Texture): void {
    this.ctx.scene.environment = texture;
    this.ctx.viewScene.environment = texture;
  }
  patchMaterials(root: Object3D | null): void {
    root?.traverseVisible(root === this.ctx.viewScene ? this._tagViewMesh : this._tagPrepassMesh);
    this.indirect.update(this.ctx.peek('sky')?.keyLight ?? this.sun, this.ctx.peek('sky') ?? undefined);
  }
  _releaseGraph() {
    const meter = this._meterPass, graph = this._graph;
    // Readback may retain targets, but must not retain scene callback ownership.
    graph?.detach();
    this._meterPass = null;
    this._graph = null;
    const dispose = () => { meter?.dispose(); graph?.dispose(); };
    // A readback can still reference the old target while a post pass changes.
    if (this._metering && this._meterTask) this._meterTask.then(dispose, dispose);
    else dispose();
  }
  registerPass(pass: PostPass): () => void {
    if (typeof pass.asNode !== 'function')
      throw new Error('[render] post pass must expose asNode() for the WebGPU graph');
    this.passes.push(pass);
    this.passes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    pass.resize?.(this.screenSize.width, this.screenSize.height);
    this._releaseGraph();
    return () => {
      this.passes.splice(this.passes.indexOf(pass), 1);
      this._releaseGraph();
    };
  }
  _warmGraph(): Promise<{ ms: number; geometries: number; frameUnchanged: boolean }> {
    this._warmTask = this._warmGraphFrames();
    return this._warmTask;
  }
  async _warmGraphFrames(): Promise<{ ms: number; geometries: number; frameUnchanged: boolean }> {
    const started = performance.now(), frame = this.ctx.time.frame;
    const graph = this._graph;
    if (!graph) throw new Error('[render] graph must be created before warmup');
    const saved: Array<[Mesh, boolean, boolean, number]> = [];
    const ranges = new Map<BufferGeometry, [number, number]>();
    const target = this.renderer.getRenderTarget();
    const camera = this.ctx.camera;
    const view = camera.view && typeof camera.view === 'object' ? { ...camera.view } : null;
    const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
    const clear = this.renderer.getClearColor(new Color()), alpha = this.renderer.getClearAlpha();
    const rendererState = {
      toneMapping: this.renderer.toneMapping, outputColorSpace: this.renderer.outputColorSpace,
      autoClear: this.renderer.autoClear, autoClearColor: this.renderer.autoClearColor,
      autoClearDepth: this.renderer.autoClearDepth, autoClearStencil: this.renderer.autoClearStencil,
      opaque: this.renderer.opaque, transparent: this.renderer.transparent,
      lighting: this.renderer.lighting, contextNode: this.renderer.contextNode,
    };
    const mrt = this.renderer.getMRT(), renderObject = this.renderer.getRenderObjectFunction();
    const xr = this.renderer.xr.enabled, shadows = this.renderer.shadowMap.enabled;
    const cameraMasks: Array<[Camera, number]> = [camera, this.ctx.viewCamera].map(c => [c, c.layers.mask]);
    const sceneStates = [this.ctx.scene, this.ctx.viewScene].map(scene => [scene, {
      name: scene.name, overrideMaterial: scene.overrideMaterial,
      background: scene.background, backgroundNode: scene.backgroundNode,
    }] as const);
    const passFlags = [graph.prePass, graph.worldPass, graph.viewPass]
      .map(pass => [pass, pass.opaque, pass.transparent] as const);
    // compileAsync() uses a different nested render-context key. Exercise the
    // native graph without any world/view geometry, simulation or RNG.
    for (const scene of [this.ctx.scene, this.ctx.viewScene]) scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || (mesh.material as Material | null)?.visible === false) return;
      saved.push([mesh, mesh.visible, mesh.frustumCulled, mesh.layers.mask]);
      mesh.visible = true;
      mesh.frustumCulled = false;
      if (!ranges.has(mesh.geometry)) {
        const { start, count } = mesh.geometry.drawRange;
        ranges.set(mesh.geometry, [start, count]);
        mesh.geometry.setDrawRange(0, 0);
      }
    });
    try {
      this.ctx.scene.traverseVisible(this._tagPrepassMesh);
      this.ctx.viewScene.traverseVisible(this._tagViewMesh);
      this.renderer.setRenderTarget(null);
      // Yield native history frames; synchronous draws can skip FRAME nodes.
      // TRAA uses 32 jitter phases. Complete the cycle so gameplay starts
      // at the same phase as a cold graph, without resetting private fields.
      const frames = graph.taaPass ? 32 : 2;
      for (let i = 0; i < frames; i++) {
        // Prime pipeline/TAA callbacks before any scene shader is built. Its
        // velocity node must already reference the unjittered projection.
        if (i === 0) for (const [pass] of passFlags) pass.opaque = pass.transparent = false;
        else for (const [pass, opaque, transparent] of passFlags) {
          pass.opaque = opaque; pass.transparent = transparent;
        }
        await warmFrame(() => graph.render(), this._warmAbort.signal,
          started + WARM_GRAPH_TIMEOUT_MS);
      }
    } catch (error) {
      this._warmAbort.abort(error);
      if (!this._disposing) this.ctx.engine.fail('render', 'prewarm', error);
      throw error;
    } finally {
      for (const [pass, opaque, transparent] of passFlags) {
        pass.opaque = opaque; pass.transparent = transparent;
      }
      for (const [object, visible, culled, mask] of saved) {
        object.visible = visible; object.frustumCulled = culled; object.layers.mask = mask;
      }
      for (const [geometry, [start, count]] of ranges) geometry.setDrawRange(start, count);
      // The pinned TRAA node attaches these runtime helpers, though its public
      // declaration omits them. Keep the rest of the graph type inferred.
      const taaPass = graph.taaPass as (NonNullable<typeof graph.taaPass> & {
        setSize(width: number, height: number): void; clearViewOffset(): void;
      }) | null;
      // Force native history initialization from the first real beauty frame.
      taaPass?.setSize(1, 1);
      // TRAA's after-pipeline callback is not run if rendering throws.
      if (camera.view && typeof camera.view === 'object' && camera.view.enabled) taaPass?.clearViewOffset();
      camera.view = view;
      camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse);
      this.renderer.setClearColor(clear, alpha);
      // Native PassNode/shadow draws also lack exception-safe restoration.
      for (const [scene, state] of sceneStates) Object.assign(scene, state);
      for (const [c, mask] of cameraMasks) c.layers.mask = mask;
      Object.assign(this.renderer, rendererState);
      this.renderer.setMRT(mrt); this.renderer.setRenderObjectFunction(renderObject);
      this.renderer.xr.enabled = xr; this.renderer.shadowMap.enabled = shadows;
      this.renderer.setRenderTarget(target);
    }
    return { ms: Math.round(performance.now() - started), geometries: ranges.size,
      frameUnchanged: this.ctx.time.frame === frame };
  }

  async prewarmMaterials(): Promise<{ ok: true; graphWarm: { ms: number; geometries: number; frameUnchanged: boolean } }> {
    // The first gameplay frame needs these exact CSM/light variants. Compiling
    // against the fallback sun before attaching the active sky light merely
    // warms shaders that are never drawn in combat.
    this._syncSun(this.ctx);
    const key = this.activeSun;
    // Hidden-variant hooks require this graph and its actual pass targets.
    this.ctx.scene.traverseVisible(this._tagPrepassMesh);
    this.ctx.viewScene.traverseVisible(this._tagViewMesh);
    this.indirect.update(key, this.ctx.peek('sky') ?? undefined);
    updateViewLighting(this, this.ctx);
    this._getGraph();
    const meter = this._meterPass;
    if (!meter) throw new Error('[render] HDR meter was not created');
    meter.warm();
    // Direct scene compiles use a different context from the production passes.
    // The zero-range graph warm below covers world/view, CSM, MRT and post.
    return { ok: true, graphWarm: await this._warmGraph() };
  }
  async dispose(): Promise<void> {
    this._disposing = true;
    this._warmAbort.abort(new Error('Renderer disposed during warmup'));
    await this._warmTask?.catch(() => {});
    await this._meterTask?.catch(() => {});
    this._meterPass?.dispose();
    this._graph?.dispose();
    this._volumeShadow?.dispose();
    this.grade.texture.dispose();
    for (const scene of [this.ctx.scene, this.ctx.viewScene]) {
      if (scene.environment === this._fallbackEnv) scene.environment = null;
      if (scene.background === this._fallbackBackground) scene.background = null;
    }
    this._fallbackEnv.dispose();
    this._ambient.removeFromParent();
    for (const light of [this.viewSun, this.viewFill]) {
      light.removeFromParent(); light.target.removeFromParent(); light.dispose();
    }
    for (const slot of this.viewPracticals) { slot.light.removeFromParent(); slot.light.dispose(); }
    for (const light of [this.sun, this._skyKey, this._skySecondary]) {
      light.shadow.shadowNode?.dispose(); light.shadow.dispose();
      this.ctx.scene.remove(light, light.target);
    }
    try { await this.renderer.dispose(); }
    finally {
      // Restore shared-node identity even when native teardown rejects.
      for (const [node, group] of this._lightUniformGroups) node.setGroup(group);
      this._lightUniformGroups.clear();
    }
  }
}
