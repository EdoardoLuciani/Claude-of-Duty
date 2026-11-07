import assert from 'node:assert/strict';

import {
  CALLOUT_CAST,
  CALLOUT_MIX,
  CALLOUT_URLS,
  CalloutPlayer,
  calloutBank,
} from '../../src/audio/callouts.ts';
import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import provenance from '../../src/audio/samples/callouts/provenance.json' with { type: 'json' };
import { EventBus } from '../../src/core/registry.ts';
import { Rng } from '../../src/core/rng.ts';
import { audioFixture } from '../lib/audio-banks.mjs';

const { actx, sources } = audioFixture();
actx.state = 'running';
const rng = new Rng(497),
  bank = new WeaponSampleBank(actx);
assert.deepEqual(CALLOUT_CAST, ['orus', 'algenib', 'alnilam', 'iapetus']);
assert.equal(Object.values(CALLOUT_URLS).flat().length, 36);
assert.equal(provenance.files['orus-grenade-1'].text, 'Frag out!');
for (const [key, urls] of Object.entries(CALLOUT_URLS)) {
  assert.equal(urls.length, 3);
  bank.hitBuffers[key] = urls.map((_, i) => ({ key, index: i, duration: 1.5 }));
}
for (let actor = 0; actor < 20; actor++) {
  const voice = CALLOUT_CAST[actor % 4];
  for (const kind of ['spot', 'reload', 'grenade']) {
    assert.equal(calloutBank(actor, kind), voice + '-' + kind);
    let previous = -1;
    for (let i = 0; i < 8; i++) {
      const recorded = bank.callout(kind, actor, rng, { when: 3 });
      const source = sources.at(-1);
      assert.equal(source.buffer.key, calloutBank(actor, kind));
      assert.notEqual(source.buffer.index, previous, 'vary the take, never the identity');
      previous = source.buffer.index;
      assert.equal(source.playbackRate.value, 1);
      assert.equal(source.when, 3);
      assert.equal(recorded.end, 4.52);
      recorded.stop();
      recorded.stop();
      assert(source.stopped && source.disconnected);
    }
  }
}
assert.equal(calloutBank(Infinity, 'spot'), 'orus-spot');
assert.equal(calloutBank(-5, 'reload'), 'algenib-reload');
assert.throws(() => new WeaponSampleBank(actx).callout('spot', 1, rng), /not loaded/);

const emitters = [],
  requests = [];
let refuse = false;
const field = {
  distanceTo: (x, y, z) => Math.hypot(x, y, z),
  acquire(options) {
    requests.push(options);
    if (refuse) return null;
    const em = {
      detached: false,
      detach() {
        this.detached = true;
      },
      moveTo(x, y, z) {
        this.position = { x, y, z };
      },
    };
    emitters.push(em);
    return em;
  },
  hold(em, node, end) {
    Object.assign(em, { node, end });
  },
  dispose() {},
};
const player = new CalloutPlayer(actx, field, bank, rng);
const pos = { x: 3, y: 0, z: 4 };
assert.equal(player.play('spot', { x: 56, y: 0, z: 0 }, 0), false);
assert.equal(player.play('spot', { x: NaN, y: 0, z: 0 }, 0), false);
assert.equal(requests.length, 0, 'inaudible/invalid speech never consumes an emitter or variant');
assert(player.play('spot', pos, 0));
const first = sources.at(-1);
assert.equal(requests.at(-1).bus, 'voice');
assert.equal(requests.at(-1).tracked, true, 'a line cannot be stolen midway by gunfire');
assert.equal(first.when, 5 / 343, 'reuse propagation scheduling');
actx.currentTime = 0.8;
assert.equal(player.play('reload', pos, 1), false, 'full duration, not the old 0.42 s gate');
pos.x = 4;
player.update();
assert.equal(emitters.at(-1).position.x, 4, 'speech follows its actual speaker');
assert(
  player.play('grenade', pos, 0),
  'grenade preempts ordinary speech even for the same recently speaking actor'
);
assert(first.stopped && emitters[0].detached);
const grenade = sources.at(-1);
assert.equal(player.play('grenade', pos, 3), false, 'no overlapping grenade spam');
actx.currentTime = 2.5;
player.update();
assert(grenade.stopped && emitters.at(-1).detached, 'natural completion releases tracked slot');
assert.equal(player.play('reload', pos, 1), false, 'leave a quiet gap after a line');
actx.currentTime = 4;
assert(player.play('reload', pos, 1));
player.stop(99);
assert(!sources.at(-1).stopped, 'other actors do not interrupt this speaker');
player.stop(1);
assert(sources.at(-1).stopped);
actx.currentTime = 6;
assert.equal(player.play('spot', pos, 1), false, 'per-actor cooldown survives interruption');
player.forget(1);
assert(player.play('spot', pos, 1), 'death forgets retained actor state');
player.reset();
refuse = true;
const before = sources.length;
assert.equal(player.play('spot', pos, 3), false);
assert.equal(sources.length, before, 'pool refusal never starts an unowned source');
refuse = false;

