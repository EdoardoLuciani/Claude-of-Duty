// Structural workload contracts, NOT rendered image comparisons or speed gates.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [nativePath, referencePath] = process.argv.slice(2);
assert(nativePath && referencePath, 'node check.mjs NATIVE.json JS-OFFSCREEN.json');
const native = JSON.parse(await readFile(nativePath));
const reference = JSON.parse(await readFile(referencePath));
assert.equal(native.mode, 'offscreen');
assert.equal(reference.mode, 'raw-offscreen');
assert.equal(native.build, 'release');
assert.equal(native.frozenPose, false);
assert.equal(native.gpuDiagnostic, false);
assert.equal(native.apiValidation, true);
assert.equal(native.vulkanValidationLayersRequested, false);
assert.equal(reference.crossOriginIsolated, true);
assert.equal(reference.adapterInfo.fallback, false);
for (const key of ['datasetSha256', 'frames', 'warmup', 'width', 'height', 'inFlight'])
  assert.equal(native[key], reference[key], key);
assert.equal(native.format.toLowerCase(), reference.format);
assert.match(native.nativeBinarySha256, /^[a-f0-9]{64}$/);
assert.match(native.nativeSourceSha256, /^[a-f0-9]{64}$/);
for (const key of ['nodes', 'meshes']) assert.equal(native.scene[key], reference.scene[key]);
assert(native.frames > 0);
assert.equal(native.samples.length, native.frames);
assert.equal(reference.samples.length, reference.frames);
for (let i = 0; i < native.frames; i++) {
  assert.equal(native.samples[i].pose, i % native.scene.bakedFrames);
  for (const key of ['draws', 'triangles']) {
    assert.equal(native.samples[i][key].length, 5);
    assert.deepEqual(native.samples[i][key], reference.samples[i][key], `${key} at frame ${i}`);
    assert(native.samples[i][key].every((v) => Number.isSafeInteger(v) && v > 0));
  }
}
assert.deepEqual(native.errors, []);
assert.deepEqual(reference.errors, []);
console.log(
  `${native.frames} frames × 5 passes: dataset, draw/triangle work, resolution, format, fence bound and pacing match.`
);
