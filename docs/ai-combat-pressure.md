# Combat pressure (#318)

The existing state machine remains the executor; this is not a GOAP or behavior-tree migration.

- Visual acquisition has its own expiry clock. Sounds/reports guide investigation, not personal target acquisition or renewed suppression fire.
- Close acquired threats can pause cover travel, flanks and retreats. A retreating soldier fights until the threat breaks or suppression/weapon safety forces withdrawal. Routes resume through the normal follower. Squad holders can similarly stop at a useful medium-range firing lane.
- Suppression is defensive behavior, not an unconditional firing veto. Exposed soldiers retain acquired defensive fire while seeking shelter or withdrawing; only physically reached, verified protection permits a suppressed hide. Heavy pressure cancels peeks before another exposure, and light pressure shortens arrived peek windows. Existing suppression-related aim error, spread and burst gaps remain unchanged. Reload, muzzle alignment/LOS, personal visual memory and friendly-fire checks still gate every shot. Diagnostics distinguish `suppressed-hide`, `suppressed-move` and `suppressed-engage` rather than silently blocking an exposed soldier.
- Cover selection shortlists eight spatially separated positions. Each needs protection, a plausible eye/bore firing lane and a physically executable peek. Standing exposure is preferred to rounding high walls. Arrival tolerance and rifle raising matter; the actual muzzle/alignment/friendly-fire gates still decide every shot. Friendly-fire checks also query animated hitboxes, since the old torso-centre proxy could miss heads and limbs; a penetrable wall cannot waive that check.
- Failed cover is remembered in a bounded six-entry, eight-second local history, invalidated by a materially changed threat. Physical peek failures time out rather than repeatedly consuming exposure windows.
- A squad assigns at most one elevated member while another member can actually provide pressure. Fresh squad visual reports can justify movement but cannot grant that member firing permission. Excessive routes, stale contact and lost support during travel cancel the assignment.
- All paths use the existing two-solves/frame scheduler. No authored world geometry or tactical metadata was added. The world pipeline fingerprints `nav.js`, so regenerated manifest/navigation **provenance bindings** are necessary; visual/collision assets and native navigation/cover data remain unchanged.

New tactical thresholds live in `src/ai/tuning.js` (`TACTICS`). Damage, accuracy, acquisition reaction time and wave-size tuning remain unchanged. Telemetry adds visual age, combat action, cover failure and elevated-role diagnostics.

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
```

The pressure gate also accepts `--url=http://127.0.0.1:<preview-port>`, `--elevated-shot=/tmp/upper.png`, and individual `--scenario=flank|retreat|squad|elevated|blind-upper|suppressed`. `--baseline` records the old policy without applying improvement-specific gates; safety and provenance assertions still run. `--clean` requires a committed, unmodified serving revision. The harness injects only the placement helper when testing preview; gameplay still comes from the built bundle.

These are matched **controlled combat scenarios**, not reconstructed telemetry or unrestricted wave acceptance. They use real sensing, shooting, animation, navigation and collision. Grenades are disabled in these scenarios to isolate rifle pressure; the separate friendly-fire/intent E2Es retain grenade coverage. The player is stationary with extra health, and soldiers are neither rescued nor killed by the fixture. The positive elevated scenario requires an actual shot after physical upstairs arrival; the negative W3 scenario rejects an eye-clear but barrel-blocked window position. The six-second `suppressed` scenario sustains maximum incoming pressure through `Agent.suppress()` without overriding perception, cover or firing: it must still acquire and return safe fire. This isolates the suppression policy, not the separate sound-source/perception problems seen in the September 27 playtest.

Existing navigation-wait tests now place threats outside close-defense range, preserving their original wait and movement assertions. Blocked-peek tests allow the new bounded rifle-raise interval and assert no fire during it. The surface fixture's locked navigation envelope hash is refreshed only with regenerated bindings and re-executed physical outcomes.

## Human acceptance before merge

- Play matched early waves with the same loadout/player route before and after.
- Confirm pressure feels coordinated rather than overwhelming or omniscient.
- Check close encounters during retreats/flanks, sight loss while making noise, blocked peeks, and fights beneath occupied upper floors.
- Keep difficulty retuning separate until behavior is evaluated. More enemy shots alone do not establish enjoyable difficulty.
