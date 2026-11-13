# Weapon report banks (#668)

Selected edited derivatives live in `public/audio/samples/`. The owner explicitly
confirmed the necessary rights and approved publishing these edits. Original library
masters/ISO remain private; retain entitlement/licence records separately. This is
not clearance for unrelated legacy samples or raw-library redistribution.

`src/audio/samples/weapon-reports-provenance.json` records actual donor models,
calibre/operating-system compromises, source hashes, ISO member paths, per-take
crop times, delivery processing and output hashes. In particular, neither of the
MCX donor banks is verified .300 BLK: both library metadata sheets say 5.56 NATO.
The AR15 folder's M16 filenames and the Glock folder's `Ospray` spelling are retained
verbatim so recovery does not depend on guessing names.

## Recovery / authoring

Use the corresponding privately held Tactical Guns Designed WAV or extract the
specified member from `Silencers - Construction Kits.iso`, e.g.:

```sh
7z x -so "$ISO" "$MEMBER" > "$SOURCE"
```

Check its SHA256 against `sources` in the provenance. Each bank uses the first three
close shots and first two distant shots of its selected reel. Attack detection uses
the first sample above 1% of the local peak within 50 ms of the coarse attack;
crop 5 ms before that attack to 5 ms before the following attack. Exact resulting
start/duration values are recorded per output, so recovery needs no detector.
Keep natural mono/stereo channels and sample rate conversion to 48 kHz; apply only
the common -3 dB headroom gain and 1 ms entrance / 80 ms exit fades:

```sh
ffmpeg -ss "$START" -i "$SOURCE" -t "$DURATION" \
  -af "volume=-3dB,afade=t=in:st=0:d=0.001,afade=t=out:st=$FADE_START:d=0.08" \
  -ar 48000 -c:a pcm_f32le "$MASTER"
ffmpeg -i "$MASTER" -map_metadata -1 -c:a libopus -b:a 192k \
  -vbr on -application audio -fflags +bitexact "$OUTPUT.opus"
```

`FADE_START` is `DURATION - 0.08`. Seek **before** the input so each fade operates
on the cropped take's timeline. No normalization, pitch shift, EQ, compression,
limiting, synthetic reinforcement or layered action samples. Preserve the inter-shot
recorded decay. Construction-kit `Distant 02` is an authored microphone perspective,
not a claim that the microphone stood at the game's 140 m crossfade endpoint.

Update the frozen master/native-decoder references in `samples/reference.json`.
`REPORT_DISTANT_MATCH` in `src/audio/weapons.ts` is
`sqrt(mean close mono energy / mean distant mono energy)`, where mono energy is
`sum(mean(channels)^2) / sampleRate` across each complete edited float master.
Verify every encoded take decodes, is non-silent, has an unclipped peak and retains
the expected attack/full tail before accepting the edit. Human listening acceptance
remains separate from these numeric checks.

## Runtime scope

`src/audio/weapons.ts` selects explicit banks from each fire event's effective
`suppressed` state. Unknown suppressed identities stay silent; no runtime fallback
borrows another bank. Empty triggers still play their mechanical dry-fire cue.
The existing integrated MCX/MPX suppressors/defaults remain until the separate
muzzle attachment/model conversion; this change adds no shop items or mount fits.
