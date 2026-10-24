# Recorded reloads — #337, first slice

## Coverage and event ownership

M4 and MCX share edited M16 donor recordings for magazine removal/seating and
forward closure. M4 also uses a separate rearward charging cue. P320 uses P99
magazine and slide-snap donors: its already-open slide receives only a forward
release, not a full rack. These are acoustic proxies, not recordings of the exact
in-game weapon models. Listening approval of donor character remains human-owned.

`weapon:reload` also carries manual-action audio. Its new phases are `charge`,
`boltopen` and `boltclose`; the existing `slide` remains the pistol release.
`src/weapons/index.ts` publishes directly from native clip events:

- `charge` emits rearward action only, and `boltrelease` emits forward closure.
- AX338 `bolt:open` / `bolt:close` emit separate cues during the post-shot cycle.
  Opening still owns the existing casing queue; sound never owns ammunition.
- M590 `pump` emits during reload **and** post-shot cycling. Only the post-shot
  case queues a spent casing. Its reload `boltrelease` does not add another close:
  the pump cue already includes forward return.
- `shellin` only emits if `_insertShell()` actually committed a shell.
- `end` is a quiet hand settle, never an invented charging-handle sequence. This
  also removes phantom racking at the end of tactical and per-shell reloads.

The new recordings replace mapped mechanical phases; no synthesized duplicate is
layered underneath them. Start/end hand rustle remains procedural. MPX, EVOLYS,
AX338 and M590 retain procedural handling in this first slice, now with corrected
mechanical event coverage. Their recorded banks remain follow-up work in #337.
EVOLYS is **not** assigned a detachable-rifle-magazine recording.

No clip durations, weapon definitions, ammo/chamber accounting, shot cadence or
shell-ejection times are changed. Cancelled clips cannot schedule future cues:
there is no full-reload audio track, timeout or deferred mechanical sequence.
Short tails from already-triggered contacts can finish naturally.

## Delivery, balance and lifecycle

Twenty mono 48 kHz Opus files occupy **64,741 bytes**, with **3.41 seconds** of
source duration / **654,720 bytes of decoded float PCM at 48 kHz**. Native decode
rates can change the PCM total. The shortest crops are 45 ms: M4's authored charge
and release beats are only 49.3 ms apart, so a full rearward/forward sample would
sound twice or overlap the following closure. All files remain below 0.5 decoded
sample peak, with approximately 8 dB or more source headroom before delivery-codec
overshoot. There is no codec header gain.

The bank preloads alongside other required recordings, taking the current total
from 50 to 70. Every fetch/decode settles before startup failure teardown. A missing
mapped recording rejects audio startup; it does not recover with synthesis.
Intentionally unmapped weapon/phase pairs retain synthesis, not a missing-asset
fallback. Disposal clears buffers and selection state. Playback does no asset I/O,
avoids immediately repeated takes and uses only ±3% gain variation, with original
pitch/rate retained for timing.

`src/audio/reloads.ts` owns the mapping and modest cue tuning. Existing foley bus
balance, gunfire ducking, compression, peak control and spatial routing remain.
The final `0.22` argument to `_playDry()` is **reverb send, not gain**; the initial
issue analysis was corrected accordingly. No master-gain or gunshot-asset changes
are included. Source peak measurements are not a listening verdict or a claim of
calibrated loudness. Check quiet reloads, post-shot actions and nearby gunfire in
the attached captures before final sound-quality acceptance.

## Source preparation and rights

Rebuild using FFmpeg/libopus and the owner's local library:

```sh
node tools/prepare-reload-audio.mjs /path/to/Music
```

The exact mono sources are under `BOOM Library - Gun Handling/`: M16 magazine
in/out and charging handle `01`, plus Walther P99 normal magazine in/out and slide
snap `01`. The script records source-relative paths/hashes, individual crop ranges,
filter/fade settings, energy/peak-limited level adjustments and delivery hashes in
`src/audio/samples/reloads/provenance.json`. It normalizes maximum 20 ms event
energy with a peak-headroom cap, not whole-reel RMS or full-scale normalization.
Two consecutive authoring runs produced identical provenance and delivery hashes.
Original source reels are not committed or uploaded.

The owner explicitly confirmed public redistribution clearance for the selected
edited #337 samples **and** mixed gameplay recordings in this implementation
session. This is owner attestation, not independent legal advice or transfer of
source-library copyright. Retain applicable licence/purchase records. These media
do not inherit the code licence; this permission does not alter separate legacy
firearm-sample restrictions.

## Validation and review

- `tests/smoke/smoke-audio-reloads.mjs` loads all seven real weapon GLBs and native
  event clips, runs the common weapon callbacks and audio consumer, and checks
  exact phase order/timing, retained magazines, ammo, cancellation and single
  correctly timed post-shot casings. It also checks delivery hashes/headers,
  bounded memory, variants, required playback and unchanged positioned routing.
- Existing asset/hit startup tests include the enlarged bank, including a missing
  reload file and all-settled failure/disposal. Their old fixed 50-file expectations
  were updated because this slice intentionally adds 20 required recordings.
- `tests/e2e/audio-reloads-e2e.mjs` exercises the actual live game audio graph and
  viewmodels on hardware WebGPU, using wall-clock animation stepping while unrelated
  gameplay is suspended. It covers six reloads, pump, bolt cycle, interruption and
  a reload under injected nearby gunfire. It does not simulate a whole AI battle.
- The e2e capture uses native final-output readback into a 2D recording canvas:
  direct WebGPU swapchain capture is black under headless Vulkan. Evidence includes
  rendered animation and post-mixer audio, not a standalone sound preview.

```sh
node tests/e2e/audio-reloads-e2e.mjs --out=/tmp/cod-337-after
node tests/e2e/audio-reloads-e2e.mjs \
  --root=/path/to/unchanged-baseline --before --port=5538 --out=/tmp/cod-337-before
```

Baseline and new captures passed on native AMD RDNA 4 WebGPU, with zero audio or
engine errors. Capture files stay outside the repository. Automated correctness,
format and signal checks do not establish subjective timbre/synchronization
approval: listen/watch the before/after evidence before accepting the sound design.
This slice advances #337; it does not close the issue.
