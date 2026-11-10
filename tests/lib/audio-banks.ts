import { AIRCRAFT_URLS } from '../../src/audio/aircraft.ts';
import { CALLOUT_URLS } from '../../src/audio/callouts.ts';
import { COMBAT_URLS } from '../../src/audio/combat.ts';
import { ENVIRONMENT_URLS } from '../../src/audio/environment.ts';
import { EXPLOSION_URLS } from '../../src/audio/explosions.ts';
import { FOLEY_URLS } from '../../src/audio/foley-urls.ts';
import { HIT_URLS } from '../../src/audio/hits.ts';
import { RADIO_URLS } from '../../src/audio/radio.ts';
import { REACTION_URLS } from '../../src/audio/reactions.ts';
import { RELOAD_URLS } from '../../src/audio/reloads.ts';

// Runtime banks and independently pinned expected recording counts.
export const AUDIO_BANKS: ReadonlyArray<readonly [Record<string, readonly string[]>, number]> = [
  [{ propeller: AIRCRAFT_URLS }, 2],
  [CALLOUT_URLS, 36],
  [ENVIRONMENT_URLS, 14],
  [EXPLOSION_URLS, 24],
  [FOLEY_URLS, 123],
  [HIT_URLS, 10],
  [RADIO_URLS, 6],
  [REACTION_URLS, 12],
  [RELOAD_URLS, 63],
  [COMBAT_URLS, 46],
];

export { audioFixture } from './audio-fixture.ts';
