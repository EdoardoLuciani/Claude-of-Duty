# #470 bounded normal-play evidence

Companion to [the report](../../run-lifecycle-470.md). This is an investigation fixture, **not a gameplay regression test or a proposed fix**. No runtime algorithm or activation/control branch is changed: only RNG seed and observation statements/wrappers are added to served Vite responses. The second batch additionally calls the existing pure anchor selector on fresh reset coordinates as a counterfactual; it neither publishes those results nor consumes RNG.

## Reproduce from the repository root

Requires the repository's installed Node/Playwright/native GPU harness. It deliberately refuses an already occupied port5476, requires a hardware WebGPU adapter and normal prewarm, and does not use capture/deterministic mode. Close unrelated GPU work when comparing observations. A fixed RNG seed does not make async worker/combat admission deterministic.

```sh
# Three fresh browser contexts, four natural deaths/restarts each.
# Initial: 20 s unattended, canvas click, W for 8 s; later runs stationary.
# Additional waits after observing enabled New Game: 0 / 5 / 12 / 0 seconds.
PROBE470_OUT=/tmp/470-forward node docs/evidence/470/reproduce.mjs

# Two fresh contexts, two natural deaths/restarts each.
# Initial: 3 s unattended, canvas click, S for 8 s; later run stationary.
PROBE470_OUT=/tmp/470-backward PROBE470_SEEDS=4660,12648430 \
  PROBE470_CYCLES=2 PROBE470_MOVEMENT=KeyS PROBE470_INITIAL_WAIT_MS=3000 \
  node docs/evidence/470/reproduce.mjs
```

No lethal-damage fallback exists. A run without a natural death within90 s after movement is recorded as blocked, not counted as a restart; the driver continues to the next bounded session. Counts are capped at three seeds × four cycles per invocation. Keyboard movement waits the full8 s even if death happens sooner: `enabledObservation.elapsed` records when the driver actually observed readiness, **not necessarily its first enabled instant**. The report identifies the one such late observation in the measured runs; the seven other zero-extra-delay cases used real Enter about one frame after the threshold. The driver does not click a disabled button or call restart directly.

The checked-in observer includes exact control-setter/planar-movement/anchor-counterfactual observations added for the backward batch. The earlier forward batch lacks those extra fields; its control timing is bounded by nested respawn, and `first-movement` includes vertical settling. Seed replacement leaves `config.deterministic=false`; readiness records retain that value, prewarm and build revision. The only modified on-disk files during measurements were this investigation's docs/artifacts. Runtime source remains the report's pinned develop base.

## Retained files

- `observations.json`: bounded extraction of all16 added natural restarts across five fresh contexts/three seeds. Each restart has actual selection sample and hitbox endpoints, final published enemy positions and IDs, reset completion, first completed rendered camera state, later0.25/1/5 s samples, first AI/movement/fire/damage/HP events, actual DOM/cached lock state and wall/frame timestamps. `generation` is **observer-assigned**, not a claimed runtime generation mechanism. Old/new ID disjointness, six new actors and absence of page/route errors were independently checked during extraction. No full shot log is retained.
- `forward-{death,restart1,restart4}.jpg`: first seed1592594996, first natural death/first restart/fourth restart. Native rendered pixels under the normal HUD.
- `backward-{death,restart1,restart2}.jpg`: seed4660, natural death/first restart/second restart. Its first restart shows the changed [5,7] anchor choice, not a forward-visible enemy.
- `reproduce.mjs`, `observer.mjs`: inspectable normal-input driver and served-response observer. Results and every captured frame go outside the repository by default. Only the six representative images above are committed.

Screenshot records contain before/after frame/time brackets and `retainedAs` mappings. `captureNative` rerenders the native graph and overlays its asynchronous readback for a normal DOM screenshot; it does not freeze simulation or invoke the deterministic shot API. The readback image falls within the bracket, not necessarily the exact first-render snapshot. Screenshots and LOS/projection observations add overhead and do not establish a performance result.

## Coordinate and timing cautions

`publication` records the final created actor coordinates but can still have the death camera; use `firstRendered` for the actual restored view. Eye-point `bearing` is signed camera-relative degrees (zero forward). `eyeInFrustum`/`feetInFrustum` are point tests, not whole-mesh raster visibility. `los` is independently queried from the actual camera to the actor eye using default physics sight masking. Screen/NDC coordinates behind the camera are mathematical projections, **not visible pixels**. All measured reset eye bearings were at least144.659° off forward, so this negative result does not rely only on distance or an eye point just outside a frustum edge.

`t` is scaled engine time, not reset on New Game; `wall` is browser `performance.now()/1000`. Same-frame event times can share `t`, so use wall and event order for subframe boundaries. Cached pointer lock can lag the actual DOM. Positive HP damage and armour-only `damage:taken.amount=0` are separate. Missing damage entries mean not observed within that run's window, not immunity. Actor `move` is 3D displacement from publication; backward-batch `moveXZ` and `first-planar-movement` exclude ground settling.

The stale-hitbox defect and changed anchor choice are verified. The player's front-spawn/camping cause **remains open**; none of these negative views disproves their repeated observation or approves new placement policy.
