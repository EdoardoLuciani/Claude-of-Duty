---
name: analyze-audio
description: Analyze audio files by sending log-scale spectrograms to the Muse Spark 1.2 model through OpenRouter (audio clips are converted with ffmpeg). Use when you need to inspect sounds (game audio, mix levels, transients, speech) and you cannot hear the audio yourself.
---

# Analyze Audio

> Gate: this harness cannot attach audio to models (pi passes images/text only), so
> this skill sends a log-scale spectrogram of each clip through OpenRouter to
> `openrouter/meta/muse-spark-1.2`. Muse Spark accepts images but NOT raw audio
> (despite OpenRouter's modality metadata, it refuses audio parts), so the
> script converts each clip with ffmpeg (`showspectrumpic`) and sends the
> spectrogram as an image. Use it whenever a question is about a sound.

## Usage

```bash
node .pi/skills/analyze-audio/scripts/openrouter-audio.mjs <file.wav|mp3> "question"
```

Example:

```bash
node .pi/skills/analyze-audio/scripts/openrouter-audio.mjs capture.wav \
  "How loud is the ambient bed relative to the gunshots? Any reverb tail?"
```

Send several named clips in one model prompt for direct comparison:

```bash
node .pi/skills/analyze-audio/scripts/openrouter-audio.mjs \
  rifle.wav smg.wav pistol.wav -- \
  "Compare all three weapon sounds. Judge each named attachment."
```

## Notes

- Requires `ffmpeg` on PATH (converts each clip to a 1920x960 log-scale
  spectrogram with frequency legend).
- Uses the pi OpenRouter API key (`~/.pi/agent/auth.json`) or `OPENROUTER_API_KEY`.
- Requests use OpenRouter's availability and rate limits. On HTTP 429, wait and retry.
- What a spectrogram preserves: amplitude envelope, mix levels, transients,
  frequency content, reverb tails — all the game-audio questions this skill
  exists for. What it does NOT do: speech transcription (no audio path to the
  model). If the model's reply looks like garbled draft text, re-run; reasoning
  models occasionally leak drafts into the answer.
- For long clips, trim to the section of interest first to keep the
  spectrogram readable.
- `see-images` can inspect the same spectrograms with other vision models.
