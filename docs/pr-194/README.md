# Confirmed floating props

The telemetry dump had five marks. After visual review, this PR explicitly omits **14 confirmed floating placements** instead of destructively culling every heuristic match. No extra door/counter collisions were found besides W2 (the original mark).

These five shots are from `develop` (objects still present) so you can confirm they were real.

| Shot | Objects | Gap |
|---|---|---|
| [01](01-e3-roof-edge.jpg) | `stool/0025`, `planter/0025`, jerry cans off E3 | ~6.8 m |
| [02](02-west-water-tanks.jpg) | `water_tank/0010`, `water_tank/0011` south of W4 | ~6.6 m |
| [03](03-north-roof-stool.jpg) | `stool/0031` off the NE roof | ~6.6 m |
| [04](04-nw-terrace-planter.jpg) | `planter/0028` off W5 at terrace height | ~3.5 m |
| [05](05-e2-stool-crate.jpg) | `stool/0020` off E2; the nearby supported crate is retained | ~6.6 m |

Same class as the rooftop telemetry marks: origin outside `roofSpec` / terrace, so the street is the only support, 3–7 m below.

## Follow-up spot checks

[![Additional culling spot checks](06-visual-spot-checks.jpg)](06-visual-spot-checks.jpg)

The E1 tyre is a confirmed float and remains omitted. The BN2 facade clutter is authored on narrow trim, while the south-gate sandbags are explicitly generated on the rampart roof; both are preserved after the follow-up review.
