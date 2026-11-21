# Claude of Duty

A browser FPS built with Three.js r187 (`0.187.0`), Bun and **WebGPU only**. Procedural and
Blender-authored assets load locally, with no runtime CDN.
[Updates](https://shumer.dev/newsletter) · [Engine contract](ARCHITECTURE.md) ·
[Contributor instructions](AGENTS.md)

```sh
bun ci
bun run dev     # builds stale generated assets, validates world assets, serves :5173
bun run verify  # CI gate: format:check, knip, build:ci, test
```

The full command list is in [AGENTS.md](AGENTS.md#commands-and-invariants).

Bun (version pinned by `packageManager` in `package.json`) is the only toolchain:
it installs, type-checks (`bun check`), formats, lints, bundles, serves, runs the
tests and drives the asset tools. Node.js is not required.

All first-party code is strict TypeScript with explicit `.ts` imports. The root
`tsconfig.json` checks the browser game (`src/`); `tools/`, `build/` and `tests/`
each have their own `tsconfig.json` adding Bun/Node types (a new Bun-side folder
copies one). Type-aware Oxlint (`.oxlintrc.json`) enforces explicit return types and
bans `any`, unsafe assertions and floating promises. Knip (`knip.json`) rejects
exports, files and dependencies nothing uses; scripts run directly belong in its
`entry` list. Validate unknown data at runtime
boundaries. In tests, prefer real instances and shared typed fixtures; only
`tests/lib/fixture.ts` may assert `Partial<T>` as `T` (issue
[#621](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/621)).
`src/render/three-types.d.ts` holds declarations verified against the pinned Three.js.

`bun run test` runs each smoke script in its own Bun process (30 s hang guard);
run one with `bun test ./tests/smoke/smoke-health-events.ts`.
`noUncheckedIndexedAccess` is off; enablement plan: [#657](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/657).
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
Browser capture, profiling and world-smoke (`bun tests/e2e/world-smoke.ts`) tools show asset-build progress and allow
15 minutes for server startup. Set `OW_STARTUP_TIMEOUT_MS` (milliseconds) for slower
machines; this is separate from browser/page timeouts. An already-running server is reused.
Change map content in
`tools/worldgen/level/`; the [world editing map](tools/worldgen/README.md) identifies
shape, placement and build locations, and the `bun tools/export-world.ts` options.
The seven authored weapons use the [shared gltfpack build recipe](build/README.md);
`bun build/models.ts p320` reruns one cook. The [spent hull](tools/blender/spent_hull/README.md)
keeps its validated native export to preserve the casing pool's vertex attributes.
Each model has its own geometry, material and animation acceptance gates.

**Three.js pin:** `three@0.187.0` with matching `@types/three@0.187.0`, unmodified.
On upgrade, review `src/render/three-types.d.ts` and keep the renderer smoke guards
(release/export/shared-core, native buffer isolation/reuse, startup/lifetime/failure)
passing. Renderer follow-ups: [#370](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/370).

## Play

The gameplay HUD is drawn with PixiJS on WebGPU; menus and startup/error controls
are native DOM. The field radio has no HUD panel: its handheld LCD is the interface.
If the HUD fails to initialize, a Reload error dialog appears.
[HUD ownership, boundaries and checks](docs/hud.md).

After loading, select **Start** to capture the mouse, enter fullscreen and begin.
Pending or denied mouse capture keeps the run frozen; select **Retry Start** to retry
(there is no unlocked-play fallback). Fullscreen is optional; where keyboard lock is
supported, shortcuts such as Ctrl+W (crouch + forward) stay in the game and a held
Esc exits fullscreen. The pause menu releases the mouse. Use **Resume** or press
Esc to return to play. If the browser doesn't recapture the mouse, click the game
canvas (also a fire press).
The pause menu has Gameplay, Audio and Controls tabs; Controls is the full
keyboard/mouse reference, including contextual behaviors.
Bindings are fixed defaults in `src/core/bindings.ts`.

| Keys                    | Action                                                 |
| ----------------------- | ------------------------------------------------------ |
| WASD, mouse             | Move and look; forward/back climb ladders              |
| Space                   | Jump / mantle / vault / ladder jump-off                |
| Left/Right Ctrl or C, Z | Toggle crouch/slide, prone                             |
| Left Shift, Q / E       | Sprint (double-tap for tactical sprint), lean          |
| LMB / RMB               | Fire / hold ADS                                        |
| R / B / I               | Reload / fire mode / inspect                           |
| 1 / 2, Tab / wheel      | Primary/secondary, cycle pair; stow grenade/radio      |
| Hold T, F, L            | Ammo/intel, flashlight / mounted laser toggle          |
| Hold H                  | Bandage (3 seconds; +50 HP on completion)              |
| G, then LMB / RMB       | Equip grenade; cook long/short throw, release to throw |
| X, then ↑ / ↓, Enter    | Radio; select a request, send it                       |
| Esc                     | Pause/resume; closes the shop instead while shopping   |

Intel takes priority over ammo and requires a four-second stationary, visible,
hands-free hold; release after completion before collecting ammo. Equipment and
movement can interrupt actions; the pause reference lists exact conditions.

Unlocked menus use native mouse, Tab/Shift+Tab and Enter/Space navigation; arrows
switch pause tabs, and arrow, Home/End and PageUp/Down keys adjust sliders or scroll
the focused reference.
After death, New Game is available after 2.85 seconds. It resets the run and
returns to the Start dialog; gameplay stays frozen until you select Start and
mouse capture succeeds. Terminal errors require Reload. Quality changes restart
the run; each settings tab has its own reset, which never changes bindings. Audio
sliders set master and per-category volume immediately and are saved in this
browser. Gamepad sticks move/look; no
buttons are bound. F7/F8 are telemetry-only.

Survive escalating squads, earn credits and shop between waves. Hover or focus a
market item to preview it; click its card (Enter/Space on the focused card) to
keep it selected. Supplies use locally bundled painted illustrations; weapons retain
interactive 3D previews. Drag to orbit around the weapon and scroll to zoom; panning is
disabled. In the focused 3D view, arrows rotate, +/- zoom and Home resets.
Toolbar buttons also provide zoom and reset. Inspection never spends credits.
Weapon cards open a customization draft: choose an optic, suppressor and laser from
verified fits, then **Buy Build / Apply Changes** or **Cancel**. The preview changes
immediately, along with a stats table comparing the base weapon, the owned build and
the draft (damage, fire rate, magazine, velocity, spread, recoil and ADS time, each
change labelled better or worse); gameplay and credits change only on confirmation.
Owned weapons charge only for new attachments, while a new weapon also costs its base
price. Removing or replacing an attachment discards it without a refund. Closing the
market cancels the draft; swapped-out weapons lose their attachments and restart clears
the loadout.
Supplies keep their immediate **Buy** buttons. All controls support keyboard use.

Every weapon starts on irons. All but the P320 accept the RMR, EXPS3, ACOG and PM II
scope; mounting one swaps removable irons for their stowed state (M590 keeps fixed
irons). Every weapon accepts the TOR Mini laser and a suppressor: the M4, MCX, MPX and
EVOLYS share the SRD762Ti; P320, AX338 and M590 mount dedicated cans. Attachments
trade handling, never ballistics: larger optics slow ADS, a can softens recoil but slows
ADS, and the laser tightens hip spread. A can also moves the projectile/flash origin to
its endcap and selects suppressed reports and a smaller flash; the laser draws a beam
and surface dot along its emitter axis without predicting spread or drop.
**L** toggles the mounted laser per gun, independently of the **F** flashlight.

For debug/capture, `attachmentOptic`, `attachmentRail` and `attachmentMuzzle` (`none`
clears a slot) configure an owned weapon at boot (`?attachmentWeapon=<id>`, default
`rifle`), as do
`tools/capture.ts --optic/--rail/--muzzle`, e.g.
`bun tools/capture.ts --weapon=rifle --optic=exps3 --shot=ads`.
`tools/profile.ts --rail=laser|none` provides matched laser performance captures.

M4/P320 are the starting weapons; MCX, EVOLYS, MPX, AX338 and M590 are shop options.
The day/night clock
starts at 16:30 and advances nine hours per ten active minutes. Pause/shop freeze
it; the first 21:00 triggers a three-minute streetlight outage, not an interior outage.

For edit locations, source/generated ownership and regeneration commands, see the
[asset and world editing map](docs/assets.md).

Asset regeneration/reference notes: [arms](tools/blender/player_arms/README.md),
[M4](tools/blender/m4/README.md), [MCX](tools/blender/mcx/README.md),
[P320](tools/blender/p320/README.md), [EVOLYS](tools/blender/evolys/README.md),
[MPX](tools/blender/mpx/README.md), [AX338](tools/blender/ax338/README.md),
[M590](tools/blender/m590/README.md).
Tests are not final human visual acceptance; see each asset's remaining limits.

## Diagnostics

- `bun tools/capture.ts`: named gameplay screenshot. Use final-output captures,
  not old intermediate-target PNGs, for appearance review. For a specific weapon
  gesture, use e.g. `--weapon=mcx --clip=reloadEmpty --at=2.5 --out=/tmp/mcx-charge.png`.
  This poses the viewmodel clip directly, not a gameplay reload/ammunition test;
  gesture names are the playable aliases (`reloadEmpty`, `inspect`, `draw`, etc.).
  It steps the real clip clock to the first sampled pose at/after `--at`, reports
  requested/actual seconds and stepped frames, and fails if the clip stops,
  changes or its clock stalls. The target must be inside the clip; `--at=0`
  captures its first stepped pose. Grenade, radio and bandage poses are rejected;
  use a weapon shot instead. Do not combine with `--reload` or `--list`.
- `bun tools/profile.ts`: sustained living-combat frame/CPU percentiles and hitches.
  GPU timestamps are unavailable; node-builder activity is not GPU compilation time.
  Compare matched runs only; there is no cross-hardware frame-time threshold.
  `--production` profiles the existing `dist/` (`bun run build` first) via
  `bun build/bun.ts preview`.

Keep capture/profile primitives and focused correctness checks; task-specific
screenshot matrices, reels and investigation scripts are temporary and not committed. `bun run test` is the correctness gate; it is not visual or combat-
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

The `Validate` GitHub Actions workflow runs `bun run verify` on pull requests and pushes to `main`
and `develop`: formatting, types, lint, the production build and tests.
Changes go through pull requests into `develop`; only the owner promotes to `main`.
