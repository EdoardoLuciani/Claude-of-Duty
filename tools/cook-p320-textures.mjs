#!/usr/bin/env node
/** Texture-only P320 cook. Requires the pinned external KTX-Software 4.4.2 toktx. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  read as readKTX,
  KHR_DF_MODEL_UASTC,
  KHR_SUPERCOMPRESSION_ZSTD,
} from 'three/examples/jsm/libs/ktx-parse.module.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'assets/weapons/p320-compact/p320-compact.glb');
const outputPath = resolve(process.argv[2] ?? join(dirname(sourcePath), 'p320-compact.ktx2.glb'));
assert(outputPath.endsWith('.glb') && outputPath !== sourcePath, 'cook to a separate .glb');
assert(
  process.argv.length <= 3,
  'usage: TOKTX=/path/toktx node tools/cook-p320-textures.mjs [output.glb]'
);
const encoder = process.env.TOKTX ?? 'toktx';
const probe = spawnSync(encoder, ['--version'], { encoding: 'utf8' });
if (probe.error) throw probe.error;
assert.equal(probe.status, 0, probe.stderr);
const version = (probe.stdout + probe.stderr).trim();
assert.equal(version, 'toktx v4.4.2', 'use the pinned encoder for reproducible assets');
const raw = readFileSync(sourcePath);
assert.equal(raw.readUInt32LE(0), 0x46546c67);
assert.equal(raw.readUInt32LE(4), 2);
assert.equal(raw.readUInt32LE(8), raw.length);
const jsonLength = raw.readUInt32LE(12);
const doc = JSON.parse(raw.subarray(20, 20 + jsonLength));
const binary = raw.subarray(28 + jsonLength);
assert.equal(doc.buffers.length, 1);
assert.equal(doc.images.length, 4);
assert(!doc.extensionsUsed?.includes('KHR_texture_basisu'), 'input must be the native PNG export');
const replacements = new Map();
const records = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'p320-ktx2-'));
const flags = [
  '--t2',
  '--encode',
  'uastc',
  '--uastc_quality',
  '4',
  '--uastc_rdo_l',
  '0.25',
  '--zcmp',
  '18',
  '--genmipmap',
  '--filter',
  'box',
  '--target_type',
  'RGB',
  '--threads',
  '1',
];
try {
  for (const image of doc.images) {
    assert.equal(image.mimeType, 'image/png');
    assert.match(image.name, /^p320-(base|normal|orm|emission)$/);
    const view = doc.bufferViews[image.bufferView];
    const png = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    assert(png.equals(readFileSync(join(dirname(sourcePath), 'textures', `${image.name}.png`))));
    const input = join(scratch, `${image.name}.png`),
      output = join(scratch, `${image.name}.ktx2`);
    writeFileSync(input, png);
    const srgb = ['p320-base', 'p320-emission'].includes(image.name);
    // Keep XYZ normal channels: --normal_mode would require shader reconstruction.
    execFileSync(
      encoder,
      [
        ...flags,
        '--assign_oetf',
        srgb ? 'srgb' : 'linear',
        '--assign_primaries',
        srgb ? 'bt709' : 'none',
        output,
        input,
      ],
      { stdio: 'pipe' }
    );
    const ktx = readFileSync(output),
      container = readKTX(ktx);
    assert.equal(container.pixelWidth, 1024);
    assert.equal(container.pixelHeight, 1024);
    assert.equal(container.levels.length, 11);
    assert.equal(container.supercompressionScheme, KHR_SUPERCOMPRESSION_ZSTD);
    assert.equal(container.dataFormatDescriptor[0].colorModel, KHR_DF_MODEL_UASTC);
    assert.equal(container.dataFormatDescriptor[0].transferFunction, srgb ? 2 : 1);
    replacements.set(image.bufferView, ktx);
    image.mimeType = 'image/ktx2';
    records.push({
      name: image.name,
      sourceSha256: hash(png),
      bytes: ktx.length,
      sha256: hash(ktx),
      width: 1024,
      height: 1024,
      mipLevels: 11,
      colorSpace: srgb ? 'sRGB' : 'linear',
    });
  }
  for (const accessor of doc.accessors) assert(!replacements.has(accessor.bufferView));
  const chunks = [];
  let offset = 0;
  for (let i = 0; i < doc.bufferViews.length; i++) {
    const view = doc.bufferViews[i];
    assert.equal(view.buffer, 0);
    const bytes =
      replacements.get(i) ??
      binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    const padded = Buffer.alloc((bytes.length + 3) & ~3);
    bytes.copy(padded);
    chunks.push(padded);
    offset += padded.length;
  }
  doc.buffers[0].byteLength = offset;
  for (const texture of doc.textures) {
    assert(Number.isInteger(texture.source));
    texture.extensions = { ...texture.extensions, KHR_texture_basisu: { source: texture.source } };
    delete texture.source;
  }
  doc.extensionsUsed = [...(doc.extensionsUsed ?? []), 'KHR_texture_basisu'];
  doc.extensionsRequired = [...(doc.extensionsRequired ?? []), 'KHR_texture_basisu'];
  const text = Buffer.from(JSON.stringify(doc));
  const json = Buffer.alloc((text.length + 3) & ~3, 0x20);
  text.copy(json);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + offset, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(offset, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const result = Buffer.concat([header, json, binHeader, ...chunks]);
  writeFileSync(outputPath, result);
  const report = {
    encoder: version,
    flags,
    sourceSha256: hash(raw),
    sha256: hash(result),
    sourceBytes: raw.length,
    bytes: result.length,
    images: records,
  };
  writeFileSync(outputPath.replace(/\.glb$/, '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
