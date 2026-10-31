import {
  abs,
  exp,
  float,
  max,
  min,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector4,
} from 'three/webgpu';
import type { Node, Renderer } from 'three/webgpu';

/** Experimental, text-free HUD: one bounded quad, no second device or render target.
 * Coordinates are CSS pixels; resolution and DOM-overlay ordering remain those
 * of the game canvas. This approximates CSS shadows, not a pixel-identical port. */
export class GpuCrosshair {
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private geometry = new PlaneGeometry(1, 1);
  private material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private mesh = new Mesh(this.geometry, this.material);
  private shape = uniform(new Vector4(6, 8, 1, 1)); // gap, length, scale, dot scale
  private alpha = uniform(new Vector4(1, 0.85, 1, 1)); // blade, dot, HUD fade, spare
  private extent = uniform(64);
  private pixel = uniform(1);
  enabled = false;

  constructor() {
    this.camera.position.z = 1;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    const p = uv().sub(0.5).mul(this.extent);
    const a = abs(p);
    const half = vec2(this.shape.z.mul(0.8), this.shape.y.mul(0.5));
    const box = (q: Node<'vec2'>): Node<'float'> =>
      max(q, vec2(0))
        .length()
        .add(min(max(q.x, q.y), 0));
    const vertical = box(vec2(a.x, abs(a.y.sub(this.shape.x))).sub(half));
    const horizontal = box(vec2(a.y, abs(a.x.sub(this.shape.x))).sub(half));
    const blade = min(vertical, horizontal);
    const dot = p.length().sub(this.shape.z.mul(this.shape.w).mul(1.1));
    const aa = this.pixel.mul(0.7);
    const coverage = (d: Node<'float'>): Node<'float'> =>
      float(1).sub(smoothstep(aa.negate(), aa, d));
    // The outward end of each blade is white; the inward end is translucent.
    const along = max(a.x, a.y).sub(this.shape.x).div(this.shape.y).add(0.5);
    const gradient = mix(0.62, 1, along.div(0.62).clamp());
    const bladeFill = coverage(blade).mul(gradient).mul(this.alpha.x);
    const dotFill = coverage(dot).mul(this.alpha.y);
    const white = float(1).sub(float(1).sub(bladeFill).mul(float(1).sub(dotFill)));
    const seat = (d: Node<'float'>, opacity: Node<'float'>): Node<'float'> => {
      const outline = coverage(d.sub(1)).mul(0.55);
      const blur = exp(
        max(d, 0)
          .div(max(this.shape.z.mul(2), 0.25))
          .pow(2)
          .negate()
      ).mul(0.6);
      return max(outline, blur).mul(opacity);
    };
    const black = max(seat(blade, this.alpha.x), seat(dot, this.alpha.y));
    const opacity = white.add(black.mul(float(1).sub(white)));
    // Straight alpha, already display-referred white/black like the CSS source.
    // Do not apply another output transform to this or the encoded world below.
    this.material.fragmentNode = vec4(
      vec3(white.div(max(opacity, 0.0001))),
      opacity.mul(this.alpha.z)
    );
  }

  update(
    gap: number,
    length: number,
    visible: number,
    bright: number,
    pulse: number,
    k: number
  ): void {
    this.shape.value.set(gap, 8 * k * length, k, 1 + pulse * 1.1);
    this.alpha.value.x = visible * Math.min(1, bright);
    this.alpha.value.y = visible * (0.85 + 0.15 * pulse);
    this.extent.value = 2 * (Math.abs(gap) + 8 * k * length + 10 * k);
    this.mesh.scale.setScalar(this.extent.value);
  }

  draw(renderer: Renderer, width: number, height: number, hudOpacity: number): void {
    if (
      !this.enabled ||
      hudOpacity < 0.004 ||
      Math.max(this.alpha.value.x, this.alpha.value.y) < 0.004
    )
      return;
    this.alpha.value.z = hudOpacity;
    this.pixel.value = 1 / renderer.getPixelRatio();
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
    // Only these states are changed. Leave viewport, target and scissor alone.
    // Like RenderPipeline, bypass Three's implicit full-screen output-transform
    // target: our shader emits display-referred values directly onto final output.
    const clear = renderer.autoClear;
    const tone = renderer.toneMapping;
    const output = renderer.outputColorSpace;
    const mrt = renderer.getMRT();
    const draw = renderer.getRenderObjectFunction();
    try {
      renderer.autoClear = false;
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = LinearSRGBColorSpace;
      renderer.setMRT(null);
      renderer.setRenderObjectFunction(null);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.autoClear = clear;
      renderer.toneMapping = tone;
      renderer.outputColorSpace = output;
      renderer.setMRT(mrt);
      renderer.setRenderObjectFunction(draw);
    }
  }

  dispose(): void {
    this.enabled = false;
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
