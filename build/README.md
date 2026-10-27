# Runtime model cooking

`models.mjs` is the shared offline gltfpack build stage. Regeneration is explicit;
ordinary dev/build/CI uses committed runtime GLBs, with no encoder requirement.
Native Blender exports remain authoring references. No metadata sidecars are
emitted: settings and opt-in profiles live in `MODEL_COOKS`/`GLTFPACK_FLAGS`.

Install native **gltfpack 1.3 with BasisU support** from the
[official release](https://github.com/zeux/meshoptimizer/releases/tag/v1.3), then:

```sh
GLTFPACK=/absolute/path/gltfpack npm run models:cook -- p320
# All registered models (P320 and standalone EXPS3):
npm run models:cook
# Use the same profile on a scratch native export:
npm run models:cook -- p320 /tmp/p320-review
```

The encoder writes to a temporary directory before replacing the destination.
Runtime outputs use `.runtime.glb`; their container is still GLB, regardless of
embedded texture formats. The generic `cookModel({ input, output, flags })` function
can also be imported by other build stages.

To opt in another model, register its source directory, native export, runtime
output and any model-specific flags in `MODEL_COOKS`. Wire its loader to the
runtime output with KTX2/meshopt support, then validate its named mechanics,
materials/UVs, animation/contacts, resource ownership and visual fidelity.
Simplification is opt-in **per model**; P320's tight-error profile is not a global
triangle-reduction policy. EXPS3 uses a tighter error limit to preserve its optical
opening; its cooked attachment is not yet wired into gameplay. Other models are
not converted by these profiles.
