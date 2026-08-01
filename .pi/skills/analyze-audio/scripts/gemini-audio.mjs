#!/usr/bin/env node
// Usage: node gemini-audio.mjs <audio-file> [prompt]
// Sends the audio to gemini-3.5-flash-lite (accepts audio, answers in text).
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file = process.argv[2];
const prompt =
  process.argv[3] ??
  'Describe this audio clip in detail: what sounds are present, how loud is the background, are there transients or reverb?';
if (!file || !existsSync(file)) {
  console.error('usage: node gemini-audio.mjs <audio.wav|mp3> [prompt]');
  process.exit(1);
}

let key = process.env.GEMINI_API_KEY ?? '';
if (!key) {
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.pi', 'agent', 'auth.json'), 'utf8'));
    key = auth.google?.key ?? '';
  } catch { /* fall through */ }
}
if (!key) {
  console.error('No Gemini API key: set GEMINI_API_KEY or configure pi google auth.');
  process.exit(1);
}

const mime = file.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
const body = {
  contents: [
    {
      role: 'user',
      parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: readFileSync(file).toString('base64') } }],
    },
  ],
};

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
);
if (!res.ok) {
  console.error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const json = await res.json();
console.log(json.candidates?.[0]?.content?.parts?.[0]?.text ?? '(no response text)');
