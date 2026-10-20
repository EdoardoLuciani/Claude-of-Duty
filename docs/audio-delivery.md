# Private Opus audio delivery

**Local-only review branch.** The operator explicitly authorized committing the
prepared audio derivatives locally. The current tree keeps only Opus delivery
files; WAV masters are preserved in a verified private archive outside Git. This does not grant public
redistribution rights. Do not push, upload or open a public PR containing these
assets without separate clearance. See [sample provenance](../src/audio/samples/LICENSE.md)
and [private report preparation](tactical-gunshots.md).

## Runtime versus masters

`src/audio/samples.ts` loads40 Ogg Opus recordings using native `decodeAudioData()`.
Vite bundles those referenced `.opus` files. The41 WAV masters are archived outside
the repository; normal install/test/build does not require that private archive.
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

These are asset sizes before HTTP compression. Removing masters from the current
tree cleans the checkout; earlier local commits still contain them. No history
rewrite was performed, and the runtime bundle is unchanged by this cleanup. Predecoded float AudioBuffers retain their
frame/channel count: this optimization targets downloads, not FPS or playback RAM.

## Regenerate explicitly

Requires local FFmpeg with `libopus` and FFprobe. No runtime dependency, network
service, automatic normal-build transcode or downloaded commercial library.

```sh
node tools/encode-opus.mjs /private/wav-masters /outside/repository/opus-trial
# To intentionally regenerate the delivery copies from the external archive:
node tools/encode-opus.mjs /private/wav-masters
```

The tool derives the40 required names from runtime imports and reads the matching
WAV masters from the explicitly supplied directory (or `AUDIO_MASTER_DIR`). Settings: float input, audio application, VBR256kb/s stereo /128kb/s
mono, complexity10,20ms frames,48kHz. No gain filters, loudness matching, downmix,
source offset or duration trimming. All OpusHead output gains are0. Container
serial numbers can change bytes without changing the audio. The smoke test hashes
Ogg page payloads, excluding serial/CRC headers, so unchanged codec packets remain
reproducible. Intentional encoder/audio changes require explicit reference review
and native decode/listening checks, not automatic baseline replacement. Never overwrite WAV masters with integer PCM.

## Validation and limitations

```sh
node tests/smoke/smoke-audio-opus.mjs
OPUS_EVIDENCE_DIR=/outside/repository/opus-decode node tests/e2e/audio-opus-e2e.mjs
AUDIO_MIX_EVIDENCE_DIR=/outside/repository/mix node tests/e2e/audio-mix-e2e.mjs
# Additional offline validation against every verified original master:
AUDIO_MASTER_DIR=/private/wav-masters npm test
AUDIO_MASTER_DIR=/private/wav-masters OPUS_EVIDENCE_DIR=/outside/repository/direct-master-check node tests/e2e/audio-opus-e2e.mjs
```

`src/audio/samples/reference.json` preserves source checksums, original format,
full-tail mono energy, duration/layout, heartbeat pulse times and measured native
master frames/RMS/peak at44.1/48/96k. It is authoring/test metadata, never imported
by the runtime. Frozen approved Opus payload hashes bind those references to the
actual delivered recordings; tests do not silently rebaseline changed files.

Smoke checks require all40 assets, correct mono/stereo headers, zero header gain,
complete Ogg granules/master durations, unchanged approved codec payloads, no WAVs
in the delivery directory and a4MB encoded-bank budget. Native codec checks compare
all40 copies against those frozen master measurements at44.1/48/96k: exact
frame/channel counts, finite float PCM and less than0.5dB total-energy drift.
The delivered heartbeat's pulse timing is also checked. This common engineering
margin is not per-file normalization or proof of transient/timbre transparency.
The preparation/routing smokes use the frozen source statistics by default. With
`AUDIO_MASTER_DIR`, the original full-sample WAV checks run additionally, after
verifying every accessed master checksum; the native test then decodes both actual
WAV and Opus files in that browser rather than using stored master measurements.
Missing/changed external masters fail explicitly when that mode is requested.
The codec and actual-game tests validate what is loaded at runtime.

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
