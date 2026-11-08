# `noUncheckedIndexedAccess` triage and pilot (issue 602)

Status: **not ready for global enablement.** `tsconfig.json` is unchanged and the normal
`bun run typecheck` gate stays authoritative. This page records the baseline, how the
diagnostics break down, the pilot patterns and the remaining plan.

## Baseline

Command, run on `b5a2f94` (develop after the Bun migration):

```sh
bun check --noUncheckedIndexedAccess --all --no-pretty   # Bun 1.4.4
```

| Checker                           | Diagnostics |
| --------------------------------- | ----------: |
| `bun check` (Bun 1.4.4)           |       2,442 |
| `tsc` 7.0.2                       |       2,442 |
| `tsc` 6.0.3 (classification run)  |       2,442 |
| Any of the above without the flag |           0 |

The issue's 2,499 diagnostics on `af113a8` are superseded by this run. After the
pilot, the count is **2,408** across 95 files. 141 of 236 `src` files have no diagnostics
of their own, but only 83 stay clean once their imports are included.

| Subsystem | Before | After | Typed buffer | Array | Tuple | Record | Indirect |
| --------- | -----: | ----: | -----------: | ----: | ----: | -----: | -------: |
| physics   |    941 |   941 |          668 |   188 |     1 |        |       84 |
| weapons   |    430 |   425 |           40 |   354 |     1 |     17 |       13 |
| ai        |    395 |   395 |           26 |   298 |    37 |     11 |       23 |
| ui        |    217 |   217 |              |   191 |       |      1 |       25 |
| fx        |    168 |   168 |           90 |    63 |       |        |       15 |
| materials |     66 |    66 |           63 |       |       |        |        3 |
| audio     |     64 |    64 |           24 |    29 |     2 |      2 |        7 |
| radio     |     53 |    53 |              |    53 |       |        |          |
| sky       |     27 |    27 |              |    27 |       |        |          |
| intel     |     14 |    14 |              |     9 |       |      1 |        4 |
| render    |     21 |    13 |            2 |    10 |       |        |        1 |
| core      |     13 |    10 |            4 |     4 |       |        |        2 |
| market    |     10 |    10 |              |    10 |       |        |          |
| game      |      9 |     0 |              |       |       |        |          |
| world     |      9 |     0 |              |       |       |        |          |
| dev       |      5 |     5 |            1 |     4 |       |        |          |

The "after" columns break down the post-pilot diagnostics by the type being indexed.
The largest files are `physics/ragdoll.ts` (304), `physics/bvh.ts` (268),
`physics/index.ts` and `weapons/viewmodel.ts` (134 each).

## Classification

The counts above are **diagnostics, not bugs**. A one-off script (not committed) built
the TypeScript 6 compiler API program for this `tsconfig.json`. For each diagnostic it
found the indexed read at fault. For a `'x' is possibly undefined` diagnostic, that is the
read in `x`'s initializer. It then classified that read by the indexed type and the shape
of the index. There are 1,419 such root reads after the pilot. One read typically
produces 1–10 diagnostics as the value is used.

| Root read                                              | Roots | Diagnostics | Usual meaning                                                                                                                                           |
| ------------------------------------------------------ | ----: | ----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed buffer with offset/variable/constant index       |   704 |         918 | Proven by construction: stride arithmetic over buffers sized from validated counts (BVH, ragdoll, decals, masks). The checker cannot express the bound. |
| Array inside `for (i < arr.length)`                    |    78 |         328 | Proven by loop bound. Where the index is unused, `for…of` is exact.                                                                                     |
| Array inside a loop bounded by another length/capacity |   104 |         374 | Usually a parallel/pooled array invariant (`slots[i]` for `i < alive.length`). This is a real invariant that should be stated once at construction.     |
| Array with constant index                              |   208 |         246 | Often an inaccurate type: a fixed triple/pair typed as `number[]`, or an element read after a length check (`meshes[0]`).                               |
| Array with variable/computed index or destructuring    |   100 |         292 | Mixed: cursors (`path[pathIndex]`), ring buffers, and genuinely unchecked lookups.                                                                      |
| Record/index signature with key                        |    20 |          32 | Either a finite key set typed as `Record<string, T>` (fix the type) or a dynamic asset/catalog lookup (validate where it enters).                       |
| Tuple with variable index                              |    28 |          41 | `Vec3[k]` for `k < 3`. Correct, but TypeScript does not narrow numeric loop indices.                                                                    |
| Indirect                                               |   177 |         177 | The value comes through a parameter, assignment or callback, so the root is elsewhere.                                                                  |

