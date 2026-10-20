import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { audioMaster, audioReference } from '../helpers/audio-masters.mjs';

const original = process.env.AUDIO_MASTER_DIR;
const temporary = mkdtempSync(join(tmpdir(), 'cod-master-reference-'));
try {
  delete process.env.AUDIO_MASTER_DIR;
  const { file, reference } = audioMaster('heartbeat');
  assert.equal(file, null, 'Ordinary checks must not depend on a private archive');
  assert.equal(reference, audioReference.heartbeat);
  assert.throws(() => audioMaster('unknown'), /Missing frozen master reference/);
  process.env.AUDIO_MASTER_DIR = temporary;
  assert.throws(() => audioMaster('heartbeat'), { code: 'ENOENT' });
  writeFileSync(join(temporary, 'heartbeat.wav'), 'changed master, not a recording');
  assert.throws(() => audioMaster('heartbeat'), /archived master changed/);
} finally {
  if (original === undefined) delete process.env.AUDIO_MASTER_DIR;
  else process.env.AUDIO_MASTER_DIR = original;
  rmSync(temporary, { recursive: true, force: true });
}
console.log('PASS: external masters explicit, missing/changed masters fail, no silent fallback');
