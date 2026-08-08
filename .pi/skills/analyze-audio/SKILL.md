---
name: analyze-audio
description: Analyze audio by converting it to a log-scale spectrogram first — for mix levels, transients, frequency content and reverb tails a spectrogram beats raw audio every time. If you have vision, inspect the spectrogram directly; otherwise query Muse Spark with it.
---

# Analyze Audio

For ANY audio analysis, work from a spectrogram: it shows amplitude, frequency
and timing exactly, which raw audio cannot give you reliably.

## 1. Convert

```bash
ffmpeg -i in.wav -lavfi "showspectrumpic=s=1920x960:legend=1:scale=log" -frames:v 1 spec.png
```

## 2. Inspect

- **If you have vision**: read the spectrogram directly (`read spec.png`).
- **Otherwise**: query Muse Spark with it:

```bash
pi --model openrouter/meta/muse-spark-1.2 --thinking high \
  -p @/absolute/path/to/spec.png "Analyze this spectrogram: ..."
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
