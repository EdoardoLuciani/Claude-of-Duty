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

Node.js 24.x is required; Node-run tools and smoke tests load migrated `.ts`
modules using native type stripping. Runtime TypeScript uses explicit `.ts`
imports and is checked by `npm run typecheck`. `npm run lint` bans explicit `any`
and unsafe assignment, argument, call, member access and return through its
type-aware pass; regular rules also cover `src/`, `tools/`, and `tests/`.
`npm run build` runs typecheck and lint first via `prebuild`. Remaining JavaScript
helpers run alongside TypeScript; broad `checkJs` adoption is deferred.

### Formatting

Run `npm run format` to write formatting; `npm run format:check` checks it in CI.
Both use the pinned [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) from `npm ci`.
The command scope is in `package.json`; style and exclusions are in `.oxfmtrc.json`.
Generated files, assets, reports, lockfiles, shared skills and protected workflow/
agent instructions are excluded. Python, shell and SVG are not formatted.

Import sorting respects comment partitions, but bound imports can cross bare
side-effect imports. Preserve intentional evaluation boundaries and fix exposed
initialization dependencies. Package sorting preserves script order and conditional
exports/imports precedence. Keep bulk formatting separate from functional changes.

Source-byte caches can change after formatting: dev/build refresh procedural
exports; shared physics/navigation inputs also require `npm run world`. Review and
commit provenance refreshes separately, verifying unchanged geometry, collision and
navigation topology. Never hand-edit generated assets or rebuild Blender assets
just to format source.

A WebGPU-capable browser/device is required. Normal builds use committed world
and Blender assets, with no Blender requirement. Change world source in
`tools/worldgen/`, regenerate with `npm run world`, then run `npm run world:validate`.

**Three.js pin:** GitHub commit `e27dfa95ae7f453b5d7a9a36ffdb563f7c9b529b`,
not a moving `dev` dependency. Its package version still says `0.186.0`; runtime
source reports `187dev`. `tools/compensate-three.mjs` selects the pinned ESM source
exports because committed bundles still lag the latest source fixes. This pin
includes native builder-local buffer names and declaration collision handling
([#34872](https://github.com/mrdoob/three.js/pull/34872)), plus per-object reference
attributes that let compatible instanced meshes safely share shader builds
([#35007](https://github.com/mrdoob/three.js/pull/35007)). The local WGSL edit is retired; its
reviewed upstream source remains hash-verified without modification. Commit, version
and hash guards validate all targets before writing; review them on every upgrade.
Upstream also owns Fresnel and TRAA cleanup—those local corrections remain removed.
Preserve the material oracle (`node tools/arm-material-audit.mjs --strict=1`),
buffer isolation/reuse probe (`node tests/e2e/buffer-names-e2e.mjs`), and native
startup/first-use/lifetime/failure checks. Compatible native instancing now shares
shader-builder state and GPU programs/pipelines, never object buffers. Upstream
keeps builds that embed object-specific data out of the shared builder cache.
Other renderer follow-ups: [#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).

## Play

After loading, select **Start** to capture the mouse and begin. Pending or denied
mouse capture keeps the run frozen; select **Retry Start** to retry (there is no
unlocked-play fallback). Once playing, click the game canvas to reacquire the
cursor (also a fire press). The pause menu contains the full keyboard/mouse
reference, including contextual behaviors.
Static defaults come from `src/core/bindings.ts`; rebinding is a follow-up.

| Keys                    | Action                                                 |
| ----------------------- | ------------------------------------------------------ |
| WASD / arrows, mouse    | Move and look; forward/back climb ladders              |
| Space                   | Jump / mantle / vault / ladder jump-off                |
| Left/Right Ctrl or C, Z | Toggle crouch/slide, prone                             |
| Left Shift, Q / E       | Sprint (double-tap for tactical sprint), lean          |
| LMB / RMB               | Fire / hold ADS                                        |
| R / B / I               | Reload / fire mode / inspect                           |
| 1 / 2, Tab / wheel      | Equipped primary/secondary, cycle pair                 |
| Hold T, F               | Ammo/intel interaction, flashlight toggle              |
| Hold H                  | Bandage (3 seconds; +50 HP on completion)              |
| G, then LMB / RMB       | Equip grenade; cook long/short throw, release to throw |
| X, then 1 / 2 / 3       | Radio; immediate carpet-bomb request / locked requests |
| Esc                     | Pause/resume; closes the shop instead while shopping   |

Intel takes priority over ammo and requires a four-second stationary, visible,
hands-free hold; release after completion before collecting ammo. Equipment and
movement can interrupt actions; the pause reference lists exact conditions.

Unlocked menus use native mouse, Tab/Shift+Tab and Enter/Space navigation; arrow,
Home/End and PageUp/Down keys adjust sliders or scroll the focused reference.
After death, restart is available after 2.85 seconds. Terminal errors require
Reload. Quality changes restart the run; Defaults resets settings, not bindings.
Gamepad sticks move/look; no buttons are bound. F7/F8 are telemetry-only.

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
