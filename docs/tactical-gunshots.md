# Tactical gunshot private review candidate

**Not approved for public distribution.** The operator explicitly authorized a
local-only review commit containing the prepared audio derivatives. The current
tree contains only Opus delivery files; WAV masters are archived privately outside Git.
Do not push, upload, publish or open a public PR containing these assets without
separate rights clearance. Required runtime assets accompany the source changes;
a clean checkout needs no private overlay or external commercial library.

## Selection

Five gameplay families use BOOM **Tactical Guns Designed** Close and Distant
single reports. These are publisher-designed proxies, not exact-model field
recordings. Three close variants and two distant variants per family remain
distinct. MCX keeps the first/fourth of four reports in its already-suppressed
source. MPX uses the first three isolated reports from a suppressed MP5 source.
The three unsuppressed UZI close reports remain loaded only for legacy `smg`/`mp5`
aliases, not the actual suppressed MPX definition; UZI distant reports are unused.

For example, `lmg-1`, `lmg-2` and `lmg-3` isolate three different authored shot
events from the SAME supplied M60 Close Single file, at approximately0.10–4.00s,
5.00–9.00s and10.00–13.90s respectively. They are not duplicated or pitch-shifted
copies. Their stereo PCM masters match those isolated48k inputs sample-exactly;
no LMG preparation EQ, individual gain or boundary fade was added. The two distant
variants come from separate events in the M60 Distant Single file, averaged to mono.
The vendor's Designed processing is already part of the supplied source.

| Game weapon | Exact close filename                              | Exact distant filename                                               | Proxy limitation                                             |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| M4          | `GUNAuto_AR-M16 Close Single_B00M_TGDS.wav`       | `GUNAuto_AR-M16 Distant Single_B00M_TGDS.wav`                        | M16 5.56 AR, not M4                                          |
| P320        | `GUNPis_PI-Glock 17 Close_B00M_TGDS.wav`          | `GUNPis_PI-Glock 17 Distant_B00M_TGDS.wav`                           | Glock17 9mm striker pistol, not P320                         |
| EVOLYS      | `GUNAuto_MG-M60 Close Single_B00M_TGDS.wav`       | `GUNAuto_MG-M60 Distant Single_B00M_TGDS.wav`                        | M60 7.62 belt-fed, not EVOLYS                                |
| MPX         | `SIDS SMG HK MP5 Suppressed Single Realistic.wav` | No suitable authored counterpart; same suppressed source spatialized | Suppressed 9mm MP5 proxy; different action from MPX          |
| AX338       | `GUNRif_RI-AWM Close_B00M_TGDS.wav`               | `GUNRif_RI-AWM Distant_B00M_TGDS.wav`                                | AWM .338 AI-family bolt action, not AX338                    |
| M590        | `GUNShotg_SG-Remington 870 Close_B00M_TGDS.wav`   | `GUNShotg_SG-Remington 870 Distant_B00M_TGDS.wav`                    | Remington870 12ga pump, not Mossberg                         |
| MCX         | `SIDS AR AR15 Suppressed Single Realistic.wav`    | No suitable authored counterpart; same suppressed source spatialized | Suppressed **5.56 proxy, not .300 BLK or verified subsonic** |

Tactical's unsuppressed SIG MCX distant is not used. MCX and MPX retain their
suppressed gameplay identity. The real MPX definition (`id: 'smg'`,
`audio: 'suppressed'`, `suppressed: true`) selects a dedicated `mpx` profile before
generic suppression resolution; generic suppressed consumers and unsuppressed
`smg`/`mp5` objects retain their separate profiles. No weapon definitions, ammo,
animation, handling or cadence code changed.

## Source-level preparation and simplified playback

48k resampling and report isolation at **source level, with no baked gain**.
The 33 authored masters use IEEE float32 WAV storage: resampling peaks above
unity survive without integer clipping or normalization. Runtime delivery uses
high-quality Opus copies of all40 loaded recordings (256kb/s stereo /128kb/s mono,
VBR, float encoder input). The41 WAV masters remain intact in a verified external
archive, not in the game repository. See [delivery and offline validation](audio-delivery.md). This is lossy delivery encoding, not a bit-exact change; browser decoding must
retain channel counts, sample lengths and float headroom. Existing reference/bank
factors and mixer parameters are not retuned to compensate for codec differences. No preparation EQ,
exponential tail reshaping, per-clip loudness normalization, or duplicate
suppressed low-pass. Own reports remain stereo; positional close sources downmix
at the voice output, while prepared distant emitters are mono arithmetic averages
of their stereo originals. The player path never forces mono. Authored reports
play at rate 1 without random gain; round-robin variants provide actual variation.

