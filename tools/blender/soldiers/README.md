# Native soldier authoring

`vanguard`, `irregular` and `breacher` are supported; unknown names and rifle
styles fail explicitly. This offline recipe is not wired into normal builds:
current runtime outputs and the old Node builder remain unchanged. Soldier
outputs are currently generated/ignored; the finished migration will commit
canonical products for Blender-free builds. No mesh product is an authoring input.

The runtime reference's feature flags select covered/bare helmets, down/parked
oval goggles, tied cloth headwrap, shooting shades, fabric wrap/hard half-mask,
visible beard edges, knee pads, full carrier/thin chest rig and carbine/long AK.
Both rigs have actual panels, straps and loaded pouches; the AK has fixed
wood-tone laminate furniture, a curved magazine, gas tube and iron sights.

```sh
E=/home/edoardo/.cache/cod-blender-soldiers/all-variants
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

Next boundary is the existing Node GLTFExporter cook, then actual runtime
material/animation and visual review of all three variants. The checker validates
attributes, disjoint surfaces, normalized skinning, rigid rifle geometry near
sockets, bounds and separate-process repeatability; it is structural acceptance,
not appearance or ladder-motion acceptance. Same-host repeatability is tested;
there is no cross-platform bitwise guarantee or baseline pixel/array golden gate.
