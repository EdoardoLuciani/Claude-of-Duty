# Run lifecycle investigation — #470

Investigation of [#470](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/470), not a runtime fix or approval of gameplay tuning. All source references and measurements below target **`c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592`**, the `origin/develop` base of `docs/470-run-lifecycle-spike`. No runtime source, dependencies, assets or protected files were changed.

## Result and confidence

- **Reproduced:** normal initial loading ends without a Start action; wave 1, AI movement/perception/fire and scaled time run without pointer lock or any player gesture. This is both browser-observed and explained by the startup sequence.
- **Not reproduced:** enemies surviving a completed restart, appearing immediately at point-blank range/in front of the restored view, or unavoidable immediate post-restart death. Three natural deaths/restarts removed all prior actor identities and supplied six new actors each time, initially at least 18.26 m from the reset feet. This is not a declaration that the reported camping never happens.
- **Observed separately:** enemies continue moving during the death camera; some approach the future respawn location. During nested `player:respawn`, old agents can briefly be close to the reset position, but AI cleanup completes synchronously before another frame/render. This transient snapshot is **not** evidence of retained enemies visible after restart.
- **Confirmed handoff vulnerability under fault injection:** suppressing the restart pointer-lock request leaves `controlEnabled=true`, AI active and damage possible while unlocked. This proves absence of a successful-control gate, not a naturally occurring browser denial or the original camping cause.
- **Confirmed policy boundary, synthetic geometry only:** the >18 m test applies to anchors, not final jittered positions; neither final placement nor fallback checks visibility. A direct call of the existing placement method admits a 14.9 m point from an 18.1 m anchor. Real-map unsafe placement as the camping cause remains a hypothesis.

## Environment and provenance

Measured 2026-10-22 (host UTC clock; command output showed 20:20 UTC / local logs 21:20). Dedicated existing worktree `/home/edoardo/Documents/cod-issue-470`; runtime tree clean during measurements. Fedora Linux 44, kernel `7.2.11-200.fc44.x86_64`, x86-64, AMD Ryzen 9 9950X (32 logical CPUs); Node `v24.18.0`, npm `11.16.0`, Playwright `1.64.0`, Chromium `155.0.8059.84`, headless, 1280×720, scale 1, mute audio. Repository `launchChromium` selected native WebGPU **AMD / RDNA-4 / fallback=false**. No WebGL, skipped warmup, invulnerability, god mode or new dependencies.

`npm ci` installed pinned Three commit `0978e2b62e53654ebe1a2c3032ebee0a4981c701` (package `0.186.0`, runtime 187dev), Vite `8.3.3`. World `public/models/world/level.json`: sourceHash `96829f606dea197d`, SHA-256 `f8c5b170fa11224ade370457fe060f17bb8e9e96c6969617430fff91fdd4aaa6`. Uninstrumented browser `window.__BUILD_REVISION__` reported the exact clean base revision above.

### Reproduction and observation method

1. `npm ci`; use `tools/lib/browser-harness.mjs`'s `ensureViteServer`, `launchChromium`, `stopViteServer`, and `tools/lib/native-render.mjs`'s `waitForGame`. Fresh Playwright browser/context, navigate **`http://127.0.0.1:5470/?q=high`**. No `capture`, `deterministic`, `lockstep`, `shot` or `prewarm=0`: those change gameplay/population and cannot establish normal-run behavior.
2. Wait for real readiness; do not click. Sample initial state and again after 20 wall seconds. Record `time.frame/elapsed/raw/scale`, input enabled/lock, player control/dead/health/armour/feet, wave state, per-agent identity/alive/state/feet/distance, and worker jobs/scopes/proofs. Listen to AI `weapon:fire`, `damage:taken`, `player:death`, `player:respawn`, `wave:start/complete`, `game:restart`; copy vectors and snapshots immediately, never retain pooled event data.
3. Click canvas center; hold W eight wall seconds, release; otherwise do not fight. Wait up to 60 seconds for natural death. A scripted 10000-damage fallback existed but **was not used in any of the three main cycles**. Wait another five wall seconds after death (longer than the 2.85 s UI delay), click **NEW GAME**, sample immediately (2–3 subsequent frames here) and five seconds later. Repeat for three deaths/restarts, remaining stationary after the first movement segment.
4. Full navigation to the same URL in that context, with the same seed observation route; wait another 20 seconds without gestures. This compares initial placement/activation, not an identical worker-admission combat replay. Browser/context was fresh at the start; this reload retained the context's storage/cache.
5. Independent uninstrumented baseline: fresh page, normal random seed and URL, no served-module routes or function wrappers. Observe five seconds after readiness. The only observation is a post-readiness event listener and final snapshot. This confirms the missing Start behavior without seed injection.
6. Separate adverse handoff probe: same fixed-seed normal URL; after five seconds apply scripted lethal damage, wait five more, replace **only** `engine.input.requestPointerLock` with a no-op immediately before clicking NEW GAME; observe 20 more seconds. This deliberately models a missing successful handoff, not an actual browser rejection. Keyboard/gamepad capability is not equated with mouse-look readiness.

Instrumentation was **Playwright response routing only**, not disk edits. After Vite transforms `src/core/engine.ts`, replace the single expression `Math.random() * 2 ** 32 >>> 0` with `0x5eed1234` (1592594996), leaving `config.deterministic=false`. In transformed `src/main.ts`, immediately before `engine.start();`, install the snapshot/event listeners above and wrap `ai.update` to count/observe calls without altering arguments or results. Main cycle samples were taken every 60 frames, with event snapshots at synchronous dispatch boundaries. The adverse probe additionally recorded the first AI update for each first-agent ID and wrapped the existing one-shot `engine.onFirstRender` callback to snapshot before/after calling it. Assert route markers match once; route failures must fail the probe. Routes disappeared when the browser closed; no temporary source edits required reversion.

Distances below are `agent.position.distanceTo(player.position)` (3D feet-to-feet), not screen distance or the stance-adjusted anchor test. LOS was queried separately with `physics.lineOfSight(player.rig.eyePosition, agent.eye)` using its default sight mask. This does **not** test frustum/front-facing visibility. On synchronous restart events the rig/camera can still be the death-camera pose until the next player update; do not interpret those LOS samples as restored-view visibility. Only post-frame LOS is discussed below. Snapshotting/raycasting allocates and can affect timing; checks ran on the same host, not a performance benchmark. Scratch scripts/logs under `/tmp/470-*` are intentionally not committed. The durable evidence is the bounded observations here, not a claim of exact wall-time replay.

### Minimal independent console observer

After normal readiness, this read-only observer plus the UI steps above reproduces the identity/handoff evidence without modifying runtime modules (it does not capture the pre-first-render boundary):

```js
const e = window.__ENGINE__;
const snap = () => {
  const p = e.ctx.get('player'), ai = e.ctx.get('ai');
  return {
    frame: e.time.frame, t: e.time.elapsed, scale: e.time.scale,
    locked: e.input.pointerLocked, enabled: e.input.enabled,
    control: p.controlEnabled, dead: p.dead, hp: p.health.value,
    player: p.position.toArray(), wave: { ...ai.getWaveState() },
    worker: {
      jobs: ai.grid.worker.jobs.size, scopes: ai.grid.worker.scopes.size,
      proofs: ai.grid.worker.proofs.size,
    },
    agents: ai.agents.map(a => ({
      id: a.id, alive: a.alive, corpse: !!a.isPlayerCorpse,
      state: a.state, pos: a.position.toArray(), d: a.position.distanceTo(p.position),
    })),
  };
};
for (const type of ['player:death', 'player:respawn', 'game:restart', 'wave:start',
  'wave:complete', 'damage:taken', 'weapon:fire']) {
  e.events.on(type, event => {
    if (type === 'weapon:fire' && event.actor === 'player') return;
    console.log(type, event.amount, JSON.stringify(snap()));
  });
}
console.log('ready', JSON.stringify(snap()));
```

## Recorded evidence

### Initial load and full reload

At frame 0 before `engine.start`: `elapsed=raw=0`, scale 1, input disabled, control true, lock false, HP100/armour50, wave1 with six live agents IDs1–6. Reset feet **(13.707976, 0.097583, 19.843128)**. Distances **62.22, 61.03, 60.17, 22.29, 20.67, 20.44 m**. AI initialization has already _placed_ the wave, but prewarm has not advanced simulation.

| Observation                               | First load                              | Full reload, same seed    |
| ----------------------------------------- | --------------------------------------- | ------------------------- |
| Ready observation                         | f4 / t0.077 s                           | f4 / t0.059 s             |
| First AI fire, no gesture/lock            | f38 / t0.644 s, ID2                     | f39 / t0.643 s, ID2       |
| After 20 wall seconds                     | f1205 / t20.093 s                       | f1203 / t20.059 s         |
| Same initial IDs 1–6 now nearest distance | 20.42 m                                 | 20.37 m                   |
| ID1 distance: placed → 20 s               | 62.22 → 36.30 m                         | 62.22 → 36.54 m           |
| States at 20 s                            | combat/suppressed/combat + three patrol | same state categories     |
| Input enabled / control / lock / HP       | true / true / false / 100               | true / true / false / 100 |

Thus **movement and fire**, not merely a populated frozen scene, precede intentional start. No damage was observed in these initial 20-second windows. Wave1 remained six alive; no wave-complete/countdown was exercised. Timers advancing is established by scaled elapsed and source wave scheduling, not an observed wave transition.

Uninstrumented random-seed confirmation: clean build revision above, t5.075 s, startup hidden, **no visible buttons**, wave1/six alive, control true and lock false. First recorded AI shots t0.658/0.858/0.958 s while unlocked. No explicit Start UI exists in that state.

Adverse probe's first-frame boundary: **f1/t0.011 s first `ai.update` while input disabled**, followed by before-first-render callback snapshot still disabled and after-callback snapshot enabled, all on f1. This independently supports the source order: input enabled does not gate AI or scaled simulation.

### Three natural death/restart cycles

Times are scaled engine seconds since first load, **not reset on restart**. At dispatch completion each restart had wave1/remaining6/total6, HP100/armour50, control true, reset feet above, and worker **jobs/scopes/proofs=0/0/0**. There were no page errors. All old IDs, including the visual player corpse, were absent in the completed restart snapshot.

| Cycle | Natural death f / t | Restart dispatch f / t | Removed enemy IDs (+ player corpse) | New enemy IDs | New-wave min/max feet distance at publication |
| ----- | ------------------- | ---------------------- | ----------------------------------- | ------------- | --------------------------------------------- |
| 1     | 3904 / 65.241       | 4199 / 70.291          | 1–6 (+7)                            | 8–13          | 18.29 / 62.71 m                               |
| 2     | 5704 / 95.523       | 6004 / 100.573         | 8–13 (+14)                          | 15–20         | 18.89 / 63.04 m                               |
| 3     | 7285 / 121.989      | 7588 / 127.039         | 15–20 (+21)                         | 22–27         | 18.26 / 63.89 m                               |

All `player:respawn`, nested `wave:start` and trailing `game:restart` observer snapshots occurred in the **same frame and elapsed time** per row. At `player:respawn`, control was true and lock false, and old agents were still present; at wave/start and end of dispatch they had been replaced. Example cycle1: old ID3 was 3.16 m from the reset player in the nested respawn snapshot, but **was disposed before the next frame**. This does not establish a rendered point-blank survivor.

Death-camera motion is distinct from spawning. Between death and the five-second post-death sample, retained old ID1 approached the dead player from 71.28 to 56.92 m in cycle1. In cycle2, old ID12 went from 16.04 to 11.20 m; in cycle3 ID18 went from 15.92 to 11.12 m. They were subsequently removed, not carried into the new run. Player corpses (7/14/21) were dead, friendly, visual actors and excluded from hostile counts.

| New run after restart | First AI fire (f / t; delta from restart) | First `damage:taken` (includes armour-only amount0) | First positive HP damage  | Five-second post-restart observation |
| --------------------- | ----------------------------------------- | --------------------------------------------------- | ------------------------- | ------------------------------------ |
| 1, IDs8–13            | 4264 / 71.374; +1.083 s                   | 4676 / 78.241; +7.950 s                             | 5002 / 83.674; +13.383 s  | HP100, lock true; min19.00 m         |
| 2, IDs15–20           | 6045 / 101.256; +0.683 s                  | 6341 / 106.189; +5.616 s                            | 6804 / 113.939; +13.366 s | HP100, lock true; min18.98 m         |
| 3, IDs22–27           | 7629 / 127.772; +0.733 s                  | none within final 5.03 s window                     | none within window        | HP100, lock true; min19.40 m         |

Pointer lock was false in the synchronous restart snapshots, then true at immediate post-click observations (f4201/6006/7590); all recorded normal post-restart damage occurred with lock true. Exact lockchange timestamp and first normal-run post-reset AI tick were **not** captured; these observations bound, rather than establish, their ordering. Some far new actors had LOS after frames advanced; the nearest three did not at the immediate samples. No camera frustum/bearing capture was made, so this cannot prove an enemy was actually “directly in front.”

### Deliberately missing control handoff

Separate probe, **forced death, not one of the natural cycles**:

- Forced death f304/t5.078; NEW GAME f609/t10.161 replaces IDs1–6/corpse7 with IDs8–13; reset maps/jobs/proofs empty.
- First new-run AI tick **f610/t10.177**, still unlocked, control true. First AI fire **f658/t11.144** (+0.983 s after reset).
- Armour-only damage f1076/t18.110 (+7.950 s); first positive HP damage **f1695/t28.427**, amount0.869, unlocked. At t30.260 HP65.218, armour0, still unlocked, all six enemies alive.
- AI activity/damage is not waiting for successful pointer lock. The normal run's request _did_ succeed; no real browser denial was reproduced. Existing keyboard focus and gamepad paths mean “unlocked” alone does not mean every possible input path is unavailable.

## Source-cited sequence and reset audit

Line numbers refer to the pinned base, not a future implementation. EventBus dispatch is synchronous, insertion ordered, and reentrant ([registry.ts:94–114,149–198][registry]); dependency resolution plus listener registration determines this sequence, not the textual order of `.add` alone.

1. **Boot/core:** [main.ts:49–56,122–186][main] disables input, awaits system init/prewarm, then unconditionally `engine.start()`. First render enables input and dismisses the loading shell; `__READY__` is a diagnostic frame handshake, not player intent. [index.html:54–96][shell] makes canvas/UI inert during loading and dismisses automatically. [engine.ts:129–143,174–231][engine] begins input, fixed updates, updates, late updates and render in that order, at scale1. No Start/run-active state exists. Readiness prevents early asset use, not combat before intentional control.
2. **Input/UI:** [input.ts:143–158,184–230,247–264,301–329][input] swallows lock failure and keeps running, accepts canvas click as lock request **and fire**, has an intentional canvas-focus keyboard path while lock is pending/denied, and polls gamepad axes independent of pointer lock. [ui/index.ts:294–296,650–680][ui] initializes `_hadPointerLock=false`, so never-acquired lock does not trigger pause; only loss after a prior locked frame does. [menu.ts:235–267][menu] is a pause/settings/resume menu, initially closed; show/close separately manipulates time scale and player control.
3. **Death:** [health.ts:239–256][health] emits damage then marks dead and emits copied death payload. [player/index.ts:444–532,540–553][player] disables player control, freezes capsule, creates friendly ragdoll corpse and animates camera; late hitbox sync disables player hitbox. [weapons/index.ts:1493–1511][weapons] disables weapon hands, drops live cooked/committed grenades (not blanket cancellation). [ui/index.ts:442–451][ui] hides HUD and opens game-over; [gameover.ts:4–8,48–102][gameover] exits pointer lock and waits 2.85 unscaled seconds. AI has **no player-death reset handler**; AI updates, squad/movement/grenade logic and wave director continue ([ai/index.ts:1295–1395][ai]). [agent.ts:707–717][agent] stops sensing a disabled player hitbox but remembered targets/behavior may persist until expiry. Dead player health rejects further health damage. Sky clock/search assist/intel/audio have their own death guards; death is not global pause.
4. **Restart:** [ui/index.ts:224–227][ui] emits `game:restart` **before** requesting lock. Actual listener order: sky/world reset → player → weapons → AI → game → market → radio → UI → intel → audio intel-stop. The player's handler runs first among player/weapons/AI/game: health/plate/heal reset, spawn0 ground resolution/teleport/rig reset; `_endDeath()` enables control and emits **nested `player:respawn`**. Weapons' respawn listener re-enables hands; UI hides game-over. Then the outer restart resumes through weapon reset, AI cancellation/disposal/new wave, score reset, remaining consumers. AI sees the **reset player feet**, not old death position, for placement. No frame can interleave this synchronous stack, but nested observers see an incomplete reset. This is an ordering risk, not observed post-frame retention.

### Reset inventory / pending work

| Owner and source                                                                                                | Cleared or reset                                                                                                                                                                                                                                                                                       | Persistent / gap / consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Player [player:990–1006][player], [movement:1252–1289][movement], [health:159–175][health], [heal:86–89][heal]  | HP, dead flag, armour to one plate, hurt/suppression/heartbeat; healing cancelled/bandages replenished; yaw/pitch, capsule position/velocity, stance, sprint/slide/mantle/climb, interpolation, lean, jump/step buffers; flashlight off                                                                | Spawn0 always used, not chosen for enemy safety. Respawn event only emitted when death camera was active; a living direct respawn does not mean a new run. Camera/rig/hitbox fully resync on subsequent update/lateUpdate, not a ready event. Input pending gestures are not comprehensively cleared by `respawn`.                                                                                                                                                                                                                                     |
| AI [ai:1050–1072][ai], [agent:3468–3494][agent]                                                                 | Worker scopes/jobs/proofs, all agents including corpses and their physics characters/hitboxes/ragdolls/groups; squad/perception/target/path state disappears with agent disposal; ladder claims/queue, grenades/bodies, cover claims, wave totals/countdown and heard ping; immediately attempts wave1 | RNG forks and global agent IDs continue across restarts (reload resets IDs/seed); cached immutable assets/nav remain. Stats/planning sets/path cursor/relevance scratch refresh in frame logic, not all reset to boot values. No observed old gameplay actor remained after dispatch.                                                                                                                                                                                                                                                                  |
| Async AI [attachment-queries.js:200–228,449–539][queries], [attachment-worker.js:68–112,186–204][worker]        | `clear()` cancels each scope, deletes jobs, posts cancel IDs, clears completed proofs; monotonically increasing query IDs are not reused; late result without matching job is stale and cannot repopulate proofs. Agent dispose additionally cancels route/peek/search/ladder scopes                   | `clear()` does **not** terminate worker or increment collision generation; not needed for deleted-job rejection. Worker cancellation occurs **between whole checks**, not inside an executing native check. Player death alone does not cancel all live-enemy work; “death cancels” in worker contract includes actor death, not a global player-death freeze. Actual reset snapshots had zero jobs before reset: late in-flight result across restart was **not** experimentally forced. Existing revision/rebuild/disposal failures remain terminal. |
| Weapons [weapons:422–433,726–771][weapons], [ballistics:373–426][ballistics]                                    | Ammo/modes/loadout, reload/trigger/burst/switch/hand state, grenades/radio supplies, pickups, dropped-mag bodies, projectile list                                                                                                                                                                      | Important: `_sim.clear()` resolves/flushes **already reached pending actor contacts** before retiring rounds; it is not a silent discard. This occurs after player respawn but before AI disposal/game score reset, so synchronous old-run damage/feedback can still dispatch during reset. Persistent new-run damage/score from this path was not reproduced. Deferred weapon models are awaited by boot prewarm, not a per-run actor spawn promise.                                                                                                  |
| Game [game:108–109,140–171][game]                                                                               | Score/kills/search quiet/cue state; HUD wave state polled from AI                                                                                                                                                                                                                                      | Not an activation authority. Engine elapsed/raw/frame/RNG/scale are not reset by `GameSystem.reset`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Market/radio/intel [market:339–344][market], [radio:345–351][radio], [intel:472–486][intel]                     | Credits/pending shop countdown and close; active bombers/bombs removed; intel cases/interactions/prompts/used sites/deck/budget/run count reset; intel alarm stops                                                                                                                                     | Market close restores prior scale if open; future gate must not be overridden by this side effect. Intel archive/drop-recency history intentionally survives runs per architecture. No per-run `setTimeout` spawner was found in these owners; timers here are frame/elapsed driven.                                                                                                                                                                                                                                                                   |
| Sky/world/UI/audio [sky:387–390][sky], [world:181–184,293–296][world], [ui:478–492][ui], [audio:960–968][audio] | Clock to16:30/streetlight outage reset; HUD score/wave/banner/killfeed/arcs/hit/markers/prompt clear; intel audio stops                                                                                                                                                                                | UI is not a full subsystem rebuild: existing menu/HUD animation state and settings survive. No general FX/audio world-history purge is performed by these restart listeners. This was not an exhaustive audiovisual resource-lifetime audit; no retained-enemy inference follows from residual effects.                                                                                                                                                                                                                                                |

### Spawn selection, separation, visibility and failure behavior

[ai/index.ts:832–952][ai] reads stance-aware `playerPosition` backed by authoritative player capsule, not the overhead camera. World `spawn(0)` indexes authored transformed spawnPoints ([world:293–296][world]); player init and respawn ground-resolve this point. AI ranks the **same world spawn list** by descending **3D distance**, rejects anchors at <=18 m, then [intent.ts:113–157][intent] picks farthest first and subsequent anchors by angular spread (not next-farthest). The latter can select a much nearer qualifying anchor; initial measured second squad was ~20–22 m while first was ~60–62 m.

For each member `_pickSpawnNear` makes up to ten jitter attempts at radius0.8–3.2 m, samples physically attached ground, checks finite/floor difference <=1.4 m, and validates connected usable patrol endpoints. It then tries the anchor itself under those **physical/route** checks. There is no final player-separation check, actor-to-actor spacing check, camera/frustum test or player-to-enemy LOS constraint. Nearby patrol endpoints also have no player-safety filter. That may be intended patrol behavior; selecting a fairness policy is owner work, not this spike's authority.

Controlled method-call evidence (actual `AiSystem.prototype._pickSpawnNear`, synthetic `sampleGround` accepting flat ground, `_usablePatrol` returning a connected route, RNG angleπ/radius3.2):

| Fixture                                             | Actual result                                        |
| --------------------------------------------------- | ---------------------------------------------------- |
| Anchor(18.1,0,0), player origin, first jitter valid | final(14.9,0,~0), one sample, zero LOS queries       |
| Ten invalid jitter samples, valid anchor            | anchor(18.1,0,0), eleven samples, zero LOS queries   |
| All ten jitter samples and anchor invalid           | null, eleven samples; no unsafe force-spawn fallback |

These controlled results can be reproduced with a stub `grid.sampleGround(x,z,y,out)` that either `out.set(x,0,z); return true` or returns false for the first ten/all samples, `phys={}`, `rng.range` returning π for angle and3.2 for radius, and `_usablePatrol=()=>[routePoint]`. They demonstrate existing method semantics, **not world placement or new regression tests**.

If all anchors fail or no world spawns/nav exist, `populate` returns0, does not manufacture actors/squads, and `startWave` publishes no event or wave increment. Partial success counts only created actors. Subsequent-wave `_wavePending` failure retries after two elapsed seconds. **Initial/reset wave0 failure is different:** `resetForNewGame` ignores a zero return and `_updateWaves` returns on `_wave===0`, leaving no retry. Existing smoke tests cover invalid/disconnected patrols and empty placement, not a full initial retry or fairness policy. Any new placement rejection must handle this readiness edge rather than strand an empty run.

## Recommended direction — not implementation approval

Supervisor agreed the following **investigative recommendation**, not human-approved gameplay policy or a verified camping fix. Separate concerns because missing Start is established whereas unsafe post-restart placement as the reported cause is not.

1. **Loading/prewarm → rendered ready-awaiting-Start.** Core/main retain real boot/render/failure readiness; UI exposes a minimal intentional Start affordance using existing styling/accessibility. Game owns run phase; rendering/UI continue, while combat clock, AI/waves, movement/weapons/projectile damage are inactive. Input enabled/UI usable is not equivalent to gameplay active; simply setting time.scale0 is insufficient because update hooks still execute and some work is not dt-gated.
2. **Start/NEW GAME intent → resetting while gated.** Gate gameplay first; invalidate/cancel old-run async results before disposal and cleanup. Complete projectile/contact/equipment/market/radio/intel and old-actor cleanup without admitting effects to the new run. Reset authoritative player spawn/state before evaluating enemies. Avoid publishing `player:respawn` as an all-owners-complete signal halfway through synchronous restart.
3. **Required initial placement/readiness → awaiting-control.** Only accepted placement can publish a playable wave; zero-placement must safely retry/defer or show actionable failure. Obtain the intended control handoff from the same user gesture; pending/denied handoff remains safe with accessible retry. Do not blindly require pointer lock on every platform: input deliberately supports keyboard focus and gamepad axes; capture freezes player and pumps frames explicitly ([shots.ts:248–253,322–386][shots]). Agree supported non-pointer-lock activation first.
4. **Control + complete reset/placement → active**, exactly once per run generation. No AI/damage before this boundary. Death-camera rendering/ragdoll presentation can continue without allowing combat/wave progression to expose the **next** run. Keep terminal error absorbing/reload-only; pause/shop cannot accidentally promote waiting/resetting to active.

Suggested seams: shared/core owner `main.ts`, `core/engine.ts`, `input.ts`, `events.ts`; game owner `game/index.ts` owns phase/activation; UI `ui/index.ts`, `gameover.ts`, existing menu owns user intent/retry; player owns authoritative respawn completion; AI owns cancellation/placement completion. Define explicit typed run-phase/activation payloads in `core/events.ts` with a run generation, rather than overloading `__READY__`, `ui:pause` or nested `player:respawn`. Exact event spelling/API remains an implementation design decision requiring owner coordination, not speculative scaffolding to add in this docs change.

AI follow-up should apply an **owner-approved** predicate to every final projected/jittered candidate and anchor fallback, preserving physical/route validity. Decide horizontal versus3D separation, floors, actual view/frustum versus world LOS, acceptable visible-but-distant actors, and bounded retries/partial waves. Do not select a larger magic distance, ban all visible enemies, or add invulnerability from this evidence alone.

### Follow-ups and regression exit plan

- [#488 — lifecycle/control/reset handoff](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/488): confirmed missing Start plus handoff vulnerability; nested reset ordering explicitly labeled a risk. Acceptance includes initial Start waiting, delayed/denied/retry control, supported non-pointer paths/capture, complete reset, late async/projectile rejection, and >=3 restart/reload traces.
- [#489 — define/validate final placement policy and bounded retry](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/489): candidate hardening, **not a proven camping remedy**; owner must approve distance/visibility policy. Includes final jitter/fallback, visible/elevated/occluded fixtures, partial/zero-wave and initial retry acceptance.

Proposed source-named coverage (not added by this spike): core/game smoke phase-transition and event-order tests; normal-path browser Start/control timing tests (not only capture mode); AI placement unit fixtures beside `smoke-ai-intent.mjs`/`smoke-ai-patrol.mjs`; delayed-result restart tests beside `smoke-ai-search-worker.mjs`; projectile contacts/reset with `ballistics` coverage; `menu-controls-e2e.mjs` restart/retry input-leak checks. Browser traces must include run/agent identity, spawn coordinates, movement since publication, actual camera bearing/frustum and separate LOS, pointer/control readiness, first AI tick/fire/damage and worker cancellation. Retain existing prewarm/startup/failure, market/intel/radio and capture contracts.

## Validation and remaining limitations

Clean install and required non-world-change checks at this base:

| Command                                                       | Result                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                      | pass; 60 packages; existing audit warning below                                                                                                                             |
| `npm test`                                                    | pass; 1 Vitest file, 140 smoke checks, 110.71 s                                                                                                                             |
| `npm run typecheck`                                           | pass                                                                                                                                                                        |
| `npm run lint`                                                | pass, both regular and type-aware passes                                                                                                                                    |
| `npm run build`                                               | pass including prebuild typecheck/lint and world validation; no asset diffs                                                                                                 |
| `npm run format:check`                                        | pass at baseline; report formatted/checked again before commit                                                                                                              |
| `node tests/e2e/menu-controls-e2e.mjs`                        | pass on hardware; independently rerun using an external copy with only absolute repository imports and port5369→5475 to avoid any other worktree's server reuse; pass again |
| Normal fixed-seed observation, natural deaths×3/reload        | completed; no page errors; findings/limits above                                                                                                                            |
| Uninstrumented normal random-seed observation                 | completed; missing Start confirmed                                                                                                                                          |
| Deliberately missing lock handoff / synthetic placement calls | completed; fault-injection/method semantics only, not natural camping reproduction                                                                                          |

`npm audit --json` exits1 for pre-existing high-severity transitive `source-map-js@1.2.1` via Vite→PostCSS, advisory GHSA-68fv-2mgg-jv7q. No dependency change attempted. World/props unchanged; standalone `world:validate`/world regeneration unnecessary (normal Vite/build already validated committed world). No baseline test/build/lint failure found.

Remaining evidence gaps: one hardware/browser/quality/seed family, only three natural cycles and one full reload; no low-end/mobile/manual visual or human reaction-time acceptance; no real denied-lock browser event, explicit keyboard/gamepad-only user session, observed initial-wave failure, natural wave-complete countdown while dead, forced stale reply during reset, or projectile/contact race reproduction. Main snapshots have per-agent positions but not recorded screen bearing/frustum, so “directly in front” remains unverified. Worker async admission prevents claiming exact trajectory determinism from a fixed seed. The original camping cause is unresolved; retained enemies are contradicted **for these completed resets**, not excluded for all failure/other branches. Instrument old/new run generation, cancellation IDs/reply admission, actual view/LOS and first-control/AI/damage boundaries in the follow-ups before claiming a root cause or gameplay fix.

[main]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/main.ts
[engine]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/core/engine.ts
[registry]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/core/registry.ts
[input]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/core/input.ts
[shell]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/index.html
[ui]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ui/index.ts
[menu]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ui/menu.ts
[gameover]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ui/gameover.ts
[player]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/player/index.ts
[movement]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/player/movement.ts
[health]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/player/health.ts
[heal]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/player/heal.ts
[ai]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ai/index.ts
[agent]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ai/agent.ts
[queries]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ai/attachment-queries.js
[worker]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ai/attachment-worker.js
[intent]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/ai/intent.ts
[weapons]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/weapons/index.ts
[ballistics]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/weapons/ballistics.ts
[game]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/game/index.ts
[market]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/market/index.ts
[radio]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/radio/index.ts
[intel]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/intel/index.ts
[sky]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/sky/index.ts
[world]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/world/index.ts
[audio]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/audio/index.ts
[shots]: https://github.com/EdoardoLuciani/Claude-of-Duty/blob/c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592/src/dev/shots.ts
