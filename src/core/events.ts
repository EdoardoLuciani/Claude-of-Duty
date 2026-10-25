import type { Vector3 } from 'three';

import type { WEAPON_DEFS } from '../weapons/defs.ts';

/** Both gameplay definitions and compact dev/audio descriptors are supported. */
export type EventWeapon =
  | string
  | (Partial<Pick<(typeof WEAPON_DEFS)[keyof typeof WEAPON_DEFS], 'id' | 'class'>> & {
      audio?: string;
      name?: string;
      kind?: string;
      suppressed?: boolean;
    })
  | null;
/** Mechanical beats also cover post-shot manual actions; end is hand settle only. */
export type ReloadPhase =
  | 'start'
  | 'magout'
  | 'magin'
  | 'slide'
  | 'end'
  | 'shellin'
  | 'pump'
  | 'charge'
  | 'boltopen'
  | 'boltclose';

export interface EngineError {
  system: string;
  method: string;
  message: string;
}
/** Actor handles are intentionally opaque: receivers own identity/health checks. */
export interface DamageDealtEvent {
  target: unknown;
  amount: number;
  headshot?: boolean;
  killed?: boolean;
  point?: Vector3;
  part?: string | null;
  incident?: Vector3;
  from?: Vector3;
  source?: unknown;
  weapon?: EventWeapon;
  shot?: number;
  explosion?: boolean;
}
export interface BulletSegmentEvent {
  from: Vector3;
  to: Vector3;
  shooter: unknown;
  shot: number;
  weapon: EventWeapon;
  speed: number;
  tracer: boolean;
}
export interface BulletImpactEvent {
  point: Vector3;
  normal: Vector3;
  surface: string;
  incident: Vector3;
  damage: number;
  exit: boolean;
  shooter?: unknown;
  shot?: number;
  surfaceIndex?: number;
  object?: unknown;
  body?: unknown;
  actor?: unknown;
  part?: unknown;
}
export interface EngineEventMap {
  'weapon:fire': {
    actor: unknown;
    weapon: EventWeapon;
    origin: Vector3;
    dir: Vector3;
    seed: number;
    empty?: boolean;
    firstPerson?: boolean;
    fx?: boolean;
    viewSpace?: boolean;
    intensity?: number;
    light?: number;
    flashScale?: number;
  };
  'weapon:reload': {
    weapon: EventWeapon;
    phase: ReloadPhase;
    retained?: boolean;
    actor?: unknown;
    position?: Vector3;
  };
  'weapon:shell': {
    position: Vector3;
    velocity: Vector3;
    actor?: unknown;
    weapon?: EventWeapon;
    fxClass?: string;
    caseLen?: number;
    caseRadius?: number;
    spin?: number;
  };
  'bullet:impact': BulletImpactEvent;
  'bullet:segment': BulletSegmentEvent;
  'bullet:tracer': { from: Vector3; to: Vector3; speed: number };
  'shot:resolved': {
    shooter: unknown;
    weapon: EventWeapon;
    from: Vector3;
    to: Vector3;
    result: string;
    target: unknown;
    part: unknown;
    damage: number;
    pellet?: number;
    shot: number;
    stopReason: string;
  };
  'shot:applied': { name: string; shot: unknown };
  'damage:dealt': DamageDealtEvent;
  'damage:taken': {
    amount: number;
    from: Vector3;
    health: number;
    direction?: number;
    armourAbsorbed: number;
    armour: number;
    plateBreak: boolean;
  };
  'actor:death': { actor: unknown; point: Vector3; impulse: Vector3; headshot?: boolean };
  'wave:start': { wave: number; enemies: number; squads: number; perSquad: number };
  'wave:complete': { wave: number; nextWave: number; delay: number };
  'score:change': { score: number; delta: number; reason: string; kills: number };
  'market:open': { wave: number };
  'market:close': Record<string, never>;
  'player:land': { velocity: number; surface: string; position?: Vector3 };
  'player:footstep': {
    position: Vector3;
    surface: string;
    running: boolean;
    stance: string;
    left?: boolean;
    speed?: number;
    gait?: string;
    level?: number;
  };
  'ai:footstep': {
    position: Vector3;
    surface: string;
    gait: string;
    actor?: unknown;
    left?: boolean;
    speed?: number;
  };
  'ai:bark': { kind: string; position: Vector3; voice: number };
  'player:state': {
    stance: string;
    sprinting: boolean;
    sliding: boolean;
    ads: boolean;
    adsProgress?: number;
    state?: string;
    crouched?: boolean;
    tacticalSprint?: boolean;
    grounded?: boolean;
    airborne?: boolean;
    mantling?: boolean;
    lean?: number;
    speed?: number;
    health?: number;
    healthFraction?: number;
    dead?: boolean;
  };
  'player:jump': { position: Vector3 };
  'player:mantle': { kind: string; height: number };
  'player:death': { position: Vector3; from: Vector3 | null; amount: number };
  'player:respawn': { position: Vector3 };
  'player:heal': {
    phase: 'start' | 'cancel' | 'complete';
    amount: number;
    health: number;
    bandages: number;
    reason: string;
  };
  'player:health': {
    health: number;
    fraction: number;
    low: boolean;
    suppression: number;
    dead: boolean;
    effect: number;
    changedLowState?: boolean;
  };
  'player:heartbeat': { strength: number; fraction: number };
  'ammo:pickup': { amount: number; weapon: EventWeapon; position: Vector3 };
  'intel:spawn': { id: string; position: Vector3 };
  'intel:available': { count: number };
  'intel:noise': { position: Vector3; loudness: number };
  'intel:operation': { active: boolean; position: Vector3 };
  'intel:spark': { position: Vector3 };
  'intel:secured': {
    id: string;
    position: Vector3;
    card: string;
    cardLabel: string;
    credits: number;
  };
  'hud:heard': { bearing: number };
  'hud:search': { bearing: number; sector: string; remaining: number };
  'game:restart': { source?: string };
  'radio:strike': { position: Vector3 };
  explosion: {
    position: Vector3;
    radius: number;
    damage: number;
    impulse?: number;
    source?: unknown;
  };
  'engine:error': EngineError;
  resize: { width: number; height: number };
  'ui:pause': { paused: boolean };
}
export type EngineEventName = keyof EngineEventMap;
