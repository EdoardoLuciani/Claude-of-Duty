# Prop support detection

The support analyzer is report-only. It does not remove placements.

## Model

- A spatial hash indexes upward-facing static triangles without consulting palette names.
- Supportable geometry is explicitly tagged as ground, floor, stair, balcony, shelf, counter, or rampart geometry at its authoring site.
- Candidate contact samples come from the transformed bottom geometry, including bottom-face centroids; they are not samples of a world AABB.
- A second triangle index resolves support from instanced props. Support is propagated from ground/static surfaces through a stack, so a floating group cannot validate itself.
- Tyre piles, sandbag courses, and overlapping container stacks have explicit interlock rules for contacts that vertical samples cannot represent.
- Undeclared balcony support is reported for review and inherited through anything stacked on it.

Run `node tools/analyze-prop-support.mjs` for the JSON report. Annotated visual comparisons are in [`docs/pr-196/`](pr-196/README.md).

## Review baseline

The initial implementation produced 303 suspicious results and incorrectly flagged authored tyre piles, crate stacks, interior furniture, and rampart sandbags. Iteration on contact geometry and stack propagation reduced the current report to:

| status | count | meaning |
|---|---:|---|
| `unsupported` | 45 | no valid support chain; the nearest support is at least 1.02 m below |
| `review-balcony` | 52 | physically seated on a balcony but not explicitly declared intentional |
| `review-overhang` | 9 | supported, but fewer than 60% of contact samples agree |
| `review-gap` | 4 | 0.20–0.22 m above support; below auto-failure confidence |

Representative visual checks found:

- BN2's facade cluster is physically intersecting a balcony slab but visually implausible. It is now `review-balcony`, not silently accepted.
- Upper BN2 buckets/boxes and west-side planters visibly perch on decorative facade bands. They are `unsupported`.
- Authored rooftop crate piles remain supported through their full stack.
- All 50 generated high rampart sandbags remain supported.
- The W2 stair chair and known shelf/roof fixtures remain supported.
- All seven re-injected, visually confirmed PR #194 floats are detected as unsupported.

## Known limits

This detects support, not every kind of bad composition. A misplaced object fully seated on a declared floor or roof can still be aesthetically wrong. Balcony, overhang, and small-gap results therefore remain review queues rather than deletion inputs. Valid surfaces not yet tagged at their authoring site can also appear as false positives; the report includes the nearest unclassified geometry source to make those omissions diagnosable.
