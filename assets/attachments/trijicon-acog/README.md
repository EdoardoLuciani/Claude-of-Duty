# ACOG TA31F / TA51

`tools/blender/acog/{geometry,build}.py` owns the complete standalone optic.
It builds from an empty scene, never a generated weapon blend or GLB. The original
MCX primitive, material and planar-UV recipes remain shared source under
`tools/blender/mcx/`; they preserve the original geometry and packed surface maps.
`bun run assets` builds and cooks the optic independently of every weapon.

```sh
blender -b --python-exit-code 1 --python tools/blender/acog/build.py
bun run models:cook -- acog
```

Mount/sight datums, glass policy, tuning ownership and supported weapon/iron-sight
combinations follow the [shared attachment contract](../../../ARCHITECTURE.md#models).
