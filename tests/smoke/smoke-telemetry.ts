/**
 * Bun smoke test for telemetry archives — no browser.
 *
 *   bun test ./tests/smoke/smoke-telemetry.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Info from 'three/src/renderers/common/Info.js';
import WebGPUBackend from 'three/src/renderers/webgpu/WebGPUBackend.js';
import type { Renderer } from 'three/webgpu';

import { AiSystem } from '../../src/ai/index.ts';
import type { WorldPrefetch, WorldManifest } from '../../src/core/model-metadata.ts';
import { ModelSystem } from '../../src/core/models.ts';
import {
  TelemetrySystem,
  collectProvenance,
  hitchVerdict,
  packTgz,
} from '../../src/dev/telemetry.ts';
import { GameSystem } from '../../src/game/index.ts';
import { MarketSystem } from '../../src/market/index.ts';
import { HealController } from '../../src/player/heal.ts';
import { Health } from '../../src/player/health.ts';
import { PlayerSystem } from '../../src/player/index.ts';
import { Movement } from '../../src/player/movement.ts';
import type { RenderSystem } from '../../src/render/index-webgpu.ts';
import { WeaponSystem } from '../../src/weapons/index.ts';
import { createTestContext, createTestInput } from '../lib/context.ts';
import { fixture } from '../lib/fixture.ts';

function telemetryMeta(revision: string): NonNullable<TelemetrySystem['meta']> {
  return {
    schema: 3,
    startedAt: '',
    quality: 'high',
    deterministic: true,
    viewport: [],
    userAgent: '',
    playerHz: 0,
    enemyHz: 0,
    observers: null,
    path: '',
    transform: null,
    provenance: { revision, world: 'unknown' },
  };
}

let failures = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

// Provenance is the loaded world, not a newly deployed manifest. An older
// session's pending read must not overwrite a restarted recording either.
{
  let resolve: ((value: WorldPrefetch) => void) | undefined;
  const recorder = new TelemetrySystem();
  const meta = fixture<WorldManifest>({
    sourceHash: 'loaded-A',
    assets: { visual: 'visual-A', collision: 'collision-A', nav: 'nav-A' },
  });
  const models = new ModelSystem();
  models.worldPrefetch = new Promise((r): void => {
    resolve = r;
  });
  recorder.ctx = createTestContext({ providers: { models } });
  const first = (recorder.meta = telemetryMeta('code-A'));
  const fetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    (): never => {
      throw new Error('must not request deployment B');
    },
    { preconnect: fetch.preconnect }
  );
  try {
    recorder._fillWorldProvenance();
    recorder.meta = telemetryMeta('next-session');
    assert(resolve);
    resolve(fixture<WorldPrefetch & { then?: undefined }>({ meta }, ['then']));
    await recorder._provenanceReady;
    assert(typeof first.provenance.world === 'object');
    assert.equal(first.provenance.world.sourceHash, 'loaded-A');
    assert.equal(first.provenance.world.nav, 'nav-A');
    assert.equal(recorder.meta.provenance.world, 'unknown');
  } finally {
    globalThis.fetch = fetch;
  }
}

// Canonical healing events and live inventory/progress survive recording.
{
  const recorder = new TelemetrySystem();
  const input = createTestInput();
  input.action = (name): boolean => name === 'heal';
  const ctx = createTestContext({ input });
  const player = new PlayerSystem();
  player.ctx = ctx;
  player.movement = new Movement(ctx, player);
  player.health = new Health(ctx, null);
  player.health.value = 40;
  player.healCtrl = new HealController(player);
  player.healCtrl.bandages = 2;
  player.healCtrl.active = true;
  player.healCtrl.progress = 0.5;
  const ai = new AiSystem();
  ai.ctx = ctx;
  ai.getWaveState = (): ReturnType<AiSystem['getWaveState']> => ({
    number: 0,
    remaining: 0,
    total: 0,
    incoming: false,
    nextIn: 0,
  });
  recorder.ctx = createTestContext({
    input,
    providers: {
      player,
      weapons: new WeaponSystem(),
      ai,
      game: new GameSystem(),
      market: new MarketSystem(),
      render: fixture<RenderSystem>({
        renderer: fixture<Renderer>({ info: new Info(), backend: new WebGPUBackend() }),
      }),
    },
  });
  recorder.ctx.time.frame = 1;
  recorder.recording = true;
  recorder.events = [];
  recorder.playerSamples = [];
  recorder._move = { x: 0, y: 0 };
  recorder._contacts = new Map();
  recorder._samplePlayer();
  const sample = recorder.playerSamples[0];
  assert.deepEqual(sample.actions, ['heal']);
  assert.deepEqual([sample.bandages, sample.healing, sample.healProgress], [2, true, 0.5]);
  for (const phase of ['start', 'cancel', 'complete'] as const)
    recorder._recordEvent('player:heal', {
      phase,
      amount: phase === 'complete' ? 50 : 0,
      health: 40,
      bandages: 2,
      reason: phase,
    });
  assert.deepEqual(
    recorder.events.map((e): unknown => e.phase),
    ['start', 'cancel', 'complete']
  );
  assert.equal(recorder.events[2].amount, 50);
}

const json = new TextEncoder().encode(
  JSON.stringify({
    schema: 3,
    events: [{ t: 1, type: 'session:start' }],
    markers: [
      {
        t: 2,
        raw: 2,
        frame: 10,
        label: 'manual',
        note: 'enemy stuck behind crate',
        screenshot: 'marks/001.jpg',
        player: [1, 0, 2],
      },
    ],
    playerSamples: [],
    enemySamples: [],
  })
);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

// The adaptive hitch threshold. A machine slower than the 50 ms floor has to raise
// the bar instead of logging every frame — an earlier version fed the baseline
// only from frames under the threshold, so on a 10 fps machine it could never
// move and all 300 frames of a steady stream were logged.
const sim = (frames: number[]): { hitches: number[]; threshold: number } => {
  let ema = 16.7;
  let threshold = 0;
  const hitches: number[] = [];
  for (const ms of frames) {
    const verdict = hitchVerdict(ema, ms);
    ema = verdict.ema;
    threshold = verdict.threshold;
    if (verdict.hitch) hitches.push(ms);
  }
  return { hitches, threshold: Math.round(threshold) };
};
const steady = (ms: number, n: number): number[] => Array.from({ length: n }, (): number => ms);
check('60 fps logs only the freeze', sim([...steady(16.7, 300), 2000]).hitches.join() === '2000');
check(
  '10 fps stops logging its own frames',
  sim(steady(100, 300)).hitches.length === 4,
  String(sim(steady(100, 300)).hitches.length)
);
check('10 fps raises its own bar', sim(steady(100, 300)).threshold === 300);
check('10 fps still logs a freeze', sim([...steady(100, 300), 2000]).hitches.at(-1) === 2000);
check('19 fps no longer logs every frame', sim(steady(52.6, 300)).hitches.length === 1);
check('20 fps logs nothing', sim(steady(50, 300)).hitches.length === 0);

const tgz = await packTgz([
  { name: 'telemetry.json', data: json },
  { name: 'marks/001.jpg', data: jpeg },
]);
check('tgz is gzip', tgz[0] === 0x1f && tgz[1] === 0x8b);
// The archive must open with the system tar, which is what users extract it with.
const archiveDir = mkdtempSync(join(tmpdir(), 'cod-telemetry-'));
try {
  const archive = join(archiveDir, 'telemetry.tgz');
  writeFileSync(archive, tgz);
  const extract = (name: string): Buffer => spawnSync('tar', ['-xzOf', archive, name]).stdout;
  check('tgz roundtrip json', extract('telemetry.json').equals(Buffer.from(json)));
  check('tgz roundtrip jpeg', extract('marks/001.jpg').equals(Buffer.from(jpeg)));
} finally {
  rmSync(archiveDir, { recursive: true, force: true });
}

check(
  'missing provenance is unknown',
  collectProvenance().revision === 'unknown' && collectProvenance().world === 'unknown'
);
const missingSource = collectProvenance({ world: { visual: 'level-visual.abc.glb.gz' } }).world;
check(
  'missing world source hash is unknown',
  typeof missingSource === 'object' && missingSource.sourceHash === 'unknown'
);

if (failures) {
  console.error(`${failures} telemetry smoke checks failed`);
  process.exit(1);
}
console.log('telemetry smoke ok');
