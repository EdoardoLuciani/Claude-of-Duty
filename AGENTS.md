# Working in this repository

Browser FPS: **Three.js + Bun + WebGPU**. See [README.md](README.md) for setup
and commands. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing a subsystem.

## Workflow

- Use the **git worktree** provided for the task. Do not create another unless
  explicitly asked.
- Keep one change per branch. Use conventional commits, push, and open a PR
  against **develop**.
- For visual changes, attach before/after screenshots with `gh pr create --attach`
  (also supported by `gh pr edit` and `gh pr comment`).
- Prefer the smallest direct implementation; avoid speculative abstractions and
  unrelated refactors.
- Update ARCHITECTURE.md or README.md when a documented contract changes.
  Describe current behavior without duplicating values from code.

## Validation

- `bun run verify` is the CI gate and must pass from a clean install.
- Run `bun tools/export-world.ts` when world or prop assets change.
- Extend existing tests for bug fixes and invariants before adding new scripts.
  Don't test types, impossible inputs, source text, or one-off migrations, or add
  test-only exports to `src/`.

## Code and assets

- Use checked `.ts` for first-party runtime, test, tool, and world-authoring modules.
- No new runtime dependencies without approval. Approved: `three` and pinned
  `@recast-navigation/core` for offline-baked navigation. Keep runtime assets and
  WASM local; do not add runtime network dependencies.
- Avoid hot-path allocations and keep draw calls and state changes low. For weapon
  changes, consider both definitions and animation/handling in `src/weapons/`.
- Never commit secrets (including `auth.json`-style files) or log credentials.
- Edit world source in `tools/worldgen/`, not generated assets. To avoid a full
  rebake in a fresh worktree, copy `public/models/` and `.cache/` from a sibling
  worktree; stale assets still rebuild.
- Never edit generated or shared paths: `dist/`, `shots/`, `node_modules/`,
  `public/models/world/**`, and `.agents/skills/`.
- Change `AGENTS.md`, `.github/workflows/*`, and package manifests only when the
  task requires it. Keep changes minimal; they need human review.
