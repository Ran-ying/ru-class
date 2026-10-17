# RU-Class current architecture, status and acceptance gates

Updated 2026-10-17. This page and `docs/browser-direct-byok.md` describe the
**active runtime**. `PROJECT_SPEC.md` retains the long-term feature roadmap;
its legacy WebSocket gateway, server-held provider keys, and authenticated
public site designs were superseded by the v0.2 browser-direct decision.

## Active topology and ownership

| Component | Lives in | Responsibility |
| --- | --- | --- |
| Static site | `apps/web` | Anonymous HTTPS UI, no central user accounts |
| Browser recorder | `apps/web/audio.js`, `capture-worklet.js` | 16-kHz mono samples and bounded audio ring |
| Direct ASR requester | `apps/web/direct-asr.js` | User's provider URL / model / token, 8-second windows, serial `POST /v1/audio/transcriptions` |
| Transcript projection | `apps/web/transcript.js` | Best-effort stable delta and replaceable draft; **not ground truth** |
| Browser local data | `apps/web/local-store.js` | Private provider profiles, lesson metadata and PCM chunks in IndexedDB |
| Static-only Node server | `apps/server/src/index.ts` | Optional static content serving, no ASR gateway or user data |
| Independent Whisper API | `Ran-ying/ru-class-asr` | Bearer-protected OpenAI-compatible ASR backed by whisper.cpp |

Only the browser talks to the user's selected speech/image/text providers.
The static RU-Class server neither sees nor supplies provider keys. Speech
inference is implemented; image/text model selection exists but image/text
inference, DeepSeek translation and bilingual history are **not** implemented.

API providers must permit browser CORS and expose HTTPS (local loopback HTTP
is for same-device development only). No RU-Class CORS proxy, shared API key,
public provider default or automatic cross-device synchronization.

## Confirmed code and unconfirmed acceptance

- Main baseline: **v0.2.2**, PR #12 merged. Existing tests and GitHub CI
  verify deterministic local contracts but do not establish classroom accuracy.
- Real private C1/C2 caches contain 121/106 ASR windows. Prior PR #13
  regression reduced C1 displayed word count from 828 to 322 and C2 from
  717 to 474 in the later test. These counts show a regression, **not** WER.
  PR #13 was closed unmerged. Do not revive its 64-word cutoff strategy.
- Existing baseline corrected same-range replay idempotence, non-consecutive
  silence handling and first-stop prefix consistency. Genuine rolling
  overlap repetition, ambiguous spoken repetition, and lost phrases remain.
- The raw-window journal originally developed in PR #14 has been
  forward-ported into main on the user's request. It saves raw ASR evidence
  before lossy subtitle projection. Its Safari storage migration/export
  still needs real-device testing under `docs/asr-evidence-v0.1.md` and
  Issue #28; merging this recoverability feature was not a claim of
  physical-browser acceptance.
- Main includes **non-destructive diagnostic counters** for unrelated
  unmatched-window replacements, exposed only in the local replay report.
  These count ambiguity, not confirmed lost speech; the live text algorithm
  has deliberately not been replaced.

## 2026-10-17 private C1/C2 revalidation (reported by Codex)

**Verdict: `BASELINE_NON_REGRESSION_PASS`; `CLASSROOM_ACCURACY_NOT_ACCEPTED`.**
The operator replayed private original windows against main
`8ec4356ef74b87bc2700c67e04faf298765a2398` and previously checked
`43eea553d613b9f85a969ed4e42550c3a144ed10`. A local reconstruction
of the new main was checked against its Git blobs; this was not a live
Whisper run or a true clone at that HEAD. No audio or private hypotheses
were committed.

| Regression check | C1 | C2 |
| --- | ---: | ---: |
| Raw ASR windows | 121 | 106 |
| Window-for-window stable/draft/visible/final differences vs baseline | 0 | 0 |
| Final normalized word count (unchanged, **not** WER) | 828 | 717 |
| Long lexical repeat candidate spans (not proven duplicates) | 36 | 32 |
| Ambiguous unanchored candidate replacements | 23 | 20 |
| Ambiguous candidate tokens counted (not proven lost words) | 211 | 347 |

