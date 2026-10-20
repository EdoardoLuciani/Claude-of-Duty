import assert from 'node:assert/strict';

import { AudioSystem } from '../../src/audio/index.ts';
import { WeaponSampleBank } from '../../src/audio/samples.ts';
import reference from '../../src/audio/samples/reference.json' with { type: 'json' };
import {
  REPORT_DISTANT_MATCH,
  WEAPON_PROFILES,
  reportDistanceGain,
  reportDistantMix,
} from '../../src/audio/weapons.ts';

const kinds = ['rifle', 'mcx', 'pistol', 'lmg', 'smg', 'mpx', 'sniper', 'shotgun'];
const param = () => ({ value: 0 });
const node = () => ({
  connections: [],
  connect(to) {
    this.connections.push(to);
  },
  frequency: param(),
  Q: param(),
  gain: param(),
});
for (const kind of kinds) {
  const profile = WEAPON_PROFILES[kind];
  assert.equal(profile.sample, kind);
  assert.equal(profile.sampleAction, false);
  assert.equal(profile.samplePunch, false);
  assert.equal(profile.sampleSend, 0, 'complete reports use recorded decay, no added reverb');
  assert.equal('sampleGain' in profile, false, 'no separate authored per-profile level');
  assert.equal('firstPersonGain' in profile, false, 'no extra authored own-shot boost');
  const sources = [];
  let filters = 0;
  const ctx = {
    currentTime: 3,
    createBiquadFilter() {
      filters++;
      return node();
    },
    createGain: node,
    createBufferSource() {
      const source = {
        ...node(),
        playbackRate: param(),
        starts: [],
        start(...args) {
          this.starts.push(args);
        },
      };
      sources.push(source);
      return source;
    },
  };
  const bank = new WeaponSampleBank(ctx);
  function readVariants(key, count) {
    return Array.from({ length: count }, (_, i) => {
      const duration = reference.files[`${key}-${i + 1}`].frames / reference.masterRate;
      return { duration, i };
    });
  }
  const variants = kind === 'mcx' ? 2 : 3;
  const buffers = readVariants(kind, variants);
  bank.buffers[kind] = buffers;
  if (profile.distantSample)
    bank.buffers[profile.distantSample] = readVariants(profile.distantSample, 2);
  else assert.equal(profile.distantSample, undefined, 'no unsuppressed substitute for MCX');
  const rng = { range: (a, b) => (a + b) / 2 };
  for (let i = 0; i < variants + 1; i++) {
    const when = 4 + i * 0.075;
    const voice = bank.shot(profile, rng, { when, firstPerson: true });
    const source = sources[i];
    assert.equal(sources.length, i + 1, 'one source per own shot; no action/body layer');
    assert.equal(source.buffer, buffers[i % variants], 'authored round robin wraps');
    assert.equal(source.playbackRate.value, 1, 'no authored report pitch jitter');
    assert.equal(
      voice.node.gain.value,
      1,
      'unity voice output; only shared weapon level controls volume'
    );
    assert.notEqual(voice.node.channelCount, 1, 'never force player source mono');
    assert.deepEqual(source.starts, [[when]], 'no source offset or truncation');
    assert(voice.end >= when + source.buffer.duration);
  }
  assert.equal(filters, 0, 'no player high/low-pass, including suppressed MCX');
  const audio = new AudioSystem();
  Object.assign(audio, { actx: ctx, samples: bank, rng });
  assert.equal(audio._dry.length, 80, 'explicit private full-tail bookkeeping budget');
  for (const distance of [20, 20.001, 44.9, 45, 45.1, 70, 139.999, 140, 150]) {
    const count = sources.length;
    const voice = audio._build('shot', 7, distance, { profile, firstPerson: false });
    const mix = reportDistantMix(distance, profile);
    const blended = mix > 0 && mix < 1;
    const chosen = mix === 1 ? bank.buffers[profile.distantSample] : buffers;
    assert(
      chosen.includes(sources[count].buffer),
      'primary bank follows transition; suppressed identity retained'
    );
    assert.equal(
      sources.length - count,
      blended ? 2 : 1,
      'two complete perspectives only inside handoff; no synthetic layer'
    );
    if (blended) {
      assert(bank.buffers[profile.distantSample].includes(sources[count + 1].buffer));
      const nearGain = sources[count].connections[0].gain.value;
      const farGain = sources[count + 1].connections[0].gain.value;
      assert(Math.abs(nearGain + farGain - 1) < 1e-12, 'convex source mix');
      const theta = (mix * Math.PI) / 2;
      const distanceGain = reportDistanceGain(distance, profile);
      assert(
        Math.abs(nearGain * distanceGain - reportDistanceGain(distance) * Math.cos(theta)) < 1e-12
      );
      assert(
        Math.abs(
          farGain * distanceGain -
            reportDistanceGain(distance) *
              Math.sin(theta) *
              REPORT_DISTANT_MATCH[profile.distantSample]
        ) < 1e-12
      );
    }
    assert.equal(voice.node.channelCount, 1, 'positional report explicitly downmixes');
    assert.equal(voice.send, 0, 'enemy report is also dry');
    for (const source of sources.slice(count)) {
      assert.deepEqual(
        source.starts,
        [[7]],
        'same shot time; no source offset, delay or shortened tail'
      );
      assert.equal(source.playbackRate.value, 1);
      assert(voice.end >= source.starts[0][0] + source.buffer.duration / source.playbackRate.value);
    }
  }
  const count = sources.length;
  audio._build('shot', 9, 70, { profile, firstPerson: true });
  assert(buffers.includes(sources[count].buffer), 'player always uses close stereo perspective');
  assert.equal(sources.length, count + 1);
  assert.equal(filters, 0, 'no authored-source repair EQ or bounce filters at any range');
  bank.dispose();
  assert.deepEqual(bank.buffers, {});
}
console.log(
  'Source-faithful gunshots: stereo, full tails, fixed rate/gain, distant mapping, budgets and cleanup'
);
