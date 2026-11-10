# Claude of Duty

A browser FPS built with Three.js r187 (`0.187.0`), Bun and **WebGPU only**. Procedural and
Blender-authored assets load locally, with no runtime CDN.
[Updates](https://shumer.dev/newsletter) · [Engine contract](ARCHITECTURE.md) ·
[Contributor instructions](AGENTS.md)

```sh
bun ci
bun run dev          # builds stale generated assets, validates world assets, serves :5173
bun run test
bun run typecheck
bun run lint
bun run build
bun run build:ci     # CI build: generates the world, skips Blender/model assets
```

Bun (version pinned by `packageManager` in `package.json`) is the only toolchain:
it installs, type-checks (`bun check`), formats, lints, bundles, serves, runs the
tests and drives the asset tools. Node.js is not required.

All first-party code is strict TypeScript with explicit `.ts` imports. The root
`tsconfig.json` checks the browser game (`src/`); `tools/`, `build/` and `tests/`
each have their own `tsconfig.json` adding Bun/Node types (a new Bun-side folder
copies one). Type-aware Oxlint (`.oxlintrc.json`) enforces explicit return types and
bans `any`, unsafe assertions and floating promises. Validate unknown data at runtime
boundaries. In tests, prefer real instances and shared typed fixtures; only
`tests/lib/fixture.ts` may assert `Partial<T>` as `T` (issue
[#621](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/621)).
`src/render/three-types.d.ts` holds declarations verified against the pinned Three.js.

`bun run test` runs each smoke script in its own Bun process (30 s hang guard);
run one with `bun test ./tests/smoke/smoke-health-events.ts`.
(`noUncheckedIndexedAccess` status: [triage and plan](docs/no-unchecked-indexed-access.md).)
`bun run build` runs typecheck and lint first via `prebuild`.

### Formatting

`bun run format` writes and `bun run format:check` checks formatting with `bun fmt`
(Oxfmt, `.oxfmtrc.json`). Scope is in `package.json`; generated files, assets,
lockfiles, shared skills, protected workflow/agent files and one-row-per-record data
tables are excluded. Python, shell and SVG are not formatted. Preserve intentional
import evaluation boundaries, and keep bulk formatting separate from functional changes.
Formatting can change source-byte caches, so dev/build/tests may refresh generated
products; never hand-edit them or rebuild Blender assets just to format source.

A WebGPU-capable browser/device is required. `bun run dev` / `bun run build` run
`tools/build-assets.ts`: Blender models, gltfpack cooks, procedural textures,
the spent hull and the world are generated, not committed. Each step reruns only when
its inputs change or an output is missing; the first build needs **Blender 5.2.2** and
**gltfpack 1.3** on `PATH` (or `BLENDER`/`GLTFPACK`) and takes several minutes.
`bun run test` and `bun run build:ci` generate the world with Bun, without Blender.
Browser capture, profiling and world-smoke tools show asset-build progress and allow
15 minutes for server startup. Set `OW_STARTUP_TIMEOUT_MS` (milliseconds) for slower
machines; this is separate from browser/page timeouts. An already-running server is reused.
Change map content in
`tools/worldgen/level/`; the [world editing map](tools/worldgen/README.md) identifies
shape, placement and build locations. Regenerate with `bun run world`, then run
`bun run world:validate`. Use `bun run world -- --force` to rebuild unchanged inputs;
`bun run world -- --check` verifies a fresh rebuild against the generated outputs.
Runtime models are cooked with the [shared gltfpack build recipe](build/README.md)
during dev/build; `bun run models:cook -- p320` reruns one cook. All seven authored weapons
use cooked runtime assets. Native exports remain authoring references; each model
has its own geometry, material and animation acceptance gates.

**Three.js pin:** `three@0.187.0` with matching `@types/three@0.187.0`, unmodified.
On upgrade, review `src/render/three-types.d.ts` and keep the renderer smoke guards
(release/export/shared-core, native buffer isolation/reuse, startup/lifetime/failure)
passing. Renderer follow-ups: [#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).

## Play

The gameplay HUD is drawn with PixiJS on WebGPU; menus, startup/error controls and
the field-radio panel are native DOM. If the HUD fails to initialize, a Reload error
dialog appears.
[HUD ownership, boundaries and checks](docs/hud.md).

After loading, select **Start** to capture the mouse and begin. Pending or denied
mouse capture keeps the run frozen; select **Retry Start** to retry (there is no
unlocked-play fallback). Once playing, click the game canvas to reacquire the
cursor (also a fire press). The pause menu contains the full keyboard/mouse
reference, including contextual behaviors.
Bindings are fixed defaults in `src/core/bindings.ts`.

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
market item to preview it; click its card (Enter/Space on the focused card) to
keep it selected. Supplies use locally bundled painted illustrations; weapons retain
interactive 3D previews. Drag to orbit around the weapon and scroll to zoom; panning is
disabled. In the focused 3D view, arrows rotate, +/- zoom and Home resets.
Toolbar buttons also provide zoom and reset. Inspection never spends credits:
use the explicit Buy/Swap button to purchase supplies or weapons.

M4/P320 are the starting weapons; MCX, EVOLYS, MPX, AX338 and M590 are shop options.
The day/night clock
starts at 16:30 and advances nine hours per ten active minutes. Pause/shop freeze
it; the first 21:00 triggers a three-minute streetlight outage, not an interior outage.

For edit locations, source/generated ownership and regeneration commands, see the
[asset and world editing map](docs/assets.md).

Asset regeneration/reference notes: [arms](assets/player/arms/README.md),
[M4](assets/weapons/m4a1-block-ii/README.md), [MCX](assets/weapons/mcx-virtus/README.md),
[P320](assets/weapons/p320-compact/README.md), [EVOLYS](assets/weapons/fn-evolys-762/README.md),
[MPX](assets/weapons/sig-mpx/README.md), [AX338](assets/weapons/ax338/README.md),
[M590](assets/weapons/m590/README.md).
Tests are not final human visual acceptance; see each asset's remaining limits.

## Diagnostics

- `bun tools/capture.ts`: named gameplay screenshot. Use final-output captures,
  not old intermediate-target PNGs, for appearance review.
- `bun tools/profile.ts`: sustained living-combat frame/CPU percentiles and hitches.
  GPU timestamps are unavailable; node-builder activity is not GPU compilation time.
  Compare matched runs only; there is no cross-hardware frame-time threshold.

Keep capture/profile primitives and focused correctness checks; task-specific
screenshot matrices, reels and investigation scripts are temporary and not committed. `bun run test` is the correctness gate; it is not visual or combat-
performance acceptance.

The material-graph, FX-recipe, physics-geometry and audio-recording smoke hashes
are **characterization**, not the definition of correct behavior. To inspect a
failure, run e.g. `DUMP_CHARACTERIZATION=1 bun tests/smoke/smoke-fx-recipes.ts > /tmp/fx-current.txt`.
Run the same test/seed on the base commit with pinned dependencies;
diff the dumps (WGSL, ordered payloads/RNG, query histories or recording order).
Review the change against the behavioral assertions and any required visual checks
before manually updating an expected hash. There is no automatic baseline update.

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
