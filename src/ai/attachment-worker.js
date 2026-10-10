import { StaticWorld } from '../physics/bvh.js';
import { CharacterController } from '../physics/character.js';
import { canStand, checkAttachment } from './attachment.js';
import * as THREE from 'three';

let nav, scheduled = false, profiling = false;
const queues = new Map(), actors = [];
const channel = new MessageChannel();
const costs = {};
function observe(object, key, timed) {
  const original = object[key];
  const stat = costs[key] = { calls: 0, ms: timed ? 0 : null };
  object[key] = function (...args) {
    stat.calls++;
    const start = timed ? performance.now() : 0;
    try { return original.apply(this, args); }
    finally { if (timed) stat.ms += performance.now() - start; }
  };
}
function schedule() {
  if (!scheduled && actors.length) { scheduled = true; channel.port2.postMessage(0); }
}
channel.port1.onmessage = () => {
  scheduled = false;
  const actor = actors.shift(), queue = queues.get(actor);
  if (!queue) return;
  const job = queue.shift();
  if (queue.length) actors.push(actor); else queues.delete(actor);
  try {
    const k = job.key, from = { x: k[0], y: k[1], z: k[2] }, to = { x: k[3], y: k[4], z: k[5] };
    const start = performance.now(), before = costs.move.calls;
    const value = checkAttachment.call(nav, from, to, k[6], k[7], k[8]);
    self.postMessage({ type: 'result', id: job.id, value, ms: performance.now() - start,
      moves: costs.move.calls - before, queueMs: start - job.queuedAt, costs: profiling ? costs : null });
  } catch (error) { self.postMessage({ type: 'error', message: String(error?.stack ?? error) }); }
  schedule();
};
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      const world = new StaticWorld(); Object.assign(world, data.world);
      world._stackNode = new Int32Array(data.world.stackSize);
      const controller = new CharacterController(world, data.controller);
      controller.enabled = data.controller.enabled;
      const physics = { staticWorld: world, gravity: data.gravity, MASK: data.mask,
        checkCapsule: (a, b, r, mask) => world.overlapCapsule(a.x, a.y, a.z, b.x, b.y, b.z, r, mask, 0) === 0 };
      nav = { physics, _probe: controller, stats: { endpointChecks: 0 },
        _p0: new THREE.Vector3(), _p1: new THREE.Vector3(), canStand };
      profiling = data.profile;
      const move = controller.move;
      costs.move = { calls: 0, ms: null };
      controller.move = function (x, y, z) { costs.move.calls++; return move.call(this, x, y, z); };
      if (profiling) {
        for (const key of ['queryAabb', 'sweepCapsule', 'overlapCapsule']) observe(world, key, true);
        for (const key of ['depenetrate', 'probeGround', '_slide', '_sweepMove', '_sweepDown']) observe(controller, key, true);
      }
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'queries') {
      for (const job of data.jobs) {
        if (!queues.has(job.actor)) { queues.set(job.actor, []); actors.push(job.actor); }
        job.queuedAt = performance.now(); queues.get(job.actor).push(job);
      }
      schedule();
    } else if (data.type === 'cancel') {
      const ids = new Set(data.ids);
      for (const [actor, jobs] of queues) {
        const remaining = jobs.filter(j => !ids.has(j.id));
        if (remaining.length) queues.set(actor, remaining);
        else { queues.delete(actor); actors.splice(actors.indexOf(actor), 1); }
      }
    }
  } catch (error) { self.postMessage({ type: 'error', message: String(error?.stack ?? error) }); }
};
