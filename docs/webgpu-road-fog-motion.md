# Road shadows, fog rays, and motion/transition verification

Follow-up to `c83b9fa` on develop `a33127d`, retaining the authored-material and
world-dependent view-light direction. This is a correctness/coverage change,
**not a performance optimization or complete migration acceptance**. PR #316
remains draft. All GPU evidence below used AMD/RDNA4/non-fallback on RX 9070 XT
with `MESA_VK_DEVICE_SELECT=1002:7550!`, sequentially.

## Road bands: shadow self-occlusion

The bands persisted in raw world color with parallax, detiling, material normals,
and AO independently disabled. Disabling shadows removed them; increasing a
fixed depth bias also removed them. The fix is not a material or AO adjustment:
`csm-webgpu.js` supplies a public `shadow.biasNode` using cascade world-texel size
and **geometric** surface slope. It retains the authored base bias/normal offset.
The additional bias is `(0.5 + 1.5 * min(slope, 5))` texels converted into shadow
depth units, with the cosine bounded at .12. This avoids a globally enlarged
fixed normalized-depth offset. The existing native five-tap PCF is unchanged.

`tools/csm-bias-check.mjs` tests a plane and blocker at 512/1024/2048 shadow
resolution and sun elevations 15/35/65 degrees. At 1024 and 2048, no unoccluded
samples fell below .99. At 512, 6 and 1 samples did at the two lower elevations
(out of >32,000 per case; minima .9656/.9531), within the bounded allowance.
Blocker interiors remained black; nearest dark samples were about .08–.10 m
from the tested blocker contact. `--negative=1` removes the receiver correction
and fails `unoccluded plane has shadow bands`.

This finite oracle is not proof for every horizon angle, thin caster or contact.
It guards against merely erasing shadows to remove the bands.

## Combat glare: reconstruction and missing occlusion

The fog ray used upward camera NDC with downward native texture UV. Ground
pixels therefore marched upward and mirrored the forward-scattering lobe.
`sky/volumetrics.js` now flips **only reconstruction Y**, not color/depth sampling.
`tools/fog-ray-check.mjs` compares GPU analytic homogeneous fog against CPU
world-ray reconstruction at six pitch/yaw poses, 8,192 pixels each: maximum
error `3.170857e-7`, tolerance `2e-6`. Restoring the old ray with `--negative=1`
fails the oracle.

The march also lacked building visibility. `render/volumetric-shadow.js` samples
existing native CSM depth maps with four Vogel comparison taps; it adds no
shadow draw or render target. Matrix, split, texture and texel-size inputs update
at render time. Each cascade owns a distinct placeholder depth texture: texture
uniforms deduplicate by initial UUID, so sharing one placeholder incorrectly
aliases subsequent maps. Only those placeholders are disposed by this helper;
CSM targets remain borrowed. Static pixel noise is materialized before the march
and passed into the visibility callback, retaining the fog-hoisting invariant.

The plane/blocker oracle also checks clear/blocked volume points at height 2 m,
excluding the filter footprint in the light plane rather than world XZ. All nine
configurations have zero errors among unambiguous samples. The coarse 512/65°
case has no safely interior blocked volume samples; the other cases do.
`--volume-negative=1` aliases the depth bindings and fails the visibility check.
Fog visibility chooses one cascade without cross-cascade blending; edge/seam
quality remains part of broader visual review.

**No exposure, bloom, flash strength, fog-density, material, moon-illuminance,
AO-resolution or shadow-resolution retune.** The fixed-exposure-3 parent/candidate
ADS and combat comparisons match recorded camera, FOV, frame/time, weapon pose,
actor snapshots, gameplay/viewmodel RNG, FX light inputs and all seven FX layer
attribute/instance buffer hashes. These are capture-state checks, not complete
trajectory equivalence. The stage tool rebuilds `pipeline.outputNode` explicitly;
additional stage renders advance histories, not simulation, so stage images are
not matched-history temporal comparisons. The original legacy startup-RNG and
transient-divergence investigation remains separate.

