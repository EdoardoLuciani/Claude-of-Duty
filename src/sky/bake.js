import {
  ClampToEdgeWrapping, FloatType, HalfFloatType, LinearFilter,
  MeshBasicNodeMaterial, NoColorSpace, QuadMesh, RGBAFormat, RenderTarget,
} from 'three/webgpu';

// QuadMesh supplies native texture UVs and owns the shared fullscreen geometry.
// Only the per-pass material and returned targets belong to this subsystem.
const quad = new QuadMesh(null);

const RT_OPTIONS = {
  depthBuffer: false,
  stencilBuffer: false,
  generateMipmaps: false,
};

/** A full-screen TSL node step. */
export class BakePass {
  constructor(name, colorNode) {
    this.material = new MeshBasicNodeMaterial({
      name,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.material.colorNode = colorNode;
  }

  render(renderer, target) {
    const previous = renderer.getRenderTarget();
    quad.material = this.material;
    try {
      renderer.setRenderTarget(target);
      quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previous);
      quad.material = null;
    }
  }

  dispose() {
    this.material.dispose();
  }
}

/** Half-float colour target. Sky radiance is HDR and physically scaled. */
export function hdrTarget(width, height, opts = {}) {
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
export function floatTarget(width, height, opts = {}) {
  return hdrTarget(width, height, { ...opts, type: FloatType });
}
