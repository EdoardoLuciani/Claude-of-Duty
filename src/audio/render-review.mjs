#!/usr/bin/env node
// Render the current checkout through the live shot builder, first-person routing and
// mixer. No game rendering or sound-device capture is needed.
// node src/audio/render-review.mjs --out=/tmp/pistol.wav [--weapon=pistol] [--fallback]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureViteServer, launchChromium, parseArgs, stopViteServer } from '../../tools/lib/browser-harness.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5214);
const out = resolve(args.out ?? '/tmp/pistol-review.wav');
const server = await ensureViteServer({ port });
let browser;
try {
  browser = await launchChromium({ headless: true });
  const page = await browser.newPage();
  await page.route('**/audio-review.html', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Audio review</title>',
  }));
  await page.goto(`http://127.0.0.1:${port}/audio-review.html`);
  const result = await page.evaluate(async ({ weapon, fallback }) => {
    const { AudioSystem } = await import('/src/audio/index.js');
    const { Mixer } = await import('/src/audio/mixer.js');
    const { NoiseBank } = await import('/src/audio/dsp.js');
    const { WeaponSampleBank } = await import('/src/audio/samples.js');
    const { WEAPON_PROFILES } = await import('/src/audio/weapons.js');
    const { Rng } = await import('/src/core/rng.js');
    const profile = WEAPON_PROFILES[weapon];
    if (!profile) throw new Error(`Unknown weapon: ${weapon}`);
    const ctx = new OfflineAudioContext(2, 48000 * 12, 48000);
    const audio = new AudioSystem();
    audio.actx = ctx;
    audio.bank = new NoiseBank(ctx, new Rng(0x320));
    audio.mixer = new Mixer(ctx, new Rng(0x321));
    audio.mixer.buildReverbs();
    audio.samples = new WeaponSampleBank(ctx);
    await audio.samples.load();
    if (profile.sample && !audio.samples.buffers[profile.sample]?.every(Boolean)) {
      throw new Error('Required firearm recordings did not load');
    }
    if (fallback) audio.samples.buffers = {};
    audio.running = true;
    // Outdoors 0–6 s, indoors 6–12 s. Each half: two isolated shots,
    // a double tap, then four shots at the pistol's 460 rpm cadence.
    const times = [.4, 1.9, 3.2, 3.4, 4.4, 4.4 + 60 / 460, 4.4 + 120 / 460, 4.4 + 180 / 460];
    for (let section = 0; section < 2; section++) {
      if (section) {
        for (const [name, space] of Object.entries(audio.mixer.spaces)) {
          if (!space.live) { audio.mixer.sendLP.connect(space.conv); space.live = true; }
          space.gain.gain.setValueAtTime(name === 'room' ? 1 : 0, 6);
        }
      }
      // These are the exact _onFire first-person send values for the default
      // outdoor blend and a fully enclosed room respectively.
      const echo = section ? .35 + .75 : .35 + .35 * .9;
      for (let i = 0; i < times.length; i++) {
        audio.rng = new Rng(0x320000 + section * 100 + i);
        const voice = audio._build('shot', section * 6 + times[i], 0, { profile, firstPerson: true });
        // Mirror _playDry routing; its running-context guard intentionally
        // rejects OfflineAudioContext while the graph is being scheduled.
        const dry = ctx.createGain(); dry.gain.value = profile.firstPersonGain ?? 1.18;
        voice.node.connect(dry); dry.connect(audio.mixer.bus('weapons'));
        const wet = ctx.createGain(); wet.gain.value = echo * .6 * (voice.send ?? 1);
        dry.connect(wet); wet.connect(audio.mixer.reverbSend);
      }
    }
    const buffer = await ctx.startRendering();
    let peak = 0, sum = 0, dc = 0;
    const channels = [];
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (const x of data) {
        if (!Number.isFinite(x)) throw new Error('Non-finite audio sample');
        peak = Math.max(peak, Math.abs(x)); sum += x * x; dc += x;
      }
      channels.push(Array.from(data));
    }
    return { channels, peak, rms: Math.sqrt(sum / (buffer.length * 2)),
      dc: dc / (buffer.length * 2), errors: audio.stats.errors };
  }, { weapon: args.weapon ?? 'pistol', fallback: !!args.fallback });
  assert.equal(result.errors, 0);
  assert(result.peak > .01 && result.peak < 1, `Invalid output peak: ${result.peak}`);
  assert(Math.abs(result.dc) < .005, `DC offset: ${result.dc}`);
  const frames = result.channels[0].length;
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < 2; ch++) wav.writeInt16LE(Math.round(result.channels[ch][i] * 32767), 44 + i * 4 + ch * 2);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, wav);
  console.log(JSON.stringify({ out, peakDBFS: 20 * Math.log10(result.peak),
    rmsDBFS: 20 * Math.log10(result.rms), dc: result.dc, errors: result.errors }));
} finally {
  await browser?.close();
  stopViteServer(server);
}
