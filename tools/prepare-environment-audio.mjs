#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'oxfmt';

import { prepareOneShot } from './lib/recorded-one-shot.mjs';
assert(process.argv[2], 'Usage: node tools/prepare-environment-audio.mjs /path/to/Music');
const music = resolve(process.argv[2]),
  output = fileURLToPath(new URL('../src/audio/samples/environment/', import.meta.url));
mkdirSync(output, { recursive: true });
const b26 = 'Boom One (Update 26.02) [Boom Library] rutracker.org/Update 26.02/BIRDS/SONGBIRD/';
const air = 'Boom ONE Update/update_23_05/AIRCRAFT/MILITARY/';
const dog =
  'Sonniss_GDC2026_Organized/Animals & Creatures/344 Audio - Dog Vocalisations Vol. 1/ANMLDog_Dog Barks, Multiple, Indoors, Perspective,_344 Audio_Dog Vocalisations_02.wav';
const creak =
  'Boom ONE Update/update_23_04/DOORS/CREAK/DOORCreak_Light Wooden Door Soft Multiple Creaks 01_B00M_ONE.wav';
const gravel =
  'BOOM ONE Update/Update 24-06/ROCKS/CRASH & DEBRIS/ROCKCrsh_Gravel Fall_B00M_ONE.wav';
const siren =
  'BOOM ONE Update/Update 24-03/ALARMS/SIREN/ALRMSirn_Air Alert Siren Real_B00M_ONE.wav';
const recipes = {
  dog: [
    [dog, 0.18, 1.05],
    [dog, 1.58, 1.05],
  ],
  birds: [
    [b26 + 'BIRDSong_Blackbird Close Clean Short 01_B00M_ONE.wav', 0.25, 1.7],
    [b26 + 'BIRDSong_Blackbird Close Clean Short 02_B00M_ONE.wav', 0.2, 1.6],
  ],
  creak: [
    [creak, 0.08, 1.95],
    [creak, 3.04, 2.2],
  ],
  settle: [
    [gravel, 0.1, 2.5],
    [gravel, 3.78, 2.8],
  ],
  vehicle: [
    [
      'Sonniss_GDC2026_Organized/Vehicles & Transport/SoundBits - Pass-By - Trains, Trucks & Cars 2/VEHFrght_Freight Truck Pass By 22_SNDBTS_PB-TTC2.wav',
      0,
      5.2,
    ],
    [
      'Boom One (Update 24.09) [Boom Library]/Update 24.09/VEHICLES/TRUCK VAN & SUV/VEHTruck_Truck Pass On Highway_B00M_ONE.wav',
      16.3,
      6.2,
    ],
  ],
  heli: [
    [
      air + 'AEROMil_Military Helicopter AS532UL Cougar Fly By Short 01 MS MKH 416_B00M_ONE.wav',
      0.35,
      9.75,
    ],
    [
      air + 'AEROMil_Military Helicopter AS532UL Cougar Fly By Short 02 MS MKH 416_B00M_ONE.wav',
      4.5,
      9.2,
    ],
  ],
  siren: [
    [siren, 2, 7.5],
    [siren, 10, 7.5],
  ],
};
const manifest = {
  format: 'mono 48000 Hz Opus, 96 kbps VBR',
  rights:
    'Owner cleared public redistribution of edited #474 environmental derivatives; retain source entitlement/licence records. No raw masters or unrelated legacy permissions included.',
  design:
    'Sparse finite events, not loops. Dog donor has indoor perspective, birds are blackbirds, creaks are small wooden-door movements, settle is gravel rather than heavy masonry. Trucks/helicopters retain recorded pass character at an off-stage point, not another visible aircraft model. Siren is a real air-alert excerpt, distinct from the fictional intel warning. Inappropriate synthetic human shouts/random ambient tactical calls are retired; no suitable isolated non-actionable distressed shout has been approved. Silence remains between events.',
  files: {},
};
const urls = {};
for (const [kind, cuts] of Object.entries(recipes)) {
  const bank = `environment-${kind}`;
  urls[bank] = [];
  for (const [index, [source, start, duration]] of cuts.entries()) {
    const long = duration > 4;
    const { opus, metadata } = prepareOneShot(join(music, source), {
      start,
      duration,
      rmsDb: -24,
      highpass: kind === 'siren' ? 180 : 70,
      lowpass: kind === 'siren' ? 3000 : 10000,
      fadeIn: long ? 0.3 : 0.005,
      fadeOut: long ? 0.5 : 0.025,
    });
    const name = `${bank}-${index + 1}`;
    writeFileSync(join(output, name + '.opus'), opus);
    manifest.files[name] = { source, ...metadata };
    urls[bank].push(`new URL('./samples/environment/${name}.opus', import.meta.url).href`);
  }
}
const code = `/** Required sparse environmental recordings; no continuous bed. */\nexport const ENVIRONMENT_URLS = {${Object.entries(
  urls
)
  .map(([k, u]) => `'${k}':[${u.join(',')}],`)
  .join(
    '\n'
  )}} as const;\nexport type EnvironmentBank = keyof typeof ENVIRONMENT_URLS;\nexport const ENVIRONMENT_KINDS = ['dog','siren','creak','settle','birds','vehicle','heli'] as const;\nexport type EnvironmentKind = typeof ENVIRONMENT_KINDS[number];\nexport const ENVIRONMENT_GAIN = {dog:1,siren:0.2,creak:1,settle:1.2,birds:1,vehicle:0.6,heli:4} as const;\nexport function environmentBank(kind: EnvironmentKind): EnvironmentBank {return ('environment-' + kind) as EnvironmentBank;}\n`;
for (const [name, text] of [
  ['environment.ts', code],
  ['samples/environment/provenance.json', JSON.stringify(manifest, null, 2)],
]) {
  const f = await format(name, text, { printWidth: 100, singleQuote: true });
  assert.equal(f.errors.length, 0);
  writeFileSync(fileURLToPath(new URL('../src/audio/' + name, import.meta.url)), f.code);
}
console.log('Authored', Object.keys(manifest.files).length, 'finite environmental variants');
