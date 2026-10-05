/**
 * Node smoke test for the production material registration — no browser, no GPU.
 *
 * The gameplay path must be strict-WebGPU: `ctx.get('materials')` is the TSL
 * `MaterialSystemNode`, the world/AI/weapons systems request node materials, and
 * no WebGL-only ShaderMaterial survives in the first-person viewmodel. This test
 * is the cheap guard for that wiring; the authoring probes under
 * `tools/material-node/` compile the real GLB materials on a GPU.
 *
 *   node tools/smoke-materials-node.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MaterialSystem, MaterialSystemNode } from '../src/materials/index.js';

// 1. The production export IS the strict-WebGPU node system.
assert.equal(MaterialSystem, MaterialSystemNode,
  'ctx.get("materials") must be the TSL MaterialSystemNode');
assert.equal(MaterialSystem.id, 'materials');
assert.ok(MaterialSystem.deps.includes('render'), 'materials must init after render');
for (const fn of ['init', 'get', 'getTextureSet', 'variant', 'names', 'surfaceOf',
  'tune', 'setGroundLevel', 'bakeMasks', 'setMask', 'dispose']) {
  assert.equal(typeof MaterialSystem.prototype[fn], 'function', `materials.${fn} missing`);
}

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// 2. Boot registers the production entry, not a WebGL material module.
assert.match(read('src/main.js'), /from '\.\/materials\/index\.js'/);

// 3. World / AI / weapons gameplay materials come from the node path.
assert.match(read('src/world/index.js'), /ctx\.get\('materials'\)/);
const ai = read('src/ai/index.js');
assert.match(ai, /SoldierMaterialsNode/);
assert.doesNotMatch(ai, /from '\.\/textures\.js'/, 'AI must not use the WebGL soldier materials');
const weapons = read('src/weapons/index.js');
assert.match(weapons, /WeaponMaterialsNode/);
assert.doesNotMatch(weapons, /new WeaponMaterials\(/, 'weapons must not use the WebGL materials');

// 4. No WebGL-only ShaderMaterial left in the gameplay viewmodel optics.
assert.doesNotMatch(read('src/weapons/viewmodel.js'), /new THREE\.ShaderMaterial/,
  'viewmodel optics must be TSL node materials');

console.log('materials-node: production entry is strict-WebGPU; world/AI/weapons use node materials');
