/** Real collision/aim/input probe for all 14 sites. Optional SHOT_DIR writes review PNGs. */
import assert from 'node:assert/strict';
import { verifyNative, captureNative } from '../../tools/lib/native-render.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureViteServer, launchChromium, stopViteServer } from '../../tools/lib/browser-harness.mjs';

const port = Number(process.env.PORT ?? 8096);
const server = await ensureViteServer({ port });
const browser = await launchChromium({ webgpu: true, headless: true, args: [ '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const pump = (n) => page.evaluate((frames) => window.__PUMP__(frames), n);
const state = () => page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const intel = ctx.get('intel');
  return { hold: intel._hold, secured: intel.secured, credits: ctx.get('market').credits,
    prompt: ctx.get('ui').prompt.active, alive: intel._alive.length, card: intel.getHudState().card,
    open: intel._alive[0]?.open ?? 0, alarm: ctx.get('audio')._intelOperating,
    alarmVoice: !!ctx.get('audio')._intelAlarm, inspecting: ctx.get('weapons').inspecting,
    sparks: window.__INTEL_SPARKS__ ?? 0 };
});
const shot = async (name) => {
  if (!process.env.SHOT_DIR) return;
  mkdirSync(process.env.SHOT_DIR, { recursive: true });
  await captureNative(page, `${process.env.SHOT_DIR}/${name}.png`);
};
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1`, { timeout: 120000 });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
  await verifyNative(page);
  const boot = await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.events.emit('wave:complete', { wave: 1, nextWave: 2, delay: 20 });
    const intel = e.ctx.get('intel');
    return { budget: intel.budget, alive: intel._alive.length, prewarm: window.__PREWARM__.hooks.intel };
  });
  assert.equal(boot.budget, 0);
  assert.equal(boot.alive, 0);
  assert.equal(boot.prewarm.ok, true);
  // Reset away the artificial shop deadline, then opt in to live player controls.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.events.emit('game:restart', { source: 'test' });
    ctx.input.frozen = false;
    ctx.input.enabled = true;
    ctx.get('player').setControlEnabled(true);
    ctx.config.deterministic = false;
    ctx.get('intel').reset();
    ctx.config.deterministic = true; // keep the wave director out of this fixture
  });
  const sites = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const physics = ctx.get('physics');
    const intel = ctx.get('intel');
    return intel.markers.map((m) => {
      const floor = physics.groundHeight(m.x, m.z, m.y + 0.6);
      const body = physics.overlapSphere({ x: m.x, y: m.y + 0.27, z: m.z }, 0.2);
      const approaches = [];
      for (let i = 0; i < 8; i++) {
        const x = m.x + Math.sin(i * Math.PI / 4) * 1.2;
        const z = m.z + Math.cos(i * Math.PI / 4) * 1.2;
        const y = physics.groundHeight(x, z, m.y + 0.5);
        if (Math.abs(y - m.y) > 0.2) continue;
        const clear = physics.checkCapsule({ x, y: y + 0.34, z }, { x, y: y + 1.45, z }, 0.32);
        const los = physics.lineOfSight({ x, y: y + 1.65, z }, { x: m.x, y: m.y + 0.35, z: m.z });
        if (clear && los) approaches.push({ x, y, z });
      }
      return { id: m.id, floorDelta: floor - m.y, body, approach: approaches[0] };
    });
  });
  assert.equal(sites.length, 14);
  for (const site of sites) {
    assert(Math.abs(site.floorDelta) < 0.02, `${site.id}: supported by authored floor`);
    assert.equal(site.body, 0, `${site.id}: case intersects world geometry`);
    assert(site.approach, `${site.id}: needs a standing LOS approach`);
  }
  // A real keyboard gesture unlocks Web Audio; verify the live alarm graph too.
  await page.keyboard.press('F');
  assert(await page.evaluate(() => window.__ENGINE__.ctx.get('audio').start()));
  // Match the baseline review pose (the first site's south-side approach).
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const intel = ctx.get('intel');
    const m = intel.markers.find((m) => m.id === 'w5-living');
    ctx.get('player').teleport(ctx.camera.position.clone().set(m.x, m.y + 1.65, m.z + 1.2), { x: -0.75, y: 0, z: 0 });
  });
  await pump(30);
  const programsBefore = await page.evaluate(() => {
    return window.__NATIVE_BUILDS__;
  });
  await page.evaluate(() => {
    const intel = window.__ENGINE__.ctx.get('intel');
    intel._spawn(intel.markers.find((m) => m.id === 'w5-living'));
  });
  await pump(30);
  assert((await state()).prompt);
  const programsAfter = await page.evaluate(() => {
    return { count: window.__NATIVE_BUILDS__ };
  });
  assert.equal(programsAfter.count, programsBefore, `first cache must not compile shaders during play: ${JSON.stringify(programsAfter.added)}`);
  assert.match(await page.locator('body').textContent(), /Hold 4s · \+500 credits/i);
  await shot('cache');
  // Offscreen native screenshot output changes fullscreen render contexts;
  // restore the normal graph before measuring gameplay's opening transition.
  await pump(1);
  const openingBuilds = await page.evaluate(() => window.__NATIVE_BUILDS__);
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    window.__INTEL_SPARKS__ = 0;
    ctx.events.on('intel:spark', () => window.__INTEL_SPARKS__++);
    ctx.input.down.add('KeyF');
  });
  await pump(60);
  let s = await state();
  assert(s.hold > 0.9 && s.hold < 1.1, JSON.stringify(s));
  assert.equal(s.open, 1, 'lid opens to expose electronics');
  assert.equal(s.alarm, true, 'siren is continuously active while holding');
  assert.equal(s.alarmVoice, true, 'live audio graph owns a running siren voice');
  assert(s.sparks > 0, 'electronics emit sparks');
  assert.equal(await page.evaluate(() => window.__NATIVE_BUILDS__),
    openingBuilds, `opening and sparks must not compile shaders: ${JSON.stringify(await page.evaluate(n => window.__NATIVE_BUILD_INFO__.slice(n), openingBuilds))}`);
  await shot('holding');
  await page.evaluate(() => window.__ENGINE__.input.down.delete('KeyF'));
  await pump(20);
  s = await state();
  assert.equal(s.open, 0, 'release closes lid');
  assert.equal(s.alarm, false, 'release stops siren');
  assert.equal(s.alarmVoice, false, 'release tears down the live siren voice');
  const releasedSparks = s.sparks;
  await pump(12);
  assert.equal((await state()).sparks, releasedSparks, 'release stops new sparks');
  await shot('released');
  await page.evaluate(() => window.__ENGINE__.input.down.add('KeyF'));
  await pump(30);
  await page.evaluate(() => {
    window.__ENGINE__.events.emit('damage:taken', { amount: 0, armourAbsorbed: 12 });
  });
  assert.equal((await state()).hold, 0);
  await pump(30);
  await page.evaluate(() => window.__ENGINE__.ctx.get('player').movement.pitch = 0.4);
  await pump(2);
  assert.equal((await state()).hold, 0, 'turning away wipes hold');
  await page.evaluate(() => window.__ENGINE__.ctx.get('player').movement.pitch = -0.75);
  await pump(30);
  await page.evaluate(() => window.__ENGINE__.ctx.get('market').openShop(1));
  await pump(60);
  s = await state();
  assert.equal(s.hold, 0, 'opening shop during hold wipes progress');
  assert.equal(s.secured, 0, 'shop freezes securing');
  assert.equal(s.open, 0, 'shop closes lid');
  assert.equal(s.alarm, false, 'shop stops siren');
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.get('market').closeShop();
    ctx.input.frozen = false;
    ctx.input.enabled = true;
    ctx.get('player').setControlEnabled(true);
    ctx.input.down.clear();
  });
  await pump(2);
  // Actual I-key inspection must interrupt an existing hold, including the live voice.
  await page.evaluate(() => window.__ENGINE__.input.down.add('KeyF'));
  await pump(60);
  assert((await state()).hold > 0.9);
  await page.keyboard.down('i');
  await pump(1);
  await page.keyboard.up('i');
  s = await state();
  assert.equal(s.inspecting, true);
  assert.equal(s.hold, 0, 'inspection immediately resets progress');
  assert.equal(s.alarm, false, 'inspection stops the siren');
  assert.equal(s.alarmVoice, false, 'inspection tears down the live siren voice');
  const inspectionSparks = s.sparks;
  await pump(60);
  s = await state();
  assert.equal(s.inspecting, true);
  assert.equal(s.hold, 0, 'hands stay busy during inspection');
  assert.equal(s.open, 0, 'inspection closes the lid');
  assert.equal(s.sparks, inspectionSparks, 'inspection stops new sparks');
  await shot('inspection');
  await pump(125);
  s = await state();
  assert.equal(s.secured, 0, 'the interrupted four-second hold cannot pay out');
  assert.equal(s.credits, 0);
  await page.evaluate(() => {
    window.__ENGINE__.input.down.clear();
    window.__ENGINE__.ctx.get('weapons').viewmodel.stopClip();
  });
  await pump(2);
  // A dropped ammo case must not steal F or collect while securing intel.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const weapons = ctx.get('weapons');
    weapons.state.reserve = 0;
    weapons.pickups.spawn(ctx.get('player').feetPosition);
    ctx.input.down.add('KeyF');
  });
  await pump(239);
  s = await state();
  assert.equal(s.secured, 0, 'cache must not complete before four seconds');
  assert.equal(s.credits, 0, 'no early payout');
  assert(s.hold > 3.9 && s.hold < 4, JSON.stringify(s));
  await pump(3);
  s = await state();
  assert.equal(s.secured, 1, JSON.stringify(s));
  assert.equal(s.credits, 500, 'cache payout is separate from score');
  assert.equal(s.alive, 0);
  assert(s.card);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').state.reserve), 0);
  await shot('secured');
  await pump(40);
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('weapons').state.reserve), 0, 'held F cannot leak after completion');
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    ctx.input.down.clear();
    ctx.get('weapons').pickups.clear();
    ctx.get('weapons').refillAmmo();
  });
  // Open every authored point through the live controller and real physics, not a mock LOS.
  const results = [];
  for (const site of sites) {
    await page.evaluate(({ id, approach }) => {
      const ctx = window.__ENGINE__.ctx;
      const intel = ctx.get('intel');
      intel.reset();
      const m = intel.markers.find((m) => m.id === id);
      intel._spawn(m);
      const eye = ctx.camera.position.clone().set(approach.x, approach.y + 1.65, approach.z);
      const dx = m.x - eye.x, dz = m.z - eye.z, dy = m.y + 0.35 - eye.y;
      ctx.get('player').teleport(eye, { x: Math.atan2(dy, Math.hypot(dx, dz)), y: Math.atan2(-dx, -dz), z: 0 });
      ctx.input.down.clear();
    }, site);
    await pump(8);
    assert((await state()).prompt, `${site.id}: visible interaction prompt`);
    await page.evaluate(() => window.__ENGINE__.input.down.add('KeyF'));
    await pump(242);
    const result = await state();
    assert.equal(result.secured, 1, `${site.id}: ${JSON.stringify(result)}`);
    results.push(site.id);
  }
  // Passive discovery remains audible while aiming/firing, without opening or AI noise.
  await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx, audio = ctx.get('audio'), play = audio.play;
    window.__DISCOVERY__ = { pings: 0, announcements: 0, noise: 0 };
    const offAvailable = ctx.events.on('intel:available', () => window.__DISCOVERY__.announcements++);
    const offNoise = ctx.events.on('intel:noise', () => window.__DISCOVERY__.noise++);
    audio.play = function(kind, ...args) {
      if (kind === 'intel_beep') window.__DISCOVERY__.pings++;
      return play.call(this, kind, ...args);
    };
    window.__DISCOVERY_CLEANUP__ = () => { offAvailable(); offNoise(); audio.play = play; };
  });
  const discovery = [];
  for (const input of ['idle', 'ADS', 'fire']) {
    await page.evaluate((input) => {
      const ctx = window.__ENGINE__.ctx, intel = ctx.get('intel');
      ctx.input.down.clear();
      ctx.get('weapons').viewmodel.stopClip();
      intel.reset();
      const m = intel.markers.find((m) => m.id === 'w5-living');
      intel._spawn(m);
      ctx.get('player').teleport(ctx.camera.position.clone().set(m.x, m.y + 1.65, m.z + 1.2), { x: -0.75, y: 0, z: 0 });
      window.__DISCOVERY__ = { pings: 0, announcements: 0, noise: 0 };
      if (input === 'ADS') ctx.input.down.add('Mouse2');
      if (input === 'fire') ctx.input.down.add('Mouse0');
    }, input);
    await pump(180);
    const counts = await page.evaluate(() => window.__DISCOVERY__);
    assert.deepEqual(counts, { pings: 9, announcements: 1, noise: 0 }, input);
    assert.equal((await state()).hold, 0, input);
    assert.equal((await state()).alarm, false, input);
    discovery.push({ input, ...counts });
  }
  await page.evaluate(() => window.__DISCOVERY_CLEANUP__());
  await page.evaluate(() => window.__ENGINE__.events.emit('game:restart', { source: 'test' }));
  s = await state();
  assert.equal(s.secured, 0);
  assert.equal(s.credits, 0);
  assert.equal(s.alive, 0);
  assert.equal(s.card, '');
  assert.equal(await page.evaluate(() => window.__ENGINE__.ctx.get('ui').banner.t), 1, 'restart clears stale cache banners');
  // Exercise selection through real wave events using the exported world markers.
  const placements = await page.evaluate(() => {
    const ctx = window.__ENGINE__.ctx;
    const intel = ctx.get('intel');
    const player = ctx.get('player');
    const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const results = [];
    ctx.config.deterministic = false;
    try {
      intel.reset();
      for (let wave = 1; wave <= 2; wave++) {
        const candidates = intel.markers.filter((m) => !intel._used.has(m.id) &&
          distance(m, player.feetPosition) >= 18 && intel._alive.every((c) => distance(m, c) >= 24));
        ctx.events.emit('wave:complete', { wave, nextWave: wave + 1, delay: 20 });
        const cache = intel._alive[wave - 1];
        results.push({ wave, candidateCount: candidates.length, selected: cache?.id,
          valid: candidates.some((m) => m.id === cache?.id) });
      }
      ctx.events.emit('wave:complete', { wave: 3, nextWave: 4, delay: 20 });
      results.push({ liveCount: intel._alive.length });
    } finally {
      ctx.config.deterministic = true;
      ctx.events.emit('game:restart', { source: 'test' });
    }
    return results;
  });
  for (const placement of placements.slice(0, 2)) {
    assert(placement.candidateCount > 0 && placement.valid, JSON.stringify(placement));
  }
  assert.equal(placements[2].liveCount, 2);
  const audio = await page.evaluate(async () => {
    const { uiSound, intelSiren } = await import('/src/audio/foley.js');
    const { Mixer } = await import('/src/audio/mixer.js');
    const { NoiseBank } = await import('/src/audio/dsp.js');
    const { Rng } = await import('/src/core/rng.ts');
    const results = [];
    for (const kind of ['intel_beep', 'intel_siren', 'intel_call']) {
      const actx = new OfflineAudioContext(1, 48000, 48000);
      const rng = new Rng(132);
      const bank = new NoiseBank(actx, rng.fork(), 1.2);
      const mixer = new Mixer(actx, rng.fork());
      if (kind === 'intel_siren') {
        const siren = intelSiren(actx);
        siren.node.connect(mixer.bus('ui'));
        siren.stop(0.85); // interrupt an audible pulse, not a silent gap
        siren.stop(0.9); // repeated cleanup is harmless
      } else uiSound(actx, bank, rng, kind, { when: 0.01 }).node.connect(mixer.bus('ui'));
      const buffer = await actx.startRendering();
      let peak = 0, sum = 0, nan = 0, tail = 0;
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const sample = data[i];
        if (i > 0.9 * 48000) tail = Math.max(tail, Math.abs(sample));
        if (!Number.isFinite(sample)) nan++;
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
      }
      results.push({ kind, peak, rms: Math.sqrt(sum / buffer.length), nan, tail });
      mixer.dispose();
    }
    return results;
  });
  for (const sound of audio) {
    assert.equal(sound.nan, 0, sound.kind);
    assert(sound.peak > 0.01 && sound.peak < 1, JSON.stringify(sound));
    assert(sound.rms > 0.001, JSON.stringify(sound));
  }
  const siren = audio.find((s) => s.kind === 'intel_siren');
  assert(siren.rms > 0.15 && siren.rms > audio[0].rms * 4, `siren must dominate the detector: ${JSON.stringify(audio)}`);
  assert(siren.tail < 0.0001, `siren must stop promptly: ${JSON.stringify(siren)}`);
  // Render the full four-second cue through the game mixer, also as an optional PR preview.
  const alert = await page.evaluate(async (exportSamples) => {
    const { intelSiren } = await import('/src/audio/foley.js');
    const { Mixer } = await import('/src/audio/mixer.js');
    const { Rng } = await import('/src/core/rng.ts');
    const actx = new OfflineAudioContext(1, 4.25 * 48000, 48000);
    const mixer = new Mixer(actx, new Rng(132));
    const voice = intelSiren(actx);
    voice.node.connect(mixer.bus('ui'));
    voice.stop(4);
    const buffer = await actx.startRendering();
    const data = buffer.getChannelData(0);
    const rms = (a, b) => {
      let sum = 0;
      const start = Math.round(a * 48000), end = Math.round(b * 48000);
      for (let i = start; i < end; i++) sum += data[i] * data[i];
      return Math.sqrt(sum / (end - start));
    };
    const amplitude = (hz) => {
      let re = 0, im = 0;
      for (let i = 4800; i < 14400; i++) {
        const phase = 2 * Math.PI * hz * i / 48000;
        re += data[i] * Math.cos(phase); im += data[i] * Math.sin(phase);
      }
      return Math.hypot(re, im) * 2 / 9600;
    };
    let peak = 0, nan = 0;
    for (const sample of data) {
      peak = Math.max(peak, Math.abs(sample));
      if (!Number.isFinite(sample)) nan++;
    }
    const result = {
      peak, nan, rms: rms(0, 4), tail: rms(4.1, 4.25),
      pulses: [[0.1, 0.3], [0.8, 1], [1.6, 1.8], [2.3, 2.5], [3.1, 3.3], [3.8, 3.95]].map(([a, b]) => rms(a, b)),
      gaps: [[0.55, 0.65], [1.25, 1.4], [2.05, 2.15], [2.75, 2.9], [3.55, 3.65]].map(([a, b]) => rms(a, b)),
      tones: [740, 880].map(amplitude), weaTones: [853, 960].map(amplitude),
      pcm: exportSamples ? Array.from(data) : null,
    };
    mixer.dispose();
    return result;
  }, !!process.env.AUDIO_PREVIEW);
  assert.equal(alert.nan, 0);
  assert(alert.peak > 0.5 && alert.peak < 1 && alert.rms > 0.15, JSON.stringify({ ...alert, pcm: null }));
  assert(alert.pulses.every((rms) => rms > 0.2), 'all six alert pulses must sound during a claim');
  assert(alert.gaps.every((rms) => rms < 0.0001), 'double-pulse rhythm has real silent gaps');
  assert(alert.tail < 0.0001, 'completion stops the loop');
  assert(Math.min(...alert.tones) > Math.max(...alert.weaTones) * 8, 'fictional pitches, not the real WEA signal');
  if (process.env.AUDIO_PREVIEW) {
    // Mono PCM16 WAV, no normalization: this is the actual tested mixer output.
    const wav = Buffer.alloc(44 + alert.pcm.length * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < alert.pcm.length; i++) wav.writeInt16LE(Math.round(alert.pcm[i] * 32767), 44 + i * 2);
    mkdirSync(dirname(process.env.AUDIO_PREVIEW), { recursive: true });
    writeFileSync(process.env.AUDIO_PREVIEW, wav);
  }
  delete alert.pcm;
  // Real non-capture boots must load the history written by the previous game.
  const freshBoots = [];
  for (let game = 0; game < 3; game++) {
    await page.goto(`http://127.0.0.1:${port}/`, { timeout: 120000 });
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 120000 });
    await verifyNative(page);
    const drop = await page.evaluate(() => {
      const engine = window.__ENGINE__;
      engine.stop();
      const ctx = engine.ctx;
      const intel = ctx.get('intel');
      ctx.get('player').respawn(0);
      // Force the same selection stream to prove history, not a lucky new seed, varies it.
      intel.rng.seed(132);
      const before = intel._recent.slice();
      const feet = ctx.get('player').feetPosition;
      const fresh = intel.markers.filter((m) => !before.includes(m.id) && Math.hypot(m.x - feet.x, m.z - feet.z) >= 18);
      ctx.events.emit('wave:complete', { wave: 1, nextWave: 2, delay: 20 });
      return { selected: intel._alive[0]?.id, before, fresh: fresh.length,
        persisted: JSON.parse(localStorage.getItem('ow:intel-sites:v1')) };
    });
    assert(drop.selected && drop.fresh > 0 && !drop.before.includes(drop.selected), JSON.stringify(drop));
    assert(drop.persisted.includes(drop.selected));
    if (freshBoots.length) assert(drop.before.includes(freshBoots.at(-1)));
    freshBoots.push(drop.selected);
  }
  assert.equal(new Set(freshBoots).size, 3, 'three fresh games must not repeat the same eligible drop');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, audio, alert, discovery, freshBoots, sites: results, checks: ['deterministic', 'prewarm (zero first-spawn compiles)', 'aim', 'plate hit', 'shop pause', 'inspection cancellation', 'passive discovery during ADS/fire', 'F ownership', 'four-second claim', 'credits', 'restart', 'wave-event spawn spacing', 'fresh-boot history', 'lid open/close', 'sparks', 'looped phone-style alert/stop', 'offline audio synthesis/cadence/pitches'] }, null, 2));
} catch (error) {
  console.error('browser errors:', errors);
  console.error(await page.evaluate(() => ({ ready: window.__READY__, engineError: window.__ENGINE__?.error, text: document.body.innerText.slice(-1500) })).catch(() => null));
  throw error;
} finally {
  await browser.close();
  stopViteServer(server);
}
