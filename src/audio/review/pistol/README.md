# Pistol listening comparison

- [Before: develop at fa4740b](before.flac)
- [After: recorded report with restrained processing](after.flac)

Both contain stereo 48 kHz / 16-bit PCM in lossless FLAC, rendered through Chromium's
OfflineAudioContext using the game's actual `AudioSystem._build`, first-person
routing gains and `Mixer` (bus compression, master limiter and convolution
reverb). No post-normalization or extra processing was applied. Master volume,
shot timing, noise/IR seeds and per-shot random seeds are identical.

Each clip is 12 seconds:

| Time | Content |
| --- | --- |
| 0–6 s | Default outdoor blend: two single shots, a double tap, four rapid shots |
| 6–12 s | Same pattern with room reverb |

The four rapid shots use the P320 gameplay cadence of 460 rpm. Ambient sound,
impacts, shell landings and reloads are omitted to isolate the firing report.
This is an isolated mixer render, not recorded gameplay.

| Measurement | Before | After |
| --- | ---: | ---: |
| Integrated loudness (FFmpeg EBU R128) | -20.3 LUFS | -20.7 LUFS |
| Sample peak | -0.45 dBFS | -1.29 dBFS |
| True peak (FFmpeg) | -0.3 dBFS | -0.8 dBFS |

The 0.4 LU loudness difference is small; keep playback volume unchanged for the
comparison. Neither exported clip clips. The underlying recordings still have
some clipped transients; this change does not reconstruct missing source detail.

## Changes

The close pistol now uses its recorded report without the shared revolver-cock
recording or additional synthetic snap, swept bass and metallic action layers.
It keeps more recorded low-frequency body (45 Hz high-pass, lighter 320 Hz cut,
no 130 Hz cut), removes the +3.6 dB treble shelf, and narrows pitch variation
from ±3% to ±1%. First-person gain, reverb and other weapon profiles are unchanged.
The existing procedural sound remains available when samples fail or shots are
more than 45 metres away.

These are still the bundled Walther PPQ recordings, not recordings of a P320.
This is a more restrained treatment of the available source, not a claim of
model-specific acoustic accuracy. Final subjective acceptance requires listening.
Source licenses and attribution are in [../../samples/LICENSE.md](../../samples/LICENSE.md).
The before clip also includes the attributed Ruger cocking sample.

## Reproduce

From a checkout with dependencies and a Playwright Chromium browser installed:

```sh
node src/audio/render-review.mjs --out=/tmp/pistol.wav
node src/audio/render-review.mjs --fallback --out=/tmp/pistol-fallback.wav
ffmpeg -i /tmp/pistol.wav -c:a flac -compression_level 12 /tmp/pistol.flac
```

The renderer always imports the current checkout. To reproduce the baseline,
copy `src/audio/render-review.mjs` into a separate worktree at `fa4740b`, install
its dependencies, and run the same command there. `CHROMIUM_PATH` can point to a
compatible locally installed browser. The script rejects missing source files,
non-finite samples, silence, clipping and excessive DC offset.
