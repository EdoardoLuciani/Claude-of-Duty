#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'oxfmt';

import { prepareOneShot } from './lib/recorded-one-shot.mjs';

assert(process.argv[2], 'Usage: node tools/prepare-reaction-audio.mjs /path/to/Music');
const music = resolve(process.argv[2]),
  output = fileURLToPath(new URL('../src/audio/samples/reactions/', import.meta.url));
mkdirSync(output, { recursive: true });
const manifest = {
  format: 'mono 48000 Hz Opus, 96 kbps VBR',
  rights:
    'Owner explicitly cleared public redistribution of edited #474 nonverbal derivatives. Keep original licence/entitlement records; no raw masters or unrelated legacy permissions are included.',
  design:
    'Two library-labelled male identity groups, no pitch shifting. Complete short closed-mouth/medium pain efforts, with separate takes used as restrained death/collapse grunts instead of long death screams. Identity grouping follows library labels, not verified real performer credits.',
  files: {},
};
const urls = {};
for (const [actor, label, hurts, deaths] of [
  [
    0,
    '02',
    [
      [0.04, 0.35],
      [1.45, 0.42],
      [2.87, 0.43],
    ],
    [
      [4.64, 0.48],
      [6.12, 0.46],
      [7.56, 0.48],
    ],
  ],
  [
    1,
    '04',
    [
      [0.04, 0.48],
      [1.52, 0.48],
      [2.98, 0.46],
    ],
    [
      [4.53, 0.43],
      [5.94, 0.58],
      [7.59, 0.45],
    ],
  ],
]) {
  for (const [kind, cuts, performance] of [
    ['hurt', hurts, 'Pain Soft'],
    ['death', deaths, 'Pain Medium'],
  ]) {
    const bank = `reaction-${actor}-${kind}`;
    urls[bank] = [];
    const source = `BOOM.Library.Close.Combat.WAV.DVDR/Close.Combat.Construction.Kit/CloseCombat_ConstructionKit_48kHz/CC-CK VO Male ${label} ${performance}.wav`;
    for (const [i, [start, duration]] of cuts.entries()) {
      const name = `${bank}-${i + 1}`,
        { opus, metadata } = prepareOneShot(join(music, source), { start, duration });
      writeFileSync(join(output, name + '.opus'), opus);
      manifest.files[name] = { source, identityGroup: label, role: kind, ...metadata };
      urls[bank].push(`new URL('./samples/reactions/${name}.opus', import.meta.url).href`);
    }
  }
}
const code = `/** Required recorded nonverbal reactions; speech remains in #497. */\nexport const REACTION_URLS = {\n${Object.entries(
  urls
)
  .map(([key, values]) => `'${key}': [${values.join(',')}],`)
  .join(
    '\n'
  )}\n} as const;\nexport type ReactionBank = keyof typeof REACTION_URLS;\nexport type ReactionKind = 'hurt' | 'death';\nexport const REACTION_MIX = { gain: 1, send: 0.45 } as const;\nexport function reactionKind(kind: string | undefined): ReactionKind | null { return kind === 'death' ? 'death' : kind === 'hurt' || kind === 'pain' || kind === 'hit' ? 'hurt' : null; }\nexport function reactionBank(voice: number, kind: ReactionKind): ReactionBank { const actor = Number.isFinite(voice) ? Math.abs(Math.trunc(voice)) % 2 : 0; return ('reaction-' + actor + '-' + kind) as ReactionBank; }\n`;
for (const [name, text] of [
  ['reactions.ts', code],
  ['samples/reactions/provenance.json', JSON.stringify(manifest, null, 2)],
]) {
  const formatted = await format(name, text, { printWidth: 100, singleQuote: true });
  assert.equal(formatted.errors.length, 0);
  writeFileSync(fileURLToPath(new URL('../src/audio/' + name, import.meta.url)), formatted.code);
}
console.log('Authored', Object.keys(manifest.files).length, 'restrained reaction variants');
