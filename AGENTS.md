# AGENTS.md — Claude of Duty

Instructions for AI coding agents working in this repository. Read this file
FIRST, before touching any code.

## What this is

A browser first-person shooter built with **Three.js + Vite + WebGL2**, roughly
47k lines across 12 subsystems. The only runtime dependency is `three`.
Textures/animation are procedural; world meshes load from committed GLBs.
The world is authored as JS under `tools/worldgen/` and exported with `npm run
world`; meshoptimizer cooks collision directly in Node. Normal builds use the
committed assets without regenerating them.

## Architecture (subsystems in `src/`)

| dir | responsibility |
|---|---|
| `core` | boot, loop, input, events, math helpers, utils |
| `render` | HDR pipeline, shadows, GTAO, TAA, bloom, tonemapping |
| `materials` | procedural GPU texture forge (19 surfaces) |
| `sky` | atmospheric scattering, time of day, volumetric fog |
| `world` | street layout, building kit, props, spawns |
| `player` | movement, camera, health, weapon handling |
| `weapons` | weapon defs, ballistics, recoil, reload, inspect, attachments |
| `physics` | collision, projectiles, damage |
| `ai` | soldiers, squads, nav, animation state machine |
| `audio` | procedural sound, spatialization |
| `market` | shop/economy UI and logic |
| `ui` | HUD, menus, overlays |
| `fx` | impacts, particles, tracers, screen effects |
| `dev` | debug helpers, developer-only overlays |

`tools/` contains Node scripts (asset export, world validation, smoke tests,
capture/diff tooling). `docs/` has design docs — read the relevant one before
changing a subsystem.

## Commands

```bash
npm ci                 # clean install (preferred over npm install)
npm test               # vitest: tools/smoke-*.mjs
npm run lint           # oxlint src tools (warnings do not fail CI)
npm run build          # vite build — must pass
npm run world:validate # validates committed world assets (run when touching world)
npm run world          # compile JS world source and cook collision
npm run dev            # dev server (not needed for CI work)
```

There is no formatter. `npm run lint` is oxlint (warnings only). Match the surrounding style.

## Conventions

- **ES modules** (`"type": "module"`). Use `.mjs` for scripts run by Node
  directly; `.js` for code bundled by Vite. Prefer `.js` inside `src/`.
- **Plain, direct code.** This codebase favors straightforward imperative code
  over abstraction. Do not introduce classes/factories/DI for things a module
  or function handles today. Do not add speculative generality.
- **No new runtime dependencies.** `three` is the only runtime dependency and
  that is deliberate. If an issue truly requires a dependency, say so in the PR
  — the change will need explicit human approval (package manifests are
  protected files in the pipeline).
- **Performance matters.** Hot paths (per-frame, per-entity, per-particle) must
  avoid per-frame allocations where practical. Keep draw calls and state
  changes low.
- **Numbers over prose.** Tuning values (damage, recoil, speeds, economy)
  belong in the weapon/world data, not scattered as magic literals in logic.
- **Weapons data** lives in `src/weapons/` (definitions, animations, ammo
  behavior). Check both the def and the animation/handling code when changing
  weapon behaviour.
- **World assets are generated** (`public/models/world/`) — do not hand-edit
  committed generated files; change `tools/worldgen/` and regenerate them.
- **Commit messages:** conventional, e.g. `feat(weapons): ...`,
  `fix(player): ...`, `chore: ...` — see repository history.

## Invariants — do not break

1. `npm test` and `npm run build` must pass.
2. `npm run world:validate` must pass when world/prop assets change.
3. The game must run from a clean `npm ci` — no missing imports, no undefined
   exports, no accidental `main`-branch-only assets.
4. Do not weaken or delete smoke tests to make CI pass. If a test is wrong,
   fix the test *and* explain why in the PR.
5. `AGENTS.md`, `.github/workflows/*`, and package manifests are protected:
   changes to them are possible but will require human review — keep them
   minimal and intentional.
6. Never commit secrets, API keys, or `auth.json`-style files. Never log or
   echo credential values.

## Directories not to modify without a specific issue requirement

- `dist/`, `shots/`, `node_modules/` — generated/ignored.
- `public/models/world/**` — generated from `tools/worldgen/`.
- `.pi/` — local agent configuration (skills); pipeline-owned.
