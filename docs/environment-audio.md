# Recorded sparse environment — #474

This independent slice replaces the environmental oscillators/noise generators
with **14 required finite recordings**, two variants each for dog, birds, wooden
creak, gravel settling, truck and helicopter passes, and air-alert siren. Bomber,
weapons, explosions, hits and tactical speech are not reauthored here. Nonverbal
reactions are a separate PR; spoken dialogue remains deferred in #497.

## Source audit / deliberate gaps

- **Dog:** two nonoverlapping barks from the existing 344 Audio dog reel, labelled
  indoor perspective. This is an off-stage urban dog donor, not a claimed dry
  outdoor/multiple-dog recording. Preserve its short tail; judge baked perspective.
- **Birds:** distinct clean BOOM blackbird phrases, appropriate temperate-zone
  birds, not a generic tropical jungle wash.
- **Creak:** separate soft movements from a light wooden-door reel. Small wooden
  object/door detail, not verified large structural collapse or metallic strain.
- **Settle:** separate BOOM gravel falls, including their diminishing contacts.
  Grit/gravel detail, not a claim of heavy masonry failure or a new explosion.
- **Truck:** SoundBits freight pass and a separate BOOM highway pass. Mono excerpts
  retain recorded approach/retreat character at an off-stage emitter. There is no
  visible vehicle that they claim to track.
- **Helicopter:** two BOOM solo AS532UL Cougar excerpts. Real helicopters, not toy
  drones, fixed-wing PC-21 or a mixed escort. Finite recorded pass character, not
  another loop or visible aircraft. #504's moving bomber remains unchanged.
- **Siren:** separate nonoverlapping excerpts of a real BOOM air-alert recording,
  band-limited to reduce field background. This is environmental, not the game's
  fictional intel alarm or hearing evidence; those contracts remain unchanged.
- **Distant human shouts/chatter:** no suitable isolated non-actionable distressed
  shout was established. Cartoon/Santa calls, cheering, creature voices, unrelated
  civilian conversations and mixed nearfield combat are not appropriate substitutes.
  The old synthesized shout and random ambient tactical-callout timer/callback
  are **retired**, not silently replaced by false nearby enemy warnings. Actual
  AI-event tactical barks remain unchanged for #497. Silence is the explicit gap
  decision; don't claim recorded distant shout coverage.
- **Wind/air bed:** current develop already has **no continuous bed**. We retain
  quiet gaps/sparse events rather than import a park/meadow/traffic scene as a
  constant masking wash. Distant volley/boom scheduling remains as before.

The owner explicitly cleared public edited #474 environmental derivatives and
separately mixed gameplay captures. This is owner attestation, not independent
legal verification. Keep library entitlement/licence records; media do not inherit
code licensing. Source masters remain private and unrelated legacy permissions
are unchanged.

## Authoring and runtime

`node tools/prepare-environment-audio.mjs /path/to/Music` reproduces clips, explicit
Vite URLs and formatted provenance via the offline-only one-shot helper shared
with the other #474 authoring work. Source/output hashes, exact crops, source
channel counts, explicit stereo averaging/downmix loss, filters, fades, active
level reference/gain, decoded durations/peaks are recorded. No pitch/time randomizing
or runtime loops. Long excerpts use 300/500 ms fades; short contacts use 5/25 ms.
The −24 dB active-sample target and −9 dB pre-codec peak cap are source references,
not automatic runtime matching; decoded peak must remain below 0.5.

Added storage: **715,588 encoded bytes / 11,558,400 float bytes at 48 kHz** (~11 MiB).
This independent branch has 252 required recordings (238 baseline + 14); other
categories add recordings. Reuse the existing all-settled bank's contact containers,
per-kind no-immediate-repeat state, disposal and per-render cache ownership. Each
event creates one finite source/output in the existing pool. Missing assets fail
startup, with no per-event I/O or synthetic substitute. No new runtime dependency.

The scheduler retains the original volley/boom/one-shot timing ranges and silence
when stopped. It no longer schedules nonexistent actors' tactical speech. All
recorded events retain normal propagation, attenuation, occlusion, air absorption,
ambience bus, reverb, ducking/concussion, finite retirement and restart/disposal.
`ENVIRONMENT_GAIN` owns per-category source trims; existing event presentation
references, gun/master/bus gains and test thresholds are unchanged. There is no
new independent audio engine, scheduler, NPC population or gameplay warning.

## Validation / listening

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
node tests/e2e/audio-selftest-e2e.mjs
node tests/e2e/audio-mix-e2e.mjs
node tests/e2e/audio-environment-e2e.mjs --out=/tmp/environment-after
node tests/e2e/audio-environment-e2e.mjs --root=/path/to/before --port=5548 --baseline --out=/tmp/environment-before
```

Smoke covers bytes/headers, decoded metadata budgets, both no-repeat variants,
rate=1, timing, explicit missing-recording errors/all-settled cleanup, real
producer dispatch and absence of replaced generators/phantom voice callback.
The scheduler test now checks its three supported timers and explicitly asserts
zero random tactical chatter; this is a deliberate contract change, not a removed
failure gate. Self-test uses actual recorded methods, not the deleted generator.
Native mix covers both takes of every category, nearest ranges and room helicopter
cases, retaining all prior hierarchy/headroom/tail/readability gates and gun anchors.

Actual WebGPU integration records a **controlled open-path palette through the
normal game master** at the closest normal ranges (14 m, 90 m for heli/siren),
normal maximum event level/reference gain, and explicit occlusion=0 for comparison.
No source/bus/master gain override or normalization. Representative order/windows:
dog 3 s, birds 3.5 s, creak 4.5 s, settle 5 s, vehicle 11 s, heli 17 s, siren 13 s.
These windows include the longer original synthesis and room tails. Native mix
separately covers every recorded variant. Images are labelled static native
snapshots, not full-motion footage or unassisted gameplay. AI/random scheduling
are suppressed only for the palette. A separate normal scheduler probe, without
that palette's occlusion override, produces one real recorded dog and verifies
finite cleanup with no audio/engine errors or phantom tactical callouts.

Source labels, hashes and metering are not perceptual approval. Judge naturalness,
baked perspective, repetition, siren/rotor tail transitions and quiet-scene balance.
#501's high-rate spatial investigation remains separate; no rate-specific gain
patch or relaxed gate is introduced here.
