---
name: analyze-audio
description: Analyze audio files by sending them to a Gemini audio-capable model through the raw API. Use when you need to inspect sounds (game audio, mix levels, transients, speech) and you cannot hear the audio yourself.
---

# Analyze Audio

> Gate: this harness cannot attach audio to models (pi passes images/text only), so
> this skill sends the audio through OpenRouter to
> `openrouter/google/gemini-3.6-flash`, which accepts audio input and answers in
> text. Use it whenever a question is about a sound.

## Usage

```bash
node .pi/skills/analyze-audio/scripts/gemini-audio.mjs <file.wav|mp3> "question"
```

Example:

```bash
node .pi/skills/analyze-audio/scripts/gemini-audio.mjs capture.wav \
  "How loud is the ambient bed relative to the gunshots? Any reverb tail?"
```

Send several named clips in one model prompt for direct comparison:

```bash
node .pi/skills/analyze-audio/scripts/gemini-audio.mjs \
  rifle.wav smg.wav pistol.wav -- \
  "Compare all three weapon sounds. Judge each named attachment."
```

## Notes

- Uses the pi OpenRouter API key (`~/.pi/agent/auth.json`) or `OPENROUTER_API_KEY`.
- Requests use OpenRouter's availability and rate limits. On HTTP 429, wait and retry.
- Speech transcription is accurate; subtle tonal detail is not (lite model).
- Alternative for vision models: convert to a spectrogram PNG and use the
  `see-images` skill:
  `ffmpeg -i in.wav -lavfi "showspectrumpic=s=1920x960:legend=1:scale=log" -frames:v 1 spec.png`
