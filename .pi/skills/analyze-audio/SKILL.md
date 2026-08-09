---
name: analyze-audio
description: Analyze measurable audio features—mix levels, transients, frequency content, and reverb tails—by converting clips to log-scale spectrograms. If you have vision, inspect them directly; otherwise query kimi-k3.
---

# Analyze Audio

Use a spectrogram for measurable amplitude, frequency, and timing questions.
It does not preserve everything in the source and is not a transcription tool.

## 1. Convert

```bash
ffmpeg -i in.wav -lavfi "showspectrumpic=s=1920x960:legend=1:scale=log" -frames:v 1 spec.png
```

## 2. Inspect

- **If you have vision**: read the spectrogram directly (`read spec.png`).
- **Otherwise**: query kimi-k3 with it (best overall of the tested vision
  models — calibration-honest on level deltas and the most accurate on
  spectral detail; it under-calls differences below ~1–2 dB, so pair it with
  measurements when a small delta matters):

```bash
pi --model openrouter/moonshotai/kimi-k3 --thinking high \
  -p @/absolute/path/to/spec.png "Analyze this spectrogram: ..."
```

Secondary pass — qwen3.8-max is the best at locating *where* a difference
lives spectrally (it inflates dB claims, read its magnitudes as lower bounds):

```bash
pi --model openrouter/qwen/qwen3.8-max --thinking high \
  -p @/absolute/path/to/spec.png "Which bands changed between these panels?"
```

For several clips in one prompt, the bundled helper converts and asks in one
step:

```bash
node .pi/skills/analyze-audio/scripts/openrouter-audio.mjs \
  rifle.wav smg.wav pistol.wav -- "Compare all three sounds."
```

## Tips

- Ask specific questions: how loud is the ambient bed relative to the
  transients, how long are the reverb tails, what frequency is the rumble?
- Trim long clips to the section of interest first so the spectrogram stays
  readable.
