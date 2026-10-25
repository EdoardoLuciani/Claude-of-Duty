import * as THREE from 'three';
import type { Vector3Like } from 'three';

import { StaticWorld } from '../physics/bvh.ts';
import { CharacterController } from '../physics/character.ts';
import { instrument, parseClientMessage } from './attachment-types.ts';
import type {
  AttachmentOracle,
  LadderQuery,
  QueuedQuery,
  QueryCosts,
  WorkerMessage,
} from './attachment-types.ts';

// Keep worker globals local: the application tsconfig also includes DOM types.
const worker = self as unknown as {
  postMessage(message: WorkerMessage): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};
import { canStand, checkAttachment } from './attachment.js';
import { LADDER, LadderMotor } from './ladder.ts';

let nav: AttachmentOracle | undefined;
let scheduled = false,
  profiling = false,
  failed = false;
let ladderController: CharacterController | undefined;
function failure(error: unknown): void {
  failed = true;
  queues.clear();
  actors.length = 0;
  worker.postMessage({
    type: 'error',
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
function checkLadder(query: LadderQuery): boolean {
  const c = ladderController;
  if (!c) throw new Error('[ai worker] missing ladder scratch');
  c.radius = query.radius;
  c.height = query.height;
  c.stepHeight = query.stepHeight;
  c.snapDistance = query.snapDistance;
  c.slopeLimit = query.slopeLimit;
  c.maxIterations = query.maxIterations;
  c.mask = query.mask;
  c.enabled = query.enabled;
  c.setPosition(query.foot.x, query.foot.y, query.foot.z);
  c.velocity.x = c.velocity.y = c.velocity.z = 0;
  c.grounded = false;
  const motor = new LadderMotor(c, query.descriptor, query.direction, query.maxMoves, query.cursor);
  try {
    for (let i = 0; i <= query.maxMoves && motor.status === 'active'; i++)
      motor.advance(LADDER.step);
    if (motor.status === 'active')
      throw new Error('[ai worker] ladder check exceeded bounded work');
    return motor.status === 'complete';
  } finally {
    motor.cancel();
  }
}
const queues = new Map<number, QueuedQuery[]>();
const actors: number[] = [];
const channel = new MessageChannel();
const costs: QueryCosts = {};
function timedCost(key: string): { calls: number; ms: number } {
  return (costs[key] = { calls: 0, ms: 0 });
}
function schedule(): void {
  if (!failed && !scheduled && actors.length) {
    scheduled = true;
    channel.port2.postMessage(0);
  }
}
channel.port1.onmessage = (): void => {
  scheduled = false;
  if (failed) return;
  const actor = actors.shift();
  if (actor === undefined) return;
  const queue = queues.get(actor);
  if (!queue) return;
  const job = queue.shift();
  if (!job || !nav) return;
  if (queue.length) actors.push(actor);
  else queues.delete(actor);
  try {
    const k = job.key;
    const start = performance.now(),
      before = costs.move.calls;
    const repeated = nav.stats.repeatedStates ?? 0,
      saved = nav.stats.savedMoves ?? 0;
    const value = Array.isArray(k)
      ? checkAttachment.call(
          nav,
          { x: k[0], y: k[1], z: k[2] },
          { x: k[3], y: k[4], z: k[5] },
          k[6],
          k[7],
          k[8]
        )
      : checkLadder(k);
    if (value === null) throw new Error('[ai worker] incomplete full query');
    const ended = performance.now();
    const result = {
      type: 'result' as const,
      id: job.id,
      value,
      ms: ended - start,
      repeatedStates: (nav.stats.repeatedStates ?? 0) - repeated,
      savedMoves: (nav.stats.savedMoves ?? 0) - saved,
      moves: costs.move.calls - before,
      queueMs: start - job.queuedAt,
      costs: profiling ? costs : null,
    };
    worker.postMessage(result);
  } catch (error) {
    failure(error);
  }
  schedule();
};
worker.onmessage = ({ data: value }): void => {
  if (failed) return;
  try {
    const data = parseClientMessage(value);
    if (data.type === 'init') {
      if (nav) throw new Error('[ai worker] duplicate initialization');
      const world = new StaticWorld();
      Object.assign(world, data.world);
      world._stackNode = new Int32Array(data.world.stackSize);
      const controller = new CharacterController(world, data.controller);
      controller.enabled = data.controller.enabled;
      ladderController = new CharacterController(world);
      const physics = {
        staticWorld: world,
        gravity: data.gravity,
        MASK: data.mask,
        checkCapsule: (a: Vector3Like, b: Vector3Like, r: number, mask: number): boolean =>
          world.overlapCapsule(a.x, a.y, a.z, b.x, b.y, b.z, r, mask, 0) === 0,
      };
      nav = {
        physics,
        repeatState: data.repeatState !== false,
        _probe: controller,
        stats: { endpointChecks: 0 },
        _p0: new THREE.Vector3(),
        _p1: new THREE.Vector3(),
        canStand,
      };
      profiling = data.profile;
      const move = controller.move.bind(controller);
      costs.move = { calls: 0, ms: null };
      controller.move = function (x, y, z): number {
        costs.move.calls++;
        return move.call(this, x, y, z);
      };
      const ladderMove = ladderController.move.bind(ladderController);
      ladderController.move = function (x, y, z): number {
        costs.move.calls++;
        return ladderMove(x, y, z);
      };
      if (profiling) {
        world.queryAabb = instrument(world.queryAabb.bind(world), timedCost('queryAabb'));
        world.sweepCapsule = instrument(world.sweepCapsule.bind(world), timedCost('sweepCapsule'));
        world.overlapCapsule = instrument(
          world.overlapCapsule.bind(world),
          timedCost('overlapCapsule')
        );
        controller.depenetrate = instrument(
          controller.depenetrate.bind(controller),
          timedCost('depenetrate')
        );
        controller.probeGround = instrument(
          controller.probeGround.bind(controller),
          timedCost('probeGround')
        );
        controller._slide = instrument(controller._slide.bind(controller), timedCost('_slide'));
        controller._sweepMove = instrument(
          controller._sweepMove.bind(controller),
          timedCost('_sweepMove')
        );
        controller._sweepDown = instrument(
          controller._sweepDown.bind(controller),
          timedCost('_sweepDown')
        );
      }
      worker.postMessage({ type: 'ready' });
    } else if (data.type === 'queries') {
      if (
        !nav ||
        data.jobs.length + [...queues.values()].reduce((n, q): number => n + q.length, 0) > 256
      )
        throw new Error('[ai worker] query queue limit');
      for (const job of data.jobs) {
        if (!queues.has(job.actor)) {
          queues.set(job.actor, []);
          actors.push(job.actor);
        }
        queues.get(job.actor)?.push({ ...job, queuedAt: performance.now() });
      }
      schedule();
    } else if (data.type === 'cancel') {
      const ids = new Set(data.ids);
      for (const [actor, jobs] of queues) {
        const remaining = jobs.filter((j): boolean => !ids.has(j.id));
        if (remaining.length) queues.set(actor, remaining);
        else {
          queues.delete(actor);
          actors.splice(actors.indexOf(actor), 1);
        }
      }
    }
  } catch (error) {
    failure(error);
  }
};
