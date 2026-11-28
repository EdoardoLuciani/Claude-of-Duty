---
description: Build or remake a Blender model with reference diffs and blind Oracle review
argument-hint: "<asset> [constraints]"
---

Build or remake `$ARGUMENTS` as a Blender asset.

1. Gather reference images from multiple angles and establish the target dimensions. Prefer manufacturer reference photos and published dimensions when available; otherwise use the supplied references and intended scale.
2. Model at the target scale. Match camera angles and align renders to references without stretching. Use silhouette and local pixel diffs to fix proportions, then refine materials. Rerender and repeat.
3. When it looks right, send matched reference photos and renders to a fresh `oracle` with shuffled neutral labels and no answer key or prior context. Ask which are photos, which are renders, and what gives them away. Fix those tells and repeat with a fresh Oracle until it can't reliably tell them apart. If blocked, report the remaining tells. If no comparable photos exist, report that blind photo review was unavailable.
