import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { WEAPON_IDS } from '../../src/weapons/defs.ts';
import { loadWeapon } from '../../src/weapons/loaders.ts';
import { parseGLB } from '../../tools/lib/glb-fixture.mjs';

// Exercise the real adapters and assets without browser-only URL fetching.
const original = GLTFLoader.prototype.loadAsync;
GLTFLoader.prototype.loadAsync = (url) => parseGLB(readFileSync(new URL(url)));
try {
  for (const id of WEAPON_IDS) {
    const model = await loadWeapon(id);
    assert.equal(model.id, id, 'each catalog key loads its own authored adapter');
    assert(model.root && model.animations.length > 0);
    assert(model.materials.size > 0, 'the returned ownership sets contain converted materials');
    for (const material of model.materials) material.dispose();
    for (const texture of model.textures) texture.dispose();
  }
  for (const id of ['unknown', '__proto__', 'constructor', 'toString']) {
    await assert.rejects(loadWeapon(id), /\[weapons\] unknown weapon/);
  }
} finally {
  GLTFLoader.prototype.loadAsync = original;
}
console.log(
  'shared weapon loaders: seven authored assets and unknown/prototype-key rejection passed'
);