## First-use and transition work discovered by motion testing

- Stable render-owned key/secondary directional lights copy the authored sky
  values. Sun/moon handoff changes values, not light/CSM identities. The original
  sky lights remain the authoritative data and are hidden from direct rendering.
  Zero sky intensity cannot reactivate fallback daylight.
- FX updates precede render synchronization. FX must read the **current authored
  key intensity**, not the previous draw's proxy; otherwise initial mote/shimmer
  buffers change. The comparison above caught this lag, and a smoke regression
  guards it. FX upload strategy, particle timing and flash-budget formula remain
  unchanged.
- Weapons await deferred models during boot, then warm all weapon groups, radio,
  reticle/scope ancestors, dropped-magazine world variants and an ammo-pickup
  visual through the actual zero-range graph. No pickup item/ID, physics body or
  RNG draw is created. No asynchronous zero-range warmup runs from weapon update
  during gameplay. Errors are reported; visibility/pool ownership is restored.
- AI's init-time prewarm previously cached success before the production graph
  existed. It now preserves material creation order but defers actual warmup to
  the engine hook. Throwaway meshes borrow the real variant geometry/groups and
  receiving/casting flags; their skeleton is owned and disposed, model assets
  remain borrowed. No Agent or gameplay ID/RNG is created. The synthetic
  all-material triangle missed two native shadow variants even after deferral.
- Haze's private RG-target scene needs its actual render context, not only
  `compileAsync`. Its zero-vertex warm draw covers both transparent sides and
  restores range/count, visibility, activity, target and clear state on failure.

Initial checks found 2 first-reload builders, 2 first-scope builders and 56 first
staged-combat setup builders (50 soldier + 6 pickup). Low-quality first haze use
also exposed 2 builders. Targeted checks now report **zero** for these cases.
Counters are `onNodeBuilderCreated` events, not direct GPU pipeline-compilation
or hitch-duration measurements. Diagnostic negatives for magazine, optics, AI
and haze restore the corresponding missing warmup and fail the motion guard.

## Scripted acceptance matrix

`tools/render-motion-check.mjs` uses a persistent native offscreen output at the
quality tier's **physical drawing resolution**, exactly one game render per
simulated frame. It records setup and moving-period builders separately, checks
stable key/CSM/cascade identities, finite exposure in `(0, 5]`, nonblank captures,
non-MSAA view targets and unchanged world/view target sizes. Player death fails
the run rather than silently stopping the clock. MCX selection is asserted (an
initial prototype accidentally reset it to M4 through `debugPose` and was rejected).

- High: eight 180-frame sequences, all frames captured at 1280×720: road sweeps,
  reload, MCX scope, staged combat, live walk/strafe/ADS/fire input, outdoor/interior
  camera cuts, accelerated continuous clock, and hard lighting/outage/flashlight
  switches. Zero setup or moving-period builders.
- Low/medium/ultra: road, reload, optics, cuts, continuous clock and hard lighting
  sequences passed; first combat, reload, optics and continuous clock were also
  rerun after final warmup changes. Physical sizes were 921×518, 1024×576 and
  1280×720 for the 1280×720 viewport. Zero setup/moving builders.
- Continuous clock traverses 18:00→06:00 at 4 hours per simulated second; the
  final hour is asserted. Hard switches use 19.2→1.5→16.5 and power/torch toggles.
- Full day/night lifecycle/flashlight E2E passed, including blocked/clear light
  probe 0/167 and live soldier entering beam without new builders. Fresh night
  capture totals are now 7 versus daytime 9, rather than the earlier 227 versus
  9; these totals still include capture contexts. The persistent-output motion
  check is the separate zero-builder handoff evidence.

