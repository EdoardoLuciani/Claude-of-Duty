---
name: simplify-diff
description: "Simplifies a feature branch's diff against its base — removing dead code, duplicated logic, delegation wrappers, and defensive noise while preserving functionality. User-invoked only: hidden from the model, run with /skill:simplify-diff."
disable-model-invocation: true
---

# Simplify Diff

Shrink the LOC diff of a feature branch against its base while preserving
functionality. Simple and understandable: fewer lines, fewer concepts, one
source of truth — never cleverness.

> **Invocation.** User-only: `disable-model-invocation` hides this skill from
> the model. Run `/skill:simplify-diff [base]` (base defaults to main).

## Procedure

1. **Scope.** `git diff <base>...HEAD`; mid-pass, diff against the previous
   commit to review only the current changes.
2. **Hunt:**
   - Dead code — unused returns, payload fields nobody consumes, unused
     params/methods. Grep before removing.
   - Duplicated logic — the same listener/filter/rule in two systems. Can
     one *derive* state from an existing event instead of re-implementing
     the rule? (A currency mirroring `score:change` deltas 1:1 makes the
     policy structural and kills the duplicate listener.)
   - Pure delegation wrappers — if the caller already reaches the target for
     reads, have it write the same way.
   - Defensive sanitization the caller guarantees.
   - Mergeable duplicates — repeated early-return blocks, key cascades that
     are map lookups, branches differing only in data.
   - Stale comments.
3. **Guardrails — do NOT simplify if:** it removes correctness handling (race
   fixes, edge-case guards — keep them, shrink their comments); it trades
   explicitness for cleverness; it moves code between files just to dedupe
   (a 3-line dup beats a shared util); it changes behavior or observable
   output.
4. **Verify.** `node --check` changed files, run the repo's smoke tests and
   e2e probe, `npm run build`. When semantics change, update tests to emit
   what the real system emits. Report net LOC via
   `git diff <previous-commit> HEAD --stat` (deletions should win).
5. **Commit** `refactor(<area>): shrink the diff — <what you removed>` with a
   body enumerating each removal.