Representative reviewed findings:

- **Useful: dynamic lookup.** `weapons/clips.ts` read `manifest[source].duration`. When
  a weapon alias names a clip missing from the asset manifest, the failure was a
  context-free `Cannot read properties of undefined (reading 'duration')` inside clip
  construction.
- **Useful: inaccurate type.** `world.spawn(i)` on a manifest with no spawns computed
  `0 % 0` and returned `undefined`, while its type promised a spawn point. The player
  already guards with `sp?.position`, so the type was what was wrong, not the runtime.
- **Useful: unlabeled output.** `sectorLabel(NaN)` returned `undefined` for a type that
  promises one of eight labels, so an unlabeled HUD cue would have been emitted.
- **Proof limitation.** `core/model-metadata.ts` `vec3` checked `length === 3` and then
  read `[0..2]`. The checker does not narrow `number[]` from a length comparison.
- **Proof limitation, hot path.** `physics/bvh.ts` reads `pos[p + 0..8]` for `p = i * 9`,
  `i < total`, and `pos` is allocated as `total * 9`. That makes 18 diagnostics per
  triangle loop, with no defect.
- **Inaccurate type.** `render/lut.ts` declared its single preset as
  `Record<string, GradePreset>`. Under the flag, even its `GRADE_PRESETS.default` fallback
  is "possibly undefined".

## Pilot

The pilot is five direct fixes, one per pattern, and none changes runtime behavior for
valid inputs. There are no new `!`, `as`, ignore comments, lint changes, optional-chaining
sweeps or numeric fallbacks. `src/core/model-metadata.ts`, `src/render/lut.ts`,
`src/world/index.ts` and `src/game/search-assist.ts` now report zero diagnostics of their
own. `src/weapons/clips.ts` goes from 12 to 7; the rest is the sampled-track hot path,
which is out of scope.

| Pattern                         | Change                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validated shape invariant       | `vec3` destructures `[x, y, z, ...extra]` and rejects a missing coordinate or extra elements. It keeps the same error messages and validation order (array → finite numbers → arity).                                                                                                 |
| Precise finite-key record/tuple | `GRADE_PRESETS` uses `satisfies Record<string, GradePreset>`, and `createGradeLut` takes `GradePresetName`. Unknown presets are now a compile error instead of a silent fallback. `LUM` is a readonly triple. The LUT bytes are unchanged (verified by SHA-256 against the original). |
| Honest optional type            | `world.spawn()` returns `SpawnPoint \| undefined` and explicitly returns `undefined` when there are no spawns. Its one caller already handled that.                                                                                                                                   |
| Boundary validation             | `manifestClip()` throws `[weapons] animation manifest has no clip '<name>'` when an alias source is missing. Unmapped authored events stay deliberately optional through a narrowed local.                                                                                            |
| Range invariant / dense loop    | `sectorLabel` throws on a non-finite bearing (it is called only when a cue is emitted, about once every 15 s). Loops that never use their index (`tickSearchAssist`, world lamp/bulb updates) use `for…of`.                                                                           |

`for…of` on hot paths: in V8 (Node 26.3), a warmed function looping over a 24-element
array grew the heap about equally with an indexed loop and with `for…of` (≈12–13 KB over
10⁶ calls, i.e. no per-call allocation). With every JIT tier disabled, `for…of`
allocated ≈1.6 MB, because it creates an iterator per call. Per-frame functions reach
the optimizing tiers immediately. Only loops whose index is otherwise unused should be
converted.

Tests: `tests/smoke/smoke-indexed-access-pilot.ts` covers valid inputs, plus short,
long, non-numeric and non-array coordinates; wrapped, negative and empty spawn lists;
the preset key set and LUT size; mapped and unmapped magazine events; and missing manifest
clips. `smoke-search-assist.ts` adds the full finite bearing range and non-finite rejection.
Against the original source, every valid-input assertion passes; only the new
absence/fail-fast assertions fail.

## Small-subsystem pass

The second PR fixes every non-typed-buffer diagnostic in dev, market, core, render, intel,
sky, radio, audio and fx that has a direct fix, using the same patterns. The total goes from
2,408 to **2,256**, and market, sky and intel now report zero.

