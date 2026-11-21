# Scope: PM II LP 5–25×56 / AI mount

`tools/blender/scope/build.py` is the canonical standalone source. It starts from
an empty scene, authors the complete scope and AI mount, unwraps each component,
and generates/embeds its seeded surface maps. It does not load a weapon blend or
GLB. Edit this recipe, never the generated `.blend`/GLB products.
`bun run build` hashes the standalone tooling and cooks the local GLB via
`build/models.ts`, independently of any weapon build.

```sh
blender -b -t 4 --python-exit-code 1 --python tools/blender/scope/build.py
bun build/models.ts scope
# The AX338 check loads freshly generated standalone optics to measure their fit:
blender -b -t 4 .cache/blender/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/check.py
```

The editable source keeps separate components; only the export joins them. Its
material/map names keep their `ax338_` prefixes. No weapon clips, hands or skeleton
are exported.

Mount/sight datums, thin-alpha glass policy, tuning ownership and supported
weapon/iron-sight combinations follow the
[shared attachment contract](../../../ARCHITECTURE.md#models). The P4FL-inspired
reticle is a gameplay adaptation in `src/weapons/sniper-reticle.ts`, not a
manufacturer calibration or ballistic compensation.
