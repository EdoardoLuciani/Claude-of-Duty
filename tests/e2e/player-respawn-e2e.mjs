/** Controlled real-map restart regression; not a natural-death/camping reproduction. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

import {
  collectBrowserErrors,
  ensureViteServer,
  launchChromium,
  parseArgs,
  portOpen,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';

// node tests/e2e/player-respawn-e2e.mjs --port=5480 --out=/tmp/470-respawn.json
const args = parseArgs();
const port = Number(args.port ?? 5480);
assert.equal(await portOpen(port), false, 'use a unique port owned by this worktree');
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  collectBrowserErrors(page, errors);
  await page.goto(`http://127.0.0.1:${port}/?q=high`);
  const device = await waitForGame(page);
  const checks = await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.stop(); // Hold the next update so it cannot hide a same-dispatch stale capsule.
    const ctx = e.ctx;
    const p = ctx.get('player');
    const ai = ctx.get('ai');
    const world = ctx.get('world');
    const results = [];
    const snapshot = () => {
      const c = p.hitbox;
      return {
        dead: p.dead,
        health: p.health.value,
        armour: p.health.armour,
        stance: p.stance,
        lean: [p.movement.leanAmount, p.movement.leanOffsetX, p.movement.leanOffsetZ],
        feet: p.position.toArray(),
        enabled: c.enabled,
        a: [c.ax, c.ay, c.az],
        b: [c.bx, c.by, c.bz],
        radius: c.radius,
        sample: ai.playerPosition(p.position.clone()).toArray(),
      };
    };
    let cycle;
    const populate = ai.populate;
    const playerPosition = ai.playerPosition;
    ai.populate = function (...params) {
      cycle.populateEntry = snapshot();
      return populate.apply(this, params);
    };
    ai.playerPosition = function (...params) {
      const sample = playerPosition.apply(this, params);
      // populate reads this._v3; record the actual sample, not just reset feet.
      if (params[0] === this._v3) cycle.placementOrigins.push(sample.toArray());
      return sample;
    };
    const off = ctx.events.on('player:respawn', () => {
      cycle.respawnObservers.push(snapshot());
    });
    try {
      for (const dead of [true, false]) {
        cycle = { dead, placementOrigins: [], respawnObservers: [] };
        const moved = world.spawn(1);
        const gy = ctx
          .get('physics')
          .groundHeight(moved.position.x, moved.position.z, moved.position.y + 6);
        p.movement.teleport(moved.position.x, gy + 0.03, moved.position.z);
        p.movement.stance = 'crouch';
        p.movement.stanceWant = 'crouch';
        p.movement.leanAmount = 0.8;
        p.movement.leanOffsetX = 0.25;
        p.movement.leanOffsetZ = -0.15;
        p.rig.eye = 1;
        if (dead) p.applyDamage(10000, null);
        else p.health.value = 25;
        p._syncHitbox(); // Establish an old-location, disabled death capsule.
        cycle.before = snapshot();
        ctx.events.emit('game:restart', { source: 'test' });
        cycle.after = snapshot();
        cycle.agents = ai.agents.filter((a) => a.alive).length;
        results.push(cycle);
      }
    } finally {
      off();
      ai.populate = populate;
      ai.playerPosition = playerPosition;
    }
    return { revision: window.__BUILD_REVISION__, results, engineError: e.error };
  });
  const report = { device, ...checks, errors };
  if (args.out) writeFileSync(String(args.out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(checks.engineError, null);
  assert.deepEqual(errors, []);
  for (const cycle of checks.results) {
    assert.equal(cycle.before.enabled, !cycle.dead);
    assert.ok(
      Math.hypot(
        cycle.before.feet[0] - cycle.after.feet[0],
        cycle.before.feet[2] - cycle.after.feet[2]
      ) > 2,
      'fixture separates death and reset positions'
    );
    assert.equal(cycle.respawnObservers.length, cycle.dead ? 1 : 0);
    assert.ok(cycle.placementOrigins.length > 0, 'actual restart populate sampled player');
    assert.ok(cycle.agents > 0, 'real restart still places a fresh wave');
    for (const state of [cycle.after, cycle.populateEntry, ...cycle.respawnObservers]) {
      assert.equal(state.dead, false);
      assert.equal(state.health, 100);
      assert.equal(state.armour, 50);
      assert.equal(state.stance, 'stand');
      assert.deepEqual(state.lean, [0, 0, 0]);
      assert.equal(state.enabled, true, 'capsule enabled before observers/placement');
      assert.deepEqual([state.a[0], state.a[2]], [state.feet[0], state.feet[2]]);
      assert.deepEqual([state.b[0], state.b[2]], [state.feet[0], state.feet[2]]);
      assert.ok(Math.abs(state.a[1] - state.feet[1] - state.radius) < 1e-9);
      assert.ok(Math.abs(state.b[1] - state.feet[1] - (1.78 - state.radius)) < 1e-9);
    }
    for (const origin of cycle.placementOrigins) {
      assert.deepEqual(
        [origin[0], origin[2]],
        [cycle.after.feet[0], cycle.after.feet[2]],
        'actual placement origin uses reset X/Z, not the old disabled hitbox'
      );
    }
  }
  console.log(
    'player-respawn-e2e: passed (same-dispatch dead/living restart capsule and AI origin)'
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
