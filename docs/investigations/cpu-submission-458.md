# CPU submission follow-up: #458

## Decision

**No application optimization or permanent Three.js patch is promoted.** The
remaining cost is predominantly per-render-object maintenance and submission,
not creation of native bind groups or just uniform upload traffic. Small binding
prototypes show some controlled-core gains but fail ordinary-scheduler acceptance.
Three's existing `BatchedMesh` API demonstrates a substantially cheaper traversal
path in an isolated toy, not a demonstrated combat FPS improvement.

This follows merged dependency PR #460, starting at
`948070c40e2b17c84883b69fe33805326a68bb28`. The installed and inspected upstream
`dev` commit is `0978e2b62e53654ebe1a2c3032ebee0a4981c701` (187dev), still upstream
tip at the final check on 2026-10-18. No dependency changes are included here.
Rare render-call stalls in #413 remain unresolved. No upstream issue/PR was opened.

## Protocol and evidence

- Ryzen 9 9950X, RX 9070 XT, native AMD/RDNA4 WebGPU, fallback false;
  Mesa RADV 26.2.4, Fedora 44/Linux 7.2.11, Node 24.18.0.
- Production profiler: full Chrome for Testing 153.0.8010.12, high, DPR 1,
  `living-combat-v1`, five soldiers, finite 10,000 HP, grenades disabled,
  120 warmup + 1,800 measured frames, unpaced lockstep 60 Hz simulation.
- Each source trial gets a fresh production build/browser/server. Exact source
  hashes and the lockfile pin are checked. Sources **and production build** are
  restored in `finally`; Vite dependency cache is invalidated.
- 73 production profiling runs / 131,400 measured frames, including diagnostics;
  six independent CDP profiles. Six additional isolated API runs / 10,800 frames.
  These are not 79 throughput-acceptance runs: pilots, sampling, counters, GPU,
  and visual-validation runs are explicitly separate.
- Primary confirmation order within each series is base1/candidate1,
  candidate2/base2, base3/candidate3. Three fresh pairs per series. Different
  series, CPU-affinity policies, and diagnostic modes are **not pooled**.
- GPU jobs ran serially. Background machine activity was not globally disabled.
  Affinity is a noise diagnostic, not a portable game optimization: Linux
  `taskset` pins only renderer process main threads after game boot, before warmup;
  existing worker/compositor/GPU threads retain their affinity. Even pinned
  controls drift. Timing quantization is approximately 0.1 ms.
- Async worker admission is not seeded replay equivalence. Fixture health/activity
  gates and workload counters must pass; identical inputs do not prove identical
  per-frame navigation outcomes.

Raw JSON, manifests, six CPU profiles and source maps, all logs, PNGs, summary,
prototype diff, and environment metadata are in
[issue-458-cpu/captures.tar.gz](issue-458-cpu/captures.tar.gz).
Archive SHA-256: `48bd5e5754dea45ce2a8adbe51b6df76dfe72931cbcda18f478bb1fd603ab2bb`.
Identical evidence files are stored as tar hardlinks to reduce archive size;
ordinary `tar -xzf` reconstructs them.
The earlier dependency/indirect/upload investigation remains separately on
`analysis/issue-458`; its captures are not mixed into these results.

## What consumes CPU

The postprocessor aligns CDP/document clocks, excludes setup/warmup, and retains
only measured-frame stacks inside `observedRender`. Three unpinned baseline
profiles (`hotspots-1`, `hotspots-2`, `hotspots-base`) agree:

| Hotspot                    | Exclusive render samples | Inclusive render samples |
| -------------------------- | -----------------------: | -----------------------: |
| `Bindings.updateForRender` |                 9.3–9.8% |               36.9–37.4% |
| `Bindings._update`         |               11.3–11.4% |               27.4–27.7% |
| `UniformsGroup.update`     |                 4.9–5.2% |                 8.7–8.9% |
| native `writeBuffer`       |                 5.8–6.1% |                 5.8–6.1% |

Inclusive rows overlap: **do not add them**. These are weighted sampling
observations, not exact method durations; sampling perturbs execution and stacks
without the render ancestor are outside this breakdown.

A separate pinned baseline CDP session reports 13.035 s renderer-main-thread CPU
in 13.546 s elapsed (~96% busy). That includes setup, warmup, and export and is
**not** a steady-frame CPU timing. `ProcessTime` also includes other renderer
threads; `ScriptDuration` is not complete JS accounting. The main-thread metric
supports genuine CPU pressure rather than treating all synchronous render time
as GPU waiting.

Separate 720p GPU diagnostics have timestamp **pass-sum** medians of
2.875 ms base / 2.877 ms candidate (599 samples each). They exclude copies, waits,
and presentation and are not complete GPU-frame times. CPU and GPU overlap;
these numbers must not be added or subtracted to construct a frame budget.

### Source-level interpretation

At the inspected pin:

