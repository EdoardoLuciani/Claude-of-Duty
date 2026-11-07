# Tactical callouts

36 offline recordings: Orus, Algenib, Alnilam and Iapetus × three takes × contact,
reload and outgoing-grenade intents. Full-bank combat-mix acceptance still requires
human listening; approval of auditions/voice-plus-grit is not final mix approval.

`src/audio/callouts.ts` owns local URLs, cast order and routing. Immutable actor ID
modulo four selects a stable speaker; avoid immediately repeated takes.
Contact follows visual acquisition, reload follows reload start, and outgoing
grenade speech follows successful launch. Unsupported intents stay silent.
One tracked spatial emitter follows the actor through the existing voice graph;
grenade lines may preempt regular speech. Discard rejected lines, never queue.
Cooldowns/gaps bound chatter. Pause/shop/death/restart/failure/disposal stop sources;
restart clears history. Reactions are separate, not verified same-performer matches.

## Masters and processing

Generation used OpenRouter `google/gemini-3.8-flash-tts`, provider-supplied voices
and original scripts, with no cloning/reference audio. No speech service or
credentials are shipped. Generation is nondeterministic; new takes need audition.
Back up pristine WAVs/metadata under `~/Music/Claude-of-Duty/tactical-callouts/raw/`
(`auditions/`, `bank/`); Opus cannot reconstruct masters.
`src/audio/samples/callouts/provenance.json` records lines, direction, voices,
generation IDs, hashes, crops and exact processing/normalization filters.

Recook archived WAVs, not delivery Opus: retain 20/80 ms around −45 dBFS activity;
80 Hz high-pass, clean-body compression plus saturated/compressed 350–6000 Hz
parallel grit at .55 weight. Target −22 dBFS active RMS under a −3 dBFS peak
ceiling; apply 5/20 ms fades. Encode mono 48 kHz Opus, 96 kbps VBR, no copied
metadata/header gain. Use each take's recorded filters for exact settings.

## Provenance and rights

[Voice descriptions](https://ai.google.dev/gemini-api/docs/speech-generation#voices) ·
[Model terms](https://ai.google.dev/gemini-api/terms) ·
[API terms](https://developers.google.com/terms) ·
[Transport terms](https://openrouter.ai/terms)

Google disclaims ownership of generated original content; applicable terms/law
still govern distribution. No exclusive copyright or third-party clearance is
guaranteed. Keep provenance and require public-repository/commercial-game rights
review; other audio banks may have different rights. No voice model or commercial
reaction master is redistributed. Run `npm test` and `npm run build`; listen to
every take, reaction pairing and speech intelligibility under gunfire.
