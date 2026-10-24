# Recorded weapon handling — #337

## Coverage: recordings only

All seven player weapons now use recorded cues for their published reload/manual
mechanical beats, including recorded start/end gear rustle. The old `reloadPhase()`
oscillator/noise generator is removed; neither unsupported cues nor missing files
fall back to synthesis. This is the reload/pump/bolt path, not a redesign of
unrelated movement, voices, UI cues, dry fire or gunshots.

| Weapon    | Recorded donors                                                                            |
| --------- | ------------------------------------------------------------------------------------------ |
| M4 / MCX  | M16 magazine removal/seating and charging-handle contacts.                                 |
| P320      | P99 normal magazine handling and isolated forward slide snap.                              |
| MPX       | MP5 magazine detach/attach and cocking-handle release; no added HK slap.                   |
| AX338     | Remington 700 bolt action; G36 detachable-magazine handling as a proxy.                    |
| M590      | Pumpgun fore-end cocking takes; Remington 870 shell-loading contacts.                      |
| EVOLYS    | Tactical-bag take/stow, recorded ammo-box latch and vest belt clip; M16 charging contacts. |
| Start/end | Quiet tactical-vest handling crops, shared across weapons.                                 |

These are acoustic donors, not exact-model recordings. The owner explicitly
approved recorded pouch/latch/charging donors for EVOLYS after a library search
found no dedicated belt-fed reload recording. Its pouch-out/in sounds are offline
composites of **recorded layers only**, not a rifle-magazine substitute or generated
metallic texture. Subsequent owner listening feedback rejected this bag-heavy
proxy; its replacement is pending a suitable belt-fed source bank. The shotgun
correction leaves all LMG files untouched. No hidden synthesized layer is used.

The first implementation's 20 M4/MCX/P320 delivery files are byte-for-byte
unchanged. The additional 43 clips cover the remaining weapons and shared rustle.

## Native event ownership and timing

`weapon:reload` also carries post-shot manual-action audio. The common weapon
system publishes directly from native clip events, with no full-reload audio
track, timeouts or future mechanical-action scheduling:

- M4/EVOLYS/AX338 empty reloads emit rearward `charge` then forward `boltclose`.
  P320 uses `slide` for its already-open slide; no fictitious full rack is added.
- AX338 post-shot `bolt:open` / `bolt:close` emit separate recorded movements.
  Opening still owns its one existing casing queue. Sound never owns ammunition.
- M590 post-shot `pump` emits one rear contact at 0.144 s and still queues its
  one spent casing. A separate authored `boltrelease` at the actual forward stop,
  0.369 s, emits the closing contact. Empty reloads open at 0.209 s (`boltopen`)
  before shell insertion and close at 0.893 s (`boltclose`), not as a bunched pair
  at the return onset. Each recording contains only one contact; cancellation
  cannot leave a forward clack scheduled inside a full-cycle file. Neither reload
  contact invents a spent casing.
- `shellin` emits only when `_insertShell()` committed one shell.
- `end` selects quiet recorded gear handling, never another charging action.
  Retained P320/MPX magazines have no synthesized ground-impact add-on.

No clip durations, balance definitions, ammo/chamber accounting, shot cadence or
shell-ejection times are changed. Cancelling a clip prevents its future cues;
short natural tails from already-triggered contacts may finish.

## Delivery, balance and lifecycle

The full bank contains **63 mono 48 kHz Opus files**, **218,550 delivery bytes** and
**12.18 seconds / 2,338,560 bytes of decoded float PCM at 48 kHz**. Native decode
rates can change the PCM total. Files are single-action crops (maximum 0.52 s),
not entire multi-take reels. Short rearward contacts fit the existing close beats
without pitch-shifting, time-stretching or moving gameplay milestones.

The sample bank preloads/caches these alongside the 173 firearm/hit/physical-foley
and aircraft recordings. At #504 that cache contained 238 files; later categories add recordings. Every fetch/decode settles before startup failure teardown.
Missing recordings reject startup; an unsupported weapon/phase combination produces an
explicit diagnostic, not a generic or synthetic substitute. Disposal clears the
buffers and selection state. Playback has no asset I/O, avoids immediately
repeated takes and uses only ±3% gain variation, retaining original playback rate.

`src/audio/reloads.ts` owns the explicit mapping and cue tuning. Existing foley
balance, gunfire ducking, compression, peak control and spatial routing remain.
The `0.22` argument to `_playDry()` is reverb send, not gain. Master gain and
gunshot assets are unchanged. All delivery assets have decoded sample peaks below
0.5 and zero codec header gain. The offline mixer probe also verifies audible,
finite, non-clipping output; these checks are not perceptual sound-design approval.

