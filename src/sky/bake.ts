import {
  ClampToEdgeWrapping, FloatType, HalfFloatType, LinearFilter,
  MeshBasicNodeMaterial, NoColorSpace, QuadMesh, RGBAFormat, RenderTarget,
} from 'three/webgpu';

// QuadMesh supplies native texture UVs and owns the shared fullscreen geometry.
// Only the per-pass material and returned targets belong to this subsystem.
const quad = new QuadMesh(null as unknown as MeshBasicNodeMaterial);

const RT_OPTIONS = {
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

/** A full-screen TSL node step. */
export class BakePass {
  material: MeshBasicNodeMaterial;
  constructor(name: string, colorNode: NonNullable<MeshBasicNodeMaterial['colorNode']>) {
    this.material = new MeshBasicNodeMaterial({
      name,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.material.colorNode = colorNode;
  }

  render(renderer: Parameters<typeof quad.render>[0], target: RenderTarget): void {
    const previous = renderer.getRenderTarget();
    quad.material = this.material;
    try {
      renderer.setRenderTarget(target);
      quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previous);
      quad.material = null as unknown as typeof quad.material;
    }
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** Half-float colour target. Sky radiance is HDR and physically scaled. */
type TargetOptions = ConstructorParameters<typeof RenderTarget>[2] & { name?: string };
export function hdrTarget(width: number, height: number, opts: TargetOptions = {}) {
  const rt = new RenderTarget(Math.max(1, width | 0), Math.max(1, height | 0), {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    colorSpace: NoColorSpace,
    ...RT_OPTIONS,
    ...opts,
  });
  rt.texture.name = opts.name ?? 'sky-hdr';
  return rt;
}

/** Float32 target — used for the transmittance LUT, where banding shows. */
export function floatTarget(width: number, height: number, opts: TargetOptions = {}) {
  return hdrTarget(width, height, { ...opts, type: FloatType });
}
