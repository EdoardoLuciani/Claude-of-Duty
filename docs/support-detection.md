# Prop support detection

The analyzer is **report-only**. It never removes or moves placements, and a
review result is not a confirmed float or a deletion instruction.

## Model

- The spatial hash still indexes upward-facing static triangles, independently
  of palette names. Ground/floor/stair/balcony/shelf/counter/rampart intent is
  declared at geometry authoring sites.
- Props use a sampled **transformed lower envelope**: a bounded grid over real
  downward-facing triangles, plus actual face points for thin features. Samples
  are not moved towards an AABB centre. Raised feet and torus holes survive.
- Signed volume corrects inside-out closed prop winding (the authored tyres
  have this property) and estimates a uniform-density centre of mass. Negative
  and non-uniform instance scales are handled.
- Contact is a measured vertical separation between actual prop and supporting
  triangles: at most **4 cm gap / 4 cm penetration**. This is a modelling
  tolerance, not an assertion of exact physical touching. No tyre/sandbag
  distance rule, crate AABB overlap rule, or fabricated sample coverage remains.
- Any analyzed solid prop can support another. Decorative instances such as
  dust skirts, litter and vegetation cannot provide support.
- Two rooted graphs distinguish an explanatory/review path from a stable path.
  A stable path needs an intended surface and a contact hull containing the
  estimated centre of mass at every step. Floating cycles cannot seed support.
- Gap, penetration, unclassified seating, balcony and footprint uncertainty
  propagate through dependent props. An independent stable path wins over
  unrelated nearby ambiguity.
- Diagnostic proximity extends to **35 cm below** and a height-bounded maximum
  of **45 cm above** an underside point. It can explain a review result but
  cannot certify support. Nearest-gap queries include rooted props as well as
  static geometry; the report names the surface/instance used.

## Reports

```sh
node tools/analyze-prop-support.mjs
node tools/analyze-prop-support.mjs --all > /tmp/support-before.json
# After a detector or world change:
node tools/analyze-prop-support.mjs --all --compare=/tmp/support-before.json > /tmp/support-after.json
node tools/capture-support-review.mjs --report=/tmp/support-after.json
```

The default report includes **all** suspicious candidates, including generated
instances without placement IDs. `--all` is the complete snapshot needed for
comparison. Comparison reports separate current-world and fixture transitions,
newly flagged, cleared, reclassified, added and removed candidates.

`physical` distinguishes contact, gap, penetration and no nearby rooted support.
`status` is the overall verdict; `reasons` preserves multiple concerns rather
than hiding secondary issues behind the first status. `localReasons`,
`supporters`, `stabilityMargin` (metres; negative outside the hull), and
`nearestSupport` distinguish local defects from inherited uncertainty.

## Current baseline

| Status | Count |
|---|---:|
| supported | 3375 |
| unsupported | 42 |
| review-gap | 111 |
| review-overhang | 192 |
| review-balcony | 52 |
| unclassified-seat | 60 |
| review-penetration | 5 |

There are 3,837 current candidates and seven separate removed-float probes.
82 of the 462 current review/unsupported results have **only inherited**
uncertainty. More review results does **not** establish higher accuracy: many
are intentionally authored debris/piles whose stability cannot be certified
under this approximation.

The [decision-logic comparison](pr-196/decision-review.md) contains the complete
old/new delta, visual spot checks, independent ray measurements, corrected test
expectations and remaining limitations.

## Limits

This is sampled vertical-contact/stability analysis, not exact triangle-triangle
collision, a rigid-body solver, or a general composition validator. It does not
model friction, wall leaning, cloth deformation, material strength or the mass
of an entire loaded stack. Closed-prop signed-volume estimates can be inaccurate
for open, mixed-winding or heavily self-intersecting meshes. Sampling is capped
at 32 bins per axis; tiny features and side contacts can still be missed.

A valid intentional sandbag pile can therefore require review, and a misplaced
object fully seated on a declared roof can still pass. Missing static intent
stays visible as `unclassified-seat` rather than being silently accepted or
called a certain float. The solid candidate list remains explicit: adding a
new prototype requires deciding whether it belongs in that scope.
