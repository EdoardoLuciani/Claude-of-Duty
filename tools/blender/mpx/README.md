# MPX source map

[Shared workflow](../README.md) ·
[Asset and commands](../../../assets/weapons/sig-mpx/README.md)

- `build.py`: geometry/maps/studio/stages; `actions.py`: eight actions/hands/events.
- `animations.py`: runtime sampling/reset; `finishes.py`: finish colors/tiles.
- `geometry.py`: receiver finish separation preserving packed corner normals.

Hand calibration and shared arms are read-only. Refit separately with
`bun tools/blender/mpx/hand-reference.ts`. Shared review-arm baking lives in
[`../review_hands.py`](../review_hands.py), independent of EVOLYS tooling.
Save editable components/sparse actions before runtime joins.
Keep the smart-project atlas, original UV0 grain and padded 4×4 UV1 finish tiles.
Body lenses stay optical; solid polymer covers retain original cap pivots and
closed occlusion. The unused clear-cap finish tile remains reserved.
Opaque, optical and absorptive interior sorting policies stay separate.

Ordinary meshes retain original local frames: do not rebase them to reduce draws.
Mechanisms follow original animated parents; magazines/rounds remain independent.
Preserve Blender packed corner normals rather than re-encoding decoded vectors.
Motion uses the 120 Hz lattice, held exact endpoints (Fire/Last_Shot 60/950 s),
LINEAR motion, CONSTANT/STEP scales and explicit child TRS resets.
Stock Actions export keeps forced sampling off; output inspection is read-only.

## Approved repeatability limit

Evaluated-bevel UVs may differ by 1.1920928955078125e-7 UV (.0001220703125 texel
at 1024). Atlas preservation takes precedence: GLB byte-repeatability remains
unmet for those bytes. Do not round/repack/reproject either UV set.
Maps, manifest and non-UV payloads still require exact comparison.
Historical measured pairs remain in Git; this exception does not waive human
visual/gameplay acceptance or permit whole-geometry tolerances.
