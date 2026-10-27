#!/usr/bin/env node
/** Derive the runtime P320 from Blender's native PNG GLB using pinned gltfpack. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { read as readKTX, KHR_DF_MODEL_UASTC } from 'three/examples/jsm/libs/ktx-parse.module.js';

import { inspectGLB } from './lib/glb-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert(
  process.argv.length <= 3,
  'usage: GLTFPACK=/path/gltfpack node tools/cook-p320.mjs [asset-directory]'
);
const dir = resolve(process.argv[2] ?? join(root, 'assets/weapons/p320-compact'));
const sourcePath = join(dir, 'p320-compact.glb');
const outputPath = join(dir, 'p320-compact.ktx2.glb');
const encoder = process.env.GLTFPACK ?? 'gltfpack';
const probe = spawnSync(encoder, ['-v'], { encoding: 'utf8' });
if (probe.error) throw probe.error;
assert.equal(probe.status, 0, probe.stderr);
const version = (probe.stdout + probe.stderr).trim();
assert.equal(version, 'gltfpack 1.3', 'use the pinned native gltfpack build with BasisU support');
const sourceBytes = readFileSync(sourcePath);
const source = inspectGLB(sourceBytes);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceImages = new Map(
  source.json.images.map((image) => {
    assert.equal(image.mimeType, 'image/png');
    const view = source.json.bufferViews[image.bufferView];
    const png = source.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    assert(png.equals(readFileSync(join(dir, 'textures', `${image.name}.png`))));
    return [image.name, hash(png)];
  })
);
const flags = [
  '-kn',
  '-ke',
  '-ac',
  '-af',
  '0',
  '-vpf',
  '-vp',
  '14',
  '-vtf',
  '-vt',
  '16',
  '-vn',
  '8',
  '-ar',
  '16',
  '-at',
  '24',
  '-as',
  '24',
  '-cc',
  '-si',
  '0.50',
  '-se',
  '0.001',
  '-sp',
  '-tu',
  '-tq',
  '10',
  '-tj',
  '1',
];
const scratch = mkdtempSync(join(tmpdir(), 'p320-gltfpack-'));
try {
  const cookedPath = join(scratch, 'p320-compact.ktx2.glb');
  execFileSync(encoder, ['-i', sourcePath, '-o', cookedPath, ...flags], { stdio: 'inherit' });
  const bytes = readFileSync(cookedPath),
    cooked = inspectGLB(bytes),
    doc = cooked.json;
  assert.equal(doc.images.length, 4);
  const images = doc.images.map((image) => {
    assert.equal(image.mimeType, 'image/ktx2');
    assert(sourceImages.has(image.name), `unknown cooked image ${image.name}`);
    const view = doc.bufferViews[image.bufferView];
    const raw = cooked.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const ktx = readKTX(raw);
    assert.equal(ktx.pixelWidth, 1024);
    assert.equal(ktx.pixelHeight, 1024);
    assert.equal(ktx.levels.length, 11);
    assert.equal(ktx.dataFormatDescriptor[0].colorModel, KHR_DF_MODEL_UASTC);
    return {
      name: image.name,
      sourceSha256: sourceImages.get(image.name),
      sha256: hash(raw),
      bytes: raw.length,
      width: ktx.pixelWidth,
      height: ktx.pixelHeight,
      mipLevels: ktx.levels.length,
    };
  });
  const primitive = doc.meshes[0].primitives[0];
  const report = {
    encoder: version,
    flags,
    cookSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    sourceSha256: hash(sourceBytes),
    sha256: hash(bytes),
    sourceBytes: sourceBytes.length,
    bytes: bytes.length,
    stats: {
      triangles: doc.accessors[primitive.indices].count / 3,
      vertices: doc.accessors[primitive.attributes.POSITION].count,
      primitives: doc.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0),
      materials: doc.materials.length,
      joints: doc.skins[0].joints.length,
    },
    images,
  };
  writeFileSync(outputPath, bytes);
  writeFileSync(join(dir, 'p320-compact.ktx2.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
