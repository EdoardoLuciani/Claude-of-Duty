import { Rng } from '../../src/core/rng.ts';

/**
 * Render frame-time sources for cadence checks (issue 605): fixed rates, the
 * engine's 0.1 s dt clamp, and seeded 24-240 FPS jitter. Each entry is
 * [label, nextDt]; jitter draws from one shared seeded stream.
 */
const jitter = new Rng(605);
const steady = (fps) => () => 1 / fps;
export const FRAME_SOURCES = [
  ['30', steady(30)],
  ['60', steady(60)],
  ['120', steady(120)],
  ['144', steady(144)],
  ['10 (dt clamp)', steady(10)],
  ['jitter', () => jitter.range(1 / 240, 1 / 24)],
];
