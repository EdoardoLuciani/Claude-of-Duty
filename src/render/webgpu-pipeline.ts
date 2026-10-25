import type { Camera, Object3D, Scene } from 'three';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import type GTAONode from 'three/addons/tsl/display/GTAONode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import type Lut3DNode from 'three/addons/tsl/display/Lut3DNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import type TRAANode from 'three/addons/tsl/display/TRAANode.js';
import {
  builtinAOContext,
  context,
  convertToTexture,
  mrt,
  normalView,
  pass,
  positionView,
  renderGroup,
  renderOutput,
  screenCoordinate,
  screenUV,
  texture3D,
  Fn,
  texture,
  uniform,
  vec4,
  velocity,
} from 'three/tsl';
import { Lighting, RenderPipeline, Vector2 } from 'three/webgpu';
import { AgXToneMapping, Color, SRGBColorSpace } from 'three/webgpu';
import type { Renderer, Node } from 'three/webgpu';
import type { PassNode, RTTNode, TextureNode, UniformNode } from 'three/webgpu';

import type { VolumetricBuildOptions } from '../sky/volumetrics.ts';
import { createAoBilateralBlur } from './ao-blur-webgpu.ts';
import { createFogCompute } from './fog-compute-webgpu.ts';
import type { createGradeLut } from './lut.ts';

// Application art policy, not upstream defaults or a physical reflectance model.
const BLOOM_STRENGTH = 0.14,
  BLOOM_THRESHOLD = 1.6;
const BLOOM_RADIUS = 0,
  BLOOM_INPUT_CEILING = 16;

export interface PostPass {
  order?: number;
  asNode(color: Node, exposure: Node): Node<'vec4'>;
  asColorNode?(color: Node, exposure: Node): Node<'vec4'>;
  resize?(width: number, height: number): void;
}
export type FogInputs = VolumetricBuildOptions;
type FogBuilder = (inputs: FogInputs) => Node<'vec3'> | Node<'vec4'>;
export interface PipelineOptions {
  gtao?: boolean;
  taa?: boolean;
  bloomStrength?: number;
  bloomThreshold?: number;
  grade?: ReturnType<typeof createGradeLut> | null;
  fog?: FogBuilder | null;
  fogCompute?: boolean;
  warp?: ((node: Node<'vec4'>) => Node<'vec4'>) | null;
  postPasses?: PostPass[];
  afterDepth?: (() => void) | null;
}

/**
 * WebGPU frame graph shared by production gameplay and isolated GPU probes.
 * World and first-person
 * depth never mix; the latter has no MSAA and bypasses world TAA/fog.
 */
