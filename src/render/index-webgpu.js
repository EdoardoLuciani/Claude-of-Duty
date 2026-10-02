import { AmbientLight, Color, DataTexture, DirectionalLight, EquirectangularReflectionMapping,
  HemisphereLight, PCFShadowMap, RGBAFormat, SRGBColorSpace, StorageInstancedBufferAttribute,
  Vector2, Vector3 } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { StableCSMShadowNode } from './csm-webgpu.js';
import { lightPosition, lightTargetPosition, lightViewPosition, sharedUniformGroup, uniform } from 'three/tsl';
import { createWebGpuRenderer } from './webgpu-device.js';
import { createWorldViewPipeline } from './webgpu-pipeline.js';
import { createGradeLut } from './lut.js';
import { createHdrMeter } from './meter-webgpu.js';
import { IndirectFill } from './indirect-webgpu.js';

/** One strict WebGPU owner; no WebGL context, shader patching, or runtime toggle. */
export class RenderSystem {
  static id = 'render';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    this.q = ctx.config.q;
    this.renderer = await createWebGpuRenderer(ctx.canvas);
    this.renderer.setClearColor(0, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.maxAnisotropy = this.q.anisotropy;
    this.screenSize = { width: 1, height: 1 };
    this.displaySize = { width: 1, height: 1 };
    this.passes = [];
    this.lights = [];
    // Keep camera-relative light positions out of per-material shadow/layout
    // uniforms. Native shared bind-group caching can then reuse this field set.
    this._lightPositionGroup = sharedUniformGroup('owLightPositions', 0, 'render');
    this._lightUniformGroups = new Map();
    this.grade = createGradeLut('default');
    this.settings = { bloomStrength: 0.14, bloomThreshold: 1.6, exposureBias: 0,
      exposureKey: 1.06, autoExposure: true, lutStrength: 1 };
    this._exposure = 1;
    this._metering = false;
    this._meterReady = false;
    this._frame = 0;
    this._graph = null;
    this._meterPass = null;
    this._lightsReady = false;
    this._size = new Vector2();
    this._tagPrepassMesh = this._tagPrepassMesh.bind(this);
    this._tagViewMesh = this._tagViewMesh.bind(this);
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
    ctx.scene.background = new Color(0x86a1b4);

    this.sun = new DirectionalLight(0xffe8c4, 4.3);
    this.sun.position.set(-42, 46, 26);
    // The scene's white ambient used to overwhelm the authored blue sky fill.
    // Keep its light ID stable; the TSL indirect node supplies the actual fill.
    ctx.scene.add(this.sun, this.sun.target, new AmbientLight(0xffffff, 0));
    this.indirect = new IndirectFill(ctx);
    this.activeSun = this.sun;
    this.sunDir = new Vector3().copy(this.sun.position).normalize();
    this.viewSun = new DirectionalLight(0xffe8c4, 2.2);
    this.viewSun.position.set(-0.45, 0.75, 0.55);
    this.viewFill = new HemisphereLight(0x8fb6ff, 0x36302a, 0.35);
    this.viewRim = new DirectionalLight(0xffd7a8, 0.9);
    this.viewRim.position.set(0.2, 0.35, -0.9);
    ctx.viewScene.add(this.viewSun, this.viewFill, this.viewRim);
    this._viewChildren = ctx.viewScene.children.length;
    this.resize(ctx.canvas.clientWidth || 1280, ctx.canvas.clientHeight || 720);
  }

