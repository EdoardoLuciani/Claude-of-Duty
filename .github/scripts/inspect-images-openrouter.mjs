#!/usr/bin/env node
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const apiKey = process.env.OPENROUTER_API_KEY;
const prompt = process.env.INPUT_PROMPT?.trim();
let imagePaths;

try {
  imagePaths = JSON.parse(process.env.INPUT_IMAGE_PATHS ?? '');
} catch {
  throw new Error('image_paths must be a JSON array');
}

if (!apiKey) throw new Error('OPENROUTER_API_KEY is unavailable');
if (!prompt) throw new Error('prompt is required');
if (!Array.isArray(imagePaths) || imagePaths.length < 1 || imagePaths.length > 8) {
  throw new Error('image_paths must contain between 1 and 8 paths');
}

const workspace = await realpath(process.env.GITHUB_WORKSPACE ?? process.cwd());
const mimeTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);
const content = [{ type: 'text', text: prompt }];

for (const imagePath of imagePaths) {
  if (typeof imagePath !== 'string') throw new Error('every image path must be a string');
  const absolute = await realpath(resolve(imagePath));
  if (absolute !== workspace && !absolute.startsWith(`${workspace}${sep}`)) {
    throw new Error(`image is outside the workspace: ${imagePath}`);
  }
  const mime = mimeTypes.get(extname(absolute).toLowerCase());
  if (!mime) throw new Error(`unsupported image format: ${imagePath}`);
  const info = await stat(absolute);
  if (info.size > 20 * 1024 * 1024) throw new Error(`image exceeds 20 MiB: ${imagePath}`);
  const data = await readFile(absolute, 'base64');
  content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } });
}

const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'x-ai/grok-4.6',
    messages: [{ role: 'user', content }],
    reasoning: { effort: 'high' },
    max_tokens: 4096,
  }),
});

if (!response.ok) {
  const body = (await response.text()).slice(0, 1000);
  throw new Error(`OpenRouter returned ${response.status}: ${body}`);
}

const result = await response.json();
const answer = result.choices?.[0]?.message?.content;
if (typeof answer !== 'string' || !answer.trim()) {
  throw new Error('Grok 4.6 returned no image analysis');
}

console.log(JSON.stringify({ model: 'x-ai/grok-4.6', analysis: answer.trim() }));