Reviewed capture samples show the road/glare corrections, preserved scope/weapon
composition, and no gross retained outdoor image after the interior cut. Videos
are **simulated 60 Hz sequences with readback between frames**, not real-time
hitch recordings. This is not exhaustive shimmer/ghosting measurement, continuous
doorway traversal, unscripted play, or human visual sign-off.

## Timing: no win claimed

Plain-timer 1080p/high, 600-sample parent/candidate runs (ordinary AI option):

| Pair | Parent interval mean ms | Candidate ms |
|---|---:|---:|
| 1 | 14.258 | 17.184 |
| 2 | 15.598 | 15.376 |
| 3 | 15.091 | 15.332 |
| Final haze-warm-only correction | 14.763 | 14.589 |

The first three aggregate to 14.982→15.964 ms (+6.6% interval), with a large first
pair and mixed subsequent results. Do not discard that pair or claim a speedup.
The final warm-only correction has a separate pair rather than silently pooling
different candidates. Sampled initial/final gameplay states match in each pair;
all measured builder counts and error counts are zero.

**Fixture limitation discovered here:** the ordinary-AI player dies, so 552/600
samples are post-death. These numbers do not certify sustained living combat.
The benchmark now records `playerDead` and clock hour explicitly. A separate
staged/no-damage clock run traversed 18.3875→1.875 with no dead frames or builders:
interval mean 13.100 ms, p99 16.8 ms, max 46.6 ms; render CPU mean 10.074 ms,
max 14.2 ms. This also is not a promise of hitch-free play. Dev readiness remained
roughly 42–47 seconds (final pair 41.4/45.3 s); no startup gain is established.
Fresh living-combat performance and broad acceptance remain open.

## Regression checks and fixture corrections

75 smoke scripts, lint, build and committed-world validation pass. Actual-device
checks include strict Fresnel/material oracle, arm-blood lifecycle, all-tier view
lighting/material coverage, high graph/cache/prepass/AO/resize/light/haze and fog
hoisting/camera contracts, plus low/medium/ultra resize/sky checks. New CPU tests
cover warmup readiness, deferred assets, concurrency, borrowed resources and
failure restoration.

Two old visual-fixture assumptions were incorrect, not runtime fixes:

1. Medium resize compared physical pixels to the *old CSS width* (819 < 960).
   It now asserts exact scaled dimensions and both world/view target sizes.
2. One fixed sky pixel was required to be blue; a cloud could fail it. The check
   now samples actual cleared-depth sky pixels and requires HDR fog passthrough
   error <1e-6. Intentionally fogging sky to 200 m fails this guard. It does not
   prescribe sky hue or remove clouds.

The historical hero exposure-bound fixture has not been re-certified. Full human
motion review, production startup/RNG work, representative performance and a fresh
independent PR review remain gates. Keep PR #316 draft.

## Reproduction

Run from the migration worktree, with `MESA_VK_DEVICE_SELECT=1002:7550!` for each
GPU command, sequentially. Use `--key=value` arguments.

```sh
node tools/csm-bias-check.mjs
node tools/fog-ray-check.mjs
node tools/render-parity-isolate.mjs --shot=combat --exposure=3 --out=/tmp/parity
node tools/render-motion-check.mjs --out=/tmp/motion
node tools/render-motion-check.mjs --quality=low --phases=combat,reload,optics,cycle --every=60
node tools/render-motion-check.mjs --negative=magazine --phases=reload
node tools/render-motion-check.mjs --negative=optics --phases=optics
node tools/render-motion-check.mjs --negative=ai --phases=combat
node tools/render-motion-check.mjs --negative=haze --quality=low --phases=combat
# Also deliberate failures: csm --negative=1 / --volume-negative=1;
# fog-ray --negative=1; FOG_SKY_NEGATIVE=1 with webgpu-game hero.
RESIZE=1 QUALITY=medium SHOT=hero node tools/webgpu-game/run.mjs
node tools/webgpu-legacy-benchmark.mjs --backend=webgpu --width=1920 --height=1080 --frames=600 --clock-rate=.75
```
