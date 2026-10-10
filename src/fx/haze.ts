import * as THREE from 'three';
import { Fn, clamp, screenUV, uniform, uniformTexture, vec2, vec4 } from 'three/tsl';
import type { Node, Renderer } from 'three/webgpu';
import { ParticleLayer, resetSpawn } from './particles.js';
import { P } from './atlas.ts';

/**
 * Screen-space refraction: depth-tested distortion sprites accumulate offsets
 * in a half-resolution RG target. The graph draws it after current opaque depth,
 * before the TSL warp resamples world colour with chromatic splitting, before
 * bloom. The warp requires a texture, not an arithmetic colour expression.
 */
interface HazeOptions { capacity: number; atlas: THREE.Texture; cols: number }
interface ColorTextureNode extends Node<'vec4'> { isTextureNode: true; sample(uv: Node<'vec2'>): Node<'vec4'> }
interface DistortSpawn { x: number; y: number; z: number; size0: number; size1: number; sizeCurve: number; life: number; drag: number; tile: number; soft: number; alpha: number; alphaCurve: number; r0: number; g0: number; b0: number; i0: number; r1: number; g1: number; b1: number; i1: number; seed: number }

export class HazeSystem {
  declare enabled: boolean; declare scene: THREE.Scene; declare layer: InstanceType<typeof ParticleLayer>; declare rt: THREE.RenderTarget | null;
  declare size: THREE.Vector2; declare uStrength: ReturnType<typeof uniform<'vec2'>>; declare uActive: ReturnType<typeof uniform<'float'>>;
  declare _warmCam: THREE.Camera | null; declare _camera: THREE.Camera | null | undefined; declare _live: boolean;
  declare distortTexNode: ReturnType<typeof uniformTexture>; declare _warp: Node<'vec4'> | null; declare _warpColor: ColorTextureNode | null;

  constructor(o: HazeOptions) {
    this.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.matrixAutoUpdate = false;

    this.layer = new ParticleLayer({
      capacity: o.capacity,
      mode: 'distort',
      atlas: o.atlas,
      cols: o.cols,
    });
    // The distortion fragment does its own occlusion test against the scene
    // depth, so hardware depth-testing is off and the mesh is never culled.
    this.layer.material.depthTest = false;
    this.scene.add(this.layer.mesh);
    this.layer.mesh.visible = true; // visibility is driven by instanceCount

    this.rt = null;
    this.size = new THREE.Vector2(1, 1);
    this.uStrength = uniform(new THREE.Vector2(0.013, 0));
    this.uActive = uniform(0);
    this._warmCam = null;

    this.distortTexNode = uniformTexture(_placeholder());
    this.distortTexNode.name = 'fx-distort-sample';
    this._warp = null;
    this._warpColor = null;
  }

