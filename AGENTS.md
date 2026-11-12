# Working in this repository

Browser FPS: **Three.js + Bun + WebGPU**. Read [ARCHITECTURE.md](ARCHITECTURE.md)
before subsystem changes: it owns directory assignments, APIs and event contracts.
[README.md](README.md) covers setup/play; `tests/` contains smoke/browser checks,
`tools/` contains authoring, validation and capture harnesses.

## Workflow

- Before modifying files, create a dedicated **git worktree**; do all work there.
- Keep one change per branch. Commit and push, then open a PR against **develop**.
- For visual changes, attach before/after screenshots with `gh pr create --attach`
  (also supported by `gh pr edit` and `gh pr comment`).
- Use conventional commits: `feat(weapons): ...`, `fix(player): ...`, `chore: ...`.
- Prefer the smallest direct implementation. No speculative frameworks, factories,
  DI or unrelated refactors. Ask before disproportionate line/complexity growth.

## Tests

- Add tests sparingly: only for a fixed bug or an invariant that could silently
  break. Extend an existing script before adding a new one.
- Never test types, impossible inputs, source text or one-off migrations, and
  never add test-only exports to `src/`.
- Test lines count as growth: a test diff larger than its source diff needs a
  reason in the PR.

## Commands and invariants

```sh
bun ci                 # preferred clean install
bun run test           # Bun runs tests/smoke/ scripts in isolated parallel processes
bun run lint           # type-aware Oxlint runs on Bun; warnings fail
bun run build          # must pass
bun run world:validate # required when world/prop assets change
bun run world          # compile world source and cook collision
bun run dev            # local server; not needed for CI-only work
```

- Tests and build must pass from a clean install: no missing imports/exports or
  assets available only on another branch. If a test is wrong, fix it and explain
  why in the PR.
- Use `bun run format` and `bun run format:check` (`bun fmt`); scope and exclusions
  are documented in README.md. All first-party runtime, test, tool and world-authoring
  ES modules use checked `.ts` source.
- No new runtime dependencies without approval. Approved: `three` and pinned
  `@recast-navigation/core` + `@recast-navigation/wasm` for offline-baked navigation.
- Avoid hot-path allocations; keep draw calls/state changes low. Put tuning in
  weapon/world data, not scattered literals. Weapon changes must consider both
  definitions and animation/handling code in `src/weapons/`.
- Never commit secrets/API keys/`auth.json`-style files or log credential values.

## Assets and protected paths

Textures/animations are procedural or Blender-authored; runtime meshes are local
GLBs. World source lives in `tools/worldgen/`; meshoptimizer cooks collision in
Bun. Dev/build/tests generate missing or stale world assets; products are ignored,
not committed. Change world source, never hand-edit `public/models/world/**`.
In a new worktree, copy `public/models/` and `.cache/assets/` from a sibling
worktree to avoid a full rebake; source hashes still rebuild anything stale.

`AGENTS.md`, `.github/workflows/*` and package manifests are protected: changes
require human review and must be minimal and intentional. Do not modify these
without a specific issue requirement:
- `dist/`, `shots/`, `node_modules/` (generated/ignored).
- `public/models/world/**` (generated only via world source).
- `.agents/skills/` (shared Pi/OpenCode skills).

Shared/lead-owned code is listed in ARCHITECTURE.md; coordinate before crossing
subsystem ownership. All runtime assets/WASM stay local, with no new network dependency.
