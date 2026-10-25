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
import aircraft from '../../src/audio/samples/aircraft/provenance.json' with { type: 'json' };
import callouts from '../../src/audio/samples/callouts/provenance.json' with { type: 'json' };
import combat from '../../src/audio/samples/combat/provenance.json' with { type: 'json' };
import environment from '../../src/audio/samples/environment/provenance.json' with { type: 'json' };
import explosions from '../../src/audio/samples/explosions/provenance.json' with { type: 'json' };
import foley from '../../src/audio/samples/foley/provenance.json' with { type: 'json' };
import hits from '../../src/audio/samples/hits/provenance.json' with { type: 'json' };
import radio from '../../src/audio/samples/radio/provenance.json' with { type: 'json' };
import reactions from '../../src/audio/samples/reactions/provenance.json' with { type: 'json' };
import reloads from '../../src/audio/samples/reloads/provenance.json' with { type: 'json' };

// dir, runtime banks, provenance, count, max seconds, encoded bytes, decoded bytes.
export const AUDIO_BANKS = [
  ['aircraft', { propeller: AIRCRAFT_URLS }, aircraft, 2, 4, 100000, 1500000],
  ['callouts', CALLOUT_URLS, callouts, 36, 4, 900000, 14000000],
  ['environment', ENVIRONMENT_URLS, environment, 14, 10, 1000000, 16000000],
  ['explosions', EXPLOSION_URLS, explosions, 24, 6.2, 2000000, 26000000],
  ['foley', FOLEY_URLS, foley, 123, 0.8, 700000, 9000000],
  ['hits', HIT_URLS, hits, 10, 0.35, 60000, 1000000],
  ['radio', RADIO_URLS, radio, 6, 0.5, 80000, 500000],
  ['reactions', REACTION_URLS, reactions, 12, 0.65, 150000, 1500000],
  ['reloads', RELOAD_URLS, reloads, 63, 0.53, 250000, 3000000],
  ['combat', COMBAT_URLS, combat, 46, 1.25, 500000, 6000000],
];

export function audioFixture(currentTime = 0) {
  const sources = [];
  const actx = {
    currentTime,
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
    createBufferSource() {
      const source = {
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
        stop() {
          this.stopped = true;
        },
        start(when) {
          this.when = when;
        },
      };
      sources.push(source);
      return source;
    },
  };
  return { actx, sources };
}
