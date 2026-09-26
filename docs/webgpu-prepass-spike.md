# WebGPU spike — re-authoring the G-buffer prepass in TSL

**Question.** How hard is a WebGPU migration, would the code get simpler, would it
get faster?

**Method.** Rather than argue from the API surface, `src/render/prepass.js` (the
depth/normal/velocity prepass) was re-authored in TSL and run head-to-head against
the real production pass in one browser session, on one GPU, on one scene.

Verdict up front: **the authoring is easier than expected, the numerics are
exact, and it is measurably slower.** Five non-obvious traps cost more time than
the port itself, and three of them are silent in WebGL.

---

## How to run it

```bash
node tools/webgpu-spike/run.mjs --w=960 --h=540 --frames=120
#   --mode=freezeObjects|freezeCamera   isolate object motion from camera motion
#   --forceWebGL                        run the SAME TSL through three's WebGL backend
```

Writes `shots/webgpu-spike.{json,png}`: the numeric diff plus a montage of both
arms' G-buffer channels and the difference.

Two launch details are load-bearing and were both discovered by failure:

- Playwright's default `headless: true` binary is `chromium_headless_shell`,
  which **never exposes `navigator.gpu`**. The full Chromium build is required
  (`run.mjs` points at `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`).
- `about:blank` **is not a secure context** for WebGPU purposes, so
  `navigator.gpu` is `undefined` there even in the full build. Test over the Vite
  dev server (`http://127.0.0.1:…`, a secure context) as `run.mjs` does.

## The experiment

| arm | what it is |
|---|---|
| **A** | `src/render/prepass.js` — the production GLSL3 pass, `scene.overrideMaterial`, hand-rolled previous-matrix bookkeeping. Imported unmodified. |
| **B** | `prepass-tsl.js` — the same three attachments via `MRTNode` + TSL's built-in `velocity`. |

Both arms get the same scene, built twice from one deterministic description
(the two `three` builds have separate class identities, so objects cannot be
shared), driven to the same frame index with the same camera. Everything that
sets a transform or an animation phase comes from a fixed-seed LCG, so a pixel
diff measures the pass and not the scene. 960×540, 518 400 pixels compared.

The scene is deliberately a stand-in built to hit every branch the production
pass special-cases: 260 static meshes, 3×120 instanced meshes, 6 skinned soldiers
driven by a 4-bone chain, one moving rigid rig, one double-sided wall, one
ground plane. It is ~6.2 k triangles, **not** the game's 11.3 M — see Caveats.

## Results — correctness

| channel | mean error | p99 | over threshold |
|---|---|---|---|
| depth (metres) | **7.6e-4 m** | 1.6e-5 m | 0.16 % over 1 cm |
| view normal | **0.053°** | 1.0e-6° | 0.34 % over 1° |
| coverage | **1.2e-4** | 0 | 0.04 % |
| material id | **1.4e-4** | 0 | 0.04 % |
| velocity (UV delta) | **5.7e-2** | 1.2e-1 | 85 % differ |

Depth is sub-millimetre over a 30 m range; the residual is varying-interpolation
precision between WGSL and GLSL. The `over` columns are silhouette pixels where
the two arms disagree about which surface wins by a fraction of a pixel — the
same magnitude of disagreement the project's own `imagediff` gate tolerates.

Those numbers are *after* fixing the five traps below. Before them the diff was
garbage (85 % of pixels, ~50° normal error) and looked exactly like "TSL gets the
maths wrong". It does not.

Isolating motion (`--mode=`) is what located the one real divergence:

| mode | velocity agreement |
|---|---|
| `freezeCamera` (objects move) | p99 = **0.0** — 99.3 % of pixels exact |
| `freezeObjects` (camera moves) | 85 % differ, arm B ~10× too large |
| default (both) | 85 % differ |

## The five traps

### 1. MRT on the renderer, not the material — and the output must be called `velocity`

`renderer.setMRT(mrt({...}))`, not `material.mrtNode = mrt({...})`.

`NodeMaterialObserver.needsVelocity()` — which gates whether per-object node
updates (`NodeUpdateType.OBJECT`) run at all — is:

```js
const mrt = renderer.getMRT();
return ( mrt !== null && mrt.has( 'velocity' ) );
```

It reads the *renderer's* MRT. With a material-level `mrtNode` the test fails,
`needsRefresh()` can return `NONE`, `updateBefore()` is skipped, and every
per-object uniform in the graph — including `VelocityNode`'s own previous matrix
— silently goes stale. It is not a perf detail: it is the difference between a
correct velocity buffer and a wrong one.

