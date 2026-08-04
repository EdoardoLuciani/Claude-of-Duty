---
name: see-images
description: Inspect image files by delegating to a vision-capable model through the pi CLI. ONLY use when you (the current model) have NO vision capabilities yourself — if you can already see image attachments, never use this skill.
---

# See Images (vision fallback for non-vision models)

> **⚠️ GATE — read this before doing anything.**
>
> This skill exists ONLY for models WITHOUT native vision.
>
> - If you CAN already see images (e.g. the `read` tool attached a PNG/JPG and
>   you can describe its actual contents — colours, text, objects), **do NOT
>   use this skill**. Just look at the image and answer directly.
> - Only when image attachments are invisible to you (e.g. the attachment is
>   reported as omitted/unsupported) should you use the fallback below.
>
> Using a vision model when you already have vision wastes tokens and time.

## When to use

- The user asks you to inspect a screenshot, render, or capture, and you cannot
  see image attachments yourself.
- You need a visual check (game screenshots, UI mockups, diagrams) and your
  current model has no vision.

## How it works

You shell out to the `pi` CLI with a vision-capable model. The vision model's
description comes back as text and becomes your "sight". Do not guess the image
contents — if the fallback fails, say so.

## Usage

1. Make sure the image exists and is a raster format the vision model accepts
   (PNG/JPEG). Convert if needed:
   ```bash
   ffmpeg -y -i input.webp output.png
   ```
2. Run the vision model on the image with a concrete question:
   ```bash
   pi --model openrouter/google/gemini-3.6-flash --thinking high \
     -p @/absolute/path/to/image.png "Describe this image in detail."
   ```
3. Use the returned description to answer the user's original question.
4. If the vision model is unavailable (auth/network/model error), report that
   honestly — never fabricate the image contents.

## Tips

- Ask specific questions ("Is there blur? What colour is the reticle? Are the
  shadows sharp?") — generic "what's in this image" returns generic answers.
- For AUDIO debugging, do not pass audio files (pi has no audio attachments):
  convert the audio to a spectrogram image first and inspect that instead:
  ```bash
  ffmpeg -i input.wav -lavfi "showspectrumpic=s=1920x960:legend=1:scale=log" \
    -frames:v 1 spectrogram.png
  pi --model openrouter/google/gemini-3.6-flash --thinking high \
    -p @/absolute/path/to/spectrogram.png \
    "Analyze this spectrogram: how loud is the ambient bed vs the transients? How long are the reverb tails?"
  ```
