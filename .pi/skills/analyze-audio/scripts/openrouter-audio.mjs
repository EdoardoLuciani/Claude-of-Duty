#!/usr/bin/env node
// Convert audio to log-scale spectrograms and ask Grok 4.6 to inspect them.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const files = separator >= 0 ? args.slice(0, separator) : args.slice(0, 1);
const prompt = (separator >= 0 ? args.slice(separator + 1).join(' ') : args[1]) ??
  'Describe these audio clips from their spectrograms, including levels, transients, frequency content and reverb.';
const labels = files.map((file, index) => `${index + 1}: ${basename(file)}`).join(', ');

if (!files.length || files.some((file) => !existsSync(file))) {
  console.error('usage: node openrouter-audio.mjs <audio-file> [prompt]');
  console.error('   or: node openrouter-audio.mjs <file-1> <file-2> ... -- <prompt>');
  process.exit(1);
}

function run(command, commandArgs, stdio = 'inherit') {
  const result = spawnSync(command, commandArgs, { stdio });
  if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

const dir = mkdtempSync(join(process.cwd(), '.pi-audio-'));
try {
  const images = files.map((file, index) => {
    const name = basename(file).replace(/\.[^.]+$/, '');
    const image = join(dir, `${index}-${name}.png`);
    run('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', file,
      '-lavfi', 'showspectrumpic=s=1920x960:legend=1:scale=log',
      '-frames:v', '1', image,
    ]);
    return `@${image}`;
  });

  const inspectImages = fileURLToPath(new URL('../../see-images/scripts/inspect-images.mjs', import.meta.url));
  run(process.execPath, [
    inspectImages, ...images.map(image => image.slice(1)), '--',
    `${prompt}\n\nSpectrograms in attachment order: ${labels}`,
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
