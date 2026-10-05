import { Color, SRGBColorSpace } from 'three';
import { vec3 } from 'three/tsl';

// Authoring constants in the GLSL surfaces are sRGB; bake shaders work in
// linear space before the render target encodes the albedo to sRGB8.
export function authoredColor(r, g, b) {
  const c = new Color().setRGB(r, g, b, SRGBColorSpace);
  return vec3(c.r, c.g, c.b);
}
