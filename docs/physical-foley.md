# Recorded physical foley — #473 follow-up

This follows #499's recorded flesh/armour feedback. It replaces the live audio
paths for other material bullet contacts, player/AI boot plants, landings, body
falls, stance/ADS cloth and movement equipment. Gunshots, reload/mechanical SFX,
explosions, speech, nonverbal vocal reactions, ambience and intentional UI cues
are unchanged. #474/#497 remain separate. Healing still has its existing UI cue;
there is no dedicated recorded medical-wrapper/bandage bank in this slice.

## Sources and honest mappings

| Event                              | Edited source / mapping                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Concrete                           | BOOM ONE 23.04 concrete-plate bullet contacts; three separate events                                                                       |
| Plaster                            | Lighter concrete/masonry contact; **no plaster-specific source identified**                                                                |
| Metal, wood, dirt, glass           | Three different Blastwave FX bullet-impact recordings per material; short contacts rather than complete long tails                         |
| Sand                               | BOOM small metal-ball-on-coarse-sand impacts; designed granular contact, not verified fine-sand ballistics                                 |
| Water impact                       | BOOM .22 lake bullet-impact recording, three events                                                                                        |
| Foliage                            | BOOM small grass-rustle impact-source events                                                                                               |
| Fabric                             | BOOM screwdriver/carpet impact-source events                                                                                               |
| Rubber                             | BOOM rubber-plate contacts; designed physical proxy, not ballistic rubber recordings                                                       |
| Boots                              | BOOM ONE 23.12 heavy leather boots: concrete, metal, wood, dirt, sand, grass, fabric; separate walk/run takes, four contacts per bank      |
| Glass steps                        | BOOM ONE 24.06 boot walk/run on glass shards                                                                                               |
| Crouch / sprint / land             | Quieter walk / heavier run / weighted run-contact-plus-gear composites; **not dedicated crouch, sprint or jump-land recordings**           |
| Water steps                        | Muted recorded boot + short recorded shallow-water splash; **not a dedicated wet-boot bank**                                               |
| Rubber / plaster / flesh underfoot | Fabric / concrete / fabric boot mappings respectively; explicit related-material fallbacks                                                 |
| Body falls                         | Close Combat construction-kit leather/concrete, loose wood, sand, grass, generic low tumble and shallow-water foley; three events per bank |
| Equipment                          | BOOM tactical-vest walking contacts; restrained extra layer on plants/landings                                                             |
| Stance / ADS                       | Close Combat cloth movements; four separate events                                                                                         |

Body falls query the physical ground under the death position; hard surfaces
share the hard-floor bank, dirt/sand share earth, and fabric/rubber use soft cloth.
The existing death-to-fall delay remains an approximation, **not a claim of a new
ragdoll contact-synchronisation system**. The replaced procedural generators and
their material/gait tables are removed. The developer self-test exercises these
same recorded sample-bank methods, loading required assets once per run and
reporting load failure rather than synthesizing a substitute. Its unrelated
isolated tests retain synthesis that still has legitimate runtime callers.

## Integration and mix

- Reuse `WeaponSampleBank`, its all-settled required startup, predecoded contact
  storage, seeded no-immediate-repeat selection, and complete disposal. There is
  no second engine, per-event fetch/decode, runtime dependency or network service.
- 123 new mono 48 kHz Opus clips: **621,437 delivery bytes**, **8,488,320 decoded
  float bytes** (about 8.10 MiB). At #502 this brought the required cache to 173
  decoded files; later categories add their own recordings. The historical
  `firearmSamples` report key counts the whole bank, not just guns. This increase is explicit rather than hidden lazy
  runtime fetching. Missing new files reject audio startup normally.
- Mono is the source format: positional playback and room returns remain stereo.
  Original stereo crops were explicitly averaged and checked for cancellation;
  worst selected-crop energy loss was about 3.24 dB. Existing stereo ambience and
  output are not downmixed.
- A boot, its optional water splash and gear share one event time and one spatial
  emitter; the latest component end owns retirement. Landing gear is not doubled
  by another dry cloth voice. Actual supplied landing position is respected.
- Existing footstep range/fade/per-frame budgets, AI stride-plant timing,
  propagation, occlusion, buses, room sends, concussion/ducking and master limiter
  stay in force. Cloth remains on its existing headlocked foley route, not UI.
- `src/audio/physical.ts` owns fixed material/gait/mix references. Surface levels
  were checked in the normal native graph; there is no hot-path normalization or
  master/gun gain change. The initial concrete walk failed the existing quiet
  readability threshold; it was corrected without weakening that test.
- **Flight remains canonical.** `bullet:segment` still owns the unchanged whizz
  synthesis/gain, including real incoming hits and near misses. Material impact
  handling no longer adds a second close-position whizz or invents one for the
  player's own wall shot. Exits and player collider contacts remain suppressed
  by their existing ownership rules; recorded incoming damage stays with #499.

