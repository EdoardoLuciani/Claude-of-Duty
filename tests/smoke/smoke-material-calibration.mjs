import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Texture, DoubleSide } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SoldierMaterialsNode } from '../../src/ai/textures-tsl.js';
import { WEAPON_MATERIALS } from '../../src/weapons/materials.js';
import { makeM4Model, M4_URL } from '../../src/weapons/m4.js';
import { makeMCXModel, MCX_URL } from '../../src/weapons/mcx.js';
import { makeP320Model, P320_URL } from '../../src/weapons/p320.js';
import { makeEvolysModel, EVOLYS_URL } from '../../src/weapons/evolys.js';
import { makeMPXModel, MPX_URL } from '../../src/weapons/mpx.js';
import { makeAX338Model, AX338_URL } from '../../src/weapons/ax338.js';

// Actual committed GLBs and production loaders. Stub only browser image decode;
// material factors/extensions, hierarchy and animation validation stay real.
for (const [id, url, make] of [
  ['rifle', M4_URL, makeM4Model], ['mcx', MCX_URL, makeMCXModel],
  ['pistol', P320_URL, makeP320Model], ['lmg', EVOLYS_URL, makeEvolysModel],
  ['smg', MPX_URL, makeMPXModel], ['sniper', AX338_URL, makeAX338Model],
]) {
  const bytes = readFileSync(new URL(url));
  const loader = new GLTFLoader().register(() => ({ name: 'SMOKE_TEXTURE',
    loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const sources = new Map();
  gltf.scene.traverse(o => { if (o.isMesh) sources.set(o.material.name, o.material); });
  const model = make(gltf);
  for (const m of model.materials) {
    const s = sources.get(m.name), label = `${id}/${m.name}`;
    assert(m.isMeshPhysicalNodeMaterial, label);
    // MCX's gameplay scope deliberately replaces transmission with thin alpha.
    const scope = id === 'mcx' && m.name.startsWith('11 |');
    const mpxOptic = id === 'smg' && /^(11|12|15) \|/.test(m.name);
    if (!scope) {
      assert.deepEqual(m.color, s.color, `${label}: loader must not compensate exposure`);
      assert.equal(m.metalness, s.metalness, `${label}: preserve finish class`);
      assert.equal(m.roughness, s.roughness, `${label}: preserve roughness`);
    }
    if (!scope && !mpxOptic) assert.equal(m.specularIntensity, s.specularIntensity ?? 1,
      `${label}: preserve authored specular`);
    for (const field of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'])
      assert.equal(m[field], s[field], `${label}: borrow authored ${field}`);
    assert.deepEqual(m.normalScale, s.normalScale, label);
    assert.equal(m.ior, s.ior ?? 1.5, label);
  }
  for (const m of model.materials) m.dispose();
  for (const t of model.textures) t.dispose();
}

// Every appearance-affecting option must distinguish a cache entry, while
// equivalent effective defaults reuse it. Materials own no input textures.
const set = { albedo: new Texture(), normal: new Texture(), orm: new Texture() };
const library = new SoldierMaterialsNode({ rubber: set }, {});
const base = library.get('rubber');
assert.equal(base, library.get('rubber', { ao: .85, normalScale: 1, rim: 1 }));
for (const opts of [{ ao: .2 }, { normalScale: .2 }, { rim: .2 }, { side: DoubleSide }]) {
  const variant = library.get('rubber', opts);
  assert.notEqual(variant, base, JSON.stringify(opts));
  assert.equal(variant, library.get('rubber', opts));
}
assert.notEqual(library.glass([.02, .02, .02]), library.glass([.08, .06, .04]));
assert.equal(library.glass(), library.glass([.06, .07, .08]));
library.dispose();

for (const key of ['glove', 'glove_pad', 'glove_seam', 'sleeve'])
  assert(!WEAPON_MATERIALS[key], `${key}: gameplay arms must not have a second procedural recipe`);
for (const [, p] of Object.values(WEAPON_MATERIALS)) {
  assert.equal(p.localSpace, true);
  assert.deepEqual(p.weather.slice(0, 3), [0, 0, 0], 'hand-held finishes disable environmental weather');
}
console.log('All six authored weapon adapters preserve pigment/PBR maps; soldier cache variants and single arm authoring path passed');