// Real event wiring: separate pause/shop/death/error blocks cannot undo each other.
const events = new EventBus(),
  audio = new AudioSystem();
Object.assign(audio, { running: true, actx, field, samples: bank, rng, _callouts: player });
audio.ctx = { events, peek: () => null };
audio._wireEvents(audio.ctx);
const bark = () => audio.bark('spot', pos, { voice: 0 });
assert(bark());
events.emit('ui:pause', { paused: true });
assert(sources.at(-1).stopped);
assert.equal(bark(), false);
events.emit('market:open', { wave: 1 });
events.emit('market:close', {});
assert.equal(bark(), false, 'closing shop cannot undo pause');
events.emit('ui:pause', { paused: false });
events.emit('game:restart', {});
assert(bark());
events.emit('player:death', {});
assert.equal(bark(), false);
events.emit('ui:pause', { paused: false });
assert.equal(bark(), false, 'unpausing cannot undo player death');
events.emit('game:restart', {});
assert(bark());
audio._onDeath({ actor: { id: 0 } });
assert(sources.at(-1).stopped, 'death cancels speech even without an impact point');
events.emit('game:restart', {});
events.emit('ai:bark', { kind: 'reload', position: pos, voice: 2 });
assert.equal(sources.at(-1).buffer.key, 'alnilam-reload');
events.emit('engine:error', { system: 'test', method: 'update', message: 'terminal' });
assert(sources.at(-1).stopped);
events.emit('game:restart', {});
assert.equal(bark(), false, 'terminal failure cannot be undone by a restart event');
assert.equal(audio.bark('flank', pos), false, 'unimplemented intent never substitutes contact');
assert.equal(audio.bark('spot', null), false, 'no head-locked phantom nearby enemy');
assert.equal(audio.bark('spot', pos, { radio: true }), false, 'radio dialogue is out of scope');
assert(CALLOUT_MIX.spacing > 0);
actx.close = async () => {
  actx.state = 'closed';
};
audio.dispose();
assert.equal(audio._callouts, null);
audio.bark = () => {
  throw Error('disposed audio retained its listener');
};
assert.doesNotThrow(() => events.emit('ai:bark', { kind: 'spot', position: pos, voice: 1 }));

const firing = new AudioSystem();
Object.assign(firing, {
  running: true,
  actx,
  rng: { float: () => 0 },
  field: { listenerPos: { x: 0, y: 0, z: 0 }, distanceTo: () => 10 },
  mixer: { duck() {} },
});
firing._playAt = () => true;
firing.bark = () => {
  throw Error('gunfire fabricated tactical intent');
};
assert.doesNotThrow(() => firing._onFire({ weapon: 'ai_rifle', origin: pos, firstPerson: false }));
console.log(
  'Four stable voices, recorded variations, duration/priority gates and lifecycle-owned spatial speech'
);
