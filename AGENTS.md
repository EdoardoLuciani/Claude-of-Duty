# Working in this repository

Browser FPS: **Three.js + Vite + WebGPU**. Read [ARCHITECTURE.md](ARCHITECTURE.md)
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

## Commands and invariants

```sh
npm ci                 # preferred clean install
npm test               # Vitest runs tests/smoke/ scripts
npm run lint           # oxlint src tools tests --deny-warnings
npm run build          # must pass
npm run world:validate # required when world/prop assets change
npm run world          # compile world source and cook collision
npm run dev            # local server; not needed for CI-only work
```

- Tests and build must pass from a clean install: no missing imports/exports or
  assets available only on another branch. Do not weaken/delete tests to pass CI.
  If a test is wrong, fix it and explain why in the PR.
- No formatter; match surrounding style. ES modules: `.js` in bundled source,
  `.mjs` for directly executed Node scripts.
- No new runtime dependencies without approval. Approved: `three` and pinned
  `@recast-navigation/core` + `@recast-navigation/wasm` for offline-baked navigation.
- Avoid hot-path allocations; keep draw calls/state changes low. Put tuning in
  weapon/world data, not scattered literals. Weapon changes must consider both
  definitions and animation/handling code in `src/weapons/`.
- Never commit secrets/API keys/`auth.json`-style files or log credential values.

## Assets and protected paths

Textures/animations are procedural or Blender-authored; runtime meshes are local
GLBs. World source lives in `tools/worldgen/`; meshoptimizer cooks collision in
Node. Normal builds use committed world assets. Change source and regenerate—do
not hand-edit `public/models/world/**`.

`AGENTS.md`, `.github/workflows/*` and package manifests are protected: changes
require human review and must be minimal and intentional. Do not modify these
without a specific issue requirement:
- `dist/`, `shots/`, `node_modules/` (generated/ignored).
- `public/models/world/**` (generated only via world source).
- `.agents/skills/` (shared Pi/OpenCode skills).

Shared/lead-owned code is listed in ARCHITECTURE.md; coordinate before crossing
subsystem ownership. All runtime assets/WASM stay local, with no new network dependency.
