import type { Vector3, Vector3Like } from 'three';
import type { CharacterController } from '../physics/character.ts';
import type { StaticWorld } from '../physics/bvh.ts';
import { isRecord, isNumber, isNumberArray } from './validation.ts';

export interface AttachmentOracle {
  physics: {
    gravity: number;
    MASK: { CHARACTER: number };
    checkCapsule(a: Vector3Like, b: Vector3Like, radius: number, mask: number): boolean;
  };
  _p0: Vector3;
  _p1: Vector3;
  _probe: CharacterController | null;
  stats: { endpointChecks: number; repeatedStates?: number; savedMoves?: number };
  repeatState?: boolean;
  canStand(p: Vector3Like, radius?: number, height?: number): boolean;
}
export function instrument<This, Args extends unknown[], Result>(
  original: (this: This, ...args: Args) => Result,
  stat: QueryCost
): (this: This, ...args: Args) => Result {
  return function (...args: Args): Result {
    stat.calls++;
    const start = stat.ms === null ? 0 : performance.now();
    try {
      return original.apply(this, args);
    } finally {
      if (stat.ms !== null) stat.ms += performance.now() - start;
    }
  };
}
export type QueryKey = number[];
export interface QueryRequest {
  id: number;
  key: QueryKey;
  actor: number;
}
export interface QueuedQuery extends QueryRequest {
  queuedAt: number;
}
export interface PlanningScope {
  actor: number;
  kind: string;
  proofs: Map<string, { id: number }>;
  started: number;
  frame: number;
  waiting: boolean;
  waitOrigin?: number[] | null;
  gapFrames: number;
  attempts: number;
  origin?: Vector3 | null;
  lastFrame: number;
  pending: boolean;
  unsent: QueryRequest[];
  used: Set<number>;
}
export interface PlanningJob {
  id: number;
  key: QueryKey;
  identity: string;
  scope: PlanningScope;
  frame: number;
  sent: number;
  generation: number;
}
export interface QueryCost {
  calls: number;
  ms: number | null;
}
export type QueryCosts = Record<string, QueryCost>;
export type QuerySample =
  | {
      type: 'query';
      actor: number | null;
      kind: string | null;
      frame: number | null;
      key?: QueryKey | null;
      ms: number;
      roundTripMs: number | null;
      queueMs: number | null;
      moves: number;
    }
  | {
      type: 'decision';
      actor: number;
      kind: string;
      frame: number;
      ms: number;
      frames: number;
      attempts: number;
      gapFrames: number;
    };
export type AttachmentSnapshot = Pick<
  StaticWorld,
  | 'version'
  | 'dirty'
  | 'nodeCount'
  | 'triCount'
  | 'pos'
  | 'nrm'
  | 'surface'
  | 'mask'
  | 'object'
  | 'triIndex'
  | 'nodeBounds'
  | 'nodeMeta'
  | '_taabb'
> & { stackSize: number };
export type ControllerSettings = Pick<
  CharacterController,
  | 'radius'
  | 'height'
  | 'stepHeight'
  | 'slopeLimit'
  | 'snapDistance'
  | 'maxIterations'
  | 'mask'
  | 'enabled'
>;
export interface InitMessage {
  type: 'init';
  world: AttachmentSnapshot;
  controller: ControllerSettings;
  gravity: number;
  mask: { CHARACTER: number };
  profile: boolean;
  repeatState: boolean;
}
export type ClientMessage =
  | InitMessage
  | { type: 'queries'; jobs: QueryRequest[] }
  | { type: 'cancel'; ids: number[] };
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | {
      type: 'result';
      id: number;
      value: boolean;
      ms: number;
      moves: number;
      repeatedStates?: number;
      savedMoves?: number;
      queueMs?: number;
      costs?: QueryCosts | null;
    };