| Pattern                     | Examples                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Precise finite-key record   | `IMPACTS` `satisfies Record<SurfaceName, ImpactRecipe>` (the checker enforces coverage of every surface); `MUZZLE_PROFILES`; gait/gear mix types with a required `walk` fallback; the shared `hasOwn` guard replacing an `as` cast |
| Tuple instead of `number[]` | atmosphere coefficients, sun/moon tints, night ambient hue, the three star layers, the tinnitus node list                                                                                                                          |
| Read once, then narrow      | `const [first] = meshes`, a local strike object instead of `active[length - 1]`, a precomputed `lastDrop`, the four volumetric taps built as a sum, the fx atlas reading its four settled loads as a tuple                         |
| Pool owns its slot          | each intel cache owns its HUD pulse (the minimap reads pulses by index, not identity)                                                                                                                                              |
| Fail fast at the read       | callout actor, stale or unloaded sample round-robin index on close and distant layers (previously a context-free `TypeError` later), stereo worklet output                                                                         |
| `for…of` / manual counter   | loops whose index is unused, or used only for instance-matrix writes                                                                                                                                                               |

Not fixed here, because each needs the same proof-convention decision as typed buffers
([#624](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/624)):

- **Ring cursors** (`(cursor + i) % length`): audio dry slots, spatial track cursor, fx shell
  spawn.
- **Reverse loops that splice while iterating**: radio `active` and `bombs`. Converting them to
  forward iteration would change processing (event) order.
- **Values derived from typed buffers**: core `lo`/`hi`, the IR median, fx probe surfaces,
  the noise permutation and the decal `FAN`.

`.entries()` is **not** allocation-free. Over 10⁶ warmed calls on a 48-element array it
caused 1,774 scavenges, against 3 for an indexed loop and 12 for `for…of` with a manual
counter. Use it only on cold paths (asset load, IR/music generation, telemetry export).

Equivalence checks (not committed): a full radio strike pass emits a byte-identical event
stream before and after the change (61 events). The music score data was transcribed
unchanged. New tests cover non-finite strike bounds, stale sample indices and `series()`
wiring.

## Enforcement

A scoped gate is **not** installed.

- `bun check --noUncheckedIndexedAccess <file>` checks the file **and its imports**. Of
  the 141 files with no diagnostics of their own, only 83 pass that way, because the rest
  import a module with diagnostics. `world/index.ts` is a pilot example: it is clean on its
  own but imports `weapons/viewmodel.ts`.
- A gate made of those 83 files would cover leaves only, and keeping its file list up to
  date would be a new hand-maintained baseline in a protected manifest/workflow. That is
  disproportionate while the flag is not the target configuration.
- Use the command above ad hoc. Compare the total against the latest count recorded here, and
  check that a touched file does not gain diagnostics.

## Remaining blockers and follow-up

Global enablement needs the following, roughly in this order:

1. **Owner decision for typed-buffer kernels (918 diagnostics, mostly physics/fx/materials;
   tracked in [#624](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/624)).**
   TypeScript cannot express "this offset is in bounds", and per-read guards are both
   slower and wrong for proven invariants. The realistic options are:
   - a documented, file-local rule allowing `!` only on typed-buffer reads inside a kernel
     whose buffer sizes are validated at construction (oxlint does not currently ban
     non-null assertions, so this would be a reviewed convention, not a lint change);
   - small inlined accessors that throw on `undefined`. These are cheaper to review but add
     a branch per read on BVH/ragdoll/raycast paths and need profiling.

   This decision is required before physics can be touched. The estimate is one PR per
   kernel file once it is made.

2. **Pooled/parallel arrays (≈374).** State the capacity invariant once: fixed-length
   tuple types where the length is a compile-time constant, otherwise a single
   construction-time check plus the convention from step 1. Mainly ai, ui and weapons,
   about one PR per subsystem.
3. **Mechanical, behavior-preserving fixes (≈615: length-bounded loops, constant indices, tuples):** `for…of` where the index is unused;
   triples typed as `number[]` (`Vec3`, colors) converted to tuples; precise records;
   reads after `length` checks restructured to destructuring. These are leaf-first and
   small per subsystem: radio, sky, market, dev, core, render and intel are under 60
   diagnostics each.
4. **Dynamic lookups (≈500: computed indices, records, indirect).** Review each
   one; this is where the remaining real findings are likely to be. Validate at the
   asset/catalog boundary or model absence.
5. Flip the flag in `tsconfig.json` only when the count is zero, with no permanent
   allowed-error list.

Steps 2–4 cover the 1,490 non-typed-buffer diagnostics (273 of them in physics), across roughly
ten subsystem PRs. The other 918 depend on the step 1 decision.
