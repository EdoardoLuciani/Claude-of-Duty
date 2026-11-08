import type { TimestampQuery } from 'three';
import 'three/src/renderers/common/Backend.js';

import type { combatLane } from './combat-fixture.ts';
import type { createCombatProfile } from './profile-combat.js';

// Verified against the pinned Three r187 common Backend implementation.
declare module 'three/src/renderers/common/Backend.js' {
  export default interface Backend {
    trackTimestamp: boolean;
    getTimestampFrames(type: TimestampQuery): number[];
  }
}
declare global {
  interface Window {
    __PROFILE__: { combatLane: typeof combatLane; create: typeof createCombatProfile };
    __NATIVE_BUILDS__: number;
  }
}
export interface FrameSample {
  i: number;
  at: number;
  dt: number | null;
  callbackAt: number;
  callbackIntervalMs: number | null;
  startAt: number;
  callbackLagMs: number;
  cpuMs: number;
  renderMs: number;
  gameMs: number;
  playerShots?: number;
  aiShots?: number;
  impacts?: number;
  weapon?: string;
  reloading?: boolean;
  nodeBuilders: number;
  calls: number;
  draws: number;
  geometries: number;
  textures: number;
}
export interface GpuSample {
  i: number;
  frame: number;
  renderFrame: number | null;
  computeFrame: number | null;
  renderMs: number | null;
  computeMs: number | null;
}
export interface ProfileStage {
  id: string;
  phase: string;
  countOnly: boolean;
  ms: Float64Array | null;
  calls: Uint16Array;
}
export interface Distribution {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
