---
name: analyze-audio
description: Analyze audio files by sending them to a Gemini audio-capable model through the raw API. Use when you need to inspect sounds (game audio, mix levels, transients, speech) and you cannot hear the audio yourself.
---

# Analyze Audio

> Gate: this harness cannot attach audio to models (pi passes images/text only), so
> this skill sends the audio to `gemini-3.5-flash-lite`, which accepts audio input
> and answers in text. Use it whenever a question is about a sound.

## Usage

```bash
node .pi/skills/analyze-audio/scripts/gemini-audio.mjs <file.wav|mp3> "question"
```

Example:

```bash
node .pi/skills/analyze-audio/scripts/gemini-audio.mjs capture.wav \
  "How loud is the ambient bed relative to the gunshots? Any reverb tail?"
```

## Notes

- Uses the pi google API key (`~/.pi/agent/auth.json`) or `GEMINI_API_KEY`.
- Free tier: 250k input tokens/min (audio ≈ 32 tokens/s — about 2 hours of
  audio per minute). On HTTP 429, wait ~60s and retry.
- Speech transcription is accurate; subtle tonal detail is not (lite model).
- Alternative for vision models: convert to a spectrogram PNG and use the
  `see-images` skill:
  `ffmpeg -i in.wav -lavfi "showspectrumpic=s=1920x960:legend=1:scale=log" -frames:v 1 spec.png`
