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

`npm ci` installs the pinned [Oxfmt](https://oxc.rs/docs/guide/usage/formatter)
0.73.0 development tool; no global formatter or extra runtime dependency is needed.
Run `npm run format` to write formatting, and `npm run format:check` for a read-only
check (also run by validation CI). Both commands target maintained `src/`, `tools/`,
`tests/`, `docs/`, and the root source/docs/config files listed in `package.json`.

`.oxfmtrc.json` keeps two-space indentation, single quotes, semicolons, ES5 trailing
commas and a 100-column print width. Markdown prose keeps its existing wrapping;
import/package/Tailwind sorting, JSDoc rewriting and embedded-language formatting
are disabled to avoid unrelated or string-content changes. HTML uses strict
whitespace sensitivity. Oxfmt supports JS/TS, JSON, Markdown and HTML here; Python
(Blender authoring), shell scripts and SVG are not formatted.

The config excludes assets, generated public models and Blender-generated
`src/weapons/hand-poses.ts` / `src/weapons/bandage-path.ts`, build/capture output,
`node_modules`, lock files, generated report directories/`*-report.json`/`*-report.md`,
shared `.agents/` skills, `AGENTS.md`, `.github/` and the package manifest. Protected
files must be edited intentionally, not through a bulk formatter run. Git-ignored
output is also skipped. Keep functional changes and bulk formatting in separate
commits for review.

Formatting authoring inputs invalidates the procedural exporters' source-byte
caches even when behavior is unchanged. Normal `npm run dev`/`npm run build` tasks
refresh those caches through the exporters; committed procedural outputs should
remain byte-identical. World validation also checks raw source hashes, including
shared physics/navigation inputs. When those files are formatted, run `npm run world`
through the normal exporter and review/commit the required manifest/navigation
provenance refresh separately; verify geometry, collision and navigation topology
are unchanged. Never hand-edit generated files or regenerate Blender assets just
to format source.

A WebGPU-capable browser/device is required. Normal builds use committed world
and Blender assets, with no Blender requirement. Change world source in
`tools/worldgen/`, regenerate with `npm run world`, then run `npm run world:validate`.

**Three.js pin:** GitHub commit `313f1f582b61af64f76ffaa4f23b3abb3ff298a1`,
not a moving `dev` dependency. Its package version still says `0.186.0`; runtime
source reports `187dev`. `tools/compensate-three.mjs` selects the pinned ESM source
exports because committed bundles still lag the latest source fixes (including
[#34872](https://github.com/mrdoob/three.js/pull/34872), native builder-local buffer
names and declaration collision handling). The local WGSL edit is retired; its
reviewed upstream source remains hash-verified without modification. Commit, version
and hash guards validate all targets before writing; review them on every upgrade.
Upstream also owns Fresnel and TRAA cleanup—those local corrections remain removed.
Preserve the material oracle (`node tools/arm-material-audit.mjs --strict=1`),
buffer isolation/reuse probe (`node tests/e2e/buffer-names-e2e.mjs`), and native
startup/first-use/lifetime/failure checks. Stable names share GPU programs/pipelines,
not shader-builder state or object buffers.
Other renderer follow-ups: [#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).

## Play

Click the game canvas to lock/reacquire the cursor (also a fire press). The pause
menu contains the full keyboard/mouse reference, including contextual behaviors.
Static defaults come from `src/core/bindings.ts`; rebinding is a follow-up.
Only two defaults changed: **F interact → hold T interact**, and **T flashlight →
F flashlight**. All other bindings and gameplay behaviors are preserved; the
inactive V melee reservation is removed (melee was never implemented).

| Action                       | Previous → approved default        | Behavior                                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movement                     | WASD / arrow keys → unchanged      | Hold; forward/back also climb/dismount ladders.                                                                                                                                                                             |
| Look                         | Mouse → unchanged                  | Sensitivity/invert look are settings.                                                                                                                                                                                       |
| Jump / mantle / vault        | Space → unchanged                  | Press for buffered jump, stand-up, ladder jump-off or slide cancel; forward + jump / automatic ledge rules mantle or vault.                                                                                                 |
| Crouch / slide               | Left or Right Ctrl / C → unchanged | Toggle; while sprinting, slide subject to speed/cooldown; press again cancels slide.                                                                                                                                        |
| Prone                        | Z → unchanged                      | Toggle prone; when prone, request crouch.                                                                                                                                                                                   |
| Sprint / tactical sprint     | Left Shift → unchanged             | Hold while forward, standing and not aiming; double-tap then hold for tactical sprint. Right Shift is unbound.                                                                                                              |
| Lean left / right            | Q / E → unchanged                  | Hold, release to center; both cancel, grounded/non-prone and not sprinting/sliding.                                                                                                                                         |
| Fire / ADS                   | LMB / RMB → unchanged              | Auto: hold; semi: press; burst can continue after release. ADS is held, not toggled.                                                                                                                                        |
| Reload / fire mode / inspect | R / B / I → unchanged              | Press; supported modes only. Inspect/reload blocked with grenade/radio out; B still changes underlying gun mode.                                                                                                            |
| Equipped primary / secondary | 1 / 2 → unchanged                  | Select equipped slots, not fixed weapons; same-slot does not stow accessories.                                                                                                                                              |
| Weapon cycle                 | Tab / mouse wheel → unchanged      | Independent requests through equipped pair; either wheel direction advances. Switching/busy guards can reject requests, including simultaneous Tab + wheel.                                                                 |
| Ammo / intel                 | F → **hold T**                     | Ammo: 0.45 s in range, reserve space required. Intel: 4 s aimed, visible, stationary, hands free; damage/motion/release/busy hands cancel. Intel takes priority; release after securing before collecting ammo.             |
| Flashlight                   | T → **F**                          | Toggle on press while live; death/restart off, pause/shop preserve and ignore toggles.                                                                                                                                      |
| Bandage                      | Hold H → unchanged                 | 3 s, health/item only on completion. Walking allowed; release, sprint, jump/fall, slide, mantle, combat/equipment/switch, health damage or pause cancel.                                                                    |
| Grenade                      | G → unchanged                      | Equip/stow, not throw; can replace radio. LMB long / RMB short: press to spend/cook, hold burns fuse, release commits throw; overcook explodes in hand. Cooking/throw blocks switching.                                     |
| Radio                        | X → unchanged                      | Equip/stow; cannot replace grenade. While out: 1 immediately requests carpet bomb; 2/3 give locked feedback, not weapon selection. Ordinary 3 has no action. Accepted strike spends charge/stows; refusal leaves radio out. |
| Pause / cursor release       | Esc → unchanged                    | Pause/resume; lock loss also pauses. In shop: skip/close instead; death ignores pause. Resume requests lock.                                                                                                                |

**Native menus (unlocked):** mouse clicks activate buttons/purchases without
firing or locking; Tab / Shift+Tab traverse focus, Enter / Space activate buttons.
Arrows, Home/End and PageUp/Down adjust focused sliders; arrows / PageUp/Down or
wheel scroll the focused reference. After death, Enter/Space or New Game restart
when prompted (2.85 s delay). Terminal errors freeze gameplay: activate Reload.
Defaults resets settings/quality, not bindings, and changing quality restarts the
run. Gamepad left/right sticks move/look; no button actions are bound. Optional
telemetry F7/F8 remains diagnostic-only (see below).

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
