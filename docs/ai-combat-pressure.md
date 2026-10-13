# AI combat pressure

The existing state machine executes policy; thresholds live in
`src/ai/tuning.ts` (`TACTICS`), not a parallel planner or difficulty rebalance.

- Visual acquisition expires. Sounds/reports permit investigation, not fresh
  acquisition/suppression fire. Chest/head checks have independent LOS/cone/range
  but one awareness increment; camera bob/recoil/death aren't target evidence.
- Close acquired threats can interrupt tactical travel and later resume routes.
  Suppressed actors retain safe defensive fire; hide only at verified shelter.
  Reload, alignment, LOS/memory and animated friendly-hitbox gates always apply.
- Cover needs protection and executable eye/bore peeks; bound detours, remember
  failures until threat changes, and time out failed peeks, including deferred paths.
- One elevated squad member requires another supplying real pressure. Reports
  justify travel, not fire; stale contact/lost support/excess route cancel it.
- Gunfire is uncertain location evidence; impact danger can't refresh/move the
  shooter cue. Invalid/disconnected cues use bounded reachable observation.
- Persistent blocked muzzles try physical adjustment, retain failures and then
  investigate contact without losing flank/retreat routes. Fresh visual search
  ends only with a clear rifle lane; reload/vault/motion reset obstruction.
- Expired firing permission resumes contact travel/search, not combat from memory.
  Worker pending/cancelled admission follows [ai-worker.md](ai-worker.md).

## Validation

```sh
node tools/nav240/surface-gate.mjs --out=/tmp/pressure-surface.json
node tools/nav240/access-gate.mjs --out=/tmp/pressure-access.json
node tests/e2e/ai-ff-e2e.mjs
node tests/e2e/ai-intent-e2e.mjs
node tests/e2e/ai-pressure-e2e.mjs --clean --out=/tmp/pressure.json
node tests/e2e/ai-observation-e2e.mjs --clean --out=/tmp/observation.json
```

Pressure scenarios: `flank|retreat|squad|elevated|blind-upper|suppressed`.
Observation: `arch|roof|hidden|search|search-move`. Both accept URL/baseline/clean;
clean gates serving provenance. Preserve safety, real obstruction and nav hashes.
Controlled high-health stationary-player scenarios aren't unrestricted-wave or
difficulty acceptance; friendly-fire/intent E2Es retain grenade coverage.
The historical blind-upper friendly-fire failure and its resolved-shot safety fix
are documented in [the worker contract](ai-worker.md). The zero-friendly-hit gate
remains unchanged; this is not an outstanding worker-eligibility failure.
Human review needs matched waves/loadouts/routes; more shots alone aren't better
difficulty. Sustained moving-combat methodology: [profiling.md](profiling.md).