export function createWorldViewPipeline(
  renderer: Renderer,
  scene: Scene,
  camera: Camera,
  viewScene: Scene,
  viewCamera: Camera,
  {
    gtao = true,
    taa = false,
    bloomStrength = BLOOM_STRENGTH,
    bloomThreshold = BLOOM_THRESHOLD,
    grade = null,
    fog = null,
    fogCompute = false,
    warp = null,
    postPasses = [],
    afterDepth = null,
  }: PipelineOptions = {}
): {
  pipeline: RenderPipeline;
  worldPass: PassNode;
  viewPass: PassNode;
  prePass: PassNode;
  aoPass: GTAONode | null;
  aoBlur: { textureNode: RTTNode; dispose(): void } | null;
  taaPass: TRAANode | null;
  exposure: UniformNode<'float', number>;
  linearDepth: TextureNode;
  detach: () => void;
  render(): void;
  dispose(): void;
} {
  let aoPass = null,
    aoBlur = null,
    taaPass = null;
  const intermediates: Array<{ dispose(): void }> = [];
  const asTexture = (node: Node<'vec4'>): Node<'vec4'> => {
    const result = convertToTexture(node as never) as Node<'vec4'> & {
      isRTTNode?: boolean;
      dispose(): void;
    };
    if (result !== node && result.isRTTNode) intermediates.push(result);
    return result; // Existing texture/pass outputs remain borrowed.
  };
  const worldPass = pass(scene, camera, { samples: 0 });
  worldPass.lighting = new ClusteredLighting();
  const worldLights = worldPass.lighting.getNode(scene) as ReturnType<
    typeof worldPass.lighting.getNode
  > & { setSize(width: number, height: number): void };
  const clusterSize = new Vector2();
  const viewPass = pass(viewScene, viewCamera, { samples: 0 });
  // Environment hooks specialize by camera. Give the view pass an explicit
  // cache identity even when its light/environment topology equals the world.
  viewPass.contextNode = context({});
  // PassNode resets Three's clear alpha to one for each pass (including after
  // native CSM renders). Clear the view scene to transparent black, otherwise
  // an empty pixel covers the entire world during alpha composition.
  const oldBefore = Reflect.get(viewScene, 'onBeforeRender') as typeof viewScene.onBeforeRender;
  const oldAfter = Reflect.get(viewScene, 'onAfterRender') as typeof viewScene.onAfterRender;
  const savedColor = new Color();
  let savedAlpha = 0;
  type ViewRenderHook = (renderer: Renderer, scene: Scene, camera: Camera, target: unknown) => void;
  const callViewHook = (
    hook: typeof oldBefore,
    r: Renderer,
    s: Scene,
    c: Camera,
    target: unknown
  ): void => {
    (hook as unknown as ViewRenderHook).call(viewScene, r, s, c, target);
  };
  const beforeRender: ViewRenderHook = (r, s, c, target): void => {
    if (oldBefore) callViewHook(oldBefore, r, s, c, target);
    if (target !== viewPass.renderTarget) return;
    r.getClearColor(savedColor);
    savedAlpha = r.getClearAlpha();
    r.setClearColor(0, 0);
  };
  const beforeView = beforeRender;
  const afterView: ViewRenderHook = (r, s, c, target): void => {
    if (target === viewPass.renderTarget) r.setClearColor(savedColor, savedAlpha);
    if (oldAfter) callViewHook(oldAfter, r, s, c, target);
  };
  viewScene.onBeforeRender = beforeView as unknown as typeof viewScene.onBeforeRender;
  viewScene.onAfterRender = afterView as unknown as typeof viewScene.onAfterRender;
  const detach = (): void => {
    if ((viewScene.onBeforeRender as unknown) === beforeView) viewScene.onBeforeRender = oldBefore;
    if ((viewScene.onAfterRender as unknown) === afterView) viewScene.onAfterRender = oldAfter;
  };
  // Opaque geometry only: custom translucent particle fragment shaders cannot
  // produce MRT attachments. Layer 1 excludes the sky dome and soft FX.
  const prePass = pass(scene, camera, { samples: 0 });
  // Keep the original materials for mapped normals, alpha tests and vertex
  // deformation, but skip lighting/IBL and their bindings. A separate manager
  // isolates the prepass render-list/light cache from the lit world pass.
  prePass.lighting = new Lighting();
  prePass.lighting.enabled = false;
  scene.traverse((object: Object3D): void => {
    if ((object as Object3D & { isLight?: boolean }).isLight) object.layers.enable(1);
  });
  prePass.setLayers({ mask: 2 } as import('three').Layers);
  prePass.transparent = false;
  // GTAO sets a white clear before updating its depth dependency. With AO
  // scheduled outside world lighting, don't inherit that clear in normals.
  const updatePrepass = Reflect.get(prePass, 'updateBefore') as (frame: {
    renderer: Renderer | null;
  }) => void;
  const preClear = new Color();
  prePass.updateBefore = function (
    this: typeof prePass,
    frame: { renderer: Renderer | null }
  ): undefined {
    const r = frame.renderer!,
      alpha = r.getClearAlpha();
    r.getClearColor(preClear);
    r.setClearColor(0, 1);
    try {
      updatePrepass.call(this, frame);
      afterDepth?.(); // Consumers now see this frame's opaque depth.
    } finally {
      r.setClearColor(preClear, alpha);
    }
    return undefined;
  } as NonNullable<typeof prePass.updateBefore>;
  const channels: Record<string, Node> = { output: normalView as Node };
  if (taa) channels.velocity = velocity;
  // The native depth attachment is nonlinear; publish positive view metres.
  channels.linearDepth = positionView.z.negate();
  prePass.setMRT(mrt(channels));
  if (gtao) {
    aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    // Keep the existing half-resolution AO budget after the upstream sampling fix.
    aoPass.resolutionScale = 0.5;
    aoBlur = createAoBilateralBlur(
      aoPass.getTextureNode(),
      prePass.getTextureNode('linearDepth'),
      prePass.getTextureNode('depth'),
      camera
    );
    // World shaders only sample the published texture. Traversing the RTT/AO
    // graph in each new mesh builder resets its fullscreen materials' contexts.
    // ScreenNode creates a fresh size uniform in each builder. Its differing
    // ID fragments otherwise-identical shared camera groups, including CSM's
    // inherited AO context. One pass-aware uniform keeps the same native UVs.
    const aoSize = uniform(new Vector2())
      .setGroup(renderGroup)
      .onRenderUpdate(({ renderer }, self): undefined => {
        const target = renderer!.getRenderTarget();
        if (target) self.value.set(target.width, target.height);
        else renderer!.getDrawingBufferSize(self.value);
      });
    worldPass.contextNode = builtinAOContext(
      texture(aoBlur.textureNode.value).sample(screenCoordinate.div(aoSize)).r
    );
  }
  // TSL transitions among texture, variable, and vector nodes here; upstream
  // generic node types are not covariant across those equivalent color values.
  let world: Node<'vec4'> = worldPass.getTextureNode();
  // Resolve only the world. The weapon's ADS motion has no valid world velocity.
  if (taa) {
    taaPass = traa(
      worldPass.getTextureNode() as never,
      prePass.getTextureNode('depth'),
      prePass.getTextureNode('velocity'),
      camera
    );
    // Borrow the published resolve texture instead of materializing an identity RTT.
    world = (taaPass as typeof taaPass & { getTextureNode(): Node<'vec4'> }).getTextureNode();
  }
  // Apply aerial perspective to world pixels only; the viewmodel is held in
  // view space and must never inherit world fog or temporal reprojection.
  let fogPass = null;
  if (fog) {
    const inputs = { color: asTexture(world), depth: prePass.getTextureNode('linearDepth') };
    const fogInputs = inputs as unknown as FogInputs;
    if (fogCompute) fogPass = createFogCompute(fog, fogInputs);
    world = (fogPass ? fogPass.textureNode : fog(fogInputs)) as Node<'vec4'>;
  }
  // World-depth haze must not distort an occluding first-person weapon.
  if (warp) world = warp(asTexture(world));
  const view = viewPass.getTextureNode();
  // The view pass is premultiplied; retain its partially transparent optic glass.
  let composite = world.mul(view.a.clamp(0, 1).oneMinus()).add(view);
  const exposure = uniform(1);
  for (const post of postPasses) {
    // Pointwise effects consume this fragment's colour directly. Resampling
    // effects keep the texture input contract and its materialization boundary.
    composite = post.asColorNode
      ? post.asColorNode(composite, exposure)
      : post.asNode(asTexture(composite), exposure);
  }
  const exposed = composite.mul(exposure);
  // A few viewmodel glints can hit RGBA16F's 65504 ceiling at glancing
  // angles. Cap only bloom's input; the original HDR colour stays intact,
  // while two anomalous pixels cannot light up half the screen.
  const glow =
    bloomStrength > 0
      ? bloom(
          vec4(exposed.rgb.min(BLOOM_INPUT_CEILING), exposed.a),
          bloomStrength,
          BLOOM_RADIUS,
          bloomThreshold
        )
      : null;
  const lit = glow ? exposed.add(glow) : exposed;
  // The authored LUT is display-referred; grade AFTER AgX and sRGB encoding.
  const final = grade
    ? lut3D(
        renderOutput(lit, AgXToneMapping, SRGBColorSpace),
        texture3D(grade.texture),
        grade.size as never,
        1 as never
      )
    : lit;
  // Publish current depth before any world soft particles or haze, even without
  // AO. PassNode deduplicates this dependency: exactly one prepass per frame.
  const output = Fn((): Node<'vec4'> | Lut3DNode => {
    prePass.getTextureNode('linearDepth').sample(screenUV).toVar();
    if (aoBlur) aoBlur.textureNode.sample(screenUV).toVar();
    if (fogPass) fogPass.computeNode.toStack();
    return final;
  })();
  const pipeline = new RenderPipeline(renderer, output);
  if (grade) pipeline.outputColorTransform = false;
  return {
    pipeline,
    worldPass,
    viewPass,
    prePass,
    aoPass,
    aoBlur,
    taaPass,
    exposure,
    linearDepth: prePass.getTextureNode('linearDepth'),
    detach,
    render(): void {
      // Resize before any draw/binding lookup, not from the lights' late update.
      renderer.getDrawingBufferSize(clusterSize);
      worldLights.setSize(clusterSize.x, clusterSize.y);
      pipeline.render();
    },
    dispose(): void {
      detach();
      pipeline.dispose();
      for (const node of intermediates) node.dispose();
      worldPass.dispose();
      worldLights.dispose(); // PassNode does not dispose its lighting node.
      viewPass.dispose();
      prePass.dispose();
      fogPass?.dispose();
      aoBlur?.dispose();
      aoPass?.dispose();
      taaPass?.dispose();
      glow?.dispose();
    },
  };
}
