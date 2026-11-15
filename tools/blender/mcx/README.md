# MCX source map

[Shared workflow](../README.md) ·
[Asset and commands](../../../assets/weapons/mcx-virtus/README.md)

- `build.py`: stages/paths; `materials.py`: seeded maps and finishes.
- `geometry.py`: irons/muzzle, attachment mounts, assemblies/pivots/sockets.
- `animations.py`: mechanical clips/events; `hands.py`: native wrist/finger and equip actions.
- `hand-reference.ts`: explicit offline grip calibration, saved beside the asset.
- `export.py`: surface projection/export; `finishes.py`: pigment/scalar packing.
- `primitives.py`: exterior helpers shared with the standalone ACOG.
- `fits.py`: catalog surface/hand/mechanism clearance sweep.
- `studio.py`: fixed review cameras/lights.
- `review_hands.py`: native clip selection and hand-control checks.
- `../review_hands.py`: shared appearance-only review-arm baking.

Metres, +X forward, −Y ejection side. Preserve names, sockets and event timing.
The repeating rest-space planar UVs are shared detail, not unique atlases.
Save editable Idle/modifiers before deterministic triangulation/runtime preparation.
The build consumes checked-in hand calibration and shared arm appearance; it does
not execute gameplay or rewrite calibration. Exported wrists/fingers drive the
shared runtime arm rig, with upper/forearm IK solved at runtime. Review skins are
excluded from the weapon GLB. Hands and equip motion are sparse BEZIER poses in
the saved source; contact windows key the glove on the moving magazine or latch
every frame. Export bakes them to the LINEAR frame lattice. Preserve fractional
endpoints, CONSTANT/STEP visibility and explicit resets. Hidden magazine scales
must not collapse wrist contact trajectories.

The single-influence mechanical skin retains its original helper controls;
magazines and showcase case remain independent. The adapter rebases the native
+X-forward scene, skin, curves and origin into game space once on load, like MPX.
No exporter hooks or GLB repair.

Opaque pigments use per-corner colors; UV1 selects padded scalar tiles.
Original UV0 albedo/full-normal pixels remain; roughness grain uses its source
mean. The base weapon has one opaque material and no glass. The MCX adapter
preserves per-finish normal strengths with canonical tile IDs; do not compensate
with lighting. Source materials remain editable in the saved blend.
Geometry simplification and encoding settings live in `build/models.ts`.
