import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const audioReference = JSON.parse(
  readFileSync(new URL('../../src/audio/samples/reference.json', import.meta.url), 'utf8')
).files;

// Default CI validates the delivered Opus payload against these frozen references.
// Explicit offline authoring runs additionally recheck every original WAV sample.
export function audioMaster(name) {
  const reference = audioReference[name];
  assert(reference, `Missing frozen master reference: ${name}`);
  const file = process.env.AUDIO_MASTER_DIR
    ? readFileSync(resolve(process.env.AUDIO_MASTER_DIR, name + '.wav'))
    : null;
  if (file)
    assert.equal(
      createHash('sha256').update(file).digest('hex'),
      reference.sha256,
      `${name}: archived master changed`
    );
  return { file, reference };
}
