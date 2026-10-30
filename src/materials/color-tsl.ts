import { Color, SRGBColorSpace } from 'three';
import type { Vector3 } from 'three';
import { vec3 } from 'three/tsl';
import type { ConstNode } from 'three/webgpu';

// Authoring constants in the GLSL surfaces are sRGB; bake shaders work in
// linear space before the render target encodes the albedo to sRGB8.
export function authoredColor(r: number, g: number, b: number): ConstNode<'vec3', Vector3> {
  const c = new Color().setRGB(r, g, b, SRGBColorSpace);
  return vec3(c.r, c.g, c.b);
}
