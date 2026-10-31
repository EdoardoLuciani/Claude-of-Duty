import { BufferUsage, RenderTexture } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';
import type { Renderer } from 'three/webgpu';

const SHADER = `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
  return Vertex(vec4f(p, 0, 1), vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5));
}
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var imageSampler: sampler;
@group(0) @binding(2) var<uniform> opacity: f32;
@fragment fn fragment(input: Vertex) -> @location(0) vec4f {
  return textureSample(image, imageSampler, input.uv) * opacity;
}`;

/** Experimental final-display blend: Pixi owns its RT, Three owns canvas/device.
 * No shared renderer caches, canvas reconfiguration, CPU copies or HDR injection.
 * Only active at matched physical resolutions: never silently soften the HUD. */
export class PixiCanvasComposite {
  readonly target = RenderTexture.create({ width: 1, height: 1, antialias: true });
  active = false;
  opacity = 0;
  draws = 0;
  private context: GPUCanvasContext;
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private uniform: GPUBuffer;
  private value = new Float32Array(4);
  private source: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private disposed = false;

  private game: Renderer;
  private pixi: WebGPURenderer;

  constructor(game: Renderer, pixi: WebGPURenderer) {
    this.game = game;
    this.pixi = pixi;
    const backend = game.backend;
    if (!('device' in backend) || !(backend.device instanceof GPUDevice))
      throw new Error('WebGPU device required');
    this.device = backend.device;
    this.context = game.domElement.getContext('webgpu')!;
    const configuration = this.context.getConfiguration();
    // UI initializes before Three's first canvas draw/configuration. Do not
    // configure it here: native rendering owns that handoff and its format.
    if (configuration && configuration.device !== this.device)
      throw new Error('Three must own the configured canvas');
    const module = this.device.createShaderModule({
      label: 'Pixi display composite',
      code: SHADER,
    });
    this.pipeline = this.device.createRenderPipeline({
      label: 'Pixi display composite',
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: {
        module,
        entryPoint: 'fragment',
        targets: [
          {
            format: configuration?.format ?? navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.sampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.uniform = this.device.createBuffer({
      label: 'Pixi display opacity',
      size: 16,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
  }

  resize(w: number, h: number, resolution: number): void {
    this.active =
      this.game.domElement.width === Math.round(w * resolution) &&
      this.game.domElement.height === Math.round(h * resolution);
    if (
      this.target.width !== w ||
      this.target.height !== h ||
      this.target.source.resolution !== resolution
    ) {
      this.target.source.resize(w, h, resolution);
      this.source = null;
      this.bindGroup = null;
    }
  }

  present(): void {
    if (this.disposed || !this.active || this.opacity <= 0) return;
    this.drawTo(this.context.getCurrentTexture());
  }

  /** Also used by capture-only readback into a format-matched GPU target. */
  drawTo(output: GPUTexture): void {
    if (this.disposed || !this.active || this.opacity <= 0) return;
    const source = this.pixi.texture.getGpuSource(this.target.source);
    if (source !== this.source) {
      this.source = source;
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.uniform } },
        ],
      });
    }
    this.value[0] = this.opacity;
    this.device.queue.writeBuffer(this.uniform, 0, this.value);
    const encoder = this.device.createCommandEncoder({ label: 'Pixi display composite' });
    const pass = encoder.beginRenderPass({
      label: 'Pixi display composite',
      colorAttachments: [{ view: output.createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.draws++;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.uniform.destroy();
    this.target.destroy(true);
    this.bindGroup = null;
    this.source = null;
  }
}
