# Recorded hit feedback — #473, first slice

## Scope and routing

This replaces incoming physical damage/armour feedback and spatial flesh contacts.
Other impact materials, footsteps, body falls and voices are unchanged. Speech is
tracked separately in #497; remaining #473/#474 work is not closed by this slice.

- `damage:taken` owns one **headlocked composite voice** on the existing UI bus.
  It is immediate, unducked and unmuffled, with no room send. This retains the
  old subjective-damage presentation rather than making incoming injury disappear
  during own gunfire/concussion. It also handles explosion-derived bodily damage;
  the recording is a contact, never an additional gunshot report.
- Health-only selects flesh; armour-only selects a vest/plate contact. Mixed hits
  combine restrained flesh and armour components, with severity derived from the
  **whole event** rather than attenuating both halves twice. Plate break selects
  the break bank **instead of** the normal armour bank: break already includes
  vest/plate contact. A zero-health, armour-only break still plays.
- Player actor `bullet:impact` is skipped before consuming the world-impact budget:
  it precedes armour resolution and must not play another flesh contact. String,
  `isPlayer` and exact player-object identities are covered.
- Enemy/corpse flesh entries use the same flesh bank through existing spatial
  foley, distance, occlusion and room sends. Exits stay silent. Physics already
  deduplicates overlapping live actor regions; no extra audio shot cache is added.
- Flesh contact does not invent an impact-position near-miss/whizz. The existing
  canonical bullet-segment near-miss path remains responsible for flybys.
- Audio owns damage-dealt confirmation ticks too. HUD hitmarkers, health/armour
  flashes, direction arcs and reticle flinch remain visual consumers. Removing
  their SFX calls fixes both duplicate incoming stings and duplicate hitmarker
  ticks observed in the live-game event trace. Armour confirmation keeps its
  distinct UI timbre; headshot/kill confirmation remains separate from contact.
- The optional procedural first-person pain grunt is removed from incoming damage;
  it must not obscure the contact with another synthetic sting. Enemy vocals and
  their triggers remain unchanged pending the recorded-reaction work in #474.

## Assets, authoring and rights

Ten short, mono 48 kHz Opus assets live in `src/audio/samples/hits/`: four flesh,
three armour and three breaks. The existing sample bank loads/caches all ten at
startup alongside its 40 legacy assets. Any required fetch/decode failure rejects
startup; no per-hit fetch, decode or synthesis recovery. Disposal clears the new
buffers and selection state. Selection is seeded, avoids immediate repeats and
uses only ±2% rate / ±4% gain variation; there is no recorded speech in this bank.

`provenance.json` records exact source filenames/hashes, trims, filters, layer
levels, delivery hashes/durations and decoded peak headroom. Original masters
remain outside the repository. Source material:

- Blastwave FX, **Bullets, Casings and Impacts**: single flesh contacts 54425,
  54426, 54431 and 54432; no prerecorded machine-gun bursts or whooshes.
- BOOM ONE **24.03**: separate tactical-vest impacts.
- BOOM ONE **23.04**: brief metal-plate bullet contacts, with ringing/tail damped.
- BOOM ONE **24.05**: short ceramic-tile fracture elements for breaks.

Armour/break sounds are **authored composites**, not recordings of a modern
ballistic plate being shot. The owner explicitly confirmed public redistribution
clearance for the new edited assets during this implementation. That is an owner
attestation, not an independent legal opinion or a transfer of the source-library
copyrights. Retain applicable purchase/licence records; these commercial-derived
media do not inherit any code licence. This approval does not change the separate
restrictions on the existing legacy firearm assets.

Rebuild with installed FFmpeg/libopus and the original source libraries:

```sh
node tools/prepare-hit-audio.mjs /path/to/Music
```

The tool requires unique source filenames and never downloads audio. It averages
stereo explicitly (no equal-power downmix boost), crops source reels into single
contacts, applies modest filtering and short edge fades, then matches 20 ms event
energy with an 8 dB master peak-headroom cap. Opus decode overshoot is checked.
It does not normalize files to full scale, use a compressor to repair clipping,
or change firearm samples/master gain. Two successive local authoring runs
produced identical output hashes.

## Balance and validation

`HIT_MIX` in `src/audio/hits.ts` owns presentation tuning. The mixer, gun profiles
and existing weapon assets are unchanged. Measurements are necessary evidence,
**not a claim of perceptual approval**; listen to the captures before final
acceptance, especially for wetness, plate character and masking in combat.

The native mix suite includes actual damage events, mixed hits, armour-only
breaks, sustained own LMG plus nearby enemy rifle fire, concussion, and spatial
flesh at 2/10/25 m. It measures the post-bus UI feedback stem separately from the
gun-dominated final sum, tests readability/headroom and verifies that gunfire or
concussion do not bury the incoming stem. This is more informative than checking
only a limiter ceiling or normalizing isolated samples.

For the fixed seed/rate run, incoming UI 20 ms maxima were approximately
−23.5 to −20.9 dBFS in quiet scenes and −23.4 to −20.2 dBFS during sustained fire;
the incoming stem's largest sample peak was below 0.36. The own-rifle anchor
remained bit-identical to the pre-change capture. Dense final output remained
inside the existing 0.99 sample ceiling; tested damage-combat true peaks were
approximately −0.1 dBFS. No mixer/headroom override was used.

```sh
npm test
npm run lint
npm run build
npm run format:check
node tests/e2e/audio-e2e.mjs
node tests/e2e/audio-mix-e2e.mjs
node tests/e2e/audio-hit-feedback-e2e.mjs --out=/tmp/hit-feedback-after
```

The last command boots the actual WebGPU game, uses the real UI/audio graph,
records the six controlled incoming-event cases as WebM and MP3, then tests a
real physics bullet against an enemy and real health-controller armour-break,
explosion-derived and lethal damage. The mixed-without-break event is a contract
fixture, not a claim that every damage combination is naturally produced by the
current health tuning. Health-controller fixtures derive plate exhaustion from
`HEALTH` tuning, not an assumed absorption percentage.

For before/after evidence, run the same harness against a clean pre-change
worktree with `--root=/path/to/baseline --port=5534 --baseline --out=/tmp/hits-before`.
Evidence stays outside the repo; the harness does not publish recordings or
collect library masters. Full firefight measurements/captures involving the
legacy firearm recordings remain local, subject to their separate restrictions.