## Sources, preparation and rights

```sh
node tools/prepare-reload-audio.mjs /path/to/Music
```

Sources come from `BOOM Library - Gun Handling/`, BOOM ONE 24.02 gun mechanisms,
24.03 tactical bags, and the 23.12 ammo-box latch. Embedded source descriptions
confirm that `Pumpgun Reload` is fore-end cocking, while the Remington 870 loading
source is separate. `samples/reloads/provenance.json` records each layer's exact
source-relative path/hash, embedded description, channel count, crop, level and
stereo-to-mono energy loss, plus processing and delivery hashes. Original reels
are never committed or uploaded.

Stereo donors are explicitly averaged, not equal-power boosted. The tool rejects
crops with more than 6 dB cancellation loss; the selected stereo crops' maximum
loss is **1.14 dB**. Short edge fades, modest filtering and maximum 20 ms event
energy matching retain at least 8 dB master peak headroom before codec overshoot.
Gear rustle has a quieter -29 dB target than mechanical contacts (-19 dB); no
whole-reel RMS/full-scale normalization or synthesized sweeteners are used.
Repeated authoring runs produce identical provenance and delivery hashes.

The eight pump contact edits also record the maximum 20 ms RMS peak offset in the
**decoded** delivery. They must peak within 20 ms of their authored stop cue, not
65–288 ms inside a whole-cycle recording. The smoke check binds this metric to the
Opus hash; the browser fixture independently decodes/measures the actual buffers.
Frame quantization and mixer latency remain additional to this source offset.

The owner confirmed public redistribution clearance for selected edited #337
samples and mixed gameplay recordings, and separately approved EVOLYS's recorded
donors in the implementation conversation. This is owner attestation, not
independent legal advice or transfer of source copyright. Retain applicable
licence/purchase records. Media do not inherit the code licence; this permission
does not alter separate restrictions on legacy firearm samples.

## Validation and review

- `tests/smoke/smoke-audio-reloads.mjs` loads all seven real GLBs/native clips and
  runs clip → common callbacks → audio consumer, requiring a recording for every
  actual beat. It checks phase order/timing, retained magazines, ammo, cancellation,
  committed shell insertion, casing counts/times, delivery hashes/headers, stereo
  loss, bounded memory, variants, pump transient offsets and positioned routing.
  Missing/unknown cues must fail explicitly, never use synthesis.
- Existing startup/contact tests account for all required recordings and
  retain all-settled failure/disposal coverage. The native mix fixture now caches
  the loaded reload bank alongside its other recordings; omitting it caused a
  legitimate required-recording error, not a reason to restore synthesis. No tests
  are weakened to permit missing assets or synthetic recovery.
- `src/audio/selftest.ts` exercises all 22 recorded handling families through the
  real offline mixer, rather than continuing to test the deleted synthesizer.
- `tests/e2e/audio-reloads-e2e.mjs` covers tactical/empty reloads for all seven
  weapons, post-shot pump/bolt, interrupted pumping and reload under injected nearby
  gunfire. `--weapon=shotgun` limits capture to the four shotgun scenarios. Every
  handling event must reach the recorded bank. Normal weapon pose/ammo and transient FX updates continue while unrelated gameplay is suspended;
  this is a controlled live-game fixture, not a whole AI battle.
- Capture uses native final-output readback into a 2D recording canvas, since
  direct WebGPU swapchain capture is black under headless Vulkan. Video contains
  rendered viewmodels and live post-mixer audio, not standalone library uploads.

```sh
node tests/e2e/audio-reloads-e2e.mjs --weapon=shotgun --out=/tmp/cod-337-pump-after
node tests/e2e/audio-reloads-e2e.mjs --weapon=shotgun \
  --root=/path/to/65b2917-baseline --before --port=5538 --out=/tmp/cod-337-pump-before
node src/audio/probe.mjs --port=5540 --live=0
AUDIO_MIX_CASES=reload PORT=5542 node tests/e2e/audio-mix-e2e.mjs
```

The native AMD RDNA 4 WebGPU fixture includes 19 cases, with a four-case focused
shotgun before/after capture against `65b2917` for the pump correction. The initial
full-bank comparison against first-slice `8861329` remains historical evidence.
The offline probe covers 114 cases, including all 22 recorded handling families;
the filtered native mix suite checks 10 cases for hierarchy, silence, peak ceiling
and tails. Evidence stays outside the repository. Tests and signal checks do not
replace human listening review of synchronization and combat readability. The LMG
proxy is explicitly not accepted and awaits a better source bank.