The name is also a hard-coded convention: it must be exactly `velocity`, and
because `MRTNode` resolves slots with `getTextureIndex()` **by texture name**,
the render-target texture must carry that name too. Our production names are
`gb-normal` / `gb-velocity` / `gb-depth`; a migration renames them.

### 2. The MRT output name `depth` is reserved, and colliding with it silently disables the depth test

`NodeMaterial.setupDepth()`:

```js
const mrt = renderer.getMRT();
if ( mrt && mrt.has( 'depth' ) ) depthNode = mrt.get( 'depth' );
…
if ( depthNode !== null ) depth.assign( depthNode ).toStack();
```

Anything you name `depth` in your MRT becomes **`gl_FragDepth`**. Ours is
positive linear view depth in metres, which is not a window-space depth, so every
fragment clamped to the far plane and the depth *test* stopped occluding. All
three attachments still got written — they just held the wrong surface's values.

Measured cost of this one: **29 % of pixels resolved to a different surface** and
depth read 4.4 m off on average. It presents as a plausible-looking image, which
is what makes it expensive.

### 3. Default blending is a hard pipeline failure on a no-alpha attachment

```
Color blending srcFactor (BlendFactor::SrcAlpha) … is reading alpha but it is
missing from fragment output.  - While validating targets[1] framebuffer output.
```

A `NodeMaterial` defaults to `NormalBlending`, which is applied to *every* MRT
target. `RG16F` has no alpha, so WebGPU rejects the entire pipeline. WebGL2
silently tolerates an alpha-reading blend factor on such an attachment (alpha
reads as 1), which is why the production pass has never had to say
`NoBlending`. A G-buffer write wants `NoBlending` regardless — but note the
direction of the difference: **the same latent state is silent in WebGL and a
hard error in WebGPU.** `MRTNode.setBlendMode()` exists and looks like the
answer; nothing in r186 reads `blendModes`, so it is dead code.

### 4. Render-target clear alpha defaults differ between backends

WebGL leaves the render-target clear alpha at 1, WebGPU at 0. This produced a
**14.8 % `matId` mismatch that read exactly like a per-object uniform bug** — the
matId histogram was the tell:

```
arm A  { 0: 15339, 0.5: 13380, 0.2: 9664, 1: 8505, 0.6: 7661, … }
arm B  { 0: 23842, 0.5: 13378, 0.2: 9664,       0.6: 7661, … }
```

Arm A had 8505 pixels at `matId = 1` that arm B had at `0` — and 8505 is exactly
the *uncovered* pixel count (1 − 0.8523). No shader writes `matId = 1`; that was
the clear colour's alpha. Pinning `setClearColor(0x000000, 0)` in both arms
dropped the error to 1.4e-4.

### 5. TSL's `velocity` is not a drop-in replacement for this velocity buffer

This was the hope — replace `owPrevModelMatrix`, the `prev` Map, `beginRecord` /
`recordMatrices` / `endRecord` and the `owCurrVP`/`owPrevVP` plumbing with one
built-in node. Half of it works:

- With a frozen camera it is **exact** (p99 = 0.0 across 99.3 % of pixels), so
  the per-object previous-transform tracking is right.
- With camera motion it is **~10× too large** (arm A max |v| 0.0072, arm B 0.118
  at the same frame, same camera, same scene). Reproduces identically through
  three's **WebGL** backend, so it is not a WebGPU-backend artifact.
- `positionPrevious` is `attribute('position')` as a varying, while
  `positionLocal` is *mutated* by the skinning/instancing nodes. So vertex-level
  deform is still unrepresented and `OW_COVERAGE_DYNAMIC` is still required.

I did not root-cause the camera term, and I am not going to guess at it in a
report. Two candidate mechanisms, both checkable in a follow-up:
`velocity` is a `nodeImmutable` singleton whose `previousModelWorldMatrix`
uniform is **not** put in `objectGroup` (only `previousProjectionMatrix` is
`.setGroup(renderGroup)`), so a shared instance may be written once per material
rather than once per object; and the previous/current camera matrices are shifted
inside `if (cameraData.frameId !== frameId)`.

**Conclusion for the migration: budget for hand-writing the velocity channel in
TSL, exactly as it is hand-written in GLSL today.** The "velocity becomes free"
saving does not exist.

## Results — code size and clarity

| | production GLSL pass | TSL re-authoring |
|---|---|---|
| total lines | 238 | 208 |
| **code lines** | **174** | **110** (−37 %) |

Mechanisms in the GLSL pass that the TSL version does not need at all:

