# Tactical callouts — focused #497 bank

36 offline-generated recordings: four prebuilt synthetic identities × three
wording/performance variants × contact, reload and **outgoing** grenade intents.
The owner selected Orus, Algenib, Alnilam and Iapetus; Gacrux was rejected.
Scene-directed auditions and the parallel **voice-plus-grit** treatment were
approved. Full-bank/in-game mix acceptance remains a listening check, not a
claim established by automated tests.

## Runtime contract

- `src/audio/callouts.ts` owns cast order, required local URLs and speech routing.
  The actor's immutable sequential ID modulo four chooses its speaker across
  all intents. Each bank avoids immediately repeating its previous take; there
  are no pitch-shifted synthetic extra identities or per-line speaker changes.
- Contact means new visual acquisition, not hearing/report evidence or arbitrary
  gunfire. Reload follows AI reload start. Grenade speech follows a successful
  grenade launch and says "Frag out", "Throwing a frag" or "Grenade out"—never
  an incoming-grenade warning. Incoming warnings and the other #497 intents
  remain deferred; do not substitute a contact line for an unknown intent.
- One tracked spatial emitter owns a complete line, following its actor. Keep
  distance, propagation, occlusion, reverb and the voice bus in the existing
  audio graph. Regular lines do not overlap; outgoing-grenade announcements may
  interrupt regular speech. Rejected events are discarded, not queued.
- Per-actor cooldowns and a gap between lines bound chatter. Pause, shop,
  player/speaker death, restart, graph failure and disposal stop owned sources;
  restart clears cooldown history. Pain/death reactions stay separate. They use
  the existing actor-ID-modulo-two groups, so each speech identity has a fixed
  reaction group, **not** a verified same-performer match. Check compatibility
  in the combat mix before final acceptance.

## Authoring and raw recordings

Generation used direct HTTPS `POST /api/v1/audio/speech` to OpenRouter with
`google/gemini-3.8-flash-tts`. Delivery context went in `instructions`; `input`
contained only spoken text. No reference audio, cloning or performer/celebrity
impersonation was requested. Eight approved contact/reload takes were reused;
28 additional takes complete this bank. No credentials, generation client or
speech service are shipped or invoked during gameplay.

On the owner's machine, pristine WAVs and request/generation metadata live at:

```text
~/Music/Claude-of-Duty/tactical-callouts/raw/auditions/
~/Music/Claude-of-Duty/tactical-callouts/raw/bank/
```

These are external authoring inputs, not runtime imports. Back up this folder;
masters cannot be reconstructed losslessly from the Opus delivery files.

`src/audio/samples/callouts/provenance.json` records each spoken line, exact
scene direction, voice, generation ID, WAV source SHA-256, crop, processing and
output SHA-256. Audio generation is nondeterministic: regeneration is a new take
requiring audition, not a way to reproduce an approved master.

## Voice-plus-grit cook

1. Locate the first/last source samples exceeding -45 dBFS and retain 20 ms
   before / 80 ms after them. Do not cut consonant attacks or word endings.
2. Run the recorded `filterComplex`: an 80 Hz high-pass into two branches. The
   full-band body receives gentle compression; the parallel 350–6000 Hz branch
   receives strong compression and oversampled tanh saturation, then mixes at
   0.55 against a 1.0 clean-body weight. No full-voice handset filter, pitch/time
   shift, gunfire, static or baked room effects.
3. Measure the processed float audio's active RMS above -45 dBFS. Apply the
   recorded gain targeting -22 dBFS active RMS, limited by a -3 dBFS sample-peak
   ceiling, then 5 ms / 20 ms boundary fades. The exact `normalizationFilter`
   is retained per take.
4. Encode local mono Opus at 48 kHz, 96 kbps VBR, without copied source metadata
   or Opus header gain. Use the archived WAV and recorded filters to recook;
   do not process an already cooked Opus file as a new source.

Conceptual FFmpeg pipeline (substitute a file's recorded filters):

```sh
ffmpeg -i source.wav -filter_complex "$FILTER_COMPLEX" -map '[out]' \
  -ac 1 -ar 24000 -f f32le processed.pcm
ffmpeg -f f32le -ar 24000 -ac 1 -i processed.pcm \
  -af "$NORMALIZATION_FILTER" -map_metadata -1 \
  -ar 48000 -ac 1 -c:a libopus -b:a 96k -vbr on delivery.opus
```

## Provenance and rights

- Voice descriptions: <https://ai.google.dev/gemini-api/docs/speech-generation#voices>
- Google model terms: <https://ai.google.dev/gemini-api/terms>
- Incorporated API terms: <https://developers.google.com/terms>
- Transport terms: <https://openrouter.ai/terms>

Google's Gemini terms state that Google will not claim ownership over generated
original content; OpenRouter defers output rights to model terms. These are
original scripts rendered with provider-supplied prebuilt synthetic voices,
not edits of a commercial voice pack. No provider voice model, reference audio
or commercial reaction master is redistributed. Applicable model/API terms and
law still govern use and sharing; this is not a guarantee of exclusive output,
copyright protection or third-party clearance. Keep this provenance with public
game assets and include commercial-game/public-repository rights review in human
PR review; do not infer that every existing audio asset has the same rights.

## Validation

`npm test` covers asset hashes/Opus limits, required loading/failure behavior,
identity/variant selection, real AI triggers, priority/duration gates and lifecycle
cleanup. Also run `npm run format:check`, `npm run lint` and `npm run build`.
Human listening must still check every new take, speech versus reactions, and
intelligibility under actual gunfire. This focused PR does not close all of #497.
