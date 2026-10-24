# Recorded physical radio textures — #474 utility audit

This slice improves handset/support and intel receive texture, while deliberately
retaining useful authored electronic feedback. No spoken transmission, recorded
programme or new gameplay/AI hearing signal is introduced. Speech stays in #497;
nonverbal/environmental work is separate.

## Audit decisions

| Cue                                           | Decision                                                                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Radio open                                    | Recorded switch/dial click + short non-program fuzz, with existing 880 Hz electronic tone unchanged.                                                                                                                  |
| Accepted strike                               | Recorded click/fuzz with the existing two-tone acknowledgment unchanged. Remove the duplicate direct producer playback: the accepted `radio:strike` UI subscriber owns acknowledgment once at its existing 0.7 level. |
| Intel available                               | Recorded receive-only fuzz (no invented button press), preserving all three rising tones and the actual UI event.                                                                                                     |
| Denied/locked/no charge                       | Retain distinctive synthetic refusal tones, their routing and producer behavior.                                                                                                                                      |
| Active intel cabinet alarm                    | Retain the fictional 740/880 Hz alarm, cadence, interruption and hearing evidence. Environmental real sirens are not substituted.                                                                                     |
| Shop/tent radio programme                     | Retain existing locally generated music and its market lifecycle. No suitable ready-to-loop cleared programme was established; do not ship arbitrary broadcasts or introduce a constant world bed.                    |
| Other UI/alerts, squad speech radio treatment | Retain intentional UI cues. Deferred synthesized speech and its treatment belong to #497, not a disguised full dialogue replacement here.                                                                             |

The duplicate acknowledgment was found during the audit: `WeaponSystem._selectRequest`
called `playUi('radio_strike',1)` after successful `callStrike`, while the synchronous
real UI subscriber already called it at 0.7. Only the redundant success call is
removed. Charges, acceptance/refusal, refund, stow and visuals are unchanged;
refusal still sounds even without an accepted event. This is not a global volume
change or a lower-level workaround for hierarchy tests.

## Sources, rights and authoring

Six required mono 48 kHz Opus components: three separate power/dial click cuts from
Sonic Bat Vintage Radio and three nonoverlapping 300 ms cuts of BOOM old-radio
static sequence. These are **designed handset/squelch textures**, not verified
military PTT recordings. No AM tuning/programme, police dialogue, unrelated spoken
acknowledgment, actor clone, or source master is shipped. The source filters reduce
unnecessary low/high bands; radio fuzz does not claim intelligible speech.

`node tools/prepare-radio-audio.mjs /path/to/Music` reproduces all clips, static
URLs and formatted provenance with exact source/crop/filter/hash/level measurements.
The shared offline helper applies explicit mono conversion/cancellation checks,
5/25 ms fades, active references (click −26 dB, fuzz −30 dB), −9 dB pre-codec peak
cap and decoded peak <0.5. No pitch/time modification or per-play normalization.
**30,575 encoded / 322,560 decoded float bytes at 48 kHz.** This independent branch
has 244 required files (238 baseline +6); other categories add recordings.

The owner explicitly cleared public edited #474 radio derivatives and separately
mixed review captures. Preserve source licence/entitlement records; this is owner
attestation, not independent legal certification or relicensing as code. No raw
masters or generation-service uploads, and no expanded legacy permissions.

## Runtime ownership

Reuse contact arrays and seeded no-immediate-repeat selection in the existing
required all-settled cache. Each logical cue owns one composite output: optional
recorded switch plus recorded static, then the existing electronic tones. Static
starts 20 ms after the cue. `intel_call` has no click. Playback rate is 1; existing
UI/dry path and global/bus/gun gains remain. Functional oscillator frequencies,
start times, amplitude/envelope references and the original 0.9 s UI lifetime stay
unchanged. Composite lifetime takes the maximum of both components. Missing
recordings fail startup; no per-event fetch/decode or synthetic-noise fallback.
The superseded procedural noise branches are deleted, not left unused. The raw
UI generator now intentionally supplies only the retained functional tones.

## Validation / listening

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
node tests/e2e/audio-selftest-e2e.mjs
node tests/e2e/audio-mix-e2e.mjs
node tests/e2e/audio-radio-e2e.mjs --out=/tmp/radio-after
node tests/e2e/audio-radio-e2e.mjs --root=/path/to/before --port=5550 --baseline --out=/tmp/radio-before
```

Smoke checks hashes/headers/budgets, all component variants, rate=1, component start
and max-end timing, no recorded fallback, exact retained tone frequencies/times
with a noise-bank stub that throws, and accepted/refused/no-charge ownership.
Native developer auditions append three composite cases **after** existing cases
so older synthesized audition seeds do not shift. This corrected an initial
seed-induced quiet legacy-creak test failure without changing that cue or any gate.
Native mix adds all three logical radio cues under unchanged warning bounds.

Actual WebGPU integration captures nine controlled normal-API cues through the
actual UI/master graph (three variants each for open, strike, intel), 1.2 s apart
plus tail room. No level/bus/master override or normalization; current component
takes are chosen deterministically for coverage. AI/random ambience are suppressed
for the labelled fixture; image is a separately staged static native snapshot,
not moving gameplay or unassisted play. The baseline uses its actual procedural
noise/tones, not claimed recorded variants. Original WebM and ordinary MP3s stay
outside the repository.

A separate uncaptured contract probe uses actual weapon producer methods, actual
strike acceptance and the real UI subscriber: equip/open once, accepted strike
charges/stow, exactly one acknowledgment (baseline duplicates it), active-strike
refusal/refund, locked request, and actual `intel:available` event. It clears the
strike, waits for finite retirement, and checks no audio/engine errors, active
emitters or aircraft loops remain. Subjective quality/readability still needs
listening; hashes, numerical peaks and preserved tone parameters are not approval.
#501's high-rate spatial investigation remains separate.
