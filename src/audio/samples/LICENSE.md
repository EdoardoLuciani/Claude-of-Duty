# PRIVATE candidate rights warning

**This private local-only review branch contains commercial derivatives.**
The operator explicitly authorized local commits of the prepared WAV masters and
Opus delivery copies. This does NOT grant public distribution rights: do not push,
upload, publish or open a public PR containing these assets without rights clearance.
The legacy CC0/CC BY provenance below describes the branch baseline, NOT the
replaced candidate files.

Candidate `rifle-[123]`, `pistol-[123]`, `lmg-[123]`, `smg-[123]`,
`sniper-[123]`, `shotgun-[123].wav` and the five gameplay families'
`*-distant-[12].wav` counterparts derive from BOOM Tactical Guns Designed.
The unsuppressed `smg` UZI close bank remains for legacy aliases only, not MPX;
no UZI distant files are loaded. `mcx-[12].wav` and `mpx-[123].wav` derive from
BOOM Silencers Designed (suppressed AR15 and suppressed HK MP5 respectively). Exact source mappings,
caliber/action substitutions, the public-repository rights blocker and private
reproduction references are in [tactical-gunshots.md](../../../docs/tactical-gunshots.md).
All remaining files retain their baseline provenance below. Library originals
were not modified or added. The `.opus` files derive from the corresponding local
WAV masters using `node tools/encode-opus.mjs`: float input, audio mode, VBR,
256kb/s stereo /128kb/s mono, complexity10,20ms frames. No normalization, gain
adjustment, downmix or tail trimming. Opus is lossy; the float masters remain intact.

---

# Firearm recording provenance

These WAV files are trimmed, high-pass-filtered, 48 kHz / 16-bit derivatives of
**The Free Firearm Sound Library** by Still North Media. The source recordings
were dedicated to the public domain under **CC0 1.0 Universal**.

- Original release: https://opengameart.org/content/the-free-firearm-sound-library
- Source mirror: https://github.com/petroulacl/fps-asset-kit/tree/main/sfx/firearm_sfx
- License: https://creativecommons.org/publicdomain/zero/1.0/

| Bundled files      | Source recording                                                       |
| ------------------ | ---------------------------------------------------------------------- |
| `rifle-[12].wav`   | AR-15 `D_32P.wav` (near)                                               |
| `ak-*.wav`         | AK-47 `C_28P.wav` (near)                                               |
| `smg-*.wav`        | Carl Gustav M45 `G_31P.wav` (near)                                     |
| `pistol-*.wav`     | Walther PPQ `X_39P.wav` (near)                                         |
| `shotgun-*.wav`    | Mossberg Model 190 `N_30P.wav` (near)                                  |
| `sniper-*.wav`     | Mosin Nagant `M_21P.wav` (near) — unused; AX-338 is synthesized        |
| `suppressed-*.wav` | Savage 10 .300 Blackout `T_27P.wav` (near), runtime low-pass treatment |

Edits are limited to isolating individual takes, removing infrasonic recorder
movement, resampling, bit-depth conversion, and a short end fade. Attribution is
not required by CC0, but this notice is retained so future maintainers can audit
and replace the source material.

## Low-health heartbeat

`heartbeat.wav` is a mono 48 kHz PCM16 derivative of **Heartbeat #2** (sound 244) by DenisChardonnet / BigSoundBank, released under **CC0**:
https://bigsoundbank.com/heartbeat-2-s0244.html

Source MP3: `https://bigsoundbank.com/UPLOAD/mp3/0244.mp3`. The bundled take
is low/high-pass filtered (60 Hz / 1.6 kHz), gently compressed and limited,
trimmed to the double thump (0.65 s), and faded out. Played once per player
heartbeat; cadence is set by player health, not by looping the file.

## MCX VIRTUS game report

`mcx-[12].wav` are designed derivatives of the **CC0** Savage 10 .300 Blackout
`T_27P.wav` takes above (`suppressed-[12].wav`), **not recordings of an actual
MCX or verified recordings of this suppressor/load**. No new third-party sound
is required. `node tools/mcx-audio.mjs` deterministically rebuilds them offline:
mono downmix, onset trim, 3.1/3.3 kHz Butterworth low-pass, 55 Hz high-pass,
shortened environmental decay, end fade, 48 kHz PCM16, -4.5 dBFS peak.

The dedicated `mcx` WebAudio profile adds short pressure/body and piston-action
layers, round-robin takes and seeded pitch/level variation. It does not layer
the revolver cock recording or the M4 buffer-spring twang. Failed sample loads
disable the audio graph; there is no recorded-shot synthesis fallback.

## Additional layered recordings

- `lmg-[12].wav` — two single rounds sliced from the clean inter-shot gaps
  of **Machine Gun** by BlastwaveFx.com ("a military grade machine gun firing
  15 times in rapid succession"), licensed under CC BY 3.0:
  https://soundbible.com/640-Machine-Gun.html
  Edits: mono downmix, 48 kHz resample, 12 ms end fade, loudness
  normalisation to -16 LUFS. The game controls cadence independently at the
  EVOLYS's specified 700 rpm.

  Identified but NOT bundled (Freesound is login-gated; drop-in upgrades,
  same filenames):
  - **Authentic M60 Firing** by FranklinRook1984, CC0 1.0 — a 7.62x51
    belt-fed LMG, the exact calibre:
    https://freesound.org/people/FranklinRook1984/sounds/538302/
  - **249 single shot** by Baelphazoar, CC BY 4.0 — a real M249 SAW round:
    https://freesound.org/people/Baelphazoar/sounds/568007/

- `rifle-field.wav` — **Centerfire Rifle Gun Shot 01**, sound 411567 by LilMati,
  dedicated to the public domain under CC0 1.0:
  https://freesound.org/people/LilMati/sounds/411567/
- `action.wav` — **Ruger 357 Magnum Gun Cock**, sound 416 by Mike Koenig,
  licensed under CC BY 3.0:
  https://soundbible.com/416-Ruger-357-Magnum-Gun-Cock.html
- `explosion.wav` — **2 High Quality Explosions** (`explode.wav`) by Michel
  Baradari / apollo-music.de, licensed under CC BY 3.0. The bundled derivative
  is resampled to 48 kHz PCM with 0.5 dB of peak headroom:
  https://opengameart.org/content/2-high-quality-explosions

CC BY 3.0 license: https://creativecommons.org/licenses/by/3.0/
