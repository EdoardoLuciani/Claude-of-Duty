import { struct } from 'three/tsl';

// Packed forge outputs: sRGB albedo + linear height, linear AO/rough/metal.
export const Surface = struct({ albedo: 'vec3', height: 'float', rough: 'float',
  metal: 'float', ao: 'float' });
