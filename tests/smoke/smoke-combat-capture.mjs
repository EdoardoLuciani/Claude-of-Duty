import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The capture CLI starts a browser when imported. Execute its actual event
// subscriptions in isolation instead, so this regression cannot drift into a
// second implementation of the jump/landing attribution logic.
const source = readFileSync(new URL('../../tools/capture-hit-combat.mjs', import.meta.url), 'utf8');
const start = source.indexOf('    let jumpPending = false;');
const end = source.indexOf('    const play = audio._playAt.bind(audio);', start);
assert(start >= 0 && end > start, 'capture event-subscription seam must remain testable');
const subscribe = new Function('ctx', 'report', source.slice(start, end));
const tracker = () => {
  const handlers = new Map();
  const report = { jumps: 0, landings: 0, jumpLandings: 0 };
  subscribe(
    {
      events: {
        on(name, handler) {
          handlers.set(name, handler);
        },
      },
    },
    report
  );
  return {
    report,
    jump: () => handlers.get('player:jump')(),
    land: (velocity) => handlers.get('player:land')({ velocity }),
  };
};

const normal = tracker();
normal.jump();
normal.land(5);
normal.land(3);
assert.deepEqual(
  normal.report,
  { jumps: 1, landings: 2, jumpLandings: 1 },
  'a later terrain landing cannot reuse a consumed jump'
);

const soft = tracker();
soft.jump();
soft.land(1);
soft.land(3);
assert.deepEqual(
  soft.report,
  { jumps: 1, landings: 2, jumpLandings: 0 },
  'a soft landing consumes the jump even though the pair does not qualify'
);

const boundary = tracker();
boundary.jump();
boundary.land(2);
boundary.land(4);
assert.equal(
  boundary.report.jumpLandings,
  0,
  'the existing >2 threshold applies to the first landing only'
);

const repeated = tracker();
for (let i = 0; i < 2; i++) {
  repeated.jump();
  repeated.land(1);
  repeated.land(3);
}
assert.deepEqual(
  repeated.report,
  { jumps: 2, landings: 4, jumpLandings: 0 },
  'repeated terrain contacts cannot masquerade as two jump pairs'
);
for (let i = 0; i < 2; i++) {
  repeated.jump();
  repeated.land(5);
}
assert.deepEqual(
  repeated.report,
  { jumps: 4, landings: 6, jumpLandings: 2 },
  'independent qualifying pairs are counted normally'
);
console.log('Combat capture pairs each jump only with its first subsequent landing');
