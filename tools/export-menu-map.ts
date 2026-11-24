import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { PNG } from 'pngjs';

import { hashFiles, sourceClosure } from './lib/source-hash.ts';

// An engraved relief chart: fine contour intervals, heavier index contours,
// a survey grid and a little paper grain. No imagery or runtime GPU required.
const root = resolve(import.meta.dir, '..');
const output = join(root, 'public', 'images', 'briefing-map.png');
const stamp = join(root, '.cache', 'assets', 'briefing-map.sha256');
const width = 1536,
  height = 864;
function elevation(x: number, y: number): number {
  const u = x / 167 + 0.68 * Math.sin(y / 141) + 0.19 * Math.sin((x + y) / 57);
  const v = y / 150 + 0.62 * Math.cos(x / 177) + 0.07 * Math.cos((x - y) / 39);
  return 9 * Math.sin(u + v * 0.56) + 7 * Math.cos(v - u * 0.82) + 2.5 * Math.sin(1.8 * u - v);
}
function render(): Buffer {
  const png = new PNG({ width, height });
  const field = new Float32Array((width + 1) * (height + 1));
  for (let y = 0; y <= height; y++)
    for (let x = 0; x <= width; x++) field[y * (width + 1) + x] = elevation(x, y);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (width + 1) + x,
        z = field[i];
      const dx = field[i + 1] - z,
        dy = field[i + width + 1] - z;
      const level = Math.round(z),
        major = level % 5 === 0;
      const distance = Math.abs(level - z) / Math.max(0.001, Math.hypot(dx, dy));
      const ink = Math.min(1, Math.max(0, (major ? 1.55 : 1) - distance));
      const grid = x % 96 === 0 || y % 96 === 0;
      const cross = (x % 96 === 0 && (y + 5) % 96 <= 10) || (y % 96 === 0 && (x + 5) % 96 <= 10);
      const grain = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 29) * 0.55;
      const shade = z * 0.32 + (dx - dy) * 35 + grain + (cross ? 50 : grid ? 10 : 0);
      const pixel = (y * width + x) * 4;
      png.data[pixel] = Math.max(0, 25 + shade + ink * (major ? 105 : 34));
      png.data[pixel + 1] = Math.max(0, 50 + shade + ink * (major ? 92 : 53));
      png.data[pixel + 2] = Math.max(0, 45 + shade + ink * (major ? 45 : 38));
      png.data[pixel + 3] = 255;
    }
  return PNG.sync.write(png, { colorType: 2 });
}
const hash = hashFiles(root, sourceClosure(root, ['tools/export-menu-map.ts']));
if (
  process.argv.includes('--force') ||
  !existsSync(output) ||
  !existsSync(stamp) ||
  readFileSync(stamp, 'utf8').trim() !== hash
) {
  rmSync(stamp, { force: true });
  writeFileSync(output, render());
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, hash + '\n');
}
