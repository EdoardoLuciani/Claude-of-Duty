# Claude of Duty

A browser FPS built with Three.js r187 (`0.187.0`), Vite and **WebGPU only**. Procedural and
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
imports and is checked by `npm run typecheck`. `npm run lint` requires explicit
return types on every TypeScript function, method, getter and callback (including
contextually typed functions and functions returning functions). Constructors and
setters have no return annotation; JavaScript helpers are outside this rule.
The compiler also checks implicit missing returns, missing `override` modifiers,
switch fallthrough, and exact optional properties: omit unset patch fields rather
than writing `undefined` over required defaults. Lint rejects floating/misused promises and unsafe narrowing
assertions (including `as unknown as T`), as well as explicit `any` and unsafe
assignment, argument, call, member access and return. Runtime boundaries must
validate unknown data; owned records should be constructed with their full type.
Regular lint rules cover `src/`, `build/`, `tools/`, and `tests/`. Missing return annotations
fail CI's lint step, not `tsc` itself. The narrow declaration additions in
`src/render/three-types.d.ts` describe APIs verified against the pinned Three.js
source; review them alongside the Three/@types upgrade checks.
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
Runtime-model optimization is explicit: `npm run models:cook -- p320` uses the
[shared gltfpack build recipe](build/README.md). Normal dev/build/CI consumes the
committed `.runtime.glb`; it does not require gltfpack. M4, MCX, P320, EVOLYS, MPX
and AX338 use cooked runtime assets. M590 keeps its native export pending the
fresh-source shared-glove clearance issue; its candidate is not published.

**Three.js pin:** published npm release `three@0.187.0`, with matching
`@types/three@0.187.0` and lockfile integrity hashes. The release bundles include the
upstream fixes, so no postinstall source-export correction or local Three edits
are needed. Native builder-local buffer names and declaration collision handling
([#34872](https://github.com/mrdoob/three.js/pull/34872)), plus per-object reference
attributes that let compatible instanced meshes safely share shader builds
([#35007](https://github.com/mrdoob/three.js/pull/35007)), remain upstream-owned.
Upstream also owns Fresnel and TRAA cleanup—those local corrections remain removed.
Review the release/export/shared-core and upstream source/bundle smoke guards, plus
`src/render/three-types.d.ts`, on every Three/@types upgrade.
Preserve the native buffer isolation/reuse guards plus native
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
After death, New Game is available after 2.85 seconds. It resets the run and
returns to the Start dialog; gameplay stays frozen until you select Start and
mouse capture succeeds. Terminal errors require Reload. Quality changes restart
the run; Defaults resets settings, not bindings. Gamepad sticks move/look; no
buttons are bound. F7/F8 are telemetry-only.

Survive escalating squads, earn credits and shop between waves. Hover or focus a
market weapon to preview it; click its card (Enter/Space on the focused card) to
keep it selected. Drag to orbit around the weapon and scroll to zoom; panning is
disabled. In the focused 3D view, arrows rotate, +/- zoom and Home resets.
Toolbar buttons also provide zoom and reset. Inspection never spends credits:
use the explicit Buy/Swap button to purchase. Resupply cards still buy on click.
This first customization increment previews the current authored configurations;
separate attachment purchases and iron-sight-only defaults are not implemented yet.

M4/P320 are the starting weapons; MCX, EVOLYS, MPX and AX338 are shop options.
The day/night clock
starts at 16:30 and advances nine hours per ten active minutes. Pause/shop freeze
it; the first 21:00 triggers a three-minute streetlight outage, not an interior outage.

Asset regeneration/reference notes: [arms](assets/player/arms/README.md),
[M4](assets/weapons/m4a1-block-ii/README.md), [MCX](assets/weapons/mcx-virtus/README.md),
[P320](assets/weapons/p320-compact/README.md), [EVOLYS](assets/weapons/fn-evolys-762/README.md),
[MPX](assets/weapons/sig-mpx/README.md), [AX338](assets/weapons/ax338/README.md).
Tests are not final human visual acceptance; see each asset's remaining limits.

## Diagnostics

- `node tools/capture.mjs`: named gameplay screenshot. Use final-output captures,
  not old intermediate-target PNGs, for appearance review.
- `node tools/profile.mjs`: sustained living-combat frame/CPU percentiles and hitches.
  GPU timestamps are unavailable; node-builder activity is not GPU compilation time.
  Historical WebGL results are not current WebGPU performance evidence. No universal
  cross-hardware frame-time threshold applies; compare matched runs only.

Keep capture/profile primitives and focused correctness checks. Task-specific
screenshot matrices, reels, map reports, GPU investigations and their methodology
notes are temporary: retired scripts stay in Git history, not a second maintained
tool catalogue. `npm test` is the correctness gate; it is not visual or combat-
performance acceptance.

For local telemetry open `/?telemetry=1`: **F7** marks a moment (optional note),
**F8** stops/downloads `cod-telemetry-<timestamp>.tgz`. It contains JSON and marked
view JPEGs; nothing uploads.
Console: `__TELEMETRY__.mark('note')`, `.summary()`, `.stop()`, `.download()`.
Unclamped wall-time hitches (>50 ms and >3× recent frame time) include resource/
node-builder deltas and available long-task attribution; these are activity clues,
not proof of a GPU compile/upload. Loaded-world and build provenance accompany runs.

Subsystem exceptions stop gameplay without retrying partial updates. Rendering
continues unless it failed; the reload-required error is exposed through
`__ENGINE__.error`, telemetry and rejected capture pumps.

## Automation

The `Validate` GitHub Actions workflow runs on pull requests and pushes to `main`
and `develop`. It checks formatting, types, lint, tests and the production build.
Changes go through pull requests into `develop`; only the owner promotes to `main`.
AI implementation, review, fix and automatic merge workflows have been retired.
