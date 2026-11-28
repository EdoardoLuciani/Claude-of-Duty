---
description: Build or remake Blender game art from references, pixel diffs, and blind Oracle review
argument-hint: "<weapon or attachment> [variant, scope, references, or constraints]"
---

Build or remake this nonfunctional Claude of Duty game asset: **$ARGUMENTS**.
Identify the exact variant and configuration first; ask only if an ambiguity
would change the work. Default to Blender authoring and review only for new
standalone assets. For an existing game asset, preserve its current integration
and validate it. Do not change gameplay or add compatibility unless requested.

## References first

Read `AGENTS.md`, `ARCHITECTURE.md`, `tools/blender/README.md`, and the relevant
recipe README. Before editing, fetch and inspect manufacturer exterior photos and
published overall dimensions for the exact variant; use credible secondary
sources for missing angles. Prefer a clean side profile, complementary views,
and close-ups of the requested areas. Record source links, which configuration
each shows, confirmed envelope dimensions, estimated details, and gaps. Keep
photos as review inputs, not asset textures. Author only the visible game-art
exterior, not functional internals or fabrication geometry.

## Build, measure, and repeat

- Create or edit the reproducible Blender recipe. For a remake, render the old
  model as a baseline. Use scratch output and keep the editable scene and source
  geometry separate from optimized/exported products. Check the evaluated
  exterior envelope against the published dimensions in model space.
- Match camera angle, projection, pose and scale to each usable photo. Register
  like-for-like landmarks with translation, rotation and uniform scale only;
  solve perspective in the camera, not by stretching either image. Freeze the
  registration and masks for before/after comparisons. Mark views with uncertain
  registration as qualitative rather than treating their diffs as measurements.
- Save aligned side-by-sides, overlays and pixel-diff images. Use foreground
  silhouette overlap and signed contour or landmark errors to drive proportions;
  measure important local gaps and cutouts separately. Use masked RGB deltas as
  finish diagnostics, not as geometry evidence when lighting differs. Check other
  angles so a better side-profile score cannot hide a worse 3D shape.
- Fix the largest supported mismatch in the recipe, rebuild, rerender, and
  remeasure. Keep the best reproducible candidate and reject regressions. Work
  from envelope and silhouette to local details, then materials and highlights.
  Keep the before/after metrics and artifacts for each meaningful revision.

## Blind Oracle loop

When your measurements and visual checks look good, launch one read-only Pi
`oracle` for a one-shot visual review. Explicitly use `context: "fresh"` (never
fork or resume), with a new scratch working directory that contains only the
review images. Restrict it to image reading where supported. Give it the actual
Blender renders and real reference photos for several matched views, under
randomly assigned neutral labels with independently shuffled order. Apply the same
crop/framing and encoding conventions, strip metadata, and keep the mapping
outside the review directory. Do not pass source URLs, asset names, diffs,
previous verdicts, or the answer key.

Ask it to open every supplied image and classify each label as `photo`, `render`,
or `unsure`, with confidence and the strongest visible geometry or material cue.
Tell it to use only the supplied images and ignore background and encoding cues.
Use its repeatable tells to drive a new modeling pass, then retest the updated
candidate with a new fresh Oracle and new shuffle. Reserve a matched view for the
final round when references permit. Pass when the Oracle cannot reliably separate
photo from render across the matched views, not on a lucky wrong guess or a
single ambiguous view. Do not swap in weaker references or degrade either image
to pass. Continue while there are actionable improvements. If the user stops you,
the evidence or Oracle is unavailable, or further revisions stall, keep the best
candidate, report the remaining tells, and mark the blind gate unpassed. Never
substitute self-review.

## Deliver

Run the recipe checks and `bun run verify`; for integrated assets check the
cooked model in WebGPU and verify affected sockets, hands, clips, and existing
attachment fits. If an optimized model is shipped, compare that final version
with the same framing and include it in the visual gate. Report source links,
measured dimensions, before/after renders and diff artifacts, technical checks,
and the actual Oracle verdict separately. Follow the repository PR and screenshot
workflow; do not commit review images or generated assets.
