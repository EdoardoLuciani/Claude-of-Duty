# Application-only FX upload experiment

## Result and scope

**The existing public version-driven path eliminates the measured unchanged FX
uploads without a Three.js change.** API-unwrapped timing runs suggest a modest
render-CPU benefit, not an established desktop-FPS improvement.

Base/control: `5a6608bb968797bf4053bd38fe233037f921f64f`.
Candidate branch: `experiment/fx-versioned-uploads`.
Both clean installs retain Three.js `0978e2b62e53654ebe1a2c3032ebee0a4981c701`.
The lockfile and installed Attributes.js, WebGPUAttributeUtils.js, and
BufferAttributeNode.js were compared byte-for-byte and match between checkouts.
The Three.js fork PR was not changed, merged, or adopted.

The runtime change is five construction-time usage declarations:

- ParticleLayer's interleaved buffer: DynamicDrawUsage -> StaticDrawUsage.
- DecalSystem's four vertex attributes: the same change.

No shader, animation, budget, draw range, visibility, culling, prewarm, gameplay,
resource ownership, renderer implementation, or dependency code was changed.
ParticleLayer is used by five world/view particle rings **and the haze distortion
ring**, so the latter is included in the measurements and mutation audit.

StaticDrawUsage is an existing hint, not a new manual-update API or an assertion
that these arrays can never change. In this native-WebGPU-only application/pin,
the non-dynamic path honors explicit versions, and the native backend does not
choose an alternative allocation-frequency mode from this GL-style hint. This
choice is scoped to that contract; revisit it if backend support changes. Stream
is not presented as a universally correct hint for long-lived ring buffers.

## Mutation and lifetime audit

- ParticleLayer.emit() is the particle-array writer. It writes the complete
  32-float slot, including delayed birth/lifetime, and extends the dirty span.
  Wrap extends the span over both ends when needed; it does not omit old slots.
- ParticleLayer.flush() publishes ranges and needsUpdate only when dirty. It
  always advances the time uniform and instance-count/visibility metadata. Motion,
  growth, fading, and expiry are shader/time driven, not CPU-array rewrites.
- HazeSystem emits through its ParticleLayer and calls its flush() from update().
  The existing active gate suppresses expired offsets; it is unchanged.
- DecalSystem.add() and its UV writer populate a complete slot. The rest of a
  shorter replacement is degenerated, and its birth/fade records are updated.
  flush() publishes all four attribute ranges/versions and always advances uNow.
- debugBurst('clear') stops future scripted emissions; it does not clear particle
  storage. Expiration changes uniforms/visibility. Teardown disposes the owned
  geometry/materials; subsequent initialization constructs fresh buffers.
- Accumulated ranges remain pending if a frame does not draw. New publications
  append ranges rather than discarding older pending writes.

## Correctness evidence

A new smoke script exercises real ParticleLayer/DecalSystem classes and the pinned
Attributes/WebGPUAttributeUtils with a recording device and mirrored GPU storage.
It verifies all particle modes, dirty versions/ranges, unchanged suppression,
wrap, hidden/pending publications, clipped decals, shorter fallback replacement,
expiry, revival, and source/GPU storage equality. Negative particle/decal variants
that suppress dirty publication fail as expected.

A separate hardware fixture uses the real atlases and native node materials,
renders to half-float targets, and reads every component. Two independent paired
runs compare 37 stages each: additive/lit/distort particles and decals, animation
without CPU mutation, new slots, wrap, partial updates, another camera, shorter
slot replacement, expiry, revival, and delayed birth.

- **2,424,832 compared image bytes; zero differences.**
- Images are finite and nonblank where expected; time-only stages visibly change;
  expired stages are blank. This is not a vacuous unchanged-scene comparison.
- Unchanged and time-only stages issue no candidate attribute writes.
- Dropping particle publication breaks parity in 16,816 half-float components;
  dropping decal publication breaks it in 2,820 components.
- The existing tools/fx-webgpu probe passes on both control and candidate,
  including soft depth, anchored tracers, haze offset rendering/composition,
  expired-haze gating, and casings.

### Full-game capture boundary

Two captures per condition were taken after the five-enemy combat cycle using the
actual native final output and normal HUD, not a possibly black headless swapchain.
Control repeats are exact; candidate repeats are exact. Cross-condition captures
have **862 / 2,073,600 pixels different (0.04157%), maximum channel delta 1/255**.
The existing tools/imagediff.mjs epsilon gate passes without changing its criteria.

This is a repeatable condition-correlated one-level difference, **not** evidence
of random control-repeat noise. Its source in the full temporal/composite graph
was not isolated. Do not call full-game screenshots pixel-identical or pretend
that the exact isolated-FX comparisons prove every application frame identical.
No visual-quality setting was reduced. Screenshots/diff are retained with the
local evidence; exhaustive quality/time-of-day capture sweeps were not run.

## Combat upload census

High, 1920x1080, DPR 1, official Chrome Beta 153.0.8010.12, nonfallback hardware AMD
RDNA-4 WebGPU. Native page compositing remains the known headless/software boundary;
this is not a GPU-composited desktop-FPS benchmark.

For each population/condition: 120 warmup + 900 measured frames, repeated twice.
The living-combat-v1 fixture uses real movement, AI firing, reloads, switches,
physics, damage/impact FX, and high finite HP pools. Complete fixture reports,
per-frame draw counts, and final FX array hashes/versions match across conditions.
There are no page errors or late node-builder builds.

