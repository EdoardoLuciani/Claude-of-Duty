# Scope: PM II LP 5–25×56 / AI mount

`tools/blender/scope/build.py` is the canonical standalone source. It starts from
an empty scene, authors the complete scope and AI mount, unwraps each component,
and generates/embeds its seeded surface maps. It does not load a weapon blend or
GLB. Edit this recipe, never the generated `.blend`/GLB products.
`bun run build` hashes the standalone tooling and cooks the local GLB via
`build/models.ts`, independently of the AX338 build.

```sh
blender -b -t 4 --python-exit-code 1 --python tools/blender/scope/build.py
bun run models:cook -- scope
# The AX338 check loads freshly generated standalone optics to measure their fit:
blender -b -t 4 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/check.py
```

The #665 extraction was verified **before removing the rifle optic** against a
fresh build of the former AX338/extraction recipes with Blender 5.2.2. All five
raw-GLB primitives had identical positions, normals, UV0 and indices (maximum
component delta zero). All three embedded PNGs were byte-identical:

| Packed image | SHA-256 |
| --- | --- |
| `ax338_surface` | `19c75a7dfb03cf8e8669f5dd9972d2ac4c6c6a322d269a6c51a2f9a2a37227fe` |
| `ax338_roughness` | `518b7ad9593aad6fec2e595f9095769d71ca8fe680d595b7a8dfaa07a7eceb95` |
| `ax338_normal` | `46d318757092ef58dbc80ab5ef8b118d28f709e95dbe79d142e3f8971ca32a27` |

The original map/material names and unused atlas regions intentionally remain to
preserve this parity. `MOUNT_base` is identity; `SOCKET_sight` is game-metres
`[0, 0.038499996066093445, 0.17599999904632568]`, also identical. The editable
source retains separate components; only the export joins them. No weapon clips,
hands or skeleton are exported. This same-host comparison is not a claim of
cross-version or cross-platform byte determinism.

Mount/sight datums, thin-alpha glass policy, tuning ownership and supported
weapon/iron-sight combinations follow the
[shared attachment contract](../../../ARCHITECTURE.md#models). The P4FL-inspired
reticle remains a gameplay adaptation in `src/weapons/sniper-reticle.ts`, not a
manufacturer calibration or ballistic compensation claim.
