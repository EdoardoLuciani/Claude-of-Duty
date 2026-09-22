import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BANDAGE_PATH, BANDAGE_CONTACT, BANDAGE_SEGMENTS } from '../src/weapons/bandage-path.js';

const bytes = readFileSync(new URL('../public/models/player/bandage.glb', import.meta.url));
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'committed Blender export');
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const wrap = gltf.nodes.find(n => n.name === 'Bandage_wrap');
const roll = gltf.nodes.find(n => n.name === 'Bandage_roll');
assert(wrap && roll, 'both props are exported from the editable arms scene');
assert.equal(gltf.accessors[gltf.meshes[wrap.mesh].primitives[0].indices].count, BANDAGE_SEGMENTS * 6,
  'the ribbon must reveal exactly one quad (6 indices) per section');
assert.equal(BANDAGE_CONTACT.length, BANDAGE_SEGMENTS + 1);
assert.equal(BANDAGE_PATH.length, BANDAGE_SEGMENTS / 2 + 1);
assert(BANDAGE_CONTACT.every(p => p.length === 3 && p.every(Number.isFinite)));
assert(BANDAGE_PATH.every(p => p.length === 3 && p.every(Number.isFinite)));
assert(gltf.materials.some(m => m.name === 'Bandage_woven_linen'
  && m.pbrMetallicRoughness.baseColorTexture
  && m.pbrMetallicRoughness.metallicRoughnessTexture && m.normalTexture),
'linen has packed colour, roughness and yarn normals');
console.log('Blender bandage mesh/guide contract OK');