The count-only probe associates actual GPUQueue.writeBuffer calls with producer
arrays and per-GPUBuffer resident versions. Its final coverage includes all six
particle rings and four decal attributes. An initial per-owner probe omitted haze;
that attribution was corrected before the two primary repeated captures below.

| Per frame                              |    5 control | 5 candidate |   12 control | 12 candidate |
| -------------------------------------- | -----------: | ----------: | -----------: | -----------: |
| All uploaded bytes                     | 1,359,203.66 |  472,852.87 | 1,796,705.29 | 1,096,199.69 |
| FX uploaded bytes                      |   891,559.89 |    5,209.10 |   711,853.23 |    11,347.63 |
| FX bytes at unchanged resident version |   886,350.79 |       **0** |   700,505.60 |        **0** |
| All writeBuffer calls                  |       758.72 |      753.14 |     1,523.65 |     1,519.16 |
| Draws                                  |       931.41 |      931.41 |     1,238.74 |     1,238.74 |

Both repeats produce identical counts/bytes. The total byte and call differences
are exactly accounted for by FX: no unexplained non-FX reduction. Savings are
**65.2% / 39.0% of total uploaded bytes**, and **99.4% / 98.4% of FX bytes**, for
5/12 enemies. Calls decrease only about 5.58 / 4.50 per frame; this is principally
removing large full-array uploads, not solving the much larger uniform-write count.
The lower-enemy scenario has more unchanged FX frames; more enemies is not expected
to produce monotonically larger savings from this particular policy.

These are direct revision-based measurements, not a claim that every byte-identical
write in the earlier resource census was skippable. Sparse changed versions can
use multiple writes. In the isolated fixture, initial mapped allocation leaves a
pending source range, so the first later update can resend it alongside a new range;
this existing backend behavior is retained, not fixed in this experiment.

## API-unwrapped CPU timings

Four 900-frame runs per population/condition, with condition order alternating
between pairs: **14,400 measured frames**. No GPU API wrappers, byte snapshots,
CPU profiler, perf recorder, or render-object callback probes are active. Only
frame/game-render timers and the existing no-late-builder observer remain.
Count-mode timings above are not used as performance evidence.

Mean render CPU milliseconds for each run:

| Enemies | Run | Control | Candidate |
| ------- | --: | ------: | --------: |
| 5       |   1 |   6.752 |     6.259 |
| 5       |   2 |   6.385 |     6.249 |
| 5       |   3 |   6.309 | **5.095** |
| 5       |   4 |   6.528 |     6.191 |
| 12      |   1 |   8.459 |     8.095 |
| 12      |   2 |   7.910 | **8.033** |
| 12      |   3 |   8.178 |     7.916 |
| 12      |   4 |   8.272 |     7.919 |

The median of run means is **6.457 -> 6.220 ms (3.7%)** at five enemies and
**8.225 -> 7.976 ms (3.0%)** at twelve. These are modest, workload-local indications,
not a precise universal speedup. The five-enemy candidate run 3 is unusually fast;
it is retained and disclosed, not used to advertise a larger average gain. One
12-enemy pair is slower on the candidate. CPU/GPU/process work overlaps; no GPU-time
or FPS gain is established here. Bone/uniform duplication, preparation, and most
command submission/validation remain outside scope.

## Validation and artifacts

Both worktrees installed cleanly with npm ci. npm reports one existing high-severity
dependency finding on both unchanged lockfiles; no audit-fix/dependency change was
attempted. Candidate: **131 smoke tests passed**, build/typecheck/lint passed,
format and diff checks passed. No world/prop assets or protected manifests changed.

Primary local evidence:

- /tmp/cod-fx-{control,versioned}-{5,12}-count-r{2,3}.json: repeated primary counts.
- /tmp/cod-fx-{control,versioned}-{5,12}-cpu-r{1,2,3,4}.json: all timing samples.
- /tmp/cod-fx-{control,versioned}-render-r{1,2}.json: all half-float image components.
- /tmp/cod-fx-negative-{particle,decal}-render.json: rendered negative controls.
- /tmp/cod-fx-{control,versioned}-existing-probe/dgpu.json: existing analytic probe.
- /tmp/cod-fx-{control,versioned}-combat{,-repeat}.png; /tmp/cod-fx-combat-diff.png.
- /tmp/cod-fx-image-gate.json and /tmp/cod-fx-summary.{json,log}.
- /tmp/cod-fx-{profile,render,analyze}.mjs and /tmp/cod-fx-render-fixture.{mjs,html}:
  temporary capture/analysis tools, not committed portable browser harnesses.
- /tmp/cod-fx-{versioned,control}-{npm-ci,build}.log and /tmp/cod-fx-tests.log.

Portable regression command from the candidate checkout:

```sh
node tests/smoke/smoke-fx-versioned-uploads.mjs
```

For the temporary render harness, copy its saved HTML/module into either worktree
as .tmp-fx-versioned.html/.mjs before running /tmp/cod-fx-render.mjs. For production
combat timing, /tmp/cod-fx-profile.mjs accepts --root, --agents, --out and optional
--count/--capture; it starts its own preview server. All temporary project files
were removed after captures.
