import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessGate } from './nav240/access-gate.mjs';
import { loadMap, vec } from './nav240/fixtures.mjs';
import { makeWalker } from './nav240/harness.mjs';
import { SurfaceNav } from '../src/ai/nav.js';
import { VARIANTS } from '../src/ai/soldier.js';
import { INFANTRY } from '../src/ai/capabilities.js';

const report = await accessGate([{ speed: 1.5, dt: 1 / 60 }, { speed: 4.3, dt: 1 / 30 }]);
assert.equal(report.results.length, 88);
for (const r of report.results) {
  assert.ok(r.arrived, `${r.name} @ ${r.speed}: ${r.status}`);
  assert.equal(r.recovery.length, 0, 'repositioning never establishes walking access');
  assert.equal(r.recoveryAttempts, 0, `${r.name}: unobstructed authored access needs no recovery`);
}

// Captured neighbor trajectories reproduce the entrance pressure, not the
// original sensing/brain timeline. The integrated browser gate covers live AI.
const replay = JSON.parse(readFileSync(new URL('./nav240/fixtures/w3-entrance.json', import.meta.url)));
const f = await loadMap(); f.grid = await SurfaceNav.load(f.surfaceRaw, f.physics);
const candidate = { query(from, to) {
  const points = []; f.grid.findPath(from, to, points);
  return { points, outcome: f.grid.lastOutcome, reason: f.grid.lastReason };
} };
try {
  for (const scale of [.985, 1, 1.025]) for (const crowded of [false, true]) for (const captured of [false, true]) {
    const initial = replay.initial, target = vec(initial.moveTarget);
    const a = makeWalker(f, candidate, vec(initial.position), 21, { scale, slopeLimit: INFANTRY.slopeRadians });
    a.yaw = initial.yaw; a.speed = initial.speed; a.velocity.copy(vec(initial.velocity));
    if (captured) {
      a.path = initial.path.map(vec); a.pathLen = a.path.length; a.pathIndex = 0; a.hasMoveTarget = true;
      a.moveTarget.copy(target); a._pendingDest.copy(target);
    } else a._goTo(target);
    const neighbors = replay.neighbors.map(([id, variant], i) => ({ id, alive: true,
      height: INFANTRY.height * VARIANTS[variant].scale, radius: INFANTRY.radius * VARIANTS[variant].scale,
      position: vec(replay.frames[0][i + 1]) }));
    if (crowded) a.ai.agents.push(...neighbors);
    let index = 0, arrived = false;
    for (let frame = 0; frame < 720; frame++) {
      a.ai._pathBudget = 2;
      if (a.pathPending) a._goTo(a._pendingDest);
      const time = replay.frames[0][0] + frame / 60;
      while (index < replay.frames.length - 2 && replay.frames[index + 1][0] < time) index++;
      const lo = replay.frames[index], hi = replay.frames[index + 1];
      const t = Math.max(0, Math.min(1, (time - lo[0]) / (hi[0] - lo[0])));
      neighbors.forEach((b, i) => {
        b.alive = !!lo[i + 1];
        if (b.alive) b.position.copy(vec(lo[i + 1])).lerp(vec(hi[i + 1] ?? lo[i + 1]), t);
      });
      a._move(1 / 60); a._tickNoProgress(1 / 60);
      arrived = Math.hypot(a.position.x - target.x, a.position.z - target.z) <= INFANTRY.arrivalRadius
        && Math.abs(a.position.y - target.y) <= INFANTRY.arrivalHeight;
      if (arrived) break;
      if (!a.hasMoveTarget && !a._recovering) a._goTo(target);
    }
    const label = `W3 scale=${scale}, crowded=${crowded}, captured=${captured}`;
    assert.ok(arrived, `${label}: must finish within twelve seconds`);
    assert.ok((a.recoveryAttempts ?? 0) <= 1, `${label}: no repeated recovery loop`);
    assert.equal(a.recoveries.length, 0, `${label}: no relocation`);
    f.physics.removeCharacter(a.controller);
  }
} finally { f.grid.dispose(); }
console.log('ok  88 full authored access traversals and 12 recorded W3 entrance pressure replays, no relocation');
