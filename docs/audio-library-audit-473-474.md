# Existing-library audio audit: #473 and #474

## Decision summary

There is enough promising material to audition **cloth/fasteners, layered body
contacts, several metal contacts, glass, dogs, vehicles and radio controls**.
There is **not** evidence of a complete replacement bank for either issue.
The biggest gaps are **modern armour/ceramic fracture, soldier boot steps,
body falls, coherent tactical dialogue and exterior aircraft recordings**.
Do not assign a poor semantic match just because its library has a useful name.

This is an exploratory **code + filename + embedded-text-metadata audit**, not a
listening verdict or licence clearance. No samples were copied, edited, uploaded,
transcribed with AI or integrated. No in-game A/B was performed. “Candidate” below
means worth auditioning, **not ready to ship**.

- Scope: [#473](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/473)
  and [#474](https://github.com/EdoardoLuciani/Claude-of-Duty/issues/474).
- Code baseline: `develop` at `c3de4ec7fc1ac0cc7f9d8dc39b55ec896ac97592`.
- Library root: `~/Music`; originals left untouched.
- Inventory: **3,184 loose WAV files**, approximately **59.09 GB / 27.23 hours**.
  RIFF headers parsed for all; 3,177 contained BWF descriptions or LIST/INFO text.
- All 71 shortlisted files independently checked with `ffprobe` for duration,
  sample rate and channel count. This does not establish full-stream integrity,
  absence of clipping/noise, exact words, naturalness or usable edit boundaries.
- **Archive boundary:** the Silencers construction-kit ISO was not mounted or
  inventoried. Gaps mean “no suitable identifiable loose recording found in this
  scan,” not proof that no useful sound exists inside an archive or long take.

## Inventory and how to locate candidates

[The shortlist CSV](audio-library-audit-473-474.csv) provides **71 exact relative
paths**, measured source duration/format, intended use, caveats and rights status:
24 candidates, 15 potential layers, 14 conditional matches and 18 rejected matches.
Rejected entries explain tempting false positives; they are not recommendations.
A long source file is not automatically a bank of independent variants.

| Collection / CSV alias                    | Files | Relevance                                                                         |
| ----------------------------------------- | ----: | --------------------------------------------------------------------------------- |
| Sonniss GDC 2026 organized bundle / `S26` |   347 | Most promising foley, character excerpts, traffic and radio controls              |
| BOOM ONE update 26.01 / `B26.01`          |   602 | Mostly sci-fi/electrical/weapons; radio interference; aircraft folder is jetpacks |
| BOOM ONE update 26.02 / `B26.02`          |   501 | Birds, some metal/wood; creature voices are not human soldiers                    |
| BOOM ONE update 26.03 / `B26.03`          |   506 | Metal/glass, one leaf-step source; everyday reactions are not tactical dialogue   |
| BOOM Gun Handling                         |   140 | Weapon mechanics, separately owned by #337                                        |
| Tactical Guns Designed                    |   212 | Gunshots, separately owned by #15                                                 |
| Silencers Designed                        |   117 | Gunshots; does not include contents of the unmounted ISO                          |
| Cinematic Strikes Designed                |   108 | Designed weapon reports, not physical hit/foley replacement coverage              |
| Urban Explosions Bundle                   |   651 | Mostly explosion/microphone variants, separately owned by #112                    |

For `S26`, resolve `relative_path` under `~/Music/Sonniss_GDC2026_Organized/`.
For `B26.xx`, resolve it under the local BOOM ONE collection's `Update 26.xx/`
directory. Collection aliases intentionally omit machine-specific parent names.
For example, F02 is:

```text
Sonniss_GDC2026_Organized/Foley & Props/InMotionAudio - Foley T-Shirt/
  FOLYClth_ClothMovement24_InMotionAudio_FoleyT-Shirt.wav
```

The local worktree also contains **uncommitted, metadata-only** review aids in
`.audio-audit-local/`: `inventory.csv`, `inventory.json`, `shortlist-local.csv`
(with absolute paths) and `audition.m3u8` (53 non-rejected sources). Open the
playlist in a local media player; do not upload it or the original audio. These
machine-local artifacts are not required by the game or included in the PR.

## Current code: verified findings and corrections to issue assumptions

| Area                          | Current implementation                                                                                                                 | Consequence for replacement work                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Player health damage          | `src/audio/index.ts:_onDamageTaken()` plays `ui('damage')`; `src/ui/index.ts` also calls `hurt()` → `player_hurt`, aliased to `damage` | Duplicate health sting routing is still present. Choose one SFX owner while retaining HUD direction/flash                                               |
| Armour                        | UI's `damage:taken` handler selects `armour_hit`/`armour_break`; all are synthetic in `foley.ts`                                       | Route using health `amount`, `armourAbsorbed`, `plateBreak`; test armour-only, health-only, mixed and plate-break cases                                 |
| Enemy contact vs confirmation | `_onImpact()` consumes `bullet:impact`; `_onDamageDealt()` plays hitmarker/headshot/kill plus occasional hurt voice                    | Keep physical flesh contact on one route. Do not add another contact to `damage:dealt`; confirmation UI remains distinct                                |
| Material/step/cloth/body      | `foley.ts:surfaceImpact`, `footstep`, `cloth`, `bodyFall` are procedural                                                               | Change mappings and source voices, not the spatial/mixer engine                                                                                         |
| Land/AI steps                 | `_onLand()` uses the step voice with `gait: 'land'`; player and AI use the same step family with different distance/budget handling    | Preserve plant timing, landing energy, gait and AI density controls; a walking loop is not a drop-in replacement                                        |
| Voice                         | `vox.ts` synthesises all bark names; `Audio.bark()` has a 0.42 s global throttle and seeded voice shaping                              | Recorded actor identity must replace synthesis pitch identity. Longer recordings also need overlap/priority review; 0.42 s alone cannot prevent overlap |
| Ambient human cues            | `_distantChatter()` invokes tactical bark kinds at random positions 25–75 m away                                                       | Do not blindly replace those calls with intelligible tactical speech: that creates phantom actionable enemies                                           |
| Bomber                        | `radio/index.ts` plays static `ambient/heli` once at launch and again during flight                                                    | Still a real mismatch. A new recording alone does not fix lifecycle or attachment to the moving plane                                                   |
| Air/wind bed                  | Current `ambience.ts` explicitly has **no continuous synthetic air/noise bed**                                                         | #474's bed description is stale for this baseline. A recorded loop would add a bed, not replace an existing one                                         |
| Recorded delivery             | `samples.ts` already decodes/caches local gunshot/action/explosion/heartbeat recordings                                                | Extend its approach; no second engine. Required asset decode failures currently disable audio rather than synth-fallback                                |

Functional synthetic UI cues, the gameplay intel alarm, hitmarker/headshot/kill
confirmation and shop feedback are not automatic replacement targets. Near-miss
whizz/crack, grenade utility and shell/reload mechanics also need their own scope
decision; this report does not expand #473/#474 into #15/#337/#112/#454.

## #473 — What can be used, and what is missing

### P0: damage, armour and body contacts

| Need                    | Best existing candidates                                                                                  | Assessment / remaining gap                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dull flesh/body contact | **F01** `FGHTImpt_4 x Punch, Body 02` (3.913 s, 192 kHz stereo), **F04** T-shirt `SinglePats04` (0.572 s) | Promising **layered approximation**: isolate individual punches and add restrained cloth. Not recorded bullet wounds; audition for cinematic exaggeration. Four punches are not automatically four equally usable variants |
| Armour-only hit         | **F12** low-ring metal thud; **F04** cloth pat; optionally **F07** carabiner texture                      | Experimental construction, not verified modern armour. Keep brief/damped; do not make ballistic plates sound like a medieval shield                                                                                        |
| Mixed armour + health   | Same contact layers, selectively composed using the existing event payload                                | Asset availability is partial; no dedicated mixed-hit recording needed, but layering must not replay the same transient twice                                                                                              |
| Plate break             | No convincing direct recording identified                                                                 | **High-priority gap:** brittle ceramic/composite fracture plus physical carrier contact. **F23** ceramic sink pings are resonant tones, not fractures; **F24** spinning buckler is wrong                                   |
| Optional pain reaction  | See V03–V08 under #474                                                                                    | Do not solve missing body mass with a loud scream. Voice coverage and actor consistency remain incomplete                                                                                                                  |

Suggested construction targets, **not measured edit boundaries**: a short contact
transient, roughly 0.1–0.35 s of body/cloth, with extra fracture/debris only on a
plate break. Determine actual cuts by listening. Do not normalize every component
to full-scale or pitch-shift voices to disguise missing actors.

### P1: all twelve material names

“Partial” means a useful layer or plausible edit, not an approved complete bank.
Keep the existing procedural material where no good recording survives audition.
That is a deliberate mapping choice, not silent fallback for a broken asset load.

| Surface    | Coverage                    | Candidate IDs and caveats                                                                                                                                                                |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `concrete` | **Gap**                     | F09 is a case dropped _on_ concrete, not a clean material bullet hit. F22 is a scraping/grating horror texture despite “Concrete” in the filename                                        |
| `plaster`  | **Gap**                     | No identifiable dry plaster strike/chip bank                                                                                                                                             |
| `metal`    | **Promising**               | **F13** old-file/tire-iron tap, **F25** hammer/stairs, **F26** rod/sturdy board. Isolate smaller strikes and tame ringing; F12/F14 are designed/ambient alternatives, not dry guarantees |
| `wood`     | **Partial**                 | **F15** heavy wood hit in a 180 s horror ambience; **F16** building-block clatter; **F30** wood friction. Need clean strike and splinter edits; reject inseparable ambience              |
| `dirt`     | **Gap**                     | No clean earth puff/contact bank identified                                                                                                                                              |
| `sand`     | **Gap**                     | No clean sand contact/grain bank identified                                                                                                                                              |
| `glass`    | **Promising, limited**      | **F17** glass hit/shatter/splinters (9.296 s). One source, not a verified variation bank; avoid a full smash on every bullet                                                             |
| `water`    | **Gap for discrete impact** | Nature/water-flow recordings exist, but no clean small bullet splash identified. F18 is a sealed hot-water-bottle hit, not open water                                                    |
| `foliage`  | **Partial texture only**    | **F19** leaf step can supply crunch, not a demonstrated ballistic contact. Ambient wind/trees are not isolated impacts                                                                   |
| `fabric`   | **Promising**               | **F04** single pat; **F02/F03** cloth movement for secondary texture                                                                                                                     |
| `flesh`    | **Partial**                 | **F01/F04** dull body/cloth construction. Keep human contact distinct from UI confirmation and vocal reaction                                                                            |
| `rubber`   | **Weak/partial**            | **F18** hot-water-bottle hit may offer a damp rubber thud, but has water resonance and only one source. Trampoline bounces are not a generic rubber impact bank                          |

### Steps, falls, gear and healing

- **Footsteps:** **F19** `FEETHmn_Step Dry Leaves Single Slow` is a 15.031 s
  leaf-step source, not proof of a full gait/boot bank. The opaque **F20/F21**
  filenames (`FFG002.wav`, `FFW003.wav`) have embedded descriptions identifying
  **flip-flops on grass and wood**. Do not use them as soldier boots. Missing:
  credible boot soles on concrete/plaster, metal, wood, earth/sand/gravel and
  other relevant surfaces, with enough separate contacts for walk/run/crouch
  and velocity-scaled landings. Do not count footsteps buried in crowd recordings.
- **Body falls/landing:** **F09** instrument-case drop (1.467 s), **F11** basket
  movement and **F02/F03** cloth can be auditioned as layers. A rigid case has the
  wrong bounce/resonance for a body; **natural full-body falls and heavy boot
  landings remain gaps**. Preserve the existing delayed bodyfall timing until
  motion/animation is explicitly reviewed.
- **Cloth/gear:** **F02/F03** cotton movements (2.275/1.501 s), **F04** pat,
  **F05/F06** Velcro (0.406/6.673 s) and **F07/F08** carabiner handling are the
  most straightforward foley shortlist. Cotton is not nylon webbing; carabiners
  are optional sparse metal texture, not proof of a recorded soldier gear set.
- **Bandages:** cloth and Velcro are partial handling coverage only. No dedicated
  sterile-wrapper opening, gauze unroll/wrap or medical tape bank identified.
  Do not play a Velcro rip unless the animation actually opens a fastener. Keep
  healing completion feedback separate from physical handling.

## #474 — Voices, aircraft, environment and radio

### P0: tactical callouts and natural reactions

Only four files are present in each of the sampled Police Officer and British
Female Detective packs. The pack title does **not** imply the full commercial
catalogue is installed. The Vox Hominis excerpt has panting, crying, laughing and
whistling, not a complete soldier pain/tactical set.

| Current bark / role            | Existing lead                                                                                             | Decision                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contact`, `spotted`           | **V01** police “Shots fired, need backup” (2.118 s)                                                       | Conditional only **after actual shots**; misleading for a visual spotting event with no gunfire. Generic visual contact/“there he is” remains a gap                                     |
| `reloading`                    | None identified                                                                                           | **Gap**                                                                                                                                                                                 |
| `grenade`                      | None identified                                                                                           | **Gap**                                                                                                                                                                                 |
| `flanking`                     | None identified                                                                                           | **Gap**                                                                                                                                                                                 |
| `suppressing`                  | None identified                                                                                           | **Gap**                                                                                                                                                                                 |
| `moveup`                       | None identified                                                                                           | **Gap**                                                                                                                                                                                 |
| `copy`                         | **V02** processed police “This is Unit 1, standing by” metadata (2.396 s)                                 | “Standing by” is not “copy that.” Audition whether a neutral phrase can be isolated; do not reuse a wrong unit identity                                                                 |
| `hit`, `pain`                  | **V03** male adventurer effort yell (0.444 s), **V05** detective dying grunt (2.077 s), **V07** male gasp | Male effort/shock are not automatically natural injury reactions. V05 is the clearest character pain lead, with a female identity. **Coherent male soldier pain variants remain a gap** |
| `death`                        | **V04** male flutter-death construction source (4.952 s), **V05** female reaction                         | Audition V04 for naturalness: it belongs to a creature kit even though this file is a human source. One male take plus one female take is not several consistent enemy identities       |
| Breathing, not a tactical bark | **V06** male panting (9.062 s), **V08** detective breath (1.038 s)                                        | Useful optional human details; not substitutes for pain/death/dialogue                                                                                                                  |

Reject monster/ogre death/pain (**V09/V10**), anime attack yells as tactical speech
(**V12**), and announcer “Headshot” (**V11**) as nearby enemy dialogue. Police
burglary dispatch (**V13**) is not air-support acknowledgement. Do not assemble a
single actor by indiscriminately alternating different performers and heavy pitch
shifts. Correctly voiced gaps should remain documented until a suitable existing
recording or owner-provided recording is available.

### P0: bomber and helicopter

**No verified realistic exterior fixed-wing bomber engine/flyby or full-size
helicopter recording was identified.** The closest filenames are false or
conditional matches:

- **A20** small-plane cruise is **75.248 s of cabin/interior** material; embedded
  text includes walla/movement. Not an exterior bomber source.
- **A21** `AEROJet_Blast Off Clean` (8.736 s) and **A22** `Unidentified Encounter`
  (58.036 s) come from **Air Designed**, with sci-fi tags. A21 is worth listening
  to as a possible design layer only; neither establishes a real aircraft bank.
- **A23** BOOM ONE's `AIRCRAFT/ROCKET` content is explicitly **sci-fi jetpacks**.
- **A24** is a **toy quadcopter**, not a helicopter.

Fix the moving-emitter/lifecycle mismatch in its own small PR, but do not claim
recorded-aircraft acceptance until a suitable exterior source is identified and
cleared. A flyby with baked approach/recede/Doppler must not receive a contradictory
second moving pass. A steady engine loop would need clean loop/fade points and
attachment to plane position, with disposal/restart/overlapping-strike tests.
Bomb explosions stay under #112.

### P1/P2: environmental coverage and utility polish

| Current sound                | Best existing leads                                                                       | Remaining limits                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dog                          | **A01** multiple dog barks (5.934 s)                                                      | Strong first audition. Recording is labelled indoors; reject unsuitable baked room perspective. One file does not establish several clean variants                                                                                 |
| Birds                        | **A02/A03** clean short blackbird sequences; **A04/A05** distant magpies                  | Good semantic candidates, with more birds available in B26.02. Check map habitat and embedded distance before applying spatial treatment                                                                                           |
| Vehicle/truck                | **A06** freight-truck pass (5.210 s), **A07** multiple cars; optional **A08** motorcycle  | Direct truck match exists. Do not replace a truck with a motorcycle unintentionally; avoid duplicate baked and runtime motion                                                                                                      |
| Creak                        | **F28** heater squeak; conditional **F29** designed bowed metal                           | Plausible small-object creak; not established large structural wood/metal strain coverage. F29 has designed tone/reverb                                                                                                            |
| Rubble settle                | **F27** small scrap-heap collapse                                                         | Covers **metal debris** only. Stone/masonry/grit settling still missing. Explosion sweeteners include processed blasts, not a demonstrated clean rubble bank                                                                       |
| Siren                        | No credible direct candidate                                                              | **A25** is a toy fire-engine alarm; **A26** is a trailer alarm. Do not automatically replace the current designed siren with either                                                                                                |
| Shout/distant human activity | **A16** hushed English mixed crowd, **A17** three-male conversation                       | Useful only for plausible distant civilian activity; neither is verified distressed/combat shouting. **A18** paintball mixes nearfield fire; **A19** is excited cheering. Natural appropriate isolated distant shouts remain a gap |
| Wind/air                     | **A14** park wind/trees/traffic, **A15** meadow birds/insects/grass; **A27** chimney wind | Recordings exist but contain other scene identities. No continuous bed currently needs replacement; retain silence/sparse scheduling rather than adding masking wash                                                               |
| Radio physical controls      | **A10** power button (0.784 s), **A11** mode wheel (1.246 s)                              | Straightforward physical click candidates, not a complete military PTT/squelch set                                                                                                                                                 |
| Radio transmission texture   | **A12** ham static (22.881 s), **A13** interference; **A09** AM tuning                    | Trim/fade static to event timing. AM tuning may contain third-party broadcasts/music; isolate non-program noise and check rights separately                                                                                        |
| Support/intel speech         | Conditional **V02/V14** standing-by/emergency broadcast                                   | Exact wording/context requires listening; no verified strike request/acknowledgement or intel mission dialogue                                                                                                                     |
| Tent/shop radio music        | No identified ready-to-loop suitable musical programme                                    | Sax/horn/design snippets do not establish a coherent radio bed. Existing procedural music and intentional UI can stay                                                                                                              |

## Rights and publication gate

**No shortlisted asset is cleared by this audit for public Git distribution.**
Ownership of a folder, a filename or a bundled EULA is not proof of entitlement.
This is a practical release gate, not a legal opinion.

- All five local Sonniss `License - GDC Game Audio.pdf` copies have the same
  SHA-256: `8a26e0113e8b00a4dc953a2d568d326bc780ebd792165f9bb604cb26010dee27`.
  They grant lifetime personal/commercial modification and audiovisual/game
  synchronization, without attribution. They retain original copyrights and
  restrict selling effects as they come; they **do not explicitly settle public
  open-source raw/derived asset redistribution or sublicensing**. Have the owner
  confirm intended distribution and retain the applicable terms/provenance;
  “royalty-free” does not make the samples CC0 or code-licensed.
- The local BOOM ONE EULA is the September 2022 text: rights require validated
  entitlement/proof of purchase, with buyout/subscription conditions and limits
  on sharing/sample-library redistribution. Public, independently downloadable
  WAV/Opus files require review even when synchronized game use is permitted.
  Entitlement was **not** established during this audit. Do not treat possession
  of those collections as clearance.
- Sonniss terms prohibit AI training/development/enhancement usage; BOOM terms
  likewise restrict neural-network/AI/ML development/training. This audit used
  deterministic local header/text tools only. Do not upload recordings to AI
  audition/transcription/generation services without an appropriate permission.
- Broadcast tuning may raise third-party programme/music rights beyond the sound
  library's own recording licence. Attribution alone does not fix that.
- Before adding a derivative: record exact source, licence/version, entitlement,
  allowed distribution, edits and output hash; keep audio under its own asset
  terms. Trimming, layering, resampling or Opus encoding does not itself clear
  redistribution. No original masters or full library dumps belong in the repo.

## Recommended next work, in small reviewable steps

1. **Owner audition + rights review:** use the local playlist and CSV. Listen to
   F01–F07/F12 first for damage layering; F13/F17/F25/F26 for surfaces;
   A01/A06/A10/A11 for quick semantic matches. Log accept/reject, exact cut
   times, clean variant counts, noise/tails and identity. These are suggestions
   for what to listen to, not preselected edits.
2. **#473 damage routing and first contact layers:** consolidate damage SFX
   ownership, retain HUD and confirmation cues, audition body/cloth/metal
   constructions. Plate-break coverage remains explicitly blocked on suitable
   fracture material. No full realism claim from a metal clang alone.
3. **#473 material/cloth follow-ups:** start with metal, glass and cotton/Velcro
   that pass audition. Keep gaps procedural; do not promise a complete footstep
   or bodyfall replacement from the current shortlist.
4. **#474 aircraft follow-up:** separate moving-emitter/lifecycle correction from
   recorded-source readiness. Suitable exterior aircraft audio is still needed.
5. **#474 environmental/radio follow-up:** dogs, truck, birds and physical radio
   clicks are the strongest leads. Voice banks are a separate, mostly blocked
   deliverable; do not relabel incomplete excerpts as full dialogue coverage.

For later implementation, crop silence and irrelevant tails, level-match in the
actual mix with headroom, cache/decode once, use genuine variants where available,
and preserve spatialization, occlusion, bus routing, ducking and event budgets.
Most masters are 96 kHz stereo; do not preload minutes of source material. At
48 kHz, float-decoded mono costs about 192 kB/s, stereo 384 kB/s; plan memory from
trimmed decoded duration, not compressed download size. Downmix positional foley
only after checking phase; keep first-person presentation intentional.

Acceptance still requires in-game headphone A/B, all four damage states without
duplicate layers, semantic/identity checks, distance/occlusion and crowded-combat
listening, lifecycle/restart tests and clean-install test/lint/build. This report
closes **none** of the implementation acceptance criteria in #473 or #474.

## Audit change validation

From a clean `npm ci` in the dedicated audit worktree: `npm test` passed all
140 tests; `npm run lint`, `npm run build` and `npm run format:check` passed.
No runtime code, package manifests or media assets were changed. The inventory
and `ffprobe` checks above validate discovery/format facts only, not sound quality.
