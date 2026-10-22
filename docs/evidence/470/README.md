# #470 normal-play evidence

Companion to [the report](../../run-lifecycle-470.md). Investigation only: **16 added natural death/restart cycles did not reproduce front-visible camping**. Stale hitbox selection input and changed anchor choices are confirmed; camping causation remains open. The targeted repair and fail-before/pass-after evidence are in [#493](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/493), not this docs PR.

## External evidence and provenance

Runtime: `c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592`; original investigation commit: `9c806cdc38d3cdd4ed43023cc8f1b0932b453f44`. Fedora 44, Chromium 155.0.8059.84, native AMD RDNA-4 WebGPU (`fallback=false`), 1280×720, normal `?q=high`, prewarm enabled, `deterministic=false`. Three seeds/five fresh contexts, forward/backward input routes. See the report for environment, timing and observation limits.

Raw JSON and images are removed from the current tree, **not minified or discarded**. Originals were copied and SHA-256-verified outside the repository at `/home/edoardo/Documents/470-evidence-9c806cd/original/` before removal. JSON cannot be uploaded with `gh --attach` (images/videos only); the approved preservation path is the original full commit in this branch's history, not a new release/host. No history rewrite is part of this correction. [Original JSON (blob)](https://github.com/EdoardoLuciani/Claude-of-Duty/blob/9c806cdc38d3cdd4ed43023cc8f1b0932b453f44/docs/evidence/470/observations.json) · [raw download](https://raw.githubusercontent.com/EdoardoLuciani/Claude-of-Duty/9c806cdc38d3cdd4ed43023cc8f1b0932b453f44/docs/evidence/470/observations.json). Remote commit and downloaded JSON bytes/hash were verified before removal.

Six screenshots were uploaded with `gh pr comment 492 --attach`: [attachment comment](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/492#issuecomment-6351207969). Each attachment was downloaded again and matched the original bytes/hash. SHA-256 values below hash the original unmodified files:

| Artifact / download                                                                                                                                               | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [observations.json](https://raw.githubusercontent.com/EdoardoLuciani/Claude-of-Duty/9c806cdc38d3cdd4ed43023cc8f1b0932b453f44/docs/evidence/470/observations.json) | `e715239d470097dfffb71ed01210c0c35ca40e19dc677ffd1ae59877bcc2a2f1` |
| [forward-death.jpg](https://github.com/user-attachments/assets/583bdc60-3858-4ccd-8e2e-40c31b94276b)                                                              | `5d825bb9e89616333e6a4c619175baae9803ec43e6214885c9c32e1d986d13a0` |
| [forward-restart1.jpg](https://github.com/user-attachments/assets/c8f414b6-3f6e-440d-8e5c-77516b17e2ae)                                                           | `5285573f23abd735bbcbdabcf1e0a091641a788066f39877635cd7808a59ceca` |
| [forward-restart4.jpg](https://github.com/user-attachments/assets/ff681f1f-2f1b-4d5b-a43f-9f528d83f818)                                                           | `59dc6cc1c994615a7f732a45487c5d4762c96dc73bc1bcb6adb448ebde40770a` |
| [backward-death.jpg](https://github.com/user-attachments/assets/500b3a4b-f3ab-4ef8-9fc0-821840c47622)                                                             | `c9c34313502326da6373412ec81dcdb6f954e41b3c945a2f0f303b0585c50b86` |
| [backward-restart1.jpg](https://github.com/user-attachments/assets/f508761a-5daa-4b64-9a7c-cc40af8f0ffb)                                                          | `e7e211159bc93dcced1c421bca3e9cad5b47fba680395d54036d2d73e6f44bce` |
| [backward-restart2.jpg](https://github.com/user-attachments/assets/86682fc5-f855-481d-8903-e9c7a8b9775d)                                                          | `5eb461bc6838e7f1da0027fe8d45be7decebc7641a8184e2a746536e3bbda1d6` |

JSON retains actual selection origins/endpoints, published actor IDs/positions, restored camera/frustum/bearing and separate LOS, first AI/movement/fire/damage, DOM/cached lock/control boundaries and image brackets/`retainedAs` mappings. `generation` is observer-assigned, not a runtime mechanism. Native readback rerenders the running graph, adds overhead and is bracketed rather than exactly the first-render snapshot; it is not deterministic capture mode. Point frustum/LOS tests are not whole-mesh raster visibility. Behind-camera projections are not visible pixels. Missing damage means not observed, not immunity.

## Reproduce using retained scripts

`reproduce.mjs` and `observer.mjs` use only the repository's installed Node/Playwright and existing `tools/lib/{browser-harness,native-render}.mjs`; no scratch imports/dependencies. Keep these beside one another at their current paths. Run `npm ci` at the repository root first. The served-response markers target the pinned runtime above and must match once; use that runtime for comparisons. Requires native hardware WebGPU, normal prewarm and a free port 5476. Fixed seed does not make async combat deterministic.

```sh
# Three contexts × four natural restarts: idle 20 s, click, W 8 s; later stationary.
# Extra waits after observing enabled New Game: 0 / 5 / 12 / 0 seconds.
PROBE470_OUT=/tmp/470-forward node docs/evidence/470/reproduce.mjs

# Two contexts × two natural restarts: idle 3 s, click, S 8 s; later stationary.
PROBE470_OUT=/tmp/470-backward PROBE470_SEEDS=4660,12648430 \
  PROBE470_CYCLES=2 PROBE470_MOVEMENT=KeyS PROBE470_INITIAL_WAIT_MS=3000 \
  node docs/evidence/470/reproduce.mjs
```

Only RNG seed and observation wrappers are injected into served responses; no on-disk runtime changes, placement/activation changes, forced deaths or invulnerability. The pure fresh-coordinate anchor counterfactual neither spawns actors nor consumes RNG. Outputs go outside the repo. No natural death within 90 s is recorded as blocked, not replaced by a lethal-damage fallback. Settings cap each invocation at three seeds × four cycles. Movement waits the full 8 s even if death occurs earlier; `enabledObservation.elapsed` is the actual observation time, not necessarily first eligibility.

The forward batch predates exact control-setter, planar-movement and anchor-counterfactual fields in the retained observer; its control boundary is nested respawn and 3D movement includes ground settling. All sixteen completed resets removed prior actor/corpse IDs and published six fresh actors with empty worker maps. This is **not** a forced late-worker/projectile race test or a gameplay regression suite. Pending/denied capture policy is now frozen-with-retry, **no continue-without-lock fallback**; separate #488 implementation is underway and is not measured by these base-runtime observations.
