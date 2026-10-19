# Audio mix contrast benchmark

The accepted gunshot sound and common +12 dB positional presentation reference
are the anchor. This benchmark checks the **relative mix**, not microphone
calibration, acoustic SPL, headphone loudness or universal subjective realism.

## Run locally

Requires the normal game assets, Chromium/Playwright and local FFmpeg with its
`ebur128` filter. No new runtime dependencies or network analysis services.
Recording exports must remain outside the repository and must not be uploaded.

```sh
AUDIO_MIX_EVIDENCE_DIR=/outside/repository/mix-current \
  node tests/e2e/audio-mix-e2e.mjs
```

Options: `PORT` (exclusive, default 5500), `AUDIO_MIX_RATE` (default 48000),
`AUDIO_MIX_SEED` (default 1907), `AUDIO_MIX_CASES` (comma-separated ID substrings).
`AUDIO_MIX_ENFORCE=0` is explicitly **audit-only**: it captures failing hierarchy
measurements without calling them a passing mix. Set `AUDIO_MIX_BASELINE` to a
previous evidence directory to compare all selected own/20 m/70 m gun renders
at the same seed/sample rate. That comparison preserves the original 3e-7 native
cross-context float bound, and reports bit-exact matches separately.

## What is measured

The browser invokes actual event handlers/public audio methods with real weapon
definitions, decoded buffers, HRTF, native category compressors, hearing routing
and the native summed RMS/peak worklet. No source/module overrides, export gain,
per-file normalization or altered controller parameters. Controlled event timing
uses the offline context's native clock; housekeeping follows the real audio
ownership rules. These fixtures are not an organic AI/performance acceptance run.

Parallel taps observe source feeds **before** category compression, category
output, aggregate wet return, world input, master input and final output. The
compressor node's output is not a pre-compression tap: native makeup gain matters.
Dry and aggregate wet measurements must both be examined when diagnosing balance.

Reports include hotter-ear strongest 20/200/400 ms RMS windows, full-tail RMS,
sample peaks, last-100-ms residuals, FFmpeg K-weighted maximum momentary/integrated
LUFS, estimated true peak, and time-aligned common gain reduction. Final WAVs are
full-length stereo Float32 at runtime amplitude. Peaks above unity upstream are
valid. The sample ceiling is not a true-peak or hearing-safety guarantee.

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
