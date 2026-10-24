#!/usr/bin/env node
/** Real weapon/radio/UI event ownership and sole acknowledgment. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  ensureViteServer,
  launchChromium,
  parseArgs,
  REPO_ROOT,
  stopViteServer,
} from '../../tools/lib/browser-harness.mjs';
import { waitForGame } from '../../tools/lib/native-render.mjs';
const args = parseArgs(),
  root = resolve(args.root ?? REPO_ROOT),
  port = Number(args.port ?? 5549);
const server = await ensureViteServer({ root, port });
assert(server);
let browser;
const errors = [];
try {
  browser = await launchChromium({
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=hero`);
  await waitForGame(page, { timeout: 180000 });
  const report = await page.evaluate(async () => {
    const engine = window.__ENGINE__,
      ctx = engine.ctx,
      audio = ctx.get('audio'),
      ai = ctx.get('ai'),
      weapons = ctx.get('weapons'),
      radio = ctx.get('radio');
    await weapons._restTask;
    for (const a of ai.agents) a.dispose();
    ai.agents.length = 0;
    ai.squads.length = 0;
    if (!(await audio.start())) throw Error('Audio failed');
    audio.ambience.dispose();
    audio.update(0, ctx);
    const events = [],
      play = audio.playUi.bind(audio);
    audio.playUi = (kind, level) => {
      events.push({ kind, level });
      return play(kind, level);
    };
    const records = [],
      method = audio.samples.radio;
    if (method)
      audio.samples.radio = function (kind, rng, o) {
        const result = method.call(this, kind, rng, o);
        records.push({ kind, end: result.end });
        return result;
      };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // Exercise actual producer methods, actual strike acceptance and the real UI subscriber.
    radio.clearStrike();
    weapons._stowRadio();
    weapons.carpetBombs = 2;
    events.length = 0;
    weapons._updateRadio({ actionPressed: (id) => id === 'radio' }, true);
    const opened = { equipped: weapons.radioEquipped, events: events.slice() };
    events.length = 0;
    weapons._selectRequest(1);
    const accepted = {
      charges: weapons.carpetBombs,
      equipped: weapons.radioEquipped,
      active: radio.active.length,
      events: events.slice(),
    };
    events.length = 0;
    weapons._updateRadio({ actionPressed: (id) => id === 'radio' }, true);
    events.length = 0;
    weapons._selectRequest(1);
    const refused = { charges: weapons.carpetBombs, events: events.slice() };
    events.length = 0;
    weapons._selectRequest(2);
    const locked = events.slice();
    events.length = 0;
    ctx.events.emit('intel:available', { count: 1 });
    const intel = events.slice();
    radio.clearStrike();
    weapons._stowRadio();
    await wait(1300);
    audio.update(0, ctx);
    return {
      records,
      opened,
      accepted,
      refused,
      locked,
      intel,
      audio: audio.report(),
      active: audio.field.emitters.filter((e) => !e.free).length,
      loops: audio._aircraft.size,
      engineError: engine.error ?? null,
    };
  });
  assert.equal(report.audio.errors, 0);
  assert.equal(report.engineError, null);
  assert.equal(report.active, 0);
  assert.equal(report.loops, 0);
  assert(report.opened.equipped);
  assert.deepEqual(
    report.opened.events.map((e) => e.kind),
    ['radio_open']
  );
  assert.equal(report.accepted.charges, 1);
  assert.equal(report.accepted.active, 1);
  assert.equal(report.accepted.equipped, false);
  assert.deepEqual(
    report.accepted.events.map((e) => e.kind),
    ['radio_strike']
  );
  assert.equal(report.refused.charges, 1);
  assert.deepEqual(
    report.refused.events.map((e) => e.kind),
    ['radio_denied']
  );
  assert.deepEqual(
    report.locked.map((e) => e.kind),
    ['radio_denied']
  );
  assert.deepEqual(
    report.intel.map((e) => e.kind),
    ['intel_call']
  );
  assert.equal(report.records.length, 4);
  assert.deepEqual(errors, []);
  console.log(
    'PASS radio equip/accept/refund/locked/intel producers, sole acknowledgment and finite cleanup',
    JSON.stringify({ ack: report.accepted.events, records: report.records.length })
  );
} finally {
  await browser?.close();
  stopViteServer(server);
}
