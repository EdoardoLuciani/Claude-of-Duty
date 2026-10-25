# Audio assets and contracts

Runtime audio is local. Required recording fetch/decode failures disable the audio
graph; they never substitute synthesis. The sample bank owns decoded buffers,
seeded selection and disposal. Mixer tuning lives in `src/audio/`, not authoring tools.

## Ownership

- `damage:taken` produces one headlocked contact on the UI bus, bypassing ducking,
  concussion and room sends. Plate break replaces the ordinary armour contact;
  mixed damage can include flesh. Player actor impacts must not add another contact.
  Canonical bullet segments own flight whizzes, including incoming hits.
- Enemy flesh/material contacts and movement/body/equipment foley use spatial
  recordings. Surface aliases are intentional related-material approximations,
  not recordings of every named finish. Exits are silent.
- Reload/manual-action recordings follow native weapon clip events. Pump contacts
  are separate beats, not a prerecorded full cycle; interruption cancels later beats.
- Start button clicks unlock optional audio for both mouse and keyboard activation;
  isolated dialog key events need not reach the global input listeners. Audio failure
  does not block gameplay. Restart clears delayed concussion, tinnitus and hearing
  state even while Start suspends gameplay hooks; ordinary pause retains hearing state.
- Radio owns aircraft pose/pass lifetime; audio owns the tracked loop and cleanup.
  Pause silences the retained source without restarting it. The PC-21 donor is a
  designed bomber texture, not a verified twin-engine/RPM reproduction.
- Nonverbal reactions retain identity groups; library labels do not verify real
  performer identity. Tactical speech is separate. Sparse environmental events
  must not invent human shouts or tactical actors.
- Radio textures supplement intentional electronic tones. Successful strike
  acknowledgment has one producer, not duplicate weapon/UI playback.

## Authoring and rights

Committed Opus files are the runtime authority. Each sample directory's
`provenance.json` retains donor identities/hashes, edits, levels, approved output
hashes and rights attestations. Validation recomputes output measurements.
`samples/reference.json` freezes legacy master/codec baselines: never regenerate
expected hashes to accept a changed asset. Masters stay outside the repository.

Foley `banks` factor settings shared by takes (filename without its numeric
suffix). Reload `sources` factor donor metadata; single-layer takes store donor
and crop start directly, with unity donor gain. `processing` owns default filter
and fades; per-file filters override it. Overlays retain explicit `layers`.
Frozen hashes remain independent of the candidate asset.

Historical preparation/capture tools and source-downmix measurement receipts stay
in Git history. Edits require licensed originals and fresh native decode/mix
validation, not a normal build. Delivery is
48 kHz Opus; spatial banks are mono and legacy gun layouts remain source-owned.
Foley/hit crops use 1 ms attack / 35 ms release fades and 20 ms energy matching
with respectively 9/8 dB peak headroom; other edit settings remain in provenance.

New-bank public-derivative clearance is an owner attestation, not independent legal
verification. Preserve original licence/entitlement records; media do not inherit
the code licence. Legacy firearm derivatives remain explicitly marked private in
`samples.ts`; clearance for newer banks or mixed gameplay captures does not grant
permission to distribute legacy raw samples or source-library masters.

## Validation

`npm test` checks assets, routing, selection, native clip timing and lifecycle.
Run `node tests/e2e/audio-start-gate-e2e.mjs` for fresh keyboard/mouse unlock,
optional failure and restart with a live audio clock but no gameplay hooks.
Run `node tests/e2e/audio-e2e.mjs` for native codec/automation regressions and
`node tests/e2e/audio-mix-e2e.mjs` for whole-mix hierarchy/headroom. The
`audio-game-e2e.mjs` and `audio-aircraft-e2e.mjs` checks exercise live game
integration. Aircraft loop-authoring/steadiness probes remain in Git history;
approved loop hashes stay frozen. Real-time AI captures are not sample-aligned A/Bs.
Measurements are regression evidence, not perceptual or final human acceptance.