  _setupShadows(light) {
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

  _getGraph() {
    if (this._graph) return this._graph;
    const haze = this.ctx.peek('fx')?.hazeSys;
    const sky = this.ctx.peek('sky');
    this._graph = createWorldViewPipeline(this.renderer, this.ctx.scene, this.ctx.camera,
      this.ctx.viewScene, this.ctx.viewCamera, {
        gtao: this.q.gtao, ssrEnabled: this.q.ssr, taa: this.q.taa,
        bloomStrength: this.q.bloom ? this.settings.bloomStrength : 0,
        bloomThreshold: this.settings.bloomThreshold, grade: this.grade,
        // Postprocessing draws with an orthographic fullscreen camera. Its
        // built-in camera accessors are NOT the gameplay camera used by fog.
        fog: sky?.createFogNode ? (inputs) => sky.createFogNode({ ...inputs,
          invProj: uniform(this.ctx.camera.projectionMatrixInverse),
          camWorld: uniform(this.ctx.camera.matrixWorld),
          camPos: uniform(this.ctx.camera.position),
        }) : null,
        warp: haze ? (node) => haze.warpNode(node) : null,
        postPasses: this.passes,
      });
    this.depthTexture = this._graph.linearDepth.value;
    this.velocityTexture = this.q.taa ? this._graph.prePass.getTextureNode('velocity').value : null;
    this.normalTexture = this._graph.prePass.getTextureNode().value;
    this.aoTexture = this._graph.aoBlur?.textureNode.value ?? null;
    this.hdrTexture = this._graph.worldPass.renderTarget.texture;
    this.hdrRt = this._graph.worldPass.renderTarget;
    this.viewRt = this._graph.viewPass.renderTarget;
    this._meterPass = createHdrMeter(this.renderer, this.hdrRt.texture, this.depthTexture);
    return this._graph;
  }

  _shareLightPosition(node) {
    if (this._lightUniformGroups.has(node)) return;
    this._lightUniformGroups.set(node, node.groupNode);
    node.setGroup(this._lightPositionGroup);
  }

  _tagLight(light) {
    if (light.isPointLight || light.isSpotLight) this._shareLightPosition(lightViewPosition(light));
    if (light.isDirectionalLight || light.isSpotLight) {
      this._shareLightPosition(lightPosition(light));
      this._shareLightPosition(lightTargetPosition(light));
    }
  }

  _tagPrepassMesh(mesh) {
    if (mesh.isLight) { this._tagLight(mesh); mesh.layers.enable(1); return; }
    if (!mesh.isMesh) return;
    if (mesh.isInstancedMesh && mesh.userData.owStatic &&
        !mesh.instanceMatrix.isStorageInstancedBufferAttribute) {
      // Native instancing otherwise uploads small matrix arrays as per-object
      // uniforms in every pass. Storage keeps immutable world arrays resident
      // and still honours needsUpdate/version if an owner edits an instance.
      const source = mesh.instanceMatrix;
      const storage = new StorageInstancedBufferAttribute(source.array, source.itemSize);
      storage.setUsage(source.usage);
      storage.normalized = source.normalized;
      storage.meshPerAttribute = source.meshPerAttribute;
      mesh.instanceMatrix = storage;
    }
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) this.indirect.patch(material);
    } else this.indirect.patch(mesh.material);
    let opaque = !!mesh.material && !mesh.material.transparent;
    if (Array.isArray(mesh.material)) {
      opaque = true;
      for (const material of mesh.material) {
        if (!material || material.transparent) { opaque = false; break; }
      }
    }
    if (opaque && !mesh.userData.owNoPrepass) mesh.layers.enable(1);
    else mesh.layers.disable(1);
  }

  _tagViewMesh(object) {
    if (object.isLight) { this._tagLight(object); return; }
    if (!object.isMesh) return;
    if (Array.isArray(object.material)) {
      for (const material of object.material) this.indirect.patch(material);
    } else this.indirect.patch(object.material);
  }

  render(ctx) {
    ctx.scene.traverseVisible(this._tagPrepassMesh);
    const key = ctx.peek('sky')?.keyLight ?? this.sun;
    if (key !== this.activeSun || !this._lightsReady) {
      this.sun.visible = key === this.sun;
      this.activeSun.castShadow = false;
      this.activeSun = key;
      this._setupShadows(key);
      this._lightsReady = true;
    }
    this.sunDir.copy(this.activeSun.position).sub(this.activeSun.target.position).normalize();
    this.indirect.update(this.activeSun, ctx.peek('sky'));
    ctx.viewScene.traverseVisible(this._tagViewMesh);
    const graph = this._getGraph();
    graph.exposure.value = this._exposure * 2 ** -this.settings.exposureBias;
    ctx.peek('fx')?.hazeSys?.render(this.renderer, ctx.camera);
    this.renderer.setRenderTarget(null);
    graph.render();
    // Asynchronous, sparse HDR metering: no GPU readback stalls in the frame loop.
    if (++this._frame % 16 === 0 && !this._metering && this.settings.autoExposure) {
      this._meterTask = this._meter();
      this._meterTask.catch((e) => console.warn('[render] exposure meter', e));
    }
  }

  async _meter() {
    this._metering = true;
    try {
      const luminance = await this._meterPass.sample();
      if (!Number.isFinite(luminance) || luminance <= 0) return;
      // Same EV100-to-exposure conversion as the WebGL scene meter: the
      // photometric denominator is 1.2 * (100/12.5) = 9.6. Only the final
      // adapted exposure is capped at night, not the daylight target.
      const target = Math.max(.003, Math.min(5, this.settings.exposureKey / (9.6 * luminance)));
      this._exposure = this._meterReady ? this._exposure + (target - this._exposure) * .24 : target;
      this._meterReady = true;
    } finally { this._metering = false; }
  }

  resize(w, h) {
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

  addLight(light, opts = {}) {
    if (!this.lights.some((l) => l.light === light)) this.lights.push({ light, ...opts });
    return light;
  }
  removeLight(light) { this.lights = this.lights.filter((l) => l.light !== light); }
  requestEnvMap() { return this.ctx.scene.environment; }
  setEnvMap(texture) {
    this.ctx.scene.environment = texture;
    this.ctx.viewScene.environment = texture;
  }
  setExposureBias(ev) { this.settings.exposureBias = ev; }
  patchMaterials(root) {
    root?.traverseVisible(root === this.ctx.viewScene ? this._tagViewMesh : this._tagPrepassMesh);
    this.indirect.update(this.ctx.peek('sky')?.keyLight ?? this.sun, this.ctx.peek('sky'));
  }
  _releaseGraph() {
    const meter = this._meterPass, graph = this._graph;
    this._meterPass = null;
    this._graph = null;
    const dispose = () => { meter?.dispose(); graph?.dispose(); };
    // A readback can still reference the old target while a post pass changes.
    if (this._metering) this._meterTask.then(dispose, dispose);
    else dispose();
  }
  registerPass(pass) {
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
  async _warmGraph() {
    const started = performance.now(), frame = this.ctx.time.frame;
    const saved = [], ranges = new Map(), target = this.renderer.getRenderTarget();
    const passFlags = [this._graph.prePass, this._graph.worldPass, this._graph.viewPass]
      .map(pass => [pass, pass.opaque, pass.transparent]);
    // compileAsync() uses a different nested render-context key. Exercise the
    // native graph without any world/view geometry, simulation or RNG.
    for (const scene of [this.ctx.scene, this.ctx.viewScene]) scene.traverse((object) => {
      if (!object.isMesh || object.material?.visible === false) return;
      saved.push([object, object.visible, object.frustumCulled, object.layers.mask]);
      object.visible = true;
      object.frustumCulled = false;
      if (!ranges.has(object.geometry)) {
        const { start, count } = object.geometry.drawRange;
        ranges.set(object.geometry, [start, count]);
        object.geometry.setDrawRange(0, 0);
      }
    });
    try {
      this.ctx.scene.traverseVisible(this._tagPrepassMesh);
      this.ctx.viewScene.traverseVisible(this._tagViewMesh);
      this.renderer.setRenderTarget(null);
      // Yield native history frames; synchronous draws can skip FRAME nodes.
      // r186 TRAA uses 32 jitter phases. Complete the cycle so gameplay starts
      // at the same phase as a cold graph, without resetting private fields.
      const frames = this._graph.taaPass ? 32 : 2;
      for (let i = 0; i < frames; i++) {
        // Prime pipeline/TAA callbacks before any scene shader is built. Its
        // velocity node must already reference the unjittered projection.
        if (i === 0) for (const [pass] of passFlags) pass.opaque = pass.transparent = false;
        else for (const [pass, opaque, transparent] of passFlags) {
          pass.opaque = opaque; pass.transparent = transparent;
        }
        await new Promise((resolve, reject) => {
          requestAnimationFrame(() => {
            try { this._graph.render(); resolve(); } catch (error) { reject(error); }
          });
        });
      }
    } finally {
      for (const [pass, opaque, transparent] of passFlags) {
        pass.opaque = opaque; pass.transparent = transparent;
      }
      for (const [object, visible, culled, mask] of saved) {
        object.visible = visible; object.frustumCulled = culled; object.layers.mask = mask;
      }
      for (const [geometry, [start, count]] of ranges) geometry.setDrawRange(start, count);
      // Force native history initialization from the first real beauty frame.
      this._graph.taaPass?.setSize(1, 1);
      this.renderer.setRenderTarget(target);
    }
    return { ms: Math.round(performance.now() - started), geometries: ranges.size,
      frameUnchanged: this.ctx.time.frame === frame };
  }

  async prewarmMaterials() {
    // The first gameplay frame needs these exact CSM/light variants. Compiling
    // against the fallback sun before attaching the active sky light merely
    // warms shaders that are never drawn in combat.
    const key = this.ctx.peek('sky')?.keyLight ?? this.sun;
    this.sun.visible = key === this.sun;
    this.activeSun = key;
    this._setupShadows(key);
    this._lightsReady = true;
    // Weapon/radio hooks bind the same pass targets they render into. Build the
    // graph before their compile hooks so none can bind `undefined` as a target.
    this.ctx.scene.traverseVisible(this._tagPrepassMesh);
    this.ctx.viewScene.traverseVisible(this._tagViewMesh);
    this.indirect.update(key, this.ctx.peek('sky'));
    this._getGraph();
    this._meterPass.warm();
    await this.renderer.compileAsync(this.ctx.scene, this.ctx.camera);
    await this.renderer.compileAsync(this.ctx.viewScene, this.ctx.viewCamera);
    const graphWarm = await this._warmGraph();
    return { ok: true, graphWarm };
  }
  async dispose() {
    await this._meterTask?.catch(() => {});
    this._meterPass?.dispose();
    this._graph?.dispose();
    this.grade.texture.dispose();
    this._fallbackEnv.dispose();
    await this.renderer.dispose();
    // Light accessors are cached by Three.js. Restore their original groups so
    // a subsequent renderer/restart cannot retain this owner's group identity.
    for (const [node, group] of this._lightUniformGroups) node.setGroup(group);
    this._lightUniformGroups.clear();
  }
}
