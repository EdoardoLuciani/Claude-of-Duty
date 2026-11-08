import assert from 'node:assert/strict';

assert.equal(
  typeof process.versions.bun,
  'string',
  'smoke scripts must execute inside Bun, not Node'
);
console.log('smoke runtime: Bun');