## Offline edits and rights

The owner explicitly confirmed public redistribution clearance for these edited
material, step/landing and body/equipment derivatives during this follow-up.
This is an owner attestation, not an independent legal opinion. Raw source-library
masters and unrelated legacy firearm permissions remain separate; commercial
media retain their applicable asset terms, not the code licence. Keep purchase,
entitlement and licence records. No original masters or complete source reels
are committed; do not upload source recordings to training/cloning services.

```sh
node tools/prepare-physical-foley.mjs /path/to/Music
```

`tools/physical-foley-recipes.json` owns exact source-relative paths, distinct cuts,
filtering, durations and event-energy targets. The tool explicitly averages stereo
without an equal-power boost, filters/fades each short cut, matches a 20 ms energy
reference with at least 9 dB pre-codec peak headroom, and checks decoded Opus peaks
below 0.5. It writes the clips, generated static Vite URL table, and per-source /
per-output hashes and edits in `src/audio/samples/foley/provenance.json`. It does
not compress everything to full scale, include source directory scans/inventories,
or silently alter existing firearm/hit assets. Run normal formatting after regen.

## Validation and listening evidence

```sh
npm test
npm run lint
npm run build
npm run format:check
node tests/e2e/audio-hit-feedback-e2e.mjs
node tests/e2e/audio-selftest-e2e.mjs
AUDIO_MIX_EVIDENCE_DIR=/tmp/physical-mix node tests/e2e/audio-mix-e2e.mjs
node tools/capture-hit-combat.mjs --foley --out=/tmp/physical-combat
```

- Smoke checks cover all 123 hashes/mono headers, explicit mappings, genuine
  nonrepeating cuts, timing/lifetimes, gait levels, water/gear composition, one
  landing composite, ground-dependent falls, existing culling/budgets, canonical
  flight and required-file failure/settled teardown.
- Native WebGPU integration retains #499's health/armour/flight checks and adds
  real physics bullets against eleven world-layer material colliders, a real
  bullet-caused actor death/bodyfall, and actual controller landing/stride plants.
  The temporary colliders are test-only, removed after each shot; no world assets
  or gameplay collision definitions are changed.
- The expanded native audio suite has **150 scenarios**, including all material
  palettes, additional foot surfaces, falls and a high-velocity landing. The final
  0.99 sample ceiling, hierarchy/readability, silence, lifecycle and no-drop checks
  remain unchanged. Gun anchors compare native float PCM with the existing 3e-7
  cross-context tolerance. The comparison now reads saved `.f32` anchors rather
  than looking for WAVs the evidence writer never emitted. The close own-rifle
  anchor is also SHA-identical to baseline.
- Optional `AUDIO_MIX_CAPTURE=material,own-step-concrete,land-9,cloth,bodyfall`
  saves selected final stereo `.f32` cases alongside metadata for local encoding
  of listening previews. These are the unmodified graph output, not raw library
  masters. Native fixtures give a same-source-position/room comparison; they are
  not purported to be unassisted gameplay.
- `--foley` extends the existing continuous combat capture with two ordinary jump
  inputs (verifying actual jump events and their subsequent landings), and one
  actor starting wounded at 40 HP so a real weapon hit produces a body fall. The
  player and other actors retain high finite audition HP. Each jump is consumed
  by its first subsequent landing and qualifies only above velocity 2; later
  terrain step-downs cannot inherit that jump. Normal emitter drops
  and steals are reported, not bypassed. Ambient opening scheduling, armour refill,
  movement/reload/switch/grenade scripting and unnormalised final-master capture
  remain as documented in `hit-feedback.md`.
- Before/after combat runs are **contextual, not sample-aligned**: real-time AI,
  movement, room classification and grenade exposure can differ. Video wrappers
  show labelled static native snapshots with continuous captured audio, not
  full-motion gameplay. Direct palette clips isolate the material/gait difference;
  the combat clip demonstrates coexistence with the rest of the game.

Additional sample-rate probes: all 38 targeted physical mix cases passed at
44.1 kHz. At 96 kHz the existing strict spatial hierarchy gate fails on both the
new bank and the pre-change `develop` runtime (for example, procedural concrete
walk/run measure about −20.05/−17.15 dB per 20 ms versus recorded −20.19/−17.96,
against the same −8.12 dB own-rifle anchor). This is a reproducible native offline
spatial-mix limitation, not established as a new recording defect or an audition
of actual 96 kHz gameplay. Investigation is separate; no thresholds or mixer
paths were altered to hide it. The normal 48 kHz suite passes all 150 cases.

Measurements, hashes, event counts and stereo metadata are **not perceptual
approval**. Owner listening is still needed for contact character, gunshot bleed
in source edits, cloth/gear prominence, repetition, landing weight, and masking
under fire. The old material-only preview includes its incidental impact whizz;
the complete combat capture retains actual incoming bullet flight on both sides.
