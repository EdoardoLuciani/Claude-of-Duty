# Native material integration (#370)

Scope: public authored-material copy paths and clone/cache-safe soldier output.
No material retuning, extra rendering pass, dependency change, global interception,
prototype swapping, diagnostic-framework migration or warmup redesign.

## Pinned Three.js contract

Implementation is grounded in Three `9681657f760197afa0a680b1e522a4340a6a53f8`:

- [`NodeMaterial.copy()`](https://github.com/mrdoob/three.js/blob/9681657f760197afa0a680b1e522a4340a6a53f8/src/materials/nodes/NodeMaterial.js#L1321)
  handles ordinary properties and accessor-backed physical properties. Use the
  instance method instead of borrowing classic material prototype methods.
  Colors/vectors are copied, maps stay borrowed, and userData is deep-copied.
  Plain objects/arrays are shared: adapters explicitly own their definitions and
  physical iridescence range, preserving the old conversion's ownership. Forcing
  PHYSICAL on a weapon must never write into the standard GLB source's definitions.
- [`NodeMaterial.setupOutput()`](https://github.com/mrdoob/three.js/blob/9681657f760197afa0a680b1e522a4340a6a53f8/src/materials/nodes/NodeMaterial.js#L1164)
  explicitly documents subclassing and calling super. SoldierNodeMaterial follows
  that path, darkening lit RGB before native fog/premultiplied alpha, preserving
  alpha and the existing full/reduced/goggle rim strengths.
- A public `rimNode` property carries the immutable TSL graph. The pinned copy
  method retains it, and native material cache-key collection includes node
  properties. Clones share the graph; different rim graphs distinguish cache keys.
  No custom builder/cache patch or new runtime uniform is needed.
- `outputNode` is **not** substituted mechanically: in the pinned `setup()` it
  replaces the output after native `setupOutput()`, moving the fog/alpha boundary.
- Weapons still select physical nodes even for standard sources. Arms still select
  standard/physical from the source, preserving KHR physical extensions and maps.

The official source's ColoredShadowMaterial subclass example is the direct model
for the output hook. The pinned [node-proxy example](https://github.com/mrdoob/three.js/blob/9681657f760197afa0a680b1e522a4340a6a53f8/examples/webgpu_materials_node_proxy.html)
shows a different use case (one graph with per-proxy values); no proxy migration is
introduced here. The [custom-lighting example](https://github.com/mrdoob/three.js/blob/9681657f760197afa0a680b1e522a4340a6a53f8/examples/webgpu_lights_custom.html)
likewise does not justify replacing the retained PBR lighting model.

## Environment registration remains render-owned

`IndirectFill.patch()` stays at explicit mesh/material registration. Its node calls
upstream `EnvironmentNode.setup()` first; PMREM/anisotropy/clearcoat and local
visibility budgets are unchanged. `envNode` is the sampling input that upstream
standard materials wrap, not a replacement slot for this lighting contribution.

Cloned materials must be registered with their render owner: Three's copy method
correctly does not retain the per-instance environment function. The clone-safe AI
output subclass is separate from that renderer-owned registration. Keep world/view
camera identity, view-pass context isolation and shared render uniform groups.
Do not reuse a different owner's cached environment hook under the same graph
identity. These rules are tested, not replaced by a compatibility layer.

`__prewarmHooks`, broader diagnostic consolidation and SSR/bloom policy naming are
outside this first material-integration change.

## Validation and limits

[Raw readbacks, capture metadata, combat samples and source hashes](https://gist.github.com/EdoardoLuciani/c05562619202f8696537dcf4a3abbaff).
Captures/profiles identify parent `8d6135e` plus dirty state; runtime source hashes
identify the reviewed candidate. Before/after screenshots are attached to the PR.

Native nonfallback AMD RDNA4 / RX 9070 XT, Chromium 153. No cross-vendor, exhaustive
motion equivalence, GPU timing or statistically established performance claim.

- CPU: actual committed arm GLB plus existing six-weapon GLB regression; standard/
  physical selection, factors/extensions, maps, definitions/range/clip ownership,
  borrowed-texture disposal, clone graph/cache identity and environment registration.
- The new CPU test fails on baseline `8d6135e`: cloning loses the instance output hook.
- Extended the existing material shader/readback tool, not a parallel harness.
  All four standard/physical arm/weapon copy comparisons have **0** max float
  difference against the frozen old paths. Full/reduced/goggle originals and
  clones, with and without native fog/premultiplied alpha, have **0** difference.
- Environment comparisons in independent world-first/view-first graph contexts
  match the old paths exactly. World/view separation is **0.0551962**, live view
  update **0.0473717**, with **0** builders after binding the warmed live path.
  Independent context identities avoid reusing another fill owner's compiled hook;
  the live check is not a claim that every first-use camera switch needs no build.
- Exact-match executed `rim` and `clone` mutations fail their intended original/
  clone pixel assertion. Existing five finish/cache negative controls are retained.
- Existing native correctness/alpha/shadow, seven-weapon arm-blood/healing and
  renderer rebuild/failure/device-loss suites pass.
- Fixed-exposure (4), 960x540 before/after captures: **10/19 PNGs byte-identical**;
  worst mean absolute RGB difference **0.00003344 bytes**, maximum **3 bytes**.
  Independent baseline repeat: **11/19 exact**, worst mean **0.00003279 bytes**,
  maximum **6 bytes**. This establishes a tiny capture difference at the observed
  repeatability scale, not bit-identical final images. Fixed-exposure scene records,
  all seven material inventories/six unlit probes and live uniform probes are equal.
  Automatic-exposure captures are retained separately, not pooled with fixed ones.
- Two reversed-order living-combat pairs, 120 settle +1800 frames/run: **7200**
  accepted frames, same gameplay/action records, internal resolution/settings and
  render-call/draw-call deltas for every corresponding frame; **0** late builders.

Descriptive combat intervals / CPU render-submit p50, in milliseconds:

| Run | Frame p50/p95/p99/max | CPU submit p50 |
|---|---|---|
| Baseline 1 | 8.9 / 11.3 / 15.4 / 31.7 | 6.8 |
| Candidate 1 | 9.1 / 11.6 / 15.4 / 28.5 | 6.9 |
| Candidate 2 | 8.8 / 11.1 / 15.6 / 26.7 | 6.7 |
| Baseline 2 | 9.5 / 11.9 / 16.4 / 28.8 | 7.2 |

One pair worsens medians; the reversed pair improves. Treat this as a regression
screen, not proof of speedup or unchanged frame-time distributions. No added draw
or dispatch is introduced; the runtime source diff is net **+2 lines**. The larger
change is behavioural coverage and source/reproduction documentation.

```sh
npm ci
npm test
npm run lint
npm run build
npm run world:validate
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs
# Both must fail their named pixel assertions, not a boot/import/route error:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs --negative=rim
MESA_VK_DEVICE_SELECT=1002:7550! node tools/material-calibration-check.mjs --negative=clone
MESA_VK_DEVICE_SELECT=1002:7550! node tools/view-lighting-check.mjs --all-scenes=1 --exposure=4 --out=/tmp/material-after
MESA_VK_DEVICE_SELECT=1002:7550! node tools/profile.mjs --port=5403 --frames=1800 --warmup=120 --out=/tmp/material-combat.json
```

Baseline is a detached worktree at `8d6135e` with only the updated capture tool
copied in. The CPU negative copies only the new smoke test into that worktree.
Never run competing GPU work or terminate another agent's renderer processes.
