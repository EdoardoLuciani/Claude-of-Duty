#!/usr/bin/env node
// Usage: node openrouter-audio.mjs <audio-file> [prompt]
//        node openrouter-audio.mjs <file-1> <file-2> ... -- <prompt>
//
// Muse Spark 1.2 (openrouter/meta/muse-spark-1.2) accepts images but NOT
// audio, despite OpenRouter's modality metadata. So each clip is converted to
// a log-scale spectrogram PNG with ffmpeg and sent as an image part. The
// spectrogram preserves what mix/transient/timbre analysis needs: amplitude
// envelope, frequency content, timing, reverb tails. It does NOT support
// speech transcription — say so if asked.
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const MODEL = 'meta/muse-spark-1.2';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const files = separator >= 0 ? args.slice(0, separator) : args.slice(0, 1);
const prompt = (separator >= 0 ? args.slice(separator + 1).join(' ') : args[1]) ??
  'Describe these audio clips in detail: what sounds are present, how loud is the background, are there transients or reverb?';
if (!files.length || files.some((file) => !existsSync(file))) {
  console.error('usage: node openrouter-audio.mjs <audio-file> [prompt]');
  console.error('   or: node openrouter-audio.mjs <file-1> <file-2> ... -- <prompt>');
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

// ---- audio -> log-scale spectrogram -------------------------------------
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('ffmpeg is required: convert each clip to a spectrogram manually and use the see-images skill, or install ffmpeg.');
  process.exit(1);
}
const tmp = mkdtempSync(join(homedir(), '.pi-audio-skill-'));
const parts = [];
try {
  files.forEach((file, index) => {
    const name = basename(file).replace(/\.[^.]+$/, '');
    const png = join(tmp, `${index}-${name}.png`);
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', file,
      '-lavfi', 'showspectrumpic=s=1920x960:legend=1:scale=log',
      '-frames:v', '1',
      png,
    ]);
    parts.push({ type: 'text', text: `Spectrogram ${index + 1}: ${basename(file)}` });
    parts.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${readFileSync(png).toString('base64')}` },
    });
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- send -----------------------------------------------------------------
const body = {
  model: MODEL,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...parts,
      ],
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