function snapshot(value: unknown): value is AttachmentSnapshot {
  return (
    isRecord(value) &&
    isNumber(value.version) &&
    typeof value.dirty === 'boolean' &&
    isNumber(value.nodeCount) &&
    isNumber(value.triCount) &&
    isNumber(value.stackSize) &&
    value.pos instanceof Float32Array &&
    value.nrm instanceof Float32Array &&
    value.surface instanceof Uint8Array &&
    value.mask instanceof Uint16Array &&
    value.object instanceof Int32Array &&
    value.triIndex instanceof Uint32Array &&
    value.nodeBounds instanceof Float32Array &&
    value.nodeMeta instanceof Int32Array &&
    value._taabb instanceof Float32Array
  );
}
function settings(value: unknown): value is ControllerSettings {
  return (
    isRecord(value) &&
    isNumber(value.radius) &&
    isNumber(value.height) &&
    isNumber(value.stepHeight) &&
    isNumber(value.slopeLimit) &&
    isNumber(value.snapDistance) &&
    isNumber(value.maxIterations) &&
    isNumber(value.mask) &&
    typeof value.enabled === 'boolean'
  );
}
export function parseClientMessage(value: unknown): ClientMessage {
  if (!isRecord(value)) throw new Error('[ai worker] invalid message');
  if (value.type === 'cancel' && isNumberArray(value.ids))
    return { type: 'cancel', ids: value.ids };
  if (value.type === 'queries' && Array.isArray(value.jobs)) {
    const jobs = value.jobs.map((job: unknown): QueryRequest => {
      if (
        !isRecord(job) ||
        !isNumber(job.id) ||
        !isNumber(job.actor) ||
        !isNumberArray(job.key) ||
        job.key.length !== 9
      )
        throw new Error('[ai worker] invalid query');
      return { id: job.id, actor: job.actor, key: job.key };
    });
    return { type: 'queries', jobs };
  }
  if (
    value.type === 'init' &&
    snapshot(value.world) &&
    settings(value.controller) &&
    isNumber(value.gravity) &&
    isRecord(value.mask) &&
    isNumber(value.mask.CHARACTER)
  ) {
    return {
      type: 'init',
      world: value.world,
      controller: value.controller,
      gravity: value.gravity,
      mask: { ...value.mask, CHARACTER: value.mask.CHARACTER },
      profile: value.profile === true,
      repeatState: value.repeatState !== false,
    };
  }
  throw new Error('[ai worker] invalid message');
}
export function parseWorkerMessage(value: unknown): WorkerMessage {
  if (!isRecord(value)) throw new Error('[ai worker] invalid message');
  if (value.type === 'ready') return { type: 'ready' };
  if (value.type === 'error' && typeof value.message === 'string')
    return { type: 'error', message: value.message };
  if (
    value.type !== 'result' ||
    !isNumber(value.id) ||
    typeof value.value !== 'boolean' ||
    !isNumber(value.ms) ||
    value.ms < 0 ||
    !isNumber(value.moves) ||
    !Number.isInteger(value.moves) ||
    value.moves < 0
  )
    throw new Error('[ai worker] malformed query result');
  const costs: QueryCosts = {};
  if (value.costs != null) {
    if (!isRecord(value.costs)) throw new Error('[ai worker] invalid query costs');
    for (const [key, stat] of Object.entries(value.costs)) {
      if (!isRecord(stat) || !isNumber(stat.calls) || !(stat.ms === null || isNumber(stat.ms)))
        throw new Error('[ai worker] invalid query costs');
      costs[key] = { calls: stat.calls, ms: stat.ms };
    }
  }
  for (const key of ['repeatedStates', 'savedMoves', 'queueMs'])
    if (value[key] !== undefined && !isNumber(value[key]))
      throw new Error('[ai worker] invalid query statistics');
  return {
    type: 'result',
    id: value.id,
    value: value.value,
    ms: value.ms,
    moves: value.moves,
    costs: value.costs == null ? null : costs,
    repeatedStates: isNumber(value.repeatedStates) ? value.repeatedStates : undefined,
    savedMoves: isNumber(value.savedMoves) ? value.savedMoves : undefined,
    queueMs: isNumber(value.queueMs) ? value.queueMs : undefined,
  };
}
export function parseSnapshotCopy(
  value: unknown
): { snapshot: AttachmentSnapshot; transfer: ArrayBuffer[]; bytes: number } | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !snapshot(value.snapshot) ||
    !Array.isArray(value.transfer) ||
    !value.transfer.every((buffer: unknown) => buffer instanceof ArrayBuffer) ||
    !isNumber(value.bytes)
  )
    throw new Error('[ai worker] invalid collision snapshot');
  const transfer: ArrayBuffer[] = [];
  for (const buffer of value.transfer) {
    if (buffer instanceof ArrayBuffer) transfer.push(buffer);
  }
  return { snapshot: value.snapshot, transfer, bytes: value.bytes };
}