- [`Renderer._renderObjectDirect`](https://github.com/mrdoob/three.js/blob/0978e2b62e53654ebe1a2c3032ebee0a4981c701/src/renderers/common/Renderer.js)
  still performs render-object, node, geometry, binding, and pipeline maintenance.
- [`Bindings`](https://github.com/mrdoob/three.js/blob/0978e2b62e53654ebe1a2c3032ebee0a4981c701/src/renderers/common/Bindings.js)
  visits groups and individual bindings; even unchanged resources incur scope,
  texture/sampler, attribute generation, map lookup, and cache-key bookkeeping.
- [`NodeManager.updateGroup`](https://github.com/mrdoob/three.js/blob/0978e2b62e53654ebe1a2c3032ebee0a4981c701/src/renderers/common/nodes/NodeManager.js)
  immediately accepts object-scoped groups; other scopes use versioning.
- [`UniformsGroup`](https://github.com/mrdoob/three.js/blob/0978e2b62e53654ebe1a2c3032ebee0a4981c701/src/renderers/common/UniformsGroup.js)
  compares values and dispatches by type. Removing uploads does not remove this
  traversal or per-object native binding/draw work.

The count-only baseline (`counts-base.json`) has median **875 object visits,
1,977 binding-group updates, 14,274 scope checks, 372 backend uniform updates,
587 `writeBuffer` calls, 10 backend binding rebinds, and zero native
`createBindGroup` calls per measured frame**. Native bind-group creation is not
the steady-state bottleneck. Range splitting and other upload paths mean the
372 update calls and 587 writes are not a one-to-one accounting.

## Iterations

All implementation experiments are offline, source-hash-guarded transforms in
`tools/lib/cpu-submission-trials.mjs`, not permanent runtime code.

| Experiment                                                             | Finding / disposition                                                                                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy bind-group key; then lazy texture-resource lookups                | Plausible reduced bookkeeping; no isolated robust acceptance win.                                                                                   |
| RenderObject initialization field instead of manager lookup            | No convincing gain.                                                                                                                                 |
| Numeric uniform dispatch / cached binding classifications              | No convincing gain; keep rejected.                                                                                                                  |
| Indexed, local-reference, group-only, binding-only, uniform-only loops | Initial large win failed replication. Matched render medians: base 5.7 ms, indexed 5.8 ms. Same transformed/build hashes; reject pilot as evidence. |
| Stable material controls moved into native `renderGroup`               | Fragments pass sharing: median uniform updates **372 → 603**, writes **587 → 1,293**. Same draw count. Slower; reject.                              |
| Version/epoch reuse for unchanged non-object groups                    | Scope checks 14,274 → 13,008, unchanged uploads/draws; no robust gain.                                                                              |
| Fuse `_update` into its caller                                         | No convincing gain.                                                                                                                                 |
| Hoist object-scope check + lazy resource bookkeeping                   | Best small candidate; correctness passes, ordinary-scheduler throughput does not.                                                                   |

The final candidate exploits the native homogeneous-group invariant, bypassing
redundant object-scope version checks. It builds a **complete ordered resource
key only on actual binding invalidation**, retaining external/default-texture
cache exclusions. It does not combine buffers, alter material/object identity,
change traversal order, or introduce new permanent library patches.

Counter diagnostic (`counts-hoist-combo.json`): **14,274 → 1,299** scope checks
(~90.9% fewer), with the same 1,977 group updates, 372 backend uniform updates,
587 writes, 10 rebinds, zero native bind-group creations, and median 875 draws.
Pinned sampled `Bindings.updateForRender` inclusive share falls 33.0% → 29.0%.
Neither counter reduction nor sampled share alone qualifies throughput.

### Fresh matched confirmation

Entries are the three per-run **CPU render/submission p50s**, followed by median
of run medians. Callback column is also median of three run medians. Units ms.
Candidate is `hoist-scope+lazy-resources`.

| CPU policy / resolution  | Base render p50s | Candidate render p50s | Base → candidate render | Base → candidate callback |
| ------------------------ | ---------------- | --------------------- | ----------------------- | ------------------------- |
| Default / 1280×720       | 6.1, 5.8, 5.9    | 5.6, 5.9, 5.9         | **5.9 → 5.9**           | **8.0 → 8.0**             |
| Main core 12 / 640×360   | 4.5, 4.6, 4.5    | 4.3, 4.4, 4.4         | 4.5 → 4.4               | 6.2 → 6.0                 |
| Main core 12 / 1280×720  | 4.9, 4.8, 4.6    | 4.6, 4.6, 4.6         | 4.8 → 4.6               | 6.6 → 6.4                 |
| Main core 12 / 1920×1080 | 4.7, 4.8, 4.8    | 4.3, 4.4, 4.9         | 4.8 → 4.4               | 6.6 → 6.3                 |

Files are `natural-720-{base,combo}-{1,2,3}.json` and
`pin-{360,720,1080}-{base,combo}-{1,2,3}.json`. The 1080p third pair regresses;
the 720p pinned controls drift substantially. The small controlled-core signal
is interesting, **not a repeatable general production win**. Do not advertise
4–8% improvements from selected aggregate rows while omitting default-policy
results or that third pair. No optimization is shipped on this evidence.

## Existing API alternative: batching

`tools/batch-submission-probe.mjs` compares 512 ordinary meshes with one native
`BatchedMesh`, using 16 geometries, identical transforms, and the **same material
object**. Three fresh matched pairs (`batch-probe-{mesh,batch}-{1,2,3}.json`):

- CPU render/submission p50: ordinary **0.9, 0.9, 0.9 ms**; batch **0.2, 0.2, 0.2 ms**.
- **512 native draw commands in both modes**, zero measured shader builders.
- Full float readbacks are identical in every run (maximum difference zero).

This is a **static, all-visible, render-to-texture development-module toy**,
using default managed headless Chromium rather than the production profiler's
explicit full-browser selection. Its actual rAF cadence remains ~17 ms despite
requested unpaced flags (ordinary 17.0–17.1, batch 17.3–17.4 ms). It demonstrates
less CPU maintenance, **not an FPS/throughput improvement**, and is not pooled
with combat production measurements. It has no soldiers, shadows, moving camera,
post graph, or gameplay identity/prewarm integration.

The current [`WebGPUBackend._draw`](https://github.com/mrdoob/three.js/blob/0978e2b62e53654ebe1a2c3032ebee0a4981c701/src/renderers/webgpu/WebGPUBackend.js)
loops over batch entries with individual `drawIndexed(..., 1, ..., firstInstance)`
calls. The advantage is avoiding repeated render-object/binding/pipeline setup,
not magical WebGPU multi-draw. The existing `BatchNode` selects `instanceIndex`
when the backend has no draw-index builtin.

### Why not batch the whole game blindly?

A separate full-combat diagnostic (`inventory.json`) attributes **backend draw
visits**, not CPU-time shares, across all measured frames:

| Category                                                |  Share |
| ------------------------------------------------------- | -----: |
| Already-instanced static world                          | 54.04% |
| Ordinary static-world meshes                            | 19.09% |
| Skinned meshes (including arms classified before scene) | 19.65% |
| Other viewmodel                                         |  2.59% |
| Other dynamic world rigid                               |  2.43% |
| Post/other                                              |  2.22% |

Category counts sum exactly to all 1,546,605 measured draw visits. **Most static
world visits are already instanced.** Converting those to ordinary batch entries
could increase native draw commands; the toy is not evidence to de-instance them.
Ordinary static meshes are a bounded candidate, not the entire submission load.

Next application experiment should inventory compatible **actual material
identities**, preserve existing instancing, then try only a small ordinary-static
batch. Agree first on whether original meshes remain logical owners behind render
proxies: actual render-object identity/hierarchy changes cannot silently satisfy
the existing identity contract. Preserve layers, cast/receive-shadow flags,
per-camera culling, native buffer isolation, and actual-graph prewarm. Compare
fresh uninstrumented combat pairs before expansion. Alternatively, build a focused
upstream binding-traversal reproducer; current evidence is not a general Three bug.

## Correctness and reproduction

Pristine pin **and** candidate passed native buffer/pipeline isolation, new
texture/storage identity and disposal readbacks, low/high/ultra startup, all five
render regression suites, and strict arm-material checks. New readbacks cover
shared material with distinct per-object buffers/textures/uniforms, content edits,
same-version disposal/recreation, changed attribute/texture identities, shared
texture with distinct storage, and sampler changes. Both retain one shader builder
and one pipeline throughout that probe. Hero RGB is pixel-identical (1280×720,
zero changed pixels). These checks do not prove a throughput gain.

Clean `npm ci`, 130 smoke tests, typecheck/lint/build, and formatting passed.
World assets/source were not changed; world regeneration is not involved.

```sh
npm ci
# Serialized fresh run; output must be outside the checkout.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=hoist-scope+lazy-resources --id=repeat-combo-1 --out=/tmp/458-repeat
# Keep diagnostics separate from acceptance. Optional Linux main-thread control:
# --cpu-core=12. Counter diagnostic: --submission=1. GPU: --gpu=1.
# CPU sampling emits .cpuprofile and matching -maps directory:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/cpu-submission-trial.mjs \
  --trial=base --id=repeat-cpu --out=/tmp/458-repeat --cpu=1
node tools/cpu-submission-profile.mjs \
  --cpu=/tmp/458-repeat/repeat-cpu.cpuprofile \
  --frames=/tmp/458-repeat/repeat-cpu.json \
  --maps=/tmp/458-repeat/repeat-cpu-maps --out=/tmp/458-repeat/hotspots.json
# Isolated API probe only, not combat acceptance:
MESA_VK_DEVICE_SELECT=1002:7550! node tools/batch-submission-probe.mjs \
  --mode=mesh --out=/tmp/458-repeat/api-mesh.json
# Repeat with --mode=batch; alternate fresh browser runs, do not compare FPS.
```

Run `base` and candidate in alternating pairs, at least three each. Never run
source trials concurrently or run pristine-source smoke tests while a trial is
mutating files. Normal exits restore source/build. After forced termination,
recover **only in the disposable trial worktree**, preserving any unrelated work:
restore the experimental `src/materials/index.ts`, then `npm ci && npm run build`.
The dependency-only merged PR remains untouched. All rejected prototypes and
captures are retained separately in this investigation, not application runtime.