Authored reports now have one shared weapon-level control, default1. The
separate profile trims0.35/0.14 are removed; complete-report voice output is fixed
at unity and the previous category boost1.75 is gone. The unity voice-output node
only supplies stereo/mono routing and teardown; it is not another volume knob.
No replacement compensation for those removed trims was baked into files.
The later, explicitly approved distant-bank reference matches below are separate
from volume controls and preserve per-take differences. Enemy
report routing now also uses emitter gain1: the inherited1.2 presentation boost
was explicitly rejected after review. This is nominally−1.5836dB before shared
output control, not a uniform final-output reduction under adaptive compression.
Own reports are unchanged. After listening to current/+6/+12dB comparisons,
the operator selected **+12dB for the common positional-gunshot reference**.
The previous0.5 authored anchor is now `r = 0.5 * 10 ** (12 / 20)`
(1.9905358527674861); geometric pressure gain is `r / max(r, distance)`.
This is an explicit enemy-to-own PRESENTATION balance, NOT a recovered BOOM
microphone distance or calibrated SPL. It adds12dB above the close-range unity
cap (approximately1.99m); closer reports remain capped at1. At20m geometric
gain0.09952679264 gives−20.04dB; at70m the same-source gain0.02843622647
gives−30.92dB. The20→70m ratio remains−10.881dB BEFORE bank blending,
air/HRTF/hearing/dynamics. The approved whole-mix compression can flatten the
final audible difference and change own/quiet-cue levels during combat. No
compensation or controller retuning was added; isolated own reports bypass this
positional gain. Source/emitter/weapon/master defaults remain1.

The operator explicitly approved fixed **per-bank energy reference matching**
for the five Designed distant banks. Coefficients are
`sqrt(mean close mono energy / mean distant mono energy)`, measured over all
selected complete reports (3 close/2 distant) including full tails. These are
not per-variant normalization, extra user volume controls or inferred physical
microphone gains. Assets, source voice1, emitter1, weapon/master1 remain intact.

| Distant bank   | Reference-match gain | Match dB |
| -------------- | -------------------: | -------: |
| M4 / rifle     |          2.505944895 |    +7.98 |
| P320 / pistol  |          1.749320949 |    +4.86 |
| EVOLYS / lmg   |          2.557027665 |    +8.15 |
| AX338 / sniper |          1.536761294 |    +3.73 |
| M590 / shotgun |          1.005834224 |    +0.05 |

These measurements identify a DIGITAL file-energy difference, not its physical
cause. Equalizing that difference does not recover microphone calibration or
isolate geometric distance loss. The prior hard45m selector caused measurable
strength steps despite matching full-report energy; the operator approved
prioritizing a consistent distance transition over exact whole-tail equality.

Positional reports now crossfade perspectives over20–140m: wholly close through
20m, wholly distant from140m, equal-power cosine/sine weights between. With
`t = clamp((distance - 20) / 120, 0, 1)`, `c = cos(t*pi/2)`,
`s = sin(t*pi/2)`, reference match `k` and geometric gain `g`, the resulting
signal is `g * (c * close + k * s * distant)`. This is a spatial handoff for
independently authored waveforms, not a hearing crossfade or physical calibration.
Actual correlation/spectra/variants mean energy, short-window strength and peaks
need not all be exactly monotonic or equal at every direction.

The two source gains are factored as `c/(c+k*s)` and `k*s/(c+k*s)`; the existing
distance node carries `g*(c+k*s)`. Their product implements the above mix without
new loudness matching or a second user control. Both original recordings start
at the same shot/propagation time, rate1, with no offset or shortened tail. Each
bank keeps its round-robin variants. One spatial emitter is held until the LONGER
report finishes. Inside the transition only, one extra buffer source and two
gains are allocated per shot; outside it the original single-source path remains.
No per-frame allocations, new decoded buffers, additional spatial slots, synthetic
reinforcement or extra controller latency are introduced.

