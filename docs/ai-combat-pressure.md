# AI combat pressure

The existing state machine remains the executor; thresholds live in
`src/ai/tuning.js` (`TACTICS`), not a new GOAP/tree or difficulty rebalance.

## Behaviour contracts

- Personal visual acquisition has an expiry clock. Sounds/reports permit
  investigation, never fresh acquisition or renewed suppression fire. Check chest,
  then head/upper capsule with independent cone/range/LOS but one awareness increment.
  Lean tilts the damage capsule; camera bob/recoil/death motion is not evidence.
- Acquired close threats may interrupt cover/flank/retreat travel; normal routes
  resume afterward. Exposed suppressed soldiers retain safe defensive fire.
  Hide only at physically verified shelter; heavy pressure cancels peeks.
  Reload/alignment/LOS/memory/friendly-fire gates always apply, including animated
  hitboxes behind penetrable walls.
- Cover shortlists eight separated positions with protection and executable
  eye/bore peeks. Failed cover: six-entry/eight-second history, invalidated by
  changed threat. Time out failed peeks. Walking budget: 26 m new/12 m replacement
  and ≤2.5× direct +4 m, checked even for deferred solves.
- At most one elevated squad member while another supplies actual pressure.
  Reports can justify travel, not firing. Cancel on stale contact, excess route
  or lost support. Use existing two-solves/frame scheduler, no duplicate nav.
- Gunfire is uncertain location evidence; impacts raise danger/suppression but
  cannot move/refresh shooter clues. Cool down impact spam. Probe bounded reachable
  observation positions for invalid/disconnected elevated cues, otherwise look once.
- Persistent stationary world-blocked muzzle: try a bounded physical adjustment,
  remember failed spots, then investigate stored contact if needed. Preserve flank/
  retreat routes. Fresh sight during search needs a clear rifle lane before stopping;
  obstruction recovery requires .25 s clear lane. Reload/vault/movement reset the
  obstruction timer; brief settling decays it. No map-specific exceptions.
- Expired firing permission resumes retained contact travel or investigation;
  acquisition memory alone cannot re-enter combat. Inactive firing clears stale
  muzzle obstruction. Damage/accuracy/reaction/wave-size tuning remains separate.

Telemetry includes visual age, contact kind/sample, combat action, cover failure,
observation search and elevated roles. World/nav geometry is unchanged by these
behaviour follow-ups; authoring fingerprint changes still require regenerated bindings.

## Validation

```sh
npm ci
npm test
npm run lint
npm run build
npm run world:validate
npm run world -- --check
node tools/nav240/surface-gate.mjs --out=/tmp/pressure-surface.json
node tools/nav240/access-gate.mjs --out=/tmp/pressure-access.json
OW_E2E_PORT=5389 node tests/e2e/ai-ff-e2e.mjs
OW_E2E_PORT=5389 node tests/e2e/ai-intent-e2e.mjs
node tests/e2e/ai-pressure-e2e.mjs --clean --out=/tmp/pressure.json --shot=/tmp/pressure.png
node tests/e2e/ai-observation-e2e.mjs --clean --out=/tmp/observation.json --shot=/tmp/arch.png --roof-shot=/tmp/roof.png
```

Both combat gates accept `--url`, `--baseline` and `--clean`; clean requires the
serving revision to match the committed checkout. Only placement helpers are
injected into preview, not gameplay. Pressure scenarios:
`flank|retreat|squad|elevated|blind-upper|suppressed` (`--elevated-shot` optional).
Observation: `arch|roof|hidden|search|search-move`. Baseline retains safety/provenance
gates. Suppressed sustains real suppression without overriding perception/fire;
elevated requires upstairs arrival plus a shot; hidden cannot acquire/fire.

These are controlled scenarios with stationary high-health players and no rifle-
fixture grenades, not unrestricted wave or difficulty acceptance. Friendly-fire/
intent E2Es retain grenade coverage and use 10,000 HP to avoid testing against a
disabled corpse. Preserve safety assertions, blocked-peek raising intervals,
real-character obstruction recovery and regenerated navigation hash checks.

For human acceptance, verify served/exported provenance, then play matched early
waves/loadouts/routes: close flank/retreat fights, noisy sight loss, blocked peeks
and occupied upper floors. More enemy shots alone do not prove enjoyable difficulty.
For sustained moving-combat performance use [profiling.md](profiling.md).
