/**
 * Procedural WebGPU material system.
 *
 * The authored library is the strict-WebGPU TSL implementation in
 * `system-tsl.js`: 19 authored surfaces baked on the GPU into packed
 * albedo+height / ORM / tangent-normal render targets, plus the shared
 * detail + macro maps and the geometry curvature masks. There is no WebGL
 * material path and no backend toggle; `init()` requires an initialized
 * strict-WebGPU renderer (see `src/render/webgpu-device.js`).
 *
 * Public API — reach it with `ctx.get('materials')`:
 *
 *   get(name, opts?)          -> THREE.NodeMaterial (cached; same opts, same instance)
 *   getTextureSet(name, opts?)-> { albedo, normal, orm, size, worldSize }
 *   variant(name, opts)       -> alias for get() with a fresh cache entry
 *   names()                   -> string[]
 *   surfaceOf(name)           -> one of the ARCHITECTURE.md surface tags
 *   bakeMasks(geometry, opts) -> geometry with wear/grime/AO vertex masks
 *   setMask(geometry, opts)   -> write one mask channel onto a geometry
 *   tune(material, changes)   -> live scale/tint/parallax/weather updates
 *   setGroundLevel(y)         -> where the ground-splash weathering starts
 *   detailNormal / macroTexture -> the shared micro/macro maps
 *   dispose()
 *
 * `opts` accepts anything in DEFAULT_PARAMS (scale, tint, uvMode, parallax,
 * weather, …) plus `three` for raw node-material properties and `bake` to
 * force a distinct texture bake (a different paint colour, for example).
 */
export {
  MaterialSystemNode as MaterialSystem,
  MaterialSystemNode,
} from './system-tsl.js';
export { bakeMasks, setMask } from './masks.js';
export { LIBRARY, resolveName } from './library.js';
