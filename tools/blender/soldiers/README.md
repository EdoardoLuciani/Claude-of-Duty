# Vanguard native authoring pilot

Only `vanguard` is supported. Other variants fail explicitly. This is an offline
pilot, not wired into normal builds: current runtime outputs and the old Node
builder remain unchanged. Soldier outputs are currently generated/ignored; the
finished migration will commit canonical products for Blender-free builds.
No mesh product is an authoring input.

```sh
E=/home/edoardo/.cache/cod-blender-soldiers/native-pilot
node tools/blender/soldiers/reference.mjs "$E/reference.json"
blender -b -t 2 --python-exit-code 1 --python tools/blender/soldiers/build.py -- \
  --reference "$E/reference.json" --output "$E/a" --variant vanguard --seed 1592594996
# Repeat in separate processes with empty output directories b (same seed),
# c (1592594997), then:
python tools/blender/soldiers/check.py "$E/reference.json" \
  "$E/a/vanguard.mesh.json" "$E/b/vanguard.mesh.json" "$E/c/vanguard.mesh.json"
```

`reference.mjs` computes only public runtime rig/registry/material calibration;
its import does not create soldier geometry or write files. `build.py` also has
no import-time scene mutation. Its explicit CLI starts factory-empty and saves
175 named, editable native components with bevel/normal/skin modifiers and the
25-bone bind armature, plus a packed mesh JSON. Cloth uses small sewn sections;
boots, anatomy, hardware and the carbine use native primitives and modifiers.

Coordinates are actor metres, Y-up, facing +Z, right at -X. Blender basis is
`C(x,y,z)=(x,-z,y)`. Edit bones use `C @ runtimeWorldMatrix`, not conjugation.
Only the preview scene is Z-up; packed attributes and weapon sockets return to
actor bind space. Joints retain canonical runtime RIG order (not Blender order).
Bindings use explicit local candidate chains, not global automatic heat weights.
No global variant scale is applied: the runtime actor owns that scale.

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
material/animation and visual review. The pilot checker is structural acceptance,
not appearance or ladder-motion acceptance. Same-host repeatability is tested;
there is no cross-platform bitwise guarantee or baseline pixel/array golden gate.
