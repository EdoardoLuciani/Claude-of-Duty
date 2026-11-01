import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { HealthFx } from '../../src/ui/health.ts';

// Ignore platform-level floating-point ulps, not animation changes.
const stable = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'number' ? Number(v.toFixed(10)) : v));

// Exact accepted 180-frame trajectory captured at 3cb261b5, before HTML removal.
const golden = createHash('sha256'),
  health = new HealthFx();
for (let i = 0; i < 180; i++) {
  const state = {
    health: i < 90 ? 20 : 100,
    hurt: i < 90 ? 0.8 : 0,
    pulse: (i % 10) / 10,
    healing: i > 60 && i < 120,
    healProgress: i / 180,
  };
  if (i % 30 === 0) health.onDamage(0.7);
  health.update(1 / 60, state);
  golden.update(
    stable(
      Object.fromEntries(
        [
          'hurt',
          'hpShown',
          'beatEnergy',
          'flashT',
          'bloodAlpha',
          'bloodScale',
          'beatAlpha',
          'flashAlpha',
        ].map((k) => [k, health[k]])
      )
    )
  );
  assert(health.bloodAlpha >= 0 && health.bloodAlpha <= 1);
  assert(health.flashAlpha >= 0 && health.flashAlpha <= 1);
}
assert.equal(
  golden.digest('hex'),
  '63928d223cb9f68fa3c0f3384ed0223102fefcbe07186a1e81cfadae50f96cf6'
);
assert(!('bloodWrap' in health));
assert(!('vitals' in health));
const paused = [health.hurt, health.beatEnergy, health.flashT, health.hpShown];
health.update(0, { health: 0, hurt: 1, pulse: 1 });
for (const [i, value] of [health.hurt, health.beatEnergy, health.flashT, health.hpShown].entries())
  assert(
    Math.abs(value - paused[i]) < 1e-12,
    'paused clocks do not advance (floating-point tolerance)'
  );
console.log(
  'ok Pixi injury: accepted flash/blood/heartbeat/healing timing, pause and no native presenter'
);
