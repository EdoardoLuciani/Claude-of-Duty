// Offline authoring contract only: CI does not need Blender or a GPU.
// Real saved-source still/reel renders are also exercised manually in Blender.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scripts = ['m4a1.py', 'm4_photo_review.py', 'm4_review.py', 'mcx_virtus.py',
  'mcx_review.py', 'p320_compact.py', 'p320_review.py'];
for (const name of scripts) {
  const source = readFileSync(new URL(`../../tools/blender/${name}`, import.meta.url), 'utf8');
  const engine = /\.render\.engine\s*=\s*['"]BLENDER_EEVEE['"]/.exec(source);
  assert(engine, `${name}: explicitly select Eevee, even for older Cycles .blend files`);
  assert(engine.index < source.indexOf('bpy.ops.render.render('), `${name}: Eevee selected before rendering`);
  assert(/\.eevee\.taa_render_samples\s*=/.test(source), `${name}: use Eevee temporal samples`);
  assert(/\.eevee\.use_raytracing\s*=\s*False/.test(source), `${name}: raster-only review`);
  assert(!/\.cycles\./.test(source.slice(engine.index)), `${name}: no Cycles settings in the render path`);
  if (name === 'p320_compact.py') {
    const bake = source.indexOf('bpy.ops.object.bake(');
    const cycles = /\.render\.engine\s*=\s*['"]CYCLES['"]/.exec(source);
    assert(cycles && cycles.index < bake && bake < engine.index, 'P320: preserve Cycles atlas bake, then switch to Eevee');
  } else {
    assert(!/\.render\.engine\s*=\s*['"]CYCLES['"]/.test(source), `${name}: no path-traced gun renders`);
  }
  assert(!/\.cycles\./.test(source) || name === 'p320_compact.py', `${name}: Cycles only for the P320 atlas bake`);
}
console.log(`Blender gun renders: ${scripts.length} Eevee paths; raster-only reviews, Cycles atlas bake preserved`);
