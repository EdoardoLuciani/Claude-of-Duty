# Sleeve correctness audit: authored data before legacy appearance

**Update:** the application conversion is now fixed and the native F90 defect is
[resolved locally by a temporary compensation](webgpu-fresnel-compensation.md).
The investigation and commands below describe the historical pre-fix revision.

Reference application revision: `16217d6`; legacy `53f3d4c`. No production,
asset, dependency, lighting, exposure or grading changes in this investigation.
All new GPU checks use the RX 9070 XT (actual native device: AMD / RDNA-4 /
non-fallback; actual legacy WebGL renderer checked for RX 9070 XT / GFX1201).

## Conclusion

The sleeve washout has a concrete application-side material conversion defect,
not merely a disagreement with legacy art direction. The native arm converter
discards the authored low-specular material model. Preserving it substantially
reduces the washed-out appearance in a material-only game capture control.

A separate defect in pinned Three.js 0.186.1's native **direct-light** BRDF prevents
fully correct low-specular behavior even after that conversion is corrected.
An independent zero-specular diffuse test passes on legacy, fails on native,
and passes on native with a narrowly scoped browser-only JS counterfactual.

These findings **do not certify the complete legacy image as correct**, do not
justify copying its exposure/lighting/grade, and do not resolve the M4, road,
night, combat or motion findings in [the final-frame comparison](webgpu-visual-comparison.md).
No production fix or upstream publication has been made in this audit.

## 1. Establish an independent reference

The reference is the actual asset's declared material contract, not an old
screenshot or a claim that its artistic choices are physically measured cloth.

- `tools/blender/player_arms.py` sets Principled **Specular IOR Level = .08**.
- The committed GLB declares `KHR_materials_specular`, with
  `specularFactor = 0.1599999964237213` on `Olive_ripstop` (also on the other arm materials).
- GLTFLoader produces `MeshPhysicalMaterial`: IOR 1.5, white specular color,
  specular intensity approximately .16, metallic 0.
- Its base-color map is sRGB; normal/roughness/metallic/AO maps are non-color data.
  The base/normal/roughness/metallic textures use UV channel 1; AO uses channel 0.
  Both loaders preserve these declarations.

The [Khronos specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_specular)
explicitly says zero specular produces a pure diffuse material, and gives:

```text
dielectric_f0  = min(0.04 * specularColor, 1) * specular
dielectric_f90 = specular
```

Thus this asset requests normal-incidence reflectance **.0064 (0.64%)**, not
standard dielectric **.04 (4%)**. That is an independently checkable material
contract, regardless of which final screenshot looks nicer.

### Color checks

The standalone fixture renders into RGBA32F with no environment, tone mapping,
exposure, grading, blood decoration, world lighting or postprocessing.
An sRGB data-texture swatch `[58, 64, 43]` decodes identically on both backends:

| | Linear RGB |
|---|---|
| Ideal CPU sRGB decode | .04231141 / .05126946 / .02415763 |
| Actual GPU, both backends | .04223633 / .05126953 / .02416992 |

The small difference is consistent with hardware conversion precision, not
missing/double sRGB decoding. The fixture allows 2e-4 absolute linear error;
it does not demand exact equality with CPU `pow()`.

Sampling the actual unlit sleeve texture on the same 128² UV plane gives the
same mean on both backends: **.04280376 / .05246210 / .02445126**.
With the application's existing .30 base-color multiplier, both give
**.01284113 / .01573863 / .00733538**. These are filtered GPU fixture means,
not a claim that they equal a full-resolution CPU texel census.

This rules out a basic loader/map-decoding difference in these tests; it does
not prove every game material or postprocessing color transform is correct.

## 2. Application defect: physical material downgraded to standard

Legacy `src/weapons/arm-asset.js` clones the loaded physical material.
Native instead does:

```js
mat = new MeshStandardNodeMaterial();
THREE.MeshStandardMaterial.prototype.copy.call(mat, source);
```

Neither that material class nor that copy operation preserves the authored
specular controls. The result uses standard .04 dielectric F0: **6.25 times**
the requested normal-incidence reflectance. This is not a statement that final
pixels become 6.25 times brighter; diffuse, Fresnel angle, roughness, lighting,
energy compensation and postprocessing all contribute.

On a neutral white directional-light fixture with the actual maps and existing
.30 calibration:

| Material path | Mean linear RGB |
|---|---|
| Legacy physical | .01533754 / .01820604 / .00988689 |
| Current native standard | .02943802 / .03220900 / .02417267 |
| Native retaining physical properties | .01540603 / .01827440 / .00995561 |

The excess is largely achromatic reflection added to a very dark olive base,
which reduces the visible pigment/pattern contrast. Just preserving the loaded
physical material class/properties produces the expected direction of change
without making the texture greener or raising saturation.

### In-game control

`tools/webgpu-legacy-visual.mjs --physical-arm=1` substitutes the physical node
class and physical copy operation **only in the browser response**. It changes
no authored values. Hero/night captures plus common-exposure images were taken;
the displayed hero control matches baseline frame 183, elapsed 3.05 s, camera,
rotation, FOV, weapon state and exposure **3.3475131657922605** exactly.

The sleeve becomes darker, more olive and less washed out. It does not become
an exact copy of legacy: the view lighting/grade still differ. This is causal
material evidence, not full visual parity, performance or animation acceptance.

A production repair should preserve the incoming material type and properties,
not hard-code `.16`, tint the sleeve green, or attach an unused specular field
to a standard node material.

## 3. Pinned native BRDF defect: grazing reflectance forced to one

`MeshPhysicalNodeMaterial.setupSpecular()` computes `specularF90` correctly.
But `three/src/nodes/functions/PhysicalLightingModel.js::direct()` passes:

