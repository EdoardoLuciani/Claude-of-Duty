---
name: simplify-diff
description: Reviews a feature branch's diff against its base branch and simplifies it — removing dead code, duplicated logic, delegation wrappers, and defensive noise while preserving functionality exactly. User-invoked only: hidden from the model (disable-model-invocation), run with /skill:simplify-diff.
disable-model-invocation: true
---

# Simplify Diff

Shrink the LOC diff of a feature branch against its base while preserving
functionality. The goal is code that is simple and understandable: fewer
lines, fewer concepts, one source of truth — never cleverness.

> **Invocation.** This skill is user-only: `disable-model-invocation` hides it
> from the model's system prompt, so the model can never auto-invoke it. Run
> it with `/skill:simplify-diff` (optionally followed by the base branch, e.g.
> `/skill:simplify-diff main`). If skill commands are off, say so to the user
> and follow the procedure below manually.

## Procedure

1. **Scope the diff.**
   - `git diff <base>...HEAD --stat` then the full `git diff <base>...HEAD`.
   - Mid-pass: `git diff <previous-commit> HEAD` to review only the current
     pass's changes before committing.

2. **Hunt the patterns** (from the pass that produced this skill):
   - **Dead code** — unused return values, event-payload fields nobody
     consumes, unused parameters or methods. Grep for consumers before
     removing; a payload field that only a doc comment mentions is dead.
   - **Duplicated logic** — the same listener, filter, or earning rule in two
     systems. Ask: can one system *derive* its state from an existing event
     instead of re-implementing the rule? (Example: a secondary currency
     mirroring `score:change` deltas 1:1 — the policy becomes structural and
     the duplicate kill-filter listener, its helper method, and the constants
     import all die.)
   - **Pure delegation wrappers** — a method that only forwards to another
     object. If the caller already reaches that object for reads, have it
     write the same way and drop the wrapper.
   - **Defensive sanitization the caller guarantees** — clamps, rounding, or
     guards on inputs that only ever come from one internal caller.
   - **Mergeable duplicates** — repeated early-return blocks, hotkey
     cascades that are a map lookup, branches that differ only in data.
   - **Stale comments** — any comment that no longer matches the code (an
     anchor that moved, a key range that grew). Correcting them is part of a
     simplify pass even though it does not change LOC.

3. **Guardrails — do NOT simplify if:**
   - It removes correctness handling: state flags that fix real races (e.g.
     a one-frame suppression of the pause menu after the shop consumed the
     same Escape), guards against real edge cases (opening a shop over a
     death screen). Keep the honest fix; shrink its comment instead.
   - It trades explicitness for cleverness: a parameterized shared branch
     with conditional arrays reads worse than two explicit data tables.
   - It moves code between files just to dedupe: a 3-line duplication beats a
     shared util module.
   - It changes behavior or observable output — the repo's pixel-identity
     captures and HUD states are gates, not suggestions.

4. **Verify.**
   - `node --check` every changed file.
   - Run the repo's node smoke tests (e.g. `node tools/smoke-market.mjs`).
   - `npm run build`.
   - Run the e2e probe (e.g. `node tools/market-e2e.mjs`).
   - When semantics change (e.g. a mirror replaces direct events), update the
     tests to emit what the real system emits — and let the e2e probe rely on
     the real game's own emission instead of manual events.
   - Measure and report the net effect: `git diff <previous-commit> HEAD
     --stat` — the summary line should show more deletions than insertions.

5. **Commit** with a conventional message:
   `refactor(<area>): shrink the diff — <what you removed>` and enumerate
   each removal in the body so the review is self-explanatory.
