#!/usr/bin/env node
// Usage: node gemini-audio.mjs <audio-file> [prompt]
//        node gemini-audio.mjs <file-1> <file-2> ... -- <prompt>
// Sends audio through OpenRouter to openrouter/google/gemini-3.6-flash.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const files = separator >= 0 ? args.slice(0, separator) : args.slice(0, 1);
const prompt = (separator >= 0 ? args.slice(separator + 1).join(' ') : args[1]) ??
  'Describe these audio clips in detail: what sounds are present, how loud is the background, are there transients or reverb?';
if (!files.length || files.some((file) => !existsSync(file))) {
  console.error('usage: node gemini-audio.mjs <audio-file> [prompt]');
  console.error('   or: node gemini-audio.mjs <file-1> <file-2> ... -- <prompt>');
  process.exit(1);
}

let key = process.env.OPENROUTER_API_KEY ?? '';
if (!key) {
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.pi', 'agent', 'auth.json'), 'utf8'));
    key = auth.openrouter?.key ?? '';
  } catch { /* fall through */ }
}
if (!key) {
  console.error('No OpenRouter API key: set OPENROUTER_API_KEY or configure pi openrouter auth.');
  process.exit(1);
}

const audioParts = files.flatMap((file, index) => {
  const ext = file.toLowerCase().split('.').pop();
  const format = ext === 'mp3' ? 'mp3' : ext === 'flac' ? 'flac' : ext === 'm4a' ? 'm4a' : 'wav';
  return [
    { type: 'text', text: `Audio attachment ${index + 1}: ${basename(file)}` },
    { type: 'input_audio', input_audio: { data: readFileSync(file).toString('base64'), format } },
  ];
});
const body = {
  model: 'google/gemini-3.6-flash',
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: prompt }, ...audioParts],
    },
  ],
};

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/earendil-works/pi-coding-agent',
    'X-Title': 'pi analyze-audio skill',
  },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error(`OpenRouter API error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
const json = await res.json();
console.log(json.choices?.[0]?.message?.content ?? '(no response text)');
