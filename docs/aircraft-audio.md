# Moving bomber audio — #474, first slice

#473's physical-foley work is accepted and merged. This slice fixes the bomber's
helicopter mismatch and moving-source/lifetime ownership. Enemy nonverbal
reactions and environmental/radio work remain subsequent #474 slices; spoken
callouts remain deferred in #497. Bomb/weapon/impact sounds, damage, strike
geometry, bomb physics, timing and charges are unchanged.

## Source and editing limitations

Two required mono 48 kHz Opus loops are edited from BOOM ONE 23.05 solo **Pilatus
PC-21 propeller-plane** passes. Despite the original filename containing “Jet”,
the embedded source description identifies a propeller aircraft. No mixed FA-18
escort or helicopter source is used. Different microphone versions of the same
pass are not claimed as independent variants.

These are **designed propeller-engine textures**, not verified steady RPM or a
scale-matched twin-engine bomber recording. Each edit uses a 0.9 s near-pass crop,
explicit stereo averaging, 90 Hz high-pass/8.5 kHz low-pass, pitch-preserving 4×
stretch and a 300 ms circular linear overlap. It does not play a complete stereo
flyby or add a second runtime Doppler model over a baked-in pass. Runtime panning
and distance create the approach/pass/retreat; small source pitch/envelope changes
and looping character still require listening acceptance.

`tools/prepare-aircraft-audio.mjs /path/to/Music` reproduces the two loops and
`src/audio/samples/aircraft/provenance.json`: exact source/crop/filter/stretch,
source/output SHA-256, downmix loss, gain, decoded duration/peak and boundary
measurements. A −20 dB RMS reference is limited by a −9 dB pre-codec sample-peak
cap; no full-scale normalization or runtime automatic level matching. Circular
editing joins adjacent original samples at the buffer wrap and crossfades the
original crop's tail/head internally. Decoded boundary checks are engineering
checks, **not a claim of an inaudible seam**.

The owner explicitly confirmed public redistribution clearance for edited #474
aircraft, nonverbal, environment and radio derivatives. This is an owner
attestation, not independent legal advice. Keep source purchase/entitlement and
licence records; these commercial-derived media retain their own terms rather
than the code licence. No source masters are included or uploaded to AI services;
unrelated legacy firearm restrictions remain separate. Mixed gameplay review
recordings have separate owner publication clearance.

## Ownership and lifecycle

- `WeaponSampleBank` decodes both new required recordings alongside existing
  assets, once at audio startup. There are now 175 required files. Selection starts
  seeded and alternates the two takes without immediate repeats; loops are not
  pitch-randomized. Missing/invalid files fail audio startup with no synthesis.
- `audio.startAircraft(position)` acquires one **tracked emitter from the existing
  spatial pool**, returning a handle or null while audio is unavailable/pool full.
  The handle owns its buffer source, fade gain and emitter; it supports `move`,
  `stop` (finite fade) and immediate `dispose`. Source end releases only its own
  emitter identity, never another sound reusing the slot.
- Each strike owns one handle. If gesture-started audio is still decoding, radio
  retries attachment at the plane's **current** pose. It never restarts at the
  midpoint. Position follows the aircraft with short smoothing; existing air
  absorption, occlusion, distance, reverb, ambience bus, concussion and ducking
  remain in use. Initial playback retains source-to-listener propagation delay.
  This does not implement fully retarded moving-source positions or new Doppler.
- The loop fades when the plane completes its pass, **independent of surviving
  bombs**. Bombs over unavailable ground can take longer to retire; they must not
  hold or reacquire an off-map engine. Existing bomb trajectory/cleanup logic
  remains unchanged. A second normal strike is still rejected while one is active.
- Zero simulation dt fades the engine to silence without restarting its source;
  UI-pause/market-open events also mute immediately. A moving simulation resumes
  it. The source phase may continue silently while paused. Restart/clear fades it
  out; terminal error and audio disposal stop/disconnect immediately, including
  sources already fading or scheduled but not yet audible.
- Tracked engines cannot be stolen by finite impacts/blasts. Their fade-out returns
  to the normal finite retirement path. No timers, per-frame fetch/decode, separate
  audio engine or new runtime dependency is introduced. `AIRCRAFT_MIX` owns fixed
  gain/send/fade/priority/position-smoothing references; gun and master gains stay
  unchanged. Helicopter ambience remains separate and unchanged in this slice.

## Validation and listening

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
node tests/e2e/audio-selftest-e2e.mjs
AUDIO_MIX_CASES=aircraft node tests/e2e/audio-mix-e2e.mjs
node tests/e2e/audio-aircraft-e2e.mjs --out=/tmp/aircraft-after
node tests/e2e/audio-aircraft-e2e.mjs --root=/path/to/pre-change --port=5543 --baseline --out=/tmp/aircraft-before
```

The smoke test checks committed hashes/mono headers, loop bounds/headroom, required
loading failure/all-settled teardown, selection, initial delay, pause/stop/disposal,
late callbacks after emitter reuse, and actual RadioSystem ownership. It exercises
late audio readiness, natural completion, lingering bombs, restart and disposal
without changing strike logic or inventing a second explosion path.

The native audio suite adds both loop variants, a room pass and cancellation before
arrival. It retains all prior gates and introduces a distinct aircraft hierarchy
reference, not a relaxed existing threshold. The developer self-test includes a
finite recorded source audition; native bomber tests own continuous-loop playback
and lifetime coverage. #501's pre-existing 96 kHz spatial-mix investigation remains
separate; no rate-specific mixer patch is hidden here.

The actual WebGPU integration/capture runs two 18 s scenes through the **actual
master graph**, without source/bus/master overrides or post-normalization:

1. **Engine-only**: actual bomber path with bomb drops suppressed as an explicit
   listening fixture. Includes a half-second pause/resume at 3–3.5 s.
2. **Full strike**: normal bombs, explosions, concussion and ducking. High finite
   player HP prevents death from ending the fixture; AI is cleared and random
   ambience scheduling stopped to focus this comparison.

Both versions resolve 45 full-strike explosions in the current fixed scene. The
old path requests two static helicopter sounds; the new path starts/stops one
moving loop, with hundreds of pose updates, and no tracked engine remains at
scene end. Additional checks cover restart, source retirement before the next
strike, and immediate audio disposal. Reports, original WebM audio and ordinary
MP3s stay outside the repo. Video wrappers use labelled static native snapshots,
not full-motion gameplay; image staging is separate from the continuous capture.

Before/after use the same fixture and camera; real-time frame scheduling and
concussion/FX can still differ. Metadata, positional traces and meter bounds do
not establish sonic quality. Please judge propeller/bomber character, looping,
approach/pass/retreat, pause transitions, and whether the engine sits naturally
against the blasts. No perception/realism approval is claimed before listening.
