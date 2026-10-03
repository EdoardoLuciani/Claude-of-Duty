// Resolve through Vite together: mixing raw/unversioned and optimized Three.js
// imports creates two TSL stacks and invalidates the material fixture.
export * as THREE from 'three/webgpu';
export { createArmMaterial } from '../src/weapons/arm-asset.js';
