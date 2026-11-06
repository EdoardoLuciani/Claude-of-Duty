import { recordingUrls } from './recordings.ts';
/** Recorded physical radio components; useful functional tones stay synthesized. */
import type { Rng } from '../core/rng.ts';
import type { NoiseBank } from './dsp.ts';
import { gain } from './dsp.ts';
import { uiSound } from './foley.ts';
import type { AudioVoice } from './types.ts';
export const RADIO_URLS = {
  'radio-click': recordingUrls('radio/radio-click', 3),
  'radio-static': recordingUrls('radio/radio-static', 3),
} as const;
export type RadioKind = 'radio_open' | 'radio_strike' | 'intel_call';
export const RADIO_PARTS = {
  radio_open: ['radio-click', 'radio-static'],
  radio_strike: ['radio-click', 'radio-static'],
  intel_call: ['radio-static'],
} as const;
export const RADIO_MIX = { click: 0.45, static: 0.35, staticDelay: 0.02 } as const;
export function radioCue(
  actx: BaseAudioContext,
  bank: NoiseBank,
  rng: Rng,
  kind: RadioKind,
  recorded: AudioVoice,
  when: number,
  level = 1
): AudioVoice {
  const tones = uiSound(actx, bank, rng, kind, { when, level });
  const out = gain(actx, 1);
  recorded.node.connect(out);
  tones.node.connect(out);
  return { node: out, end: Math.max(recorded.end, tones.end), send: 0 };
}