Own/forced-first-person remains one close stereo report, unchanged. MCX/MPX have
no distant bank, never blend and use the same selected positional reference
(gain0.02843622647 at70m). There is no longer a bank switch at45m. At70m the
other families contain both perspectives, not the old wholly-distant recording.
The selected reference is an authored presentation choice; matching banks does
not validate SPL.
Air/obstruction/HRTF and propagation still use REAL distance; other sound types
and legacy synthesis retain their old curve. Original raw-recording distances
were found in local Silencers CK documentation (1.5/8/20m), but Designed mixes
combine microphones with undocumented gains; do not assign them70m capture.
Measurement recipe/hashes and raw-document audit are preserved privately.
Detailed
user-facing volume controls remain tracked in
[issue #454](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/454).

Tactical windows retain the decay until both channels return to measured
stationary inter-report floor for400ms. This is not proof every retained tail
sample is audible or useful. MCX and MPX retain full isolated windows because
their continuous noise beds make shorter boundaries ambiguous. Their only
envelope is 1ms linear click protection at each low-level splice (original MCX
boundary peaks below -71dBFS; MPX below -63dBFS). The leading MCX report buildup
discarded by the old onset detector is restored; no additional runtime shot
scheduling delay is introduced. No other fade or tail compression is authored.
Exact intervals and metrics are private.

Complete reports bypass legacy repair EQ and synthetic action/body layers. Enemy
reports blend complete close/distant perspectives in the shared20–140m handoff;
MCX and MPX use their respective suppressed sources at every range. Own reports
always use one close stereo recording. All authored reports are now dry with respect to the game's added
environment: no near-enemy synthetic ground bounce and no environmental send.
Their complete recorded decay remains. This deliberately gives up an additional
indoor/tunnel room response; it is not sonically equivalent cleanup.

The own-gun path is:

`recording → weapon level (1) → hearing state → shared energy/peak-controlled lookahead gain → master volume (1)`

Enemies retain propagation, mono positional output, direction/HRTF, distance,
air absorption and both obstruction filters. The category uses one gain for
balance × user volume × duck state instead of three serial gains. For categories
retaining a compressor, it feeds this level: volume and balance do not change
compressor drive. Ducking is now post-compressor and combined smoothing is not
sample-equivalent to the previous independent gains. Unity own-shot
routing reuses the voice output as its teardown/steal handle. Weapon-bus and
native master compressor nodes are removed, not all master compression. A linked
lookahead peak envelope now replaces both clipping stages.

One weapon level1 replaces profile gain × category gain. The former fixed
summation headroom0.22 is replaced by audio-thread, stereo-linked RMS gain.
`src/audio/energy.ts` owns the shared20ms RMS window, target0.28, maximum
gain1 (raised from0.7),3ms energy attack and250ms release. Actual summed stereo
energy includes wet/UI/music; the hotter ear controls both. There is no quiet
loudness lift, per-voice estimate, count divisor or new per-weapon trim.
This is intentional adaptive whole-mix compression, not merely an emergency
ceiling: busy gain in the dense fixture is about−13dB. Quiet cues/tails share the
reduction; upstream level changes can partly be offset while the mix remains
above target. Relative category balance, hard mute and post-controller master
remain effective. The user explicitly prefers this combat-masking policy;
controller tuning is unchanged. It is not a calibrated model of human hearing.

`src/audio/peak.ts` replaces BOTH master clipping stages with a stereo-linked
lookahead peak envelope: ceiling0.99 and80ms recovery. A monotonic deque tracks
the maximum absolute sample in the lookahead horizon; an internally held gain
and full-horizon moving average provide an anticipatory5ms attack. By the time
a peak leaves the delay, every averaged gain respects that peak's bound. The
RMS and peak detectors share the SAME5ms delay. Their tighter gain wins, rather
than multiplying two independent reductions. One audio-thread processor applies
that common stereo gain; its second native output exposes the RMS-only signal
for real inspection. No soft clip, oversampling, post-filter or emergency sample
clamp remains. This is sample-peak control, not true-peak/intersample limiting.
Quiet signals can be approximately3.1dB louder from the higher cap. Removing the
old soft clip also removes its existing0.985 linear scale; this is not relocated
elsewhere. Sustained-energy target and source/master/weapon levels are unchanged.

All output retains approximately5ms added latency, NOT two cascaded lookaheads.
Source/event/propagation timing and natural sample lengths are unchanged. The
normalizer/limiter can still reshape decay, blunt attacks or pump; listen before
sonic acceptance. Master and weapon level both default1. Mixer constructor now
creates28 nodes before unchanged reverbs/pools: the22-node healthy-hearing
baseline plus six category-controlled inputs to the shared room send. There
are no extra convolvers or per-voice nodes for this correction. The complementary
dry/processed hearing gains remain routing weights, not extra volume controls. Healthy hearing is dry1/processed0 and hearing gain1,
with sample-exact native input/output. The original20kHz low-pass/shelf remain
ONLY in the processed concussion branch. Linear fades (not equal-power) avoid
boosting correlated signals. Injury retains its cutoff, shelf, volume, delayed
attack and tinnitus. Recovery finishes at exact dry1/wet0/gain1 in30ms. Native
hold/retrigger/ramp tests require explicitly anchoring current parameter values;
unanchored ramps and the initial Nyquist experiment are retained as failed trials.

The local AudioWorklet uses preallocated power/delay, monotonic-queue and gain
smoothing rings, no render-loop allocations or messages. Module loading is
awaited, and startup/native processor failure disables audio without a silent
fallback. Source decoded memory is unchanged; DSP state/overhead are additional.

The energy-based gain now varies with the whole mix; there is no fixed dB
comparison to the preceding fixed-headroom candidate. In the earlier unity-level
revision, ordinary shots rose4.26dB and MCX/MPX12.22dB versus the two-level version,
nominally before shared output processing. Explosions/dryfire/legacy sounds sharing this level lose the
former1.75 boost (-4.86dB); no compensating tuning is introduced. Legacy isolated
source repair/synthesis parameters remain, not extra authored-report controls.
Explosions retain the prior deliberate rebalance: event
emitter gain0.8 replaces6.5. Removing compressors without addressing that boost
failed the initial mixed-recording gate. Blast composition,
radius/distance behavior, ducking and concussion timing remain as before. The
separate ambient distant boom is now deliberately subordinate (gain0.1 instead
of6); it must not drive a far-off environmental event up to foreground energy. Foley/ambience/voice category dynamics, shared room
responses for other sound types, UI/heartbeat hearing bypass and legacy report
composition are retained; legacy sounds also experience the changed shared
weapon/output path. Wet feeds now use the same logical category reference,
user volume and duck as dry outputs before entering the shared room field.
Existing room energy decays naturally rather than being tail-cut. Category
references and over-hot radio/heartbeat/alarm/helicopter sources were balanced
against unchanged gunshots; see `docs/audio-mix.md`. This is mix hierarchy, not
new detailed settings or any change to the approved shared controller.

User explicitly authorized a **higher-resource private full-tail experiment**:
40 loaded assets, **42,548,406 encoded bytes**, **43,462,716 decoded float32 bytes**
(**43.463MB / 41.449MiB**), versus previous prototype 5,000,856 decoded bytes.
Float WAV storage increases encoded size from 21,733,974 bytes; decoded memory,
channel counts, sample rate, durations and voice budgets are unchanged.
This includes the compatibility UZI bank; the earlier 39-buffer total and proposed
37-buffer MPX replacement budget are not the implemented configuration. These are
PCM payloads, excluding AudioBuffer/node/IR/noise and decode overhead. The dry
bookkeeping pool is 80; spatial remains 40. The old 68-lifetime continuous UZI
estimate does not describe the real MPX. The focused native MPX follow-up observed
45 dry slots at peak and zero steals/drops in its bounded scenario; dense enemy
tails may still exhaust 40 spatial slots. Historical six-enemy stress stole
68 of 108 voices. This is not production-performance acceptance, nor permission
to expand spatial capacity or shorten tails silently.

Spatial emitter retirement now cancels inherited future automation and anchors
running targets at the current audio time for its eight position/filter/gain
parameters. Disconnect alone did not clear those pooled timelines: an old
propagation event could overwrite a stolen replacement. The native regression
fills all40 slots, steals the41st voice before an old arrival, and also tests
release/reuse and interrupted targets at44.1/48/96kHz. It compares dry/HRTF and
wet output against an independent control across the old arrival. This fixes
ownership hygiene, not overload tail cutting or unlimited voice capacity.

## Rights evidence

Tactical's bundled `Documentation/00_BOOM-Library-EULA-2022.pdf` (September 2022):

- Page 1: rights “must be validated by proof of purchase”; grant covers
  synchronization in videogames and distribution of productions, and says the
  production must contain an additional non-sound-effects audio element.
- Pages 1–2, **LIMITATIONS**: forbids unauthorized inclusion of content **or new
  audio content derived from / mixed with it** in “Any library”. Limitation 6
  includes sharing, resampling, processing and embedding for reproduction as
  samples/sample playback. It directs doubtful uses to an **Audio Developer
  License** inquiry.
- Page 2: rights only transfer after full license-fee payment.

A local folder is not proof of purchase, an applicable license term, or permission
to distribute individually accessible WAV derivatives in a public Git repository.
Transcoding, filtering or mixing does not clear this gate. No purchase records,
serials or account data were inspected/logged. This is a rights-risk report, not
legal advice. Parent owns verification with the user/licensor and publication.

Boom One bundles the same September 2022 EULA. Cinematic Strikes' 2018 EULA also
forbids derived/mixed library inclusion online/offline without express written
consent. Silencers' local readme is installation/metadata advice, **not a license
grant**; no pack-specific EULA was found there. Sonniss grants project use and
sync, retains copyright, restricts selling sounds as-is and disallows AI training;
it is not a blanket public-domain sample license. No alternative pack is used to
circumvent the publication gate.

## Private reproduction and acceptance

The current simplification recovery directory is
`/home/edoardo/Documents/Claude-of-Duty-recovery/tactical-gunshots/reference-distance-audio/`.
It contains the matching private overlay, actual node taps, before/after and
mixed-recording renders, Oracle advice, validation and handoff. The current
worktree is `reference-distance-audio`, branch `feat/reference-distance-audio`.
The preceding game-level board remains in `runtime-level-audition`; its runtime
is byte-identical to `spatial-emitter-reuse`. The hearing candidate remains in
`transparent-hearing`; the prior
limiter candidate remains in `lookahead-peak-mix`.
The liked energy/soft-clip candidate remains in `energy-master-unity`.
The preceding fixed-headroom candidate remains in worktree `unity-weapon-level`;
the earlier two-level candidate remains in `simple-audio-pipeline`;
the original pre-simplification candidate remains in `tactical-gunshot-overhaul`.
Its `runtime-gain-20261017/` recovery holds the still-valid source-level asset
recipe and before version; its old overlay must not overwrite the new code. The preceding
rebase/native MPX evidence remains in sibling `recovery-20261017T202641/`;
original isolated inputs/source intervals remain in `source-faithful-v2/`.
Earlier handoffs/overlays describe earlier revisions and must not be reapplied
to this changed candidate. No source library original was modified.

All seven real definitions pass event routing and a fresh normal-prewarm native
WebGPU game check:27 staged real fire events across own/20m/70m and an MPX burst,
zero audio errors/drops/steals, expected stereo/mono/dry routing and complete
retirement. This is not AI loadout or full-combat performance acceptance.

The private-review gates include134 tests, build/typecheck/lint/format, native
44.1/48kHz event-time recorded mixes, isolated/overlapping blasts, a distance/radius
matrix, legacy/distant-boom routes, UI/heartbeat/concussion, native duck/mute
retrigger and unity/wet voice retirement. The designed dense fixture holds40
spatial voices without drops/steals; no quiet render caused by stealing is used
as headroom proof. Simultaneous raw/RMS-only/peak-controlled/final capture
separates the energy and peak constraints without randomized-render gain estimates. At master1
and category2, the tested candidate peak remains below unity. These are bounded
numeric gates, not a guarantee of clean sound at every arbitrary configuration.

The listening page at `http://127.0.0.1:8765/` now has current/before outputs for
all seven weapons and source/step players, plus mixed-scene comparisons. Default
Game-level mode undoes the export0.25 scale for final outputs; above-unity raw
taps get explicitly labelled page-only safety reduction. Common-gain and
RMS-matched comparison modes remain. The page slider still starts35%. The
previous complex graph is explicitly historical. Audition volume/matching is
outside the game; new step/compare exports are safe-scaled float WAVs. Runtime
recordings are untouched. The original historical MPX harness assertion failure
and its corrected evidence remain preserved in the earlier recovery directory.

No listening is claimed by the implementing agent. Source fidelity, measured
headroom and tests do not establish firearm authenticity or sonic preference.
Human local acceptance remains required, particularly for MCX/MPX proxies and
the45m perspective transition. All comparisons remain private.