  /** Warm offset sprites in their actual target without drawing geometry. */
  async prewarm(renderer: Renderer, camera: THREE.Camera | null | undefined = this._camera, drawGraph: (() => Promise<void>) | null = null) {
    if (!renderer || !this.rt) return { ok: false, reason: 'target not ready' };
    const cam = camera ?? (this._warmCam ??= new THREE.PerspectiveCamera());
    const geometry = this.layer.geometry, { start, count } = geometry.drawRange;
    const instances = geometry.instanceCount, visible = this.layer.mesh.visible, live = this._live;
    const target = renderer.getRenderTarget(), color = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    try {
      // Gameplay warms through the real graph: nesting depth is part of Three's
      // render-context key. Standalone previews can draw the private target.
      // Exercise both transparent sides with zero vertices and no particles.
      geometry.setDrawRange(0, 0); geometry.instanceCount = 1;
      this.layer.mesh.visible = true; this._live = true;
      if (drawGraph) await drawGraph();
      else this.render(renderer, cam);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && typeof error === 'object' && 'message' in error ? error.message : error) };
    } finally {
      geometry.setDrawRange(start, count); geometry.instanceCount = instances;
      this.layer.mesh.visible = visible; this._live = live;
      renderer.setClearColor(color, alpha); renderer.setRenderTarget(target);
    }
  }

  resize(w: number, h: number): void {
    const rw = Math.max(1, Math.floor(w * 0.5));
    const rh = Math.max(1, Math.floor(h * 0.5));
    if (this.rt && this.size.x === rw && this.size.y === rh) return;
    this.size.set(rw, rh);
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.RenderTarget(rw, rh, {
      type: THREE.HalfFloatType,
      format: THREE.RGFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rt.texture.name = 'fx-distort';
    this.distortTexNode.value = this.rt.texture;
  }

  /** Add one distortion sprite. `strength` is a screen-space offset in UV. */
  emit(now: number, x: number, y: number, z: number, radius: number, grow: number, life: number, strength: number, tile = P.SMOKE_A, seed = 0): void {
    const s = resetSpawn() as DistortSpawn;
    s.x = x;
    s.y = y;
    s.z = z;
    s.size0 = radius;
    s.size1 = radius * grow;
    s.sizeCurve = 0.5;
    s.life = life;
    s.drag = 2;
    s.tile = tile;
    s.soft = 0.6;
    s.alpha = 1;
    s.alphaCurve = 1.2;
    s.r0 = strength;
    s.g0 = strength;
    s.b0 = strength;
    s.i0 = 1;
    s.r1 = strength;
    s.g1 = strength;
    s.b1 = strength;
    s.i1 = 1;
    s.seed = seed;
    this.layer.emit(s, now);
  }

  update(now: number, depthTexture: THREE.Texture | null, camera: THREE.Camera): void {
    this.layer.setDepth(depthTexture);
    (this.layer.uniforms as { uSoftEnable: { value: THREE.Vector2 } }).uSoftEnable.value.x = depthTexture ? 1 : 0;
    this.layer.flush(now);
    const live = this.layer.mesh.visible;
    this.layer.mesh.visible = true; // culling is by instanceCount, not visibility
    this._camera = camera;
    this._live = this.enabled && live && !!this.rt;
    // render() skips idle frames, leaving the last offsets in the target.
    // Gate them here so a finished shockwave cannot warp later frames.
    this.uActive.value = this._live ? 1 : 0;
  }

  /**
   * Draw the offset sprites into the half-resolution target. Called by the render
   * graph after its current prepass, with the main camera. Returns false when idle.
   */
  render(renderer: Renderer, camera: THREE.Camera | null | undefined = this._camera): boolean {
    if (!this._live || !this.rt || !camera) return false;
    const prevTarget = renderer.getRenderTarget?.() ?? null;
    const prev = renderer.getClearColor(_col);
    const prevAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(this.scene, camera);
      return true;
    } finally {
      renderer.setClearColor(prev, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    }
  }

  /**
   * Build the TSL warp for a resolved colour texture node. Cache the result:
   * build it once when the pipeline is assembled, not per frame.
   *
   * @param {import('three/tsl').Node} colorNode a texture node (pass output)
   * @returns {import('three/tsl').Node<vec4>}
   */
  warpNode(colorSource: Node<'vec4'> | THREE.Texture): Node<'vec4'> {
    const colorNode: ColorTextureNode = (colorSource as ColorTextureNode).isTextureNode
      ? colorSource as ColorTextureNode : uniformTexture(colorSource as THREE.Texture) as ColorTextureNode;
    if (this._warp && this._warpColor === colorNode) return this._warp;
    const distort = this.distortTexNode;
    const strength = this.uStrength;
    const active = this.uActive;
    this._warp = Fn(() => {
      // Particle offsets are camera-space (Y up); native texture UVs point down.
      const raw = distort.sample(screenUV).xy.mul(vec2(1, -1)).mul(strength.x).mul(active);
      const d = clamp(raw, vec2(-0.03), vec2(0.03));
      // Chromatic split across the refraction so the smear reads as air, not blur.
      const r = colorNode.sample(screenUV.add(d.mul(1.08))).r;
      const c = colorNode.sample(screenUV.add(d));
      const b = colorNode.sample(screenUV.add(d.mul(0.92))).b;
      return vec4(r, c.g, b, c.a);
    })();
    this._warpColor = colorNode;
    return this._warp;
  }

  dispose() {
    this.layer.dispose();
    this.rt?.dispose();
    this.distortTexNode.dispose?.();
  }
}

const _col = new THREE.Color();

let placeholderTexture: THREE.DataTexture | null = null;

function _placeholder(): THREE.DataTexture {
  if (!placeholderTexture) {
    placeholderTexture = new THREE.DataTexture(
      new Float32Array([0, 0, 0, 0]),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    placeholderTexture.name = 'fx-distort-empty';
    placeholderTexture.needsUpdate = true;
  }
  return placeholderTexture;
}
