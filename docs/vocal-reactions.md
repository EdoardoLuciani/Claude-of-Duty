# Recorded nonverbal reactions — #474

This slice replaces synthesized hit/pain/death efforts, not spoken dialogue.
Spoken tactical callouts remain deferred in #497; their existing formant synthesis,
radio treatment, timing and warnings are otherwise unchanged.

## Sources and limitations

Twelve mono 48 kHz Opus contacts are cut from BOOM Close Combat construction-kit
`VO Male 02` and `VO Male 04` studio reels. Each library-labelled group has three
closed-mouth soft-pain takes for injury and three **separate medium-pain takes**
for brief collapse/death grunts. The latter are designed death reactions, not
mislabelled recordings of an actual death. We reject the long `Deathscream`
performances for this restrained slice. Group identity follows library numbering;
this is not independently verified real performer credit. No pitch/time shifting
or random speaker changes are used. Source fit and delivery require listening.

`node tools/prepare-reaction-audio.mjs /path/to/Music` reproduces all files,
static URLs and formatted provenance. The shared **offline-only** helper explicitly
checks mono/stereo source format/downmix cancellation, trims each complete short
take, filters 90 Hz–10 kHz, applies 5/25 ms edge fades and a −22 dB active-sample
reference with a −9 dB pre-codec sample-peak cap. Individual thresholding excludes
very quiet samples from the active reference; it is not whole-reel normalization.
Post-codec peak must stay below 0.5. Exact sources, cuts, identity groups, edits,
hashes and decoded measurements are committed; masters remain outside the repo.

The owner explicitly cleared public edited #474 nonverbal derivatives and separately
mixed gameplay review recordings. Keep entitlement/licence records. This is an
owner attestation, not independent legal certification or relicensing as code.
No masters are copied/uploaded to generation services; legacy permissions remain
separate.

## Runtime contract

- Reuse the required all-settled `WeaponSampleBank` cache and contact-array
  disposal/selection ownership. This slice adds 12 recordings to #504's 238,
  totaling **250** at this revision; later categories add their own recordings.
  No fetch/decode per reaction, runtime dependency, synthesis fallback or new engine.
- Actor seed modulo two selects a stable library identity group for both hurt
  and death. `_onDamageDealt` now passes the damaged actor's ID, matching death's
  existing actor-ID path, rather than silently defaulting every hurt to group zero.
- Within each identity/role, seeded no-immediate-repeat selection chooses takes.
  Playback rate stays 1. Only `REACTION_MIX` owns the local source gain/send;
  voice bus, spatial attenuation/occlusion/air absorption, propagation, room
  routing, concussion, gun/master levels and world gameplay are unchanged.
- Preserve the existing 30% nonfatal reaction chance and 0.42 s global bark gate.
  Ordinary nonverbal efforts additionally wait for the prior scheduled effort
  to finish, including initial arrival delay. Tactical warnings are **not** blocked
  by this extra reaction-only duration gate. Existing forced death priority is
  retained; simultaneous casualties can still vocalize through the bounded pool.
  Restart/context teardown resets the reaction timeline. These are finite short
  sources using the normal spatial/dry lifecycle, not new tracked loops.
- Remove the old synthetic hit/pain/death scripts, pain tremolo and dying-exhale
  generator, not just their gameplay callers. Developer self-test auditions the
  actual recorded methods for both groups/roles. Internal raw speech synthesis
  rejects unknown/nonverbal scripts rather than silently making a contact callout.

## Validation and previews

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
node tests/e2e/audio-selftest-e2e.mjs
node tests/e2e/audio-mix-e2e.mjs
node tests/e2e/audio-reactions-e2e.mjs --out=/tmp/reactions-after
node tests/e2e/audio-reactions-e2e.mjs --root=/path/to/develop-before --port=5546 --baseline --out=/tmp/reactions-before
```

Smoke tests verify committed hashes/headers/budgets, identity and no-repeat
variants, unmodified playback rate, no fallback, duration gating, warning/forced
priority, correct damage/death actor forwarding and complete cache disposal.
Required load/decode failure tests include all categories. Native self-test checks
all four recorded paths; native mix adds both groups/roles without relaxing gates.
Initial excessive local gain was reduced to pass the unchanged speech hierarchy;
no master, voice-bus, gun gain or threshold was adjusted to make it pass.

Actual-game E2E records a **controlled palette through the normal master graph**:
12 voices at a fixed 3 m offset, 1.4 s apart, followed by 2.2 s tail room. Each
current take is selected deterministically for coverage; levels/buses are not
overridden or post-normalized. The baseline uses its normal synthesized efforts,
not a claim that it had the same recorded variants. Actor/role/take order is in
`report.json`. AI/random ambience are suppressed for this labelled fixture. A
static native reference snapshot is staged separately, not moving gameplay video.

A separate uncaptured contract probe fires real physics bullets into a real AI
soldier, verifies nonfatal health loss then death, and checks both reactions carry
the actual actor ID and leave no finite emitters. Only this probe forces the
existing 30% chance draw to guarantee coverage; capture does not. It does not
change damage, routing, source gain or production chance. Native capture and
objective checks do not establish perceptual approval: judge restraint, character
consistency, repetition and combat balance in the linked PR previews.
