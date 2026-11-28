---
description: Remake Blender game art with pixel diffs and blind Oracle review
argument-hint: "<weapon or attachment> [constraints]"
---

Build or remake `$ARGUMENTS` as a nonfunctional Blender game asset.

1. First fetch manufacturer reference photos from multiple angles and published exterior dimensions for the exact variant.
2. Model at the correct scale. Match camera angles and align renders to photos without stretching. Use silhouette and local pixel diffs to fix proportions, then refine materials. Rerender and repeat.
3. When it looks right, send matched photos and renders to a fresh `oracle` with shuffled neutral labels and no answer key or prior context. Ask which are photos, which are renders, and what gives them away. Fix those tells and repeat with a fresh Oracle until it can't reliably tell them apart. If blocked, report what's still distinguishable.
