#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const files = separator >= 0 ? args.slice(0, separator) : args.slice(0, 1);
const prompt = (separator >= 0 ? args.slice(separator + 1).join(' ') : args.slice(1).join(' ')).trim();
const imagePaths = files.map(file => resolve(file));

if (!imagePaths.length || !prompt || imagePaths.some(file => !existsSync(file))) {
  console.error('usage: node inspect-images.mjs <image> [<image> ...] -- <prompt>');
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

const mcpScripts = spawnSync('sh', ['-c', 'command -v mcpscripts'], { stdio: 'ignore' }).status === 0;

try {
  if (mcpScripts) {
    run('mcpscripts', ['inspect-images', '.'], {
      input: JSON.stringify({ image_paths: JSON.stringify(imagePaths), prompt }),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
  } else {
    run('pi', [
      '--model', 'openrouter/x-ai/grok-4.6', '--thinking', 'high',
      '--no-session', '--no-tools', '--no-extensions', '--no-skills',
      '--no-prompt-templates', '--no-context-files', '-p',
      ...imagePaths.map(file => `@${file}`), prompt,
    ]);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
