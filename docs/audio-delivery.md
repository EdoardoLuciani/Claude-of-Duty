# Private Opus audio delivery

**Local-only review branch.** The operator explicitly authorized committing the
prepared WAV masters and Opus derivatives locally. This does not grant public
redistribution rights. Do not push, upload or open a public PR containing these
assets without separate clearance. See [sample provenance](../src/audio/samples/LICENSE.md)
and [private report preparation](tactical-gunshots.md).

## Runtime versus masters

`src/audio/samples.ts` loads40 Ogg Opus recordings using native `decodeAudioData()`.
Vite bundles those referenced `.opus` files, not the41 adjacent WAV masters.
The33 authored report masters remain IEEE float32, with full selected windows,
stereo/mono identities and legitimate resampling peaks above unity intact.
Other masters retain their existing PCM format. Opus is lossy, not a bit-exact
replacement for those masters. There is no per-file normalization or compensating
source gain. The accepted bank factors, +12dB positional reference, hearing,
shared energy/peak controller, category levels and single5ms delay are unchanged.

The accepted encoding trial measured the exact40-file delivery bank:

| Format            |         Asset bytes |
| ----------------- | ------------------: |
| WAV inputs        |          42,548,406 |
| Ogg Opus delivery |           3,178,983 |
| Saved             | 39,369,423 (92.53%) |

These are asset sizes before HTTP compression. Keeping masters in Git increases
checkout size, not the runtime bundle. Predecoded float AudioBuffers retain their
frame/channel count: this optimization targets downloads, not FPS or playback RAM.

## Regenerate explicitly

Requires local FFmpeg with `libopus` and FFprobe. No runtime dependency, network
service, automatic normal-build transcode or downloaded commercial library.

```sh
node tools/encode-opus.mjs /outside/repository/opus-trial
# To intentionally regenerate the committed delivery copies in place:
node tools/encode-opus.mjs
```

The tool derives the40 required names from runtime imports and reads the matching
WAV masters. Settings: float input, audio application, VBR256kb/s stereo /128kb/s
mono, complexity10,20ms frames,48kHz. No gain filters, loudness matching, downmix,
source offset or duration trimming. All OpusHead output gains are0. Container
serial numbers and encoder versions can change bytes; compare decoded content,
not only a compressed-file hash. Never overwrite WAV masters with integer PCM.

## Validation and limitations

```sh
node tests/smoke/smoke-audio-opus.mjs
OPUS_EVIDENCE_DIR=/outside/repository/opus-decode node tests/e2e/audio-opus-e2e.mjs
AUDIO_MIX_EVIDENCE_DIR=/outside/repository/mix node tests/e2e/audio-mix-e2e.mjs
```

Smoke checks require all40 assets, correct mono/stereo headers, zero header gain,
complete Ogg granules/master durations and a4MB encoded-bank budget. Native codec
checks compare all40 masters/copies at44.1/48/96k: exact frame/channel counts,
finite float PCM and less than0.5dB total-energy drift. This common engineering
margin is not per-file normalization or proof of transient/timbre transparency.
The WAV-based report-preparation smokes continue to validate the untouched masters;
the codec and actual-game tests validate what is now loaded at runtime.

An initial native A/B used identical game handlers/HRTF/hearing/worklet/peak
processing and no gain overrides; the operator could barely hear a difference.
Meters do not replace that listening milestone. Preserve full tails, stereo and
cadence, and run ordinary tests/build plus hearing/ownership/category/game checks.
A baseline waveform comparison at3e-7 remains valid for two renders of the SAME
codec assets, not a lossless guarantee between WAV and lossy Opus.

Local Chromium is verified. Test the exact codec/container and native decoder on
other target browsers/OS versions; HTML media-element support alone is not an API
guarantee. Required fetch/decode failures still fail closed; no synthesis or MP3
fallback silently changes the mix. No streaming decoder runs on each gunshot:
assets are decoded before play, with metadata/pre-skip handled by the browser.
The sample limiter is not true-peak mastering or headphone SPL/safety calibration.
