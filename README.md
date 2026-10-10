# Claude of Duty

A browser FPS built with pinned Three.js `187dev`, Vite and **WebGPU only**. Procedural and
Blender-authored assets load locally; no runtime CDN or WebGL fallback.
[Updates](https://shumer.dev/newsletter) · [Engine contract](ARCHITECTURE.md) ·
[Contributor instructions](AGENTS.md)

```sh
npm ci
npm run dev          # exports procedural models, validates world assets, serves :5173
npm test
npm run typecheck
npm run lint
npm run build
```

TypeScript migration is incremental: new or migrated `src/` modules use `.ts`,
with explicit imports and checked by `npm run typecheck`. Existing JavaScript
continues to run alongside TypeScript; broad `checkJs` adoption is deferred.

A WebGPU-capable browser/device is required. Normal builds use committed world
and Blender assets, with no Blender requirement. Change world source in
`tools/worldgen/`, regenerate with `npm run world`, then run `npm run world:validate`.

**Three.js pin:** GitHub commit `9681657f760197afa0a680b1e522a4340a6a53f8`,
not a moving `dev` dependency. Its package version still says `0.186.0`; runtime
source reports `187dev`. `tools/compensate-three.mjs` selects the pinned ESM source
exports because committed bundles lag the latest source fixes, and retains the
unmerged builder-local WGSL buffer-name correction. Commit/version/hash guards
validate all targets before writing; review them on every upgrade. Upstream now
owns Fresnel and TRAA cleanup—those local corrections have been removed.
Preserve the material oracle (`node tools/arm-material-audit.mjs --strict=1`),
buffer isolation/reuse probe (`node tests/e2e/buffer-names-e2e.mjs`), and native
startup/first-use/lifetime/failure checks. Stable names share GPU programs/pipelines,
not shader-builder state or object buffers.
Other renderer follow-ups: [#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).

## Play

Click to lock the cursor. WASD move; mouse aim; LMB fire; RMB ADS; R reload;
F collect/interact; Shift sprint; Ctrl crouch; Space jump; Q/E lean; I inspect;
Esc release cursor. 1/2 select primary/secondary; Tab/wheel cycle them.
G equips/stows grenades; X equips/stows the radio (1–3 select requests);
hold H for a bandage; T toggles the flashlight.

Survive escalating squads, earn credits and shop between waves. M4/P320 are the
starting weapons; MCX, EVOLYS, MPX and AX338 are shop options. The day/night clock
starts at 16:30 and advances nine hours per ten active minutes. Pause/shop freeze
it; the first 21:00 triggers a three-minute streetlight outage, not an interior outage.

Asset regeneration/reference notes: [arms](assets/player/arms/README.md),
[M4](assets/weapons/m4a1-block-ii/README.md), [MCX](assets/weapons/mcx-virtus/README.md),
[P320](assets/weapons/p320-compact/README.md), [EVOLYS](assets/weapons/fn-evolys-762/README.md),
[MPX](assets/weapons/sig-mpx/README.md), [AX338](assets/weapons/ax338/README.md).
Tests are not final human visual acceptance; see each asset's remaining limits.

## Diagnostics

- `node tools/capture.mjs`: named gameplay screenshot; `shotset.mjs`: multi-shot review.
- `node tools/baseline.mjs`: isolated native-readback captures. Verify repeatability
  before using `imagediff.mjs` as a strict pixel gate; shared-shot state can leak.
- `node tools/profile.mjs`: sustained living-combat frame/CPU percentiles and hitches.
  See [methodology and limitations](docs/profiling.md). GPU timestamps are unavailable;
  node-builder activity is not GPU compilation time. Historical WebGL results are
  not current WebGPU performance evidence.
- `node tools/webgpu-preview-check.mjs`: native preview composition, resize and lifetime.
  Use final-output captures, not old intermediate-target PNGs, for appearance review.
- [AI behaviour and controlled validation](docs/ai-combat-pressure.md).

For local telemetry open `/?telemetry=1`: **F7** marks a moment (optional note),
**F8** stops/downloads `cod-telemetry-<timestamp>.tgz`. It contains JSON and marked
view JPEGs; nothing uploads. Analyze with
`node tools/analyze-telemetry.mjs <run.tgz> [--out summary.json]`.
Console: `__TELEMETRY__.mark('note')`, `.summary()`, `.stop()`, `.download()`.
Unclamped wall-time hitches (>50 ms and >3× recent frame time) include resource/
node-builder deltas and available long-task attribution; these are activity clues,
not proof of a GPU compile/upload. Loaded-world and build provenance accompany runs.

Subsystem exceptions stop gameplay without retrying partial updates. Rendering
continues unless it failed; the reload-required error is exposed through
`__ENGINE__.error`, telemetry and rejected capture pumps.

## Automation

Owner-authorized issues run through an issue → `develop` pipeline: DeepSeek V4 Flash
via OpenCode Go implements; Grok 4.6 via OpenRouter reviews with read-only GitHub
access. CI, fix limits and squash merge are deterministic; only the owner promotes
to `main`. Actions secrets: `CODEX_API_KEY`, `OPENROUTER_API_KEY`,
`AI_CI_TRIGGER_TOKEN` (fine-grained PAT: Contents/Issues/PR read-write). Enable
**Allow GitHub Actions to create and approve pull requests**.
