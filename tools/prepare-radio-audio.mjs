#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'oxfmt';

import { prepareOneShot } from './lib/recorded-one-shot.mjs';
assert(process.argv[2], 'Usage: node tools/prepare-radio-audio.mjs /path/to/Music');
const music = resolve(process.argv[2]),
  output = fileURLToPath(new URL('../src/audio/samples/radio/', import.meta.url));
mkdirSync(output, { recursive: true });
const button =
  'Sonniss_GDC2026_Organized/Foley & Props/Sonic Bat - Vintage Radio/SBvr_Power Button 003.wav';
const wheel =
  'Sonniss_GDC2026_Organized/Foley & Props/Sonic Bat - Vintage Radio/SBvr_Mode Select Wheel 006.wav';
const noise =
  'Boom One (Update 24.09) [Boom Library]/Update 24.09/COMMUNICATIONS/STATIC/COMStatic_Old Radio Static Fuzz Sequence_B00M_ONE.wav';
const manifest = {
  format: 'mono 48000 Hz Opus, 96 kbps VBR',
  rights:
    'Owner explicitly cleared public edited #474 radio derivatives; keep original entitlement/licence records. No masters, broadcasts, actor clones or unrelated legacy permissions included.',
  design:
    'Vintage power/dial click donors and non-program radio fuzz, composed once per gameplay cue with unchanged intentional electronic acknowledgments. Designed handset switch/squelch textures, not verified military PTT recordings or spoken transmissions.',
  files: {},
};
const urls = {};
for (const [key, cuts] of Object.entries({
  'radio-click': [
    [button, 0.02, 0.28],
    [button, 0.38, 0.22],
    [wheel, 0.53, 0.28],
  ],
  'radio-static': [
    [noise, 1, 0.3],
    [noise, 4, 0.3],
    [noise, 8, 0.3],
  ],
})) {
  urls[key] = [];
  for (const [i, [source, start, duration]] of cuts.entries()) {
    const { opus, metadata } = prepareOneShot(join(music, source), {
      start,
      duration,
      rmsDb: key === 'radio-click' ? -26 : -30,
      highpass: key === 'radio-click' ? 150 : 350,
      lowpass: key === 'radio-click' ? 6500 : 3500,
    });
    const name = `${key}-${i + 1}`;
    writeFileSync(join(output, name + '.opus'), opus);
    manifest.files[name] = { source, ...metadata };
    urls[key].push(`new URL('./samples/radio/${name}.opus', import.meta.url).href`);
  }
}
const code = `/** Recorded physical radio components; useful functional tones stay synthesized. */\nimport type { Rng } from '../core/rng.ts';\nimport type { NoiseBank } from './dsp.ts';\nimport { gain } from './dsp.ts';\nimport { uiSound } from './foley.ts';\nimport type { AudioVoice } from './types.ts';\nexport const RADIO_URLS = {${Object.entries(
  urls
)
  .map(([k, u]) => `'${k}':[${u.join(',')}],`)
  .join(
    '\n'
  )}} as const;\nexport type RadioBank = keyof typeof RADIO_URLS;\nexport type RadioKind = 'radio_open' | 'radio_strike' | 'intel_call';\nexport const RADIO_PARTS = {radio_open:['radio-click','radio-static'],radio_strike:['radio-click','radio-static'],intel_call:['radio-static']} as const;\nexport const RADIO_MIX = { click:0.45, static:0.35, staticDelay:0.02 } as const;\nexport function radioCue(actx: BaseAudioContext, bank: NoiseBank, rng: Rng, kind: RadioKind, recorded: AudioVoice, when: number, level = 1): AudioVoice { const tones = uiSound(actx,bank,rng,kind,{when,level}); const out = gain(actx,1); recorded.node.connect(out); tones.node.connect(out); return {node:out,end:Math.max(recorded.end,tones.end),send:0}; }\n`;
for (const [name, text] of [
  ['radio.ts', code],
  ['samples/radio/provenance.json', JSON.stringify(manifest, null, 2)],
]) {
  const f = await format(name, text, { printWidth: 100, singleQuote: true, trailingComma: 'es5' });
  assert.equal(f.errors.length, 0);
  writeFileSync(fileURLToPath(new URL('../src/audio/' + name, import.meta.url)), f.code);
}
console.log('Authored', Object.keys(manifest.files).length, 'radio click/static components');
