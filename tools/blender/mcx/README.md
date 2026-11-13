# MCX source map

[Shared workflow](../README.md) ·
[Asset and commands](../../../assets/weapons/mcx-virtus/README.md)

- `build.py`: stages/paths; `materials.py`: seeded maps and finishes.
- `geometry.py`: assemblies/pivots/sockets; `animations.py`: six clips/events.
- `export.py`: surface projection/export; `finishes.py`: pigment/scalar packing.
- `studio.py`: fixed review cameras/lights.
- `runtime-hands.ts`: offline sampling of actual `Viewmodel`/`MCXAnimation` controls.
- `review_hands.py`: shared review-skin baking, paired clip selection and runtime parity.

Metres, +X forward, −Y ejection side. Preserve names, sockets and event timing.
The 10 cm repeating rest-space planar UVs are for shared detail, not unique atlases.
Save editable Idle/modifiers before deterministic triangulation/runtime preparation.
Export the weapon before appending review arms, then reopen the untouched source
and bake the sampled runtime matrices. Bun and generated shared arm products are
required; no previous weapon blend/GLB is a fallback build input. Runtime weapon
code, core math/guards and dependency-lock changes invalidate this bake cache.
Weapon motion remains 60 Hz; review skins have 120 Hz LINEAR keys, including
fractional endpoints. Preserve CONSTANT/STEP visibility and explicit resets.
One single-influence mechanical skin retains original helper controls; magazines
and showcase case remain independent. No exporter hooks or GLB repair.

Opaque pigments use per-corner colors; UV1 selects padded 64² scalar tiles.
Original UV0 albedo/full-normal pixels remain; roughness grain uses its source
mean. Two materials separate opaque finishes and glass. The MCX adapter preserves
per-finish normal strengths/fiber emission and glass overrides; do not compensate
with lighting. Original source materials remain editable in the saved blend.
The registered cook adds `-si 0.65 -se 0.0002 -sp -vc 16`; keep named helpers.
The absent `magazineBody` still prevents world-magazine drops. Storage/draw counts
do not establish FPS improvement; historical measurements remain in Git.