| mechanism | occurrences removed |
|---|---|
| `#include <batching/skinning/morphtarget_pars_vertex>` and their `_vertex` calls | 15 |
| manual `owPrevModelMatrix` / `owCurrVP` / `owPrevVP` uniform plumbing | 13 |
| `this.prev` Map + `_seen` bookkeeping (`beginRecord`/`recordMatrices`/`endRecord`) | 13 |
| explicit `layout(location = N) out vec4` MRT declarations | 3 |
| `material.onBeforeRender` closure + `uniformsNeedUpdate = true` | 2 + 2 |

`NodeMaterial.setupPosition()` runs morph → skin → batch → instance for free, and
`normalView` is already back-side aware, so `if (!gl_FrontFacing) n = -n;` and the
entire six-call skinning/normal chunk dance disappear. Per-object channels become
three lines:

```js
const uCoverage = uniform(1);
uCoverage.onObjectUpdate(({ object }) => {
  uCoverage.value = (object.isSkinnedMesh || object.morphTargetInfluences != null) ? 0.7 : 1;
});
```

**It is genuinely less hacky.** The specific things that go away are the ones
that would most likely have been the source of a subtle bug. But note the
replacement idiom relies on *implicit conventions* rather than named APIs: two of
the five traps above (`velocity`, `depth`) are reserved output names that are
documented nowhere in the error path, and trap 2 fails by producing plausible
pixels. The GLSL version is more verbose and says what it means.

## Results — performance

1280×720, 200 timed frames, RX 9070 XT, same scene, same pass.

| | GLSL / WebGL2 | TSL / WebGPU |
|---|---|---|
| draw calls | 139 | **92** |
| triangles | 6 172 | 6 172 |
| CPU submit | **0.179 ms** | 0.236 ms (+32 %) |
| GPU pass (timestamp query) | n/a | **0.028–0.041 ms** |

Read this carefully, because two obvious measurements are misleading:

- A tight submit loop measures **queueing, not cost** — 200 frames of GPU work
  can be queued in 51 ms. The `submitMs` column is JS time around one
  `render()`; the GPU timestamps are the real per-pass GPU cost.
- `renderer.info.render.triangles` (and `.timestamp`) **accumulate across
  `render()` calls** in the WebGPU path where `WebGLRenderer` resets per render.
  The first run reported 563 212 triangles for a 6 172-triangle scene.

What the numbers say: for a G-buffer pass of this size the whole thing is
**CPU-dominated and GPU-trivial** (41 µs of GPU work against 236 µs of CPU
submission — a 6:1 ratio). WebGPU batches draw submission (139 → 92 calls) and
still costs more CPU, because the TSL path replaces hand-written JS with three's
generic node/observer machinery: a full `needsRefresh()` walk, `updateBefore()`
for every render object every frame (forced by trap 1), node-graph evaluation and
command encoding.

No like-for-like GPU comparison against arm A is available in this harness —
WebGL2 timer queries need `EXT_disjoint_timer_query_webgl2`, which the launch
configuration does not expose. But since arm B's entire pass is 41 µs of GPU
time, the GPU side is not where a win exists at this scale. (At the game's
11.3 M triangles, 24× the fill and a heavy forward pass, that conclusion may not
hold — see Caveats.)

## Incidentally: MRT on the renderer makes the separate prepass optional

With `renderer.setMRT()`, the MRT outputs are written by **whatever material is
being drawn**. The G-buffer can therefore be produced by the *forward* pass
itself, deleting the prepass entirely — one fewer full scene traversal, one fewer
139-draw-call pass, and no `overrideMaterial` swap. That is the structural win
WebGPU actually offers here, and it is invisible from a feature-checklist
comparison against WebGL2 (which has MRT, but cannot attach it to three's lit
materials without the `onBeforeCompile` surgery this repo already does elsewhere).

Not measured, deliberately: it requires the forward pass — GLSL today — to be
ported first, and comparing it against a stand-in lit material would be
manufacturing evidence.

## Caveats

- The scene is a stand-in (6.2 k triangles, no MB-scale world geometry, no
  `BatchedMesh`). `USE_BATCHING` is exercised by the real world and was **not**
  tested here.
- Velocity was forced to `RGBA16F` in **both** arms: `gl.readPixels` on a
  2-channel `RG16F` attachment is a portability cliff. Production uses `RG16F`.
- The `over1cm` / `over1deg` residuals need the production `imagediff` gate to be
  interpreted properly; this harness reports raw distributions, it is not wired
  into `smoke.test.mjs`.
- One spike, one pass, one GPU, one driver, one three revision (r186). The traps
  above are version-specific by nature — they are conventions, not API contracts,
  and r187 could rename or fix any of them silently.
