# P320 Compact

Early Nitron Compact, curved trigger, SIGLITE irons, flush 15-round magazine.
Original game art, not downloaded CAD/mesh/maps or an endorsed/licensed replica.

`p320-compact.blend/.glb`: packed source/runtime and eight native actions.
`manifest.json` owns events/counts; `hand-reference.json` contacts; `textures/`
supports animation-only rebuilds. `src/weapons/p320.ts` samples native weapon/
wrist/finger tracks; shared skins/IK and ammo/healing/interruption stay authoritative.
Keep synchronized preview armatures, reload right-thumb grip and STEP magazines.

## Rebuild/check (root, Blender 5.2)

```sh
node tools/p320-hand-reference.mjs
blender -b --python-exit-code 1 --python tools/blender/p320_compact.py
blender -b assets/weapons/p320-compact/p320-compact.blend \
  --python-exit-code 1 --python tools/blender/p320_check.py
node tests/smoke/smoke-p320.mjs
node tests/smoke/smoke-inspect.mjs
node tests/e2e/check-p320-game.mjs --out=/tmp/p320-review
```

Normal builds need no Blender. Regeneration overwrites manual edits; `--no-bake`
requires unchanged geometry/UVs. Cycles remains for atlas baking; saved-source
`p320_review.py` and `--render` previews use Eevee without ray tracing.
Historical references/evidence: [#315](https://github.com/EdoardoLuciani/Claude-of-Duty/pull/315).
Technical gates aren't human visual or combat-performance acceptance.

## Bounded satin material revision

The slide remains a dark **dielectric coating**, not bare polished metal. Linear
pigment RGB is `(0.025, 0.027, 0.029)` with roughness `0.44 ± 0.045`; smooth molded
frame RGB is `(0.021, 0.023, 0.025)` with roughness `0.76 ± 0.045`. These are art
approximations, not measured Nitron constants. No clearcoat/specular override was
added. Stipple, blackened controls/sight housings, barrel, magazine, rounds, lettering and
micro-normal recipes retain their original settings. The three 1024 atlases,
material/primitive counts and runtime contracts are unchanged. Existing tiny
Nitron-assigned traction ribs track the slide finish; their assignments are unchanged.

Use the normal clean three-map bake/export command above. A clean bake reproduced
all three selected PNG hashes exactly, including the original normal image;
`--no-bake` is not a material-rebuild command. Texture reproducibility does not
prove full-export parity: the export-state limitation below still needs checking.
Never patch GLB buffers or override runtime materials.

The shared frame/stipple atlas boundary is antialiased: the revision changes 152
base and 151 ORM texels labeled as grip by the UV audit (maximum channel delta
5/255 base, 13/255 roughness), all within one pixel of its boundary. All 19,903
four-pixel-eroded grip-core texels remain exact. Of those boundary changes, only
two fall beyond the selected-region plus five-pixel padding mask: `(45,624)`
changes base `[35,38,39] → [35,37,39]`, roughness `218 → 219`; `(80,625)` changes
base `[37,39,40] → [36,38,39]`, roughness `211 → 213`. Coordinates are PNG top-left.
No grip pigment, roughness, normal recipe or interior texture was retuned.

A no-change export control exposed dummy-round index ordering instability
(`Cylinder.017`, POSITION/NORMAL/UV/index accessors 28/29/30/31). The selected
export preserves every non-image byte except index buffer view 34: its 1,564
oriented triangles are the exact same multiset, including winding/multiplicity.
The control also showed 12 UV components drifting by at most `2^-24` (less than
`0.000062` texel at 1024); **the selected export's UV bytes are exact**. This is
not blanket geometry tolerance. Both an unchanged-recipe bake control and an
alternate material export produced zero-scale spare nodes: full-asset export
reproducibility is therefore **not established**. They were rejected, not repaired
or substituted. The existing exporter unmutes every NLA track before its frame-0
snapshot; changing this state also changed animation sampling in a rejected
external probe. No exporter/animation changes are included here. The smoke test
now rejects collapsed spare rest nodes. Audit all nodes, animation payloads and
geometry after rebuilding; a successful bake/export process alone is insufficient.

Reference inspection used the early black Compact product photograph at
[Genitron](https://www.genitron.com/Handgun/SIG-SAUER/Pistol/P320-Compact/9-mm/Variant-1).
Its small, uncalibrated studio image establishes finish families, not exposure,
roughness measurements or exact proprietary-coating fidelity. Indoor readability
and missing first-person self-shadowing are lighting/model limitations, not
solved by this material pass.