```js
BRDF_GGX({ lightDirection, f0: specularColorBlended, f90: 1, ... })
```

Legacy's direct GGX path uses `material.specularF90`. The native diffuse energy
term also uses the correct F90; the error is specifically in the specular lobe.
The same hard-coded argument appears in the native retroreflection branch;
that branch is not exercised or corrected by this fixture.

### Independent numerical test, not legacy pixel matching

Use a flat plane, an orthographic camera, no maps/environment, roughness 1,
metallic 0, base color .18 and **specular intensity 0**. A white directional
light has intensity PI. View and light directions are symmetric about the
normal at angle theta, so the pure diffuse oracle is given below. All paths
in this test use a physical material capable of expressing zero specular;
"native stock" means unmodified library, not the game's downgraded standard
material.

```text
linear output = .18 * cos(theta)
```

| Angle | Independent expected | Legacy | Native stock | Native F90 control |
|---|---:|---:|---:|---:|
| 0° | .18000000 | .18000001 | .18004204 | .18000001 |
| 45° | .12727922 | .12727922 | .12846890 | .12727922 |
| 75° | .04658743 | .04658743 | **.10177658** | .04658743 |

All RGB channels agree. At 75°, the unwanted native term is **.05518916**:
more than the entire intended diffuse response. For this geometry/roughness,
the pinned exponential Schlick approximation independently predicts that excess:

```text
.25 * 2^((-5.55473*cos(theta) - 6.98316) * cos(theta))
```

The prediction matches within 1e-8 in these samples. A browser route changing
only the regular direct BRDF's `f90: 1` to `f90: specularF90` makes native pass
the independent diffuse oracle at all three angles. No installed dependency
or generated WGSL is modified.

For black diffuse / authored specular .16 / frontal incidence, complete output
is legacy **.0016259524**, native physical **.0016616941**, and native F90 control
**.0016259524**. This includes r186's DFG-based multiscattering compensation;
a single-scattering `F/4` oracle alone is insufficient for the complete BRDF.

With textured normals, the corrected fixture means remain slightly different:
legacy `.01533754 / .01820604 / .00988689`, native F90 control
`.01534808 / .01821645 / .00989767`. These checks do not certify bit-exact
textured-normal shading or every glTF extension.

The combined physical-material/F90 hero game control also runs without errors
and preserves the sampled camera/weapon/exposure state. Its incremental change
over material preservation alone is much smaller in this particular pose.
The large 75° fixture error must not be presented as a measured whole-sleeve
error or the primary cause of the existing standard-material capture.

## 4. What legacy has and has not earned

**Validated narrowly:** its loaded sleeve retains the requested specular
properties; basic sRGB/data-map declarations agree; its zero-specular direct
lighting passes the independent diffuse oracle. On these questions legacy is
correct and native contains real defects.

**Not certified:** its full lighting, material calibration, exposure, grading,
night readability or physically measured cloth appearance.

Both applications multiply olive base color by **.30** to compensate for the
weapon rendering setup. That is an artistic calibration, not the unmodified
GLB. Legacy also has a camera-relative five-light view rig with shaped world
light intensity, versus native's fixed key/hemi/rim setup. Neither screenshot
is a neutral material reference. Their exposure and tone-mapping paths need
separate calibration rather than indiscriminate copying.

Correct material semantics first, then assess the remaining appearance against
neutral references and intended art direction. Do not compensate for missing
material features by boosting saturation, changing textures or globally
brightening/darkening the scene.

## Reproduce

Run sequentially from the migration worktree, with the reference installed via
`npm ci`. The fixture uses managed Chrome and checks the actual device.

```sh
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs \
  --backend=webgl --root=/home/edoardo/Documents/Claude-of-Duty-webgl-visual-reference --strict=1

# Records evidence; diffuseOnlyConformant is false on pinned native.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs

# Deliberate negative: fails specifically with "zero-specular material is not pure Lambert diffuse".
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs --strict=1

# Browser-only counterfactual: passes the independent diffuse oracle.
MESA_VK_DEVICE_SELECT=1002:7550! node tools/arm-material-audit.mjs \
  --f90-control=1 --strict=1 --out=/tmp/cod-sleeve-f90

MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-visual.mjs \
  --physical-arm=1 --shots=hero,night --out=/tmp/cod-sleeve-physical
MESA_VK_DEVICE_SELECT=1002:7550! node tools/webgpu-legacy-visual.mjs \
  --physical-arm=1 --f90-control=1 --shots=hero --out=/tmp/cod-sleeve-both
```

Both source-response controls are guarded against changed implementation
markers. These are investigation switches, not production options. The visual
runner records their use in metadata. The early capture prototype predates
those metadata fields; the committed combined-control runner was rerun and
its state/exposure checked against the original capture.

Artifacts: `/tmp/cod-sleeve-audit/{webgl,webgpu}-material.json`,
`/tmp/cod-sleeve-f90/webgpu-material.json`, `/tmp/cod-sleeve-{physical,both,committed}/`,
`/tmp/cod-sleeve-audit/{specular-control,native-controls}.png`.

The initial exploratory assertions incorrectly demanded exact-enough CPU sRGB
conversion and treated single-scattering GGX as the full r186 response. They
were replaced with an explicit hardware conversion tolerance and the stronger
zero-specular analytic oracle above; stock native still deliberately fails
that correctness gate. No existing tests were weakened. Validation: **59 smoke tests**, lint and build
pass; the committed combined-control hero capture passes actual-device,
full-resolution-target, nonblank-image and zero-error checks. Stock native's
strict diffuse check deliberately fails with the expected assertion; legacy
and the native F90 counterfactual pass. No world asset regeneration is needed.
