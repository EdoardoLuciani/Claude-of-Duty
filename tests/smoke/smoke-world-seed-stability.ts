import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as THREE from 'three';

import { Assembler } from '#worldgen/builder';
import { registerProps } from '#worldgen/props';

import { buildGate, registerDressingProps } from '../../tools/worldgen/dressing.ts';

// V8 and JavaScriptCore differ by one ULP here. A computed coordinate must not
// become an element identity: hashing its decimal string rerolls the dust/debris.
function gateHash(cosine: number): string {
  const assembler = new Assembler({
    materials: { get: (name): THREE.Material => new THREE.MeshStandardMaterial({ name }) },
  });
  const hash = createHash('sha256');
  const originalCos = Math.cos;
  try {
    registerProps(assembler);
    registerDressingProps(assembler);
    assembler.add = (key, geometry, matrix): Assembler => {
      const copy = geometry.clone();
      if (matrix) copy.applyMatrix4(matrix);
      const position = copy.getAttribute('position');
      const values = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        values[i * 3] = position.getX(i);
        values[i * 3 + 1] = position.getY(i);
        values[i * 3 + 2] = position.getZ(i);
      }
      hash.update(key).update(Buffer.from(values.buffer));
      copy.dispose();
      return assembler;
    };
    Math.cos = (angle): number => (angle === 0.1 ? cosine : originalCos(angle));
    buildGate(assembler);
    for (const [id, prototype] of assembler._protos) {
      if (!prototype.matrices.length) continue;
      hash.update(id).update(String(prototype.matrices.length));
      for (const matrix of prototype.matrices) {
        hash.update(Buffer.from(new Float32Array(matrix.elements).buffer));
      }
    }
    return hash.digest('hex');
  } finally {
    Math.cos = originalCos;
    assembler.dispose();
  }
}

assert.equal(
  gateHash(0.9950041652780257),
  gateHash(0.9950041652780258),
  'one-ULP cosine differences must not reroll gate dressing or debris'
);
console.log('world seeds: gate dressing is stable across V8/JavaScriptCore cosine rounding');
