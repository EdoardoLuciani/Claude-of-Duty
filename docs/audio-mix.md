# Audio mix contrast benchmark

The accepted gunshot sound and common +12 dB positional presentation reference
are the anchor. This benchmark checks the **relative mix**, not microphone
calibration, acoustic SPL, headphone loudness or universal subjective realism.
Runtime recordings now use [high-quality Opus delivery](audio-delivery.md), with
untouched WAV masters retained offline. Codec changes do not retune this mixer.

## Run locally

Requires the normal game assets, Chromium/Playwright and local FFmpeg with its
`ebur128` filter. No new runtime dependencies or network analysis services.
Optional JSON evidence must remain outside the repository. The runner meters
raw float PCM through FFmpeg stdin; it no longer writes recordings or meter logs.

```sh
AUDIO_MIX_EVIDENCE_DIR=/outside/repository/mix-current \
  node tests/e2e/audio-mix-e2e.mjs
```

Options: `PORT` (exclusive, default 5500), `AUDIO_MIX_RATE` (default 48000),
`AUDIO_MIX_SEED` (default 1907), `AUDIO_MIX_CASES` (comma-separated ID substrings).
All criteria are enforced. `AUDIO_MIX_EVIDENCE_DIR` optionally saves one JSON
report. Set `AUDIO_MIX_BASELINE` to an archived approved Float32 WAV capture
directory to compare all selected own/20 m/70 m gun renders
at the same seed/sample rate. That comparison preserves the original 3e-7 native
cross-context float bound and reports maximum differences. Filtered
captures always include the own-M4 anchor and idle-ambience silence regression.

## What is measured

The browser invokes actual event handlers/public audio methods with real weapon
definitions, decoded buffers, HRTF, native category compressors, hearing routing
and the native summed RMS/peak worklet. No source/module overrides, export gain,
per-file normalization or altered controller parameters. Controlled event timing
uses the offline context's native clock; housekeeping follows the real audio
ownership rules. These fixtures are not an organic AI/performance acceptance run.

Parallel taps observe aggregate wet return, world input, master input and final
output. Source/category forensic taps and their global `AudioNode.connect` patch
are retired; native category-envelope tests independently check shared dry/wet
volume, mute and duck behavior.

Reports retain hotter-ear strongest20/200ms RMS windows, full-tail RMS, sample
peaks, last100ms residuals, FFmpeg K-weighted maximum momentary/integrated LUFS
and estimated true peak. The metered signal is full-length stereo Float32 at
runtime amplitude. Peaks above unity upstream are valid. The sample ceiling is not a true-peak or hearing-safety guarantee.

Whole-clip averages alone bias comparisons toward duration and silence. LUFS is
also not a complete model of short impulsive loudness: transient and body
measurements are checked alongside it, not replaced by a single target number.

## Artistic contrast criteria

Minimum gaps below the approved **own M4** in isolated renders:

| Role                           | Strongest 20 ms | Strongest 200 ms | Maximum momentary LUFS |
| ------------------------------ | --------------: | ---------------: | ---------------------: |
| Routine movement, handling, UI |           12 dB |             8 dB |                   8 LU |
| Speech                         |            8 dB |             6 dB |                   6 LU |
| Warnings                       |            6 dB |             3 dB |                   6 LU |
| Environmental background       |           24 dB |            18 dB |                  18 LU |
| Shop music                     |           15 dB |            12 dB |                  10 LU |
| Landings/body falls            |            6 dB |             3 dB |                   3 LU |
| Distant ambient combat         |           12 dB |            10 dB |                  10 LU |

These are minimum contextual contrast margins, not exact loudness targets for
individual cues. They do not require every distant gun to overpower nearby
footsteps, equalize different weapons, compensate individual directions, or lift
quiet sounds through gunfire. Near misses, close bullet impacts and nearby blasts
are intentionally urgent threats; their priority can approach gunfire. Busy and
quiet scenes are captured separately. Quiet-scene readability and real gameplay
still require consideration; merely passing the table is not proof of good taste.

## Interpretation and regression boundaries

Check source/category references and wet routing before blaming the shared
controller. Strong combat masking remains intentional. Controller retuning needs
a separate decision; do not change it just to make these numbers pass.

Category sends must honor the same logical reference/user volume/duck as their
dry category. Existing energy already inside a shared room convolution decays
naturally; muting a send is not a destructive tail cut or an instantaneous mute
of the entire room. Reverb cost must remain shared, not one convolver per voice.

Run ordinary smoke/build/lint/format checks plus native hearing, emitter ownership,
category automation and actual-game checks. Keep recordings, source windows,
suppression identities, own stereo, positional mono/HRTF, timing and complete tails.
Final human listening remains a milestone approval, not the repeated engineering
feedback loop and not something a meter can claim to replace completely.

## Implemented relative references

Weapons/master remain1; gun recordings, +12 dB reference, distance blend and shared
controller are unchanged. Category references are foley0.6 (was0.9), ambience0.06
(was0.07), voice0.6 (was0.85), UI0.45 and music0.6 (both were1.6). Following in-game
acceptance, the user requested removal of the continuous synthetic air hiss. Idle
ambience now creates no audio source; sparse environmental events, distant combat,
spatial filtering, room tails and all approved references remain. A helicopter-
specific reference2.5 (was14) handles that outlier without muting other ambience.
Distant environmental booms use0.1 instead of6. Near blast gain0.8 is unchanged.

Existing output references, not recordings, were adjusted for radio treatment
(0.16 instead of1), heartbeat (remove4x boost), siren (0.22 instead of2.5) and
magazine seating (0.7 instead of1). Content, cadence, pitches and complete tails
remain. Six fixed category send gains bring the mixer constructor from22 to28
nodes; convolver count, voice capacities and latency do not increase.

The legacy self-test now compares unrounded measurements to its **unchanged**
thresholds. Rounding0.0000226 RMS to0.00002 incorrectly failed its silence floor.
Intel tests retain detector/siren RMS priority (4x), non-silence, ceiling, pulses,
gaps and prompt stop. Obsolete absolute0.15 RMS /0.5 peak /0.2 pulse-RMS floors
were replaced with detector-relative checks: those old floors demanded the very
gunfire-like sustained alarm energy the new mix brief rejects. The separate
whole-mix benchmark now also enforces the upper warning-to-gun contrast bound.

Idle ambience must produce exact digital zero at every captured stage, not merely
fall below a silence threshold. Quiet-scene readability retains a fixed historical
reference of -44 LUFS (the highest former bed across four approved rate/seed
matrices), with the same 6 LU / distant-step -3 LU margins. Comparing cues against
the newly silent bed would make that guard trivial. This is an artistic regression
floor, not physical background SPL or proof of intelligibility on every device.
