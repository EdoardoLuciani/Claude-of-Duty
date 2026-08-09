# Firearm recording provenance

These WAV files are trimmed, high-pass-filtered, 48 kHz / 16-bit derivatives of
**The Free Firearm Sound Library** by Still North Media. The source recordings
were dedicated to the public domain under **CC0 1.0 Universal**.

- Original release: https://opengameart.org/content/the-free-firearm-sound-library
- Source mirror: https://github.com/petroulacl/fps-asset-kit/tree/main/sfx/firearm_sfx
- License: https://creativecommons.org/publicdomain/zero/1.0/

| Bundled files | Source recording |
|---|---|
| `rifle-[12].wav` | AR-15 `D_32P.wav` (near) |
| `ak-*.wav` | AK-47 `C_28P.wav` (near) |
| `smg-*.wav` | Carl Gustav M45 `G_31P.wav` (near) |
| `pistol-*.wav` | Walther PPQ `X_39P.wav` (near) |
| `shotgun-*.wav` | Mossberg Model 190 `N_30P.wav` (near) |
| `sniper-*.wav` | Mosin Nagant `M_21P.wav` (near) |
| `suppressed-*.wav` | Savage 10 .300 Blackout `T_27P.wav` (near), runtime low-pass treatment |

Edits are limited to isolating individual takes, removing infrasonic recorder
movement, resampling, bit-depth conversion, and a short end fade. Attribution is
not required by CC0, but this notice is retained so future maintainers can audit
and replace the source material.

## Additional layered recordings

- `lmg-[12].wav` — two single rounds sliced from the clean inter-shot gaps
  of **Machine Gun** by BlastwaveFx.com ("a military grade machine gun firing
  15 times in rapid succession"), licensed under CC BY 3.0:
  https://soundbible.com/640-Machine-Gun.html
  Edits: mono downmix, 48 kHz resample, 12 ms end fade, loudness
  normalisation to -16 LUFS. The original burst runs ~780 rpm, matching the
  EVOLYS's 660 rpm closely enough that per-shot pitch jitter covers the rest.

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
