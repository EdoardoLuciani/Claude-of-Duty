import type { Engine } from '../../src/core/engine.ts';
import type { combatLane } from './combat-fixture.ts';

export interface CombatBlock {
  start: number;
  frames: number;
  livingFrames: number;
  activeAiFrames: number;
  aiShots: number;
  playerShots: number;
  distance: number;
}
export interface CombatReport {
  fixture: string;
  hp: number;
  aiCount: number;
  simulationHz: number | null;
  inputCycleHz?: number;
  simulationSeconds?: number | null;
  cycleFrames: number;
  blockFrames: number;
  spawn: number[];
  enemies: number[][];
  blocks: CombatBlock[];
  reloadStarts: number;
  reloadEnds: number;
  switches: number;
  playerShots: number;
  aiShots: number;
  impacts: number;
  damageTaken: number;
  distance: number;
  yawTravel: number;
  frames: number;
}
export function createCombatProfile(
  engine: Engine,
  lane: typeof combatLane,
  options?: { realtime?: boolean; agents?: number }
): {
  report: CombatReport;
  activity(): Pick<CombatReport, 'playerShots' | 'aiShots' | 'impacts'>;
  before(frame: number, actionFrame?: number): void;
  after(): void;
  dispose(): void;
};
export function validateCombatProfile(report: CombatReport | null): asserts report is CombatReport;
