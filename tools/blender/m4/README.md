# M4 source map

[Shared workflow](../README.md) ·
[Asset and commands](../../../assets/weapons/m4a1-block-ii/README.md)

- `build.py`: stages/paths; `geometry.py`: assemblies, sockets and atlas.
- `materials.py`: seeded maps/checkering; `finishes.py`: export finish factors.
- `actions.py`: eight actions/hands/events; `animations.py`: sampling/resets.
- `export.py`: ordinary joins/native Actions; `studio.py`: fixed review setup.

Hand calibration and shared review arms are read-only; refit separately with
`node tools/blender/m4/hand-reference.mjs`. Save the editable four-map preview
before export preparation. Preserve the smart-project/checkering atlas, not MCX UVs.
Motion uses the 120 Hz lattice with LINEAR motion and CONSTANT/STEP visibility;
Draw holds frame 75 at its exact 74.4-frame/.620 s endpoint. Keep explicit TRS
resets, matching NLA names and forced sampling off; never rewrite output.

Ordinary meshes retain original controls, precision iron surfaces and independent
magazines/rounds. Cache invertible rest seats before hiding spare geometry.
The single material reads COLOR_0 tint, UV1 roughness/metalness and UV2 normal
strength/role; all four 1024² maps stay on UV0. The receiver albedo uses the
standard emissive slot, so the M4 adapter is required. Preserve paint emission.
The registered cook adds `-noq -vc 16 -kv`; do not simplify precision irons.
Historical measurements remain in Git; human appearance acceptance is separate.
