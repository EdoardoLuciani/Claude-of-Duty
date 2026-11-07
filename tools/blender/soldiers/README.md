# Native soldier authoring

`vanguard`, `irregular` and `breacher` are supported; unknown names and rifle
styles fail explicitly. Python owns geometry; canonical products are committed in
`assets/soldiers/`. Normal `bun run models` validates and stages GLB/JSON into the
ignored `public/models/soldiers/` delivery directory without Blender. No mesh
product is an authoring input.

The runtime reference's feature flags select covered/bare helmets, down/parked
oval goggles, tied cloth headwrap, shooting shades, fabric wrap/hard half-mask,
visible beard edges, knee pads, full carrier/thin chest rig and carbine/long AK.
Both rigs have actual panels, straps and loaded pouches; the AK has fixed
wood-tone laminate furniture, a curved magazine, gas tube and iron sights.

## Author and cook the complete family

```sh
node tools/blender/soldiers/export.mjs --output /absolute/scratch/soldiers
# Optional: --seed 0x5eed1234 --blender /absolute/path/to/blender
```

This explicit command requires Blender **5.2.2**. The executable defaults to
`BLENDER` or `blender`; the seed defaults to uint32 `0x5eed1234`. It computes a
reference in an owned temporary directory, factory-empty builds all registered
variants, then encodes their new packed meshes with the existing Three
GLTFExporter assembly. It never reads a previous blend/mesh/GLB as generation
input. Temporary reference/mesh payloads are removed even on failure.

Products are flat `<name>.blend`, `<name>.glb`, `<name>.json`, plus one
`manifest.json`. All three variants finish staging before any product is
published. Each file uses a same-directory temporary write and rename; the
manifest is published last. An authoring attempt invalidates the old manifest
up front, so failures—including publication failures—cannot leave an apparently
valid success marker. Already published files are not rolled back; without the
manifest the reader refuses the family. Use one authoring writer per output
directory. Blend binary bytes may differ between runs; runtime GLB/JSON bytes
are deterministic on the tested host. Manifest differences may therefore include
blend hashes, but contain no timestamps or absolute authoring/output paths.

### Blender-free normal-build boundary

`export.mjs` exports these direct Node APIs for the parent exporter:

- `loadCommittedSoldiers(directory = ASSET_ROOT)` returns
  `[{ name, glb: Buffer, json: Buffer, meta }]` for the entire registry.
- `ASSET_ROOT` is the canonical `assets/soldiers/` directory.
- `soldierInputHash(root?)` hashes the declared LF-normalized source text and
  `Three.REVISION`, not computed reference floats, mtimes or machine paths.
- `SOURCE_INPUTS` lists relative sources; `soldierInputPaths(root?)` returns
  absolute paths for an outer cache's dependency list.
- `soldierProductPaths(directory?)` returns manifest + GLB/JSON paths for the
  outer cache. Editable blends are not runtime dependencies.
- `exportSoldiers({ output, seed?, blender? })` is the explicit authoring API;
  only this API/CLI invokes Blender.

The reader checks manifest version, uint32 seed, current source hash, pinned
Blender/Three versions, exact catalog, GLB/JSON SHA256, GLB header/length, and
canonical metadata/positive statistics/five finite sockets. It never invokes
Blender or reads large blend binaries. Missing, stale or corrupt products fail
with a regeneration command—there is no public-product/procedural fallback.
Imports are side-effect-free, and reading works with `BLENDER=/missing` and no
Blender in `PATH`. The normal exporter retains its locking, atomic writes,
cache invalidation and missing-output recovery. Source or formatting changes in declared
inputs require final products to be regenerated afterward.

The cook validates finite float32 attributes, unit normals, normalized ordered
four-joint weights, canonical 25-bone indices, complete disjoint surfaces and
mesh statistics before allocating Three resources. It disposes owned geometry,
materials and skeleton even when encoding fails. This is a deliberate exception
to the weapon guide's stock Blender glTF boundary: Python owns generation;
Node GLTFExporter preserves canonical bone order, tiny weights and float colors.
There are no stock-export repairs, exporter hooks or runtime material adapters.

## Inspect the intermediate authoring payload

```sh
E=/tmp/soldier-review
node tools/blender/soldiers/reference.mjs "$E/reference.json"
for V in vanguard irregular breacher; do
  blender -b -t 2 --python-exit-code 1 --python tools/blender/soldiers/build.py -- \
    --reference "$E/reference.json" --output "$E/$V-a" --variant "$V" --seed 1592594996
  # Repeat in separate processes with empty output directories $V-b (same seed),
  # $V-c (1592594997), then:
  python tools/blender/soldiers/check.py "$E/reference.json" \
    "$E/$V-a/$V.mesh.json" "$E/$V-b/$V.mesh.json" "$E/$V-c/$V.mesh.json"
done
# Also build/check each variant with seeds 0, 1 and 4294967295.
```

`reference.mjs` computes only public runtime rig/registry/material calibration;
its import does not create soldier geometry or write files. `build.py` also has
no import-time scene mutation. Its explicit CLI starts factory-empty and saves
named, editable native components with bevel/normal/skin modifiers and the
25-bone bind armature, plus a packed mesh JSON. Cloth uses small sewn sections;
boots, anatomy, hardware and rifles use native primitives and modifiers. All
three variants stay below 25,700 triangles.

Coordinates are actor metres, Y-up, facing +Z, right at -X. Blender basis is
`C(x,y,z)=(x,-z,y)`. Edit bones use `C @ runtimeWorldMatrix`, not conjugation.
Only the preview scene is Z-up; packed attributes and weapon sockets return to
actor bind space. Joints retain canonical runtime RIG order (not Blender order).
Bindings use explicit local candidate chains, not global automatic heat weights.
No global variant scale is applied: the runtime actor owns that scale. `bulk`
changes torso/limb cross-sections and carrier/rig width/depth around unchanged
bind anchors. Optional `wide` changes anatomy and headwear width/fit together.
Positive finite tuning values are accepted; use modest human-proportion changes.
`scale` is preserved as metadata only. Seeds cover the full uint32 range using
Python's deterministic local RNG; the editable scene stores the seed as a string
because Blender's integer custom properties are signed. This is genuine seeded
authoring, not an attempt to match the old RNG stream.

UV0 is metres divided by the runtime material tile. Colors are linear neutral
part-value calibration; runtime variant tint/map application remains unchanged.
Preview materials are intentionally approximate and are not runtime materials.
Positions use 10-micrometre authoring quantization, UVs and source corner normals
use 1e-4 quantization (normals renormalized), weights use 1e-6, then float32 packing.
Canonical native topology/corner ordering removes Blender primitive enumeration
noise. JSON integers express canonical U16 joint indices; the Node cook must
select U16/U32 element indices according to vertex count. No stock glTF export,
repair, runtime adapter, or tiny-weight pruning is involved.

Review generated products in the game before publication; the ordinary exporter
only stages them and does not replace visual/animation acceptance. The checker
validates attributes, disjoint surfaces, normalized skinning, rigid rifle geometry near
sockets, bounds and separate-process repeatability; it is structural acceptance,
not appearance or ladder-motion acceptance. Same-host repeatability is tested;
there is no cross-platform bitwise guarantee or baseline pixel/array golden gate.
