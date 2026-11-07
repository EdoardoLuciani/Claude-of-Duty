import assert from 'node:assert/strict';

import * as THREE from 'three';
import * as WebGPU from 'three/webgpu';

// Runtime type guards must see the same core classes through both entry points.
assert.equal(WebGPU.REVISION, THREE.REVISION);
assert.equal(WebGPU.BufferGeometry, THREE.BufferGeometry);
assert(new WebGPU.Mesh() instanceof THREE.Mesh);
console.log('Three.js entry points share the same core classes');
