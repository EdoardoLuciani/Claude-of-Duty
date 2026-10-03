/** Compare captures from webgpu-legacy-visual.mjs. RGB code-value metrics are
 * descriptive, not a perceptual quality score or an automatic acceptance gate.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { parseArgs } from './lib/browser-harness.mjs';
const args = parseArgs(), dir = resolve(String(args.dir ?? '/tmp/legacy-visual'));
const shots = String(args.shots ?? 'hero,interior,night,detail,weapon,ads,muzzle,combat,reload').split(',');
const load = name => PNG.sync.read(readFileSync(`${dir}/${name}.png`));
const metadata = ['webgl', 'webgpu'].map(k => JSON.parse(readFileSync(`${dir}/${k}.json`, 'utf8')));
const scenes = {}, repeats = {};
function compare(a, b, name) {
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  const n = a.width * a.height;
  let sum = 0, squares = 0, over10 = 0;
  const diff = name ? new PNG({ width: a.width, height: a.height }) : null;
  for (let i = 0; i < n * 4; i += 4) {
    let max = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      sum += d; squares += d * d; max = Math.max(max, d);
      if (diff) diff.data[i + c] = Math.min(255, d * 4);
    }
    if (max > 10) over10++;
    if (diff) diff.data[i + 3] = 255;
  }
  if (name) {
    writeFileSync(`${dir}/${name}-diff-x4.png`, PNG.sync.write(diff));
    const pair = new PNG({ width: a.width * 2, height: a.height });
    for (let y = 0; y < a.height; y++) {
      a.data.copy(pair.data, y * pair.width * 4, y * a.width * 4, (y + 1) * a.width * 4);
      b.data.copy(pair.data, (y * pair.width + a.width) * 4, y * a.width * 4, (y + 1) * a.width * 4);
    }
    // Native-resolution pair: legacy LEFT, WebGPU RIGHT; no resampling or gain.
    writeFileSync(`${dir}/${name}-pair-full.png`, PNG.sync.write(pair));
  }
  return { maeRGB255: sum / (n * 3), rmseRGB255: Math.sqrt(squares / (n * 3)),
    pixelsMaxChannelOver10Pct: over10 / n * 100 };
}
for (const shot of shots) {
  const a = load(`webgl-${shot}`), b = load(`webgpu-${shot}`);
  const states = metadata.map(m => m.results.find(r => r.name === shot));
  assert(states.every(Boolean), `missing capture metadata for ${shot}`);
  const stateMatches = Object.fromEntries(
    ['frame', 'elapsed', 'camera', 'rotation', 'fov', 'clip', 'clipTime', 'mag'].map(k =>
      [k, JSON.stringify(states[0][k]) === JSON.stringify(states[1][k])])
  );
  assert(Object.values(stateMatches).every(Boolean), `camera/weapon capture state differs for ${shot}`);
  scenes[shot] = { ...compare(a, b, shot), exposures: states.map(s => s.exposure), stateMatches };
  if (existsSync(`${dir}/webgl-${shot}-fixed.png`) && existsSync(`${dir}/webgpu-${shot}-fixed.png`)) {
    scenes[shot].fixedExposure3 = compare(load(`webgl-${shot}-fixed`), load(`webgpu-${shot}-fixed`));
  }
  for (const backend of ['webgl', 'webgpu']) {
    if (!existsSync(`${dir}/${backend}-${shot}-repeat.png`)) continue;
    repeats[shot] ??= {};
    repeats[shot][backend] = compare(load(`${backend}-${shot}`), load(`${backend}-${shot}-repeat`));
  }
  console.log(shot, JSON.stringify(scenes[shot]));
}
writeFileSync(`${dir}/metrics.json`, JSON.stringify({ scenes, sameBackendRepeat: repeats }, null, 2));
