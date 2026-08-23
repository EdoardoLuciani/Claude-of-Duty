# Procedural world authoring

The world under `tools/worldgen/` is the spatial and semantic source of truth.
Normal builds load committed runtime assets. World regeneration uses
meshoptimizer in Node to cook collision directly from the assembled visual scene;
no external DCC application is required.

## Workflow

```bash
npm run world             # compile JS, cook collision, write runtime assets
npm run world -- --check  # fail if committed runtime assets are stale
npm run world:validate    # validate committed assets without regenerating them
npm run world:smoke       # browser-level world/spawn/collision smoke test
```

Export writes committed files under `public/models/world/`:

```text
level-visual.<hash>.glb.gz
level-collision.<hash>.glb.gz
level.json
```

`level.json.sourceHash` fingerprints the world compiler and authored JS. Normal
`dev` and `build` validate that fingerprint, so changing world source without
running `npm run world` fails immediately.

## Source layout

```text
tools/worldgen/
├── layout.js          building, street, alley, gate and set-piece specs
├── build.js           top-level world assembly
├── buildings.js       facade and building construction
├── interiors.js       rooms, stairs and furnishings
├── ground.js          road and terrain geometry
├── dressing.js        deterministic merged environmental detail
├── props.js           reusable prop prototypes
├── kit.js             architectural primitives
├── util.js            direct geometry helpers
└── placements/        editable free-standing dressing by region
```

Architecture remains high-level and procedural. Change a building in
`layout.js` or its owning builder rather than editing generated wall geometry.
Free-standing dressing is explicit data, organized by region and then prototype.
Each placement has a stable location-independent ID and named transform fields:

```js
{
  id: 'rock_a/0042',
  prototype: 'rock_a',
  position: [-3.2, 0.08, -27.4],
  rotationDeg: [0, 74, 0],
  scale: [0.9, 0.9, 0.9],
}
```

Placement coordinates are level-space metres, Y-up. Rotations are XYZ degrees.
Building-owned room coordinates remain local to their building. The compiler
owns conversion through the level transform.

The restored builders retain deterministic procedural micro-detail such as wall
chips and ground patches. `placements/` is the sole authority for free-standing
objects.

## Visual and collision pipeline

```text
JS specs + builders
        ├──────────────────────────────→ final visual asset
        ↓ meshoptimizer
weld positions; foliage excluded
simplify instances to 12%
simplify static geometry to 22% (static fabric to 2%)
        ↓ Three.js
merge static collision by surface
preserve repeated objects as instances
        ↓
final collision asset
```

Collision has no separately authored source and no proxy exceptions. Visual mesh
topology, prototype sharing, transforms, and `surface` assignments determine the
cooked collider. The current baseline is 220 visual draws, 8,008 instances,
605,715 static triangles, 1,146,484 instanced triangles, and 294,372 effective
collision triangles.

## Source invariants

- Placement IDs are unique in the current source.
- Placement fields, prototype references and transforms are valid.
- Repeated geometry remains linked/instanced through its prototype.
- Visual and collision surfaces use keys known to the runtime palette/physics.
- `npm run world -- --check` is byte-identical with committed outputs.
- World smoke, physics tests and selected screenshots pass before committing a
  world change.
- Commit JS source, `level.json`, and both hashed runtime assets together.