Original 45 same-sample replay counterexamples: **0 remaining**.
Every 227/227 first-stop prefix checks matched the visible text before stop;
replayed same-sample updates did not generate extra stable text or change
visible output. Second flush and plain-vs-injected final output matched.
These prove the new diagnostic counters are non-regressive for those private
fixtures, not that the displayed sentences match what was spoken.

**Evidence review queue (no human Russian listening required):** C1
#30 (25-word overwritten candidate), C2 #76/#77 (164-word extreme
repetition), C1 #120 (normal final-correction control), and the known
true-repeat overlap counterexample. Interpret saved Whisper/Qwen evidence,
source sample coordinates and private numerical results separately.
No counted candidate replacement equals a verified spoken omission.

**Confirmed synthetic counterexample to the lexical overlap algorithm:**
two identical genuine utterances at 1–2 s and 10–11 s appear in ASR windows
`[0,8]` and `[4,12]`. The windows overlap during silence (4–8 s), but
text-only matching collapses both recognized sentences to one. The old
baseline fails the same test. This demonstrates a correctness limitation;
it does not prove that this particular error occurred in C1/C2. Resolving
it reliably needs better audio-time evidence, e.g. speech regions or
timed tokens from a compatible provider, not merely more aggressive lexical
deduplication.

**Remaining engineering admission:** privately replay both C1/C2
caches and all same-window/stop-prefix cases against each proposed
caption algorithm; record changed windows, retained correctable drafts,
append-only compatibility and known repetition failure modes.
Russian human listening is explicitly **not required**, per the user's
2026-10-17 decision. Actual speech accuracy and WER remain unverified.
PR #14 Safari IndexedDB migration/export acceptance is independent;
P2 recording/playback/recovery stays deferred.
Track P1 in [Issue #16](https://github.com/Ran-ying/ru-class/issues/16).

## Browser raw-ASR evidence journal integrated for real Safari validation

The PR #14 feature implementation has been forward-ported from its
outdated branch to current main. Every **new** accepted ASR provider
window is persisted in browser-local IndexedDB v2 (same database name;
additive `hypotheses` store) before the existing
`TranscriptBuffer` projection changes the displayed text. Users
can download private source-window JSON under
**Settings → Local Data → Download raw ASR windows**; old sessions
from v1 do not acquire windows retroactively. Raw text, source sample
start/end/final flags and elapsed inference time remain on the user's
device, never on the RU-Class server. Storage failure should produce
a visible warning; an incomplete journal is not a verified full
recording.

This implementation was merged to allow owner-controlled MacBook
Safari testing, **not** because physical Safari IndexedDB migration,
two-tab upgrades, microphone source provenance, storage quota/error
and JSON export admission had already passed. See [evidence-journal
documentation](asr-evidence-v0.1.md) and [Issue #28](https://github.com/Ran-ying/ru-class/issues/28)
for the pending acceptance. The production transcript reducer algorithm
is unchanged; Draft PR #25's automatic source-window quarantine remains
OFF and unmerged. Prior lost C2 realtime positions are not restored.

## M4 reconstructed C1 and partial C2 small-model/PR #25 replay (2026-10-17)

[Detailed operator-reported numerical results](p1-m4-c1-reconstruction-c2-focus-2026-10-17.md)
and [Issue #26](https://github.com/Ran-ying/ru-class/issues/26).

The operator re-inferred **121 policy-reconstructed C1 windows** at small
`temperatureInc=0` versus `0.2`; all real local requests passed.
C1 old/new baseline final hypothesis projection counts were
**829 / 971 words**. C1 #30 changed from 3→22 tokens, with **24
actual model fallback events**, 111/121 changed visible windows and
20/121 changed stable-delta windows. These are substantially different
machine captions, **not 142 confirmed newly spoken words**. Draft
PR #25 quarantined no C1 window under either input policy.

For an independently checked C2 #76/#77 consecutive focus pair,
old small/0 C2 #76 was 164/7/53 tokens/unique/repeated trigram and
the PR #25 guard quarantined this anomaly while preserving #77;
new small/0.2 C2 #76 was 13/12/1 after actual fallback and the
guard made no additional change. The guard also **did not** catch
the 24.5s 45-token repetition candidate. A deliberately genuine
repetition synthetic case showed a dangerous **240→0** candidate
false positive. Thus PR #25 remains **Draft, off by default,
unmerged**.

**Hard evidence block:** original C1/C2 converted caches (historical
SHA pinned in Draft PR #25) were missing on this Mac. The C1
121-window timeline was reconstructed from current browser scheduling
policy, **not** the original byte-identical historical C1 cache.
The original C2 **106-window per-request sample coordinates, order,
and final flags were unavailable**; only seven separately labeled C2
focus requests per policy were conducted. Accordingly
`ORIGINAL_WINDOW_PROVENANCE_BLOCKED`,
`NEW_227_WINDOW_REAL_INFERENCE_NOT_RUN`,
`CAPTION_REDUCER_REGRESSION_NOT_RUN` and
`SPEECH_ACCURACY_UNVERIFIED` remain mandatory statuses.
Partial 128-window stop/same-range contracts cannot substitute for
the missing historical 227 prefixes / 45 original fixture replays.

**Next prerequisite:** physically validate browser-local raw
hypothesis journaling from PR #14 in Safari (IndexedDB v1→v2,
two-tab upgrades, accurate per-request source coordinates, export
without keys, and error visibility). A future **new** authentic
captured realtime window sequence can then be replayed deterministically;
it cannot retroactively re-create the original C2 timing. The
raw-window recording feature is now integrated, while Issue #28
remains open until physical Safari acceptance. Do not revive PR #13.
P2 long-session recording/playback/recovery remains deferred.

## v0.2 dated classroom catalog and session separation

The owner explicitly redefined the classroom: **course name + local
calendar date uniquely identifies a selected classroom**. A top-left
selector shows these identities; the adjacent right-aligned plus opens
a name/date entry dialog. The entire live RU caption surface and
record button remain unavailable until a classroom is selected. The
selected classroom loads previously stored recording transcripts
from its date/name group; multiple microphone Start/Stop cycles
generate separate UUID-backed sessions within that logical classroom.
Their PCM chunk indices, raw ASR window boundaries, manifest IDs,
WAV/JSON exports and timestamps remain independent and non-overwriting.
Catalog entries are UUID based, with a normalized case-insensitive
course-name/date uniqueness key; v1–v3 historical recordings are
displayed through a non-destructive computed legacy grouping. The
new IndexedDB v4 store only adds a `classrooms` catalogue; current
browser ASR and translation placeholders are unchanged.

Full API/CI contract and browser DOM tests do not claim physical MacBook
Safari v3→v4 migration/sign-off. New use and old-data preservation
remain to be confirmed in Safari; see
[dated classroom behavior](v02-dated-classroom-identity.md).

## v0.2 local lesson replay and 30-minute synthetic WAV check

The previously existing browser-origin IndexedDB v3 retained profiles,
lesson metadata, PCM16 audio chunks, original ASR-window journal and
completeness manifest. v0.2 now exposes **per-lesson whole-WAV
playback in the local data settings** using one user-controlled native
`audio` element. Switching lessons or closing the settings dialog
revokes the old Blob URL, and recording is mutually exclusive with
playback. Old local lessons with valid saved PCM remain playable.
No RU-Class server stores or receives these recordings.

`recordingWav` now refuses an empty record or non-contiguous/invalid
PCM chunk list instead of exporting a misleading partial audio file.
Automated tests generate a simulated **30-minute 16 kHz mono PCM16
WAV (57,600,044 bytes)** and check the format and size. This is **not**
a 30-minute physical MacBook/Safari microphone test; browser quota,
foreground capture, full-recording playback and reload acceptance
remain pending. Users must separately archive important WAV and
original ASR-window JSON files. See
[the v0.2 playback and endurance checklist](v02-local-recording-playback.md).
No browser subtitle-reducer, ASR engine or deferred per-sentence P2
alignment feature was changed.

## Browser-local source provenance and fail-closed completeness (Issue #33)

New recordings persist a separate IndexedDB **schema v3**
`evidence` manifest before capture, recording the browser
application version and user-selected ASR model ID (not verified
server-side model weights/`temperatureInc`). After normal stop,
an evidence export may be labeled `complete` only when every
accepted provider hypothesis was durably saved and sample-frame
count matches the WAV. Quota/write failure, interruption,
reloaded `recording` status or mismatched counts remain
`incomplete`; previously exported v2 lessons retain original
hypotheses but are `legacy_unverified`. The JSON remains
`ru-class-asr-windows-v1` with an optional privacy-scoped
`metadata` block, still consumed by prior replay scripts.
No centralized account or provider metadata attestation.

This is automated engineering behavior **pending real MacBook
Safari schema upgrade, multi-tab and quota-error acceptance** in
[Issue #28](https://github.com/Ran-ying/ru-class/issues/28).
`SPEECH_ACCURACY_UNVERIFIED`; does not enable PR #25.

## P1 authentic new 44-window same-PCM model A/B/C (2026-10-17)

The owner submitted a new physical M4 same-source report under
[Issue #31](https://github.com/Ran-ying/ru-class/issues/31).
Read [the full redacted 44-window control report](p1-2026-10-17-44window-m4-controlled-comparison.md)
before changing model settings or the subtitle algorithm.

The same **44 authentic 16-kHz source sample ranges and final flags**
were independently re-inferred on Mac mini M4 under three controlled
Whisper settings. The originally exported 44 raw texts were
**byte-identical 44/44** to the operator's small/0.2 run
(small/0 matched 17/44; medium/0.2 matched 1/44). Small/0 produced
**152** final reducer tokens and **12/59** ambiguous unanchored
replacement events/tokens, small/0.2 produced **174 / 14/73**, and
medium/0.2 **144 / 10/22**. All three model sequences passed 44-window
stop-prefix/same-range/double-flush mechanical replay. Local inference
p95 was **407 / 1315 / 4290 milliseconds**, respectively.
The operator's numerical model inference results and fallback logs
were not independently rerun by GitHub CI; the original supplied
WAV/JSON format, SHA-256 and source sample lengths were independently
checked.

The higher 0.2 token count or lower medium candidate churn is
**not** WER or semantic completeness; changing decoding changes
the actual raw hypotheses, not necessarily the correctness of the
unchanged `TranscriptBuffer`. Keep the user-selected production
default unchanged, PR #25 Draft/OFF, and original private files
out of public GitHub. Next: finish true Safari IndexedDB
evidence/provenance and incomplete-save acceptance in Issue #28
and collect more independently captured sessions before modifying
reducer heuristics. Model settings are not externally attested by
the current v1 browser JSON alone. `SPEECH_ACCURACY_UNVERIFIED`.

## P1 local numeric-only replacement provenance (2026-10-17)

`scripts/audit-private-replacements.mjs` runs the unchanged browser
`TranscriptBuffer` over a private raw ASR window JSON and outputs only
window indices, original 16-kHz sample ranges, tentative-candidate
lengths and weak final/later lexical match counts. It tracks which
source window supplied the displaced tentative hypothesis, without
changing how production captions work. See
[documentation](p1-private-replacement-audit.md). No raw Russian text,
API keys, WAV or user paths are printed. Candidate replacements are
ambiguous text-rewrite events, **not proven missing spoken words**;
no PR #25 opt-in or speech-accuracy/WER claim is authorized.

## Offline P1 audio-evidence audit helper

A new **offline-only** `scripts/audit-private-audio.mjs` tool accepts
a matching private 16-kHz PCM16 WAV and original window JSON. It flags
adjacent equal-text hypotheses when both exclusive audio regions contain
sustained sound but their shared region appears silent, and can export
selected 8-second windows with ±2 seconds and neighboring hypotheses to
a *new, owner-only private directory* for manual review. This is acoustic
**risk evidence**, not word alignment, recognized-speech proof or a
production subtitle fix. The synthetic duplicate-utterance case remains
a known failing correctness scenario. Detailed Mac-local instructions:
[docs/p1-private-audio-audit.md](p1-private-audio-audit.md).

**C1/C2 private source audio is not accessible from GitHub CI.**
Human Russian listening has been waived by user preference. Keep
`SPEECH_ACCURACY_UNVERIFIED` instead of implying a human validation
has occurred. No new Whisper inference and no P2 changes.

## Official Alibaba Cloud Beijing Qwen3-ASR cross-check

The user has an official Alibaba Cloud Model Studio API key for the
**Beijing** region, so an alternative to downloading the local MLX model
is now available: `scripts/cross-validate-dashscope-asr.py` sends only
six focused/context audio samples to the official HTTPS
`qwen3-asr-flash` API, and saves comparative private hypotheses
locally. The secret is loaded from `DASHSCOPE_API_KEY` and is never
printed or committed. An explicit dry-run sends **zero** requests.
See [Beijing cross-check workflow](p1-dashscope-official-asr.md).

**Privacy distinction:** unlike the offline MLX route, running this
official API workflow uploads the three classroom clips (twice each)
to Alibaba Cloud. The six calls need suitable consent and may incur
charges. Synthetic CI is not a real provider run, and a second-model
output is not a human-approved transcript. P1 Issue #16 remains open.

## Independent ASR cross-validation: not yet run on Mac

The separate offline `scripts/cross-validate-private-asr.py` uses the
**Qwen3-ASR** model family (not Whisper), with locally downloaded Apple MLX
weights, to produce an optional second hypothesis for three private
C1/C2 clips. Dry-run validates WAV/sample provenance; the full mode saves
actual model outputs only inside a new owner-only private directory, prints
numerical-only comparisons and runs no production code. GitHub CI uses
**fake model responses**, not real ASR. See
[Mac-local workflow](p1-independent-asr-crosscheck.md).
Neither Qwen/Whisper agreement nor difference proves spoken-word truth.
Do not mark C1 #30, C2 #77, C1 #120 human-verified based on this runner.

## Real second-model evidence and P1 shadow-only risk analysis

On 2026-10-17, the owner reported **six successful real** official
Beijing `qwen3-asr-flash` recognitions of the three C1/C2 focus clips
and their matching context audio. This is materially different from
the repository's simulated model CI and earlier numerical RMS probes.
C1 #30's overwritten hypothesis has independent Qwen lexical support
(six contiguous shared words and 0.651 normalized similarity); C2 #76
shows a 164-token/seven-unique-token repeated decoding loop with an
independent-model mismatch; C1 #120's final hypothesis has substantially
stronger cross-model support than the previous three-token draft.
**None was reviewed by a Russian-speaking human, and Qwen cannot
provide audio ground truth by agreement alone**. Full derived findings
and a shadow replay procedure:
[docs/p1-shadow-caption-risk.md](p1-shadow-caption-risk.md).

`scripts/inspect-private-caption-risks.mjs` reads only local private
ASR window JSON, emits *numerical index/risk metrics* for conservative
lexical-loop signals and ambiguous unanchored replacements, and **never
changes production captions**, network requests, audio or original
evidence. The purpose is to determine which generic mechanisms a later
reducer experiment should measure without hiding legitimate repetition
or normal final corrections. Issue #16 stays open.

## Private classroom regression gate (P1)

Use the *same private originals* for baseline and proposed algorithm. Raw
audio, tokens and recognized text stay outside GitHub.

```bash
npm ci
npm test
npm run typecheck
npm run build
node scripts/replay-browser-transcript.mjs /private/path/C1-windows.json
node scripts/replay-browser-transcript.mjs /private/path/C2-windows.json
```

Required before a caption-algorithm merge:

1. Run 121 C1 + 106 C2 windows with their actual audio sample positions
   (all 227 windows) and compare final displayed text, not just word counts.
2. All 45 known identical-sample replay counterexamples have zero extra
   stable deltas and no visible growth; verify both original and injected runs.
3. At **every** one of the 227 input prefixes, stopping must commit exactly
   the text then visible, without resurrecting superseded words.
4. Compare private Whisper and saved independent Qwen3-ASR hypothesis
   evidence, source-window sample ranges, candidate retention and anomaly
   metrics, without claiming word-level audio timestamps or spoken truth.
   Increased/decreased diagnostic counters are *signals*, not accuracy.
5. Measure the proposed algorithm's per-window behavior on C1 #30,
   C2 #76/#77, C1 #120 and the synthetic true-repeat counterexample;
   disclose changed stable deltas, remaining false-positive/false-negative
   uncertainty and append-only session-switch restrictions. A human
   Russian transcript is **not a required test**, but any WER/actual
   spoken-word accuracy claim remains unavailable without one or an
   independently validated acoustic reference.

The private original recording and caches are **not available to GitHub CI**.
Do not report those checks as passed until run locally with recorded results.

## Explicit opt-out of Russian listening (2026-10-17)

The user has decided **not to do Russian listening**. Stop requesting
human listening reports or keeping the prepared five-second blind
review packet as a mandatory development gate. It was successfully
prepared locally as `PACKET_PREPARED_NOT_AUDITED`; it must never be
misreported as an audited transcript.

Already available machine evidence: the official Beijing Qwen3-ASR
cross-check 6/6 succeeded, the shadow check flagged C2 #76 only as
an extreme loop, Draft PR #22 replay passed 121 C1 + 106 C2 windows
with 45 sample-replay and 227 stop-prefix cases, and Draft PR #23
narrowed C1 #30 to **four jointly model/later-window supported yet
finally lexically uncovered candidate positions** within a
conditional 26–31s time intersection. The two Qwen evidence paths
refer to **one audio region**, not two occurrences. RMS activity is
not speech recognition and these four candidate positions are
**not verified missing spoken words**.

Proceed with machine-only **engineering** checks and conservative
experiments. P1 outcome can be `ENGINEERING_REGRESSION_PASS`
while remaining `SPEECH_ACCURACY_UNVERIFIED`. Neither a draft
tooling PR nor a tested algorithm change becomes production-safe
solely because human listening has been waived. Do not rely on
the disabled temporary Alibaba Cloud key.

## P0 / P1 / P2 / P3 boundaries

- **P0**: PR #14 storage-review and real browser migration/export gate.
- **P1**: non-destructive evidence-driven ASR analysis, privacy-safe local
  diagnostics, eventually a separately measured caption algorithm.
- **P2 deferred by user**: long-duration recording, in-page full recording
  playback, recording timeline and interrupted-recording recovery. Existing WAV
  export remains, but is not an accepted sole archive.
- **P3**: this architecture/reference refresh across the two repositories.

## Hardware validation

M1 / Metal 101.16-second synthetic Russian inference is a *historical
development smoke*, NOT a five-minute microphone/classroom acceptance or
evidence of browser-direct v0.2 acceptance.

On 2026-10-17, the operator reported a **partial M4 independent-ASR HTTP
validation**: 8-second private audio through local ASR and remote HTTPS
reverse-proxy/WireGuard paths succeeded; a serial 20-request HTTPS run
returned **20/20 HTTP 200**, mean **852.380 ms**, p95 **906.832 ms**.
These are request-total latencies, **not browser acoustic-to-caption latency**.
See the ASR repository's
[M4 field report](https://github.com/Ran-ying/ru-class-asr/blob/main/docs/m4-2026-10-17-field-report.md)
and [numeric evidence](https://github.com/Ran-ying/ru-class-asr/blob/main/docs/m4-2026-10-17-http-benchmark.json).

Neither M4 Metal device activation logs, 5+ minute natural microphone speech,
browser CORS/real UI, WAV duration, nor captions-vs-source accuracy were
verified by these curl tests. Mac mini M4 **formal hardware and RU-Class
browser-direct/classroom acceptance remain pending**. No P0/P1/P2 gate
is waived or changed by this HTTP-only smoke.

## Historic files retained for reference only

`apps/server/src/gateway.ts`, `session.ts`, older server tests and
`docs/protocol.md` belong to the pre-v0.2 gateway design. Older
`docs/acceptance-v0.1.md`, `docs/api-integration-v0.1.md`,
`docs/reverse-proxy.md` and most of `PROJECT_SPEC.md` may mention the
retired topology. Do not use those as live installation instructions.
