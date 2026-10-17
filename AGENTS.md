# RU-Class maintainer contract — current (2026-10-17)

## Source of truth

Read `docs/current-status.md`, `docs/browser-direct-byok.md` and
`README.md` before editing. `PROJECT_SPEC.md` contains the **long-term
roadmap**, not an instruction to restore retired Node/WebSocket systems.
Historic decisions remain in `docs/decisions.md` and old acceptance reports.

## Active runtime (v0.2.2)

- Anonymous public **static** website, no site login, central user database,
  global provider keys, default model endpoint, CORS proxy or ASR relay.
- Every visitor independently sets speech, image and text API URL, model and
  Token. Keep these, recordings, lesson metadata, and captions exclusively
  in the user's own browser IndexedDB; never upload them to RU-Class.
- Browser calls user-selected CORS-compatible HTTPS OpenAI-style APIs
  directly. For local same-device testing only, loopback HTTP is allowed.
- `apps/server/src/index.ts` only serves static content. Old
  `gateway.ts`, `session.ts` and WebSocket protocols are archival.
- `apps/web/direct-asr.js` owns serial 8-second overlapping 16-kHz
  transcription calls. `transcript.js` provides best-effort stable + draft
  projection. Current projection cannot distinguish identical spoken phrases
  from Whisper alternate readings without audio timing or review.
- Keep RU transcript area present and blank until real text arrives. Use
  three compact cards in a centered responsive settings grid (3/2/1 across
  large/medium/mobile), URL + optional Token before model discovery, separate
  Save/Test actions, and modest local success feedback.
- Image/text model *configuration* exists but inference / DeepSeek / live
  translations are not implemented. Do not claim otherwise.

## P1 private offline audio probe

`scripts/audit-private-audio.mjs` and
`docs/p1-private-audio-audit.md` provide a strictly offline, privacy-safe
review workflow for possible repeat collapse. A numerical acoustic
separation candidate is **not** proof that two identical sentences were
spoken. Keep original audio and raw private hypotheses available privately;
do not turn numerical acoustic activity alone into a live caption
decision. The user has explicitly opted out of Russian human listening;
see the machine-only P1 engineering acceptance policy below.

## P1 shadow-only replay after real second-model check

The operator completed **6/6 genuine** official Beijing Qwen3-ASR
calls for private C1/C2 focus clips (2026-10-17), but nobody with
verified Russian listening skill evaluated the source audio. This is
strong *independent model evidence*, not human ground truth.
`scripts/inspect-private-caption-risks.mjs` and
`docs/p1-shadow-caption-risk.md` provide a purely diagnostic replay.
Do not turn its thresholds or risk counters into automatic deletion,
freezing of corrections, or stable transcript rewrites. No raw classroom
text, voice or prior temporary cloud Key belongs in GitHub or CI.

## P1 official Beijing-region cloud option

The user also authorized the **official Alibaba Cloud Beijing**
`qwen3-asr-flash` API path in
`scripts/cross-validate-dashscope-asr.py` and
`docs/p1-dashscope-official-asr.md`, as an alternative to downloading
and running the Qwen3 model locally. This option explicitly uploads
six private 8–12-second audio samples to the user's selected provider.
Read the API Key only from `DASHSCOPE_API_KEY` environment; do not
print it, disclose raw provider response text, or submit the samples
through GitHub Actions. A real API inference still has to be
performed on a key-holding machine; GitHub tests mock all calls.
Do not confuse this API path with the strictly offline MLX path.

## P1 independent Russian ASR cross-check

`scripts/cross-validate-private-asr.py` and
`docs/p1-independent-asr-crosscheck.md` define an optional Mac-only,
offline Qwen3-ASR *second-model* comparison. Require an already-downloaded
local model; never send private audio to a third-party API, never emit
transcripts in CI or logs, and never treat a second model as human speech
ground truth. The Python test suite uses a fake model only, so CI cannot
claim real Russian inference occurred. P2 stays excluded.

## P1 non-human engineering acceptance — explicit user decision (2026-10-17)

The user has **declined further Russian human listening**. Do not ask
for a Russian-speaking reviewer or make human transcription/listening
a required condition for continuing P1 engineering or reviewing a
**non-production** PR. The opt-out applies to all C1 #30, C2 #76/#77,
C1 #120 and true-repeat probes. Preserve previously prepared blind
review materials privately; do not treat `PACKET_PREPARED_NOT_AUDITED`
as a required open task.

**Three independent outcome labels must remain separate:**
- `ENGINEERING_REGRESSION_PASS/FAIL`: deterministic replay,
  source-sample integrity, same-window idempotency, all 227 stop
  prefixes, real 121+106-window per-window change audit, build/tests.
- `MODEL_CROSS_EVIDENCE`: existing Whisper vs actual Qwen3-ASR
  comparison and anomaly classification. Signals hypotheses rather
  than actual spoken truth.
- `SPEECH_ACCURACY_UNVERIFIED`: no valid listener-verified Russian
  reference transcript; do not claim WER, confirmed missing spoken
  words, zero true-repeat false positives, or recovered speech.

P1 may **continue offline algorithm experiments without a listening
gate**. A future browser/live merge requires green deterministic
regressions, explicit changed-window/append-only analysis, conservative
handling of ambiguous real repetitions and valid corrections, and a
documented residual-error risk. A result based only on lower token
count, heuristic risk scores, or one cross-model match does not
establish real accuracy. Keep PR #22/#23 as drafts until their own
release decision, not until a Russian reviewer is recruited. Do not
re-enable or request the disabled temporary cloud key.

## P1 2026-10-17 M4 reconstructed C1 and C2 provenance boundary

See `docs/p1-m4-c1-reconstruction-c2-focus-2026-10-17.md` for the
operator's private-Mac small/0 vs small/0.2 and PR #25 2x2 subset
replay. 121 C1 windows were *policy-reconstructed* from available
audio, not the historical exact-SHA cache; C2's original 106
realtime positions/final flags and original 45 altered-decoding
fixtures were unavailable. C1 829→971 final word count and 111/121
visible-window changes are **not evidence of restored spoken words**.
PR #25 had zero additional effect on the tested new C1 and C2 #76
hypotheses and a synthetic genuine-repeat false positive. Keep
PR #25 Draft/default OFF/unmerged, even if it handled old C2 #76.

Required next foundation: real macOS Safari P0 evidence persistence
from PR #14 (IndexedDB v1→v2/two-tab migration, private local raw
hypothesis export, exact start/end/final flags, failures visible,
key absence). Do not claim a reconstructed C2 or 227/45 full
regression without source provenance. A newly recorded realtime
dataset can support a **new** engineering replay, not a historical
C2 byte-identical replacement. Do not demand Russian listening;
`SPEECH_ACCURACY_UNVERIFIED` remains.

## v0.3 stable source-window units and LLM cutoff rule

The user proposed processing text 'older than 8 seconds' with
DeepSeek. Treat this as a **conservative eligibility boundary**,
not proof of transcription accuracy or automatic stabilization:
new rolling 8s windows no longer cover older samples, but
unanchored hypotheses can still be ambiguous and no word
timestamps are available. Use only existing `stable_delta`
emissions as immutable source units, each with actual source
confirmation-window sample bounds and recording/classroom IDs.
`StableUnitJournal.ready()` requires **8 seconds after the
confirmation window end** during capture, or a completed session
flush; never promote `partial_text` just because time elapsed.
Persist the source units only in existing local recording metadata;
old lessons may lack them. Word/sentence speech time stays null.
Different Start/Stop segments have independent source timebases.
Do not make real DeepSeek calls or invent sentence boundaries
during v0.3: the user-selected API, serial job queue, verified
prefix matching and bilingual sentence output belong to v0.4.
Read `docs/v03-stable-source-watermark.md` before expanding scope.

## v0.2 course renaming and shared bilingual history

Course title is editable *within a fixed local date*, while its
UUID remains stable. The IndexedDB v4 `classrooms` store uses a
date+normalized-name primary key: rename must **atomically re-key**
the catalog and update only membership/title metadata in the
`lessons` store in one readwrite transaction. Never alter any
recording UUID, original PCM blocks, ASR hypotheses, or evidence
manifest. Implicit legacy classroom groups become a catalog entry
with a stable UUID on explicit rename. Validate uniqueness against
both catalog rows and implicit legacy groups; no duplicate date/title.

Keep *each* stop/start as an independent recording session for
failure isolation and independent evidence provenance. The **one
classroom's history** must present all its session transcripts
chronologically, including the boundaries, across pauses/stops.
Use RU for stored raw/reduced source captions; ZH is a truthful
placeholder unless a genuine translation exists. Do not pass
the previous recording's stable transcript into the new
`TranscriptBuffer` nor concatenate arbitrary audio sample
offsets. The main two panes use a subtle 1px separator.
See `docs/v02-dated-classroom-identity.md`.

## v0.2 wide classroom manager and heading regression fix

The original dated-classroom selector created in PR #37 had a
concrete DOM wiring bug: `renderClassroomLock()` queried
`#transcription`, but the section was missing `id="transcription"`,
so choosing a course could leave the live right-side pane locked.
Keep the matching element ID and synchronously update its
`is-locked` class plus hidden prompt **before** async session reads.

The owner replaced the top-left dropdown with **small date on first
line, prominent course title on second, right-aligned plus**; use the
entire left pane width, transparent/no border. Right transcription
background and boundary are also transparent/borderless. Plus opens
a large two-column *classroom manager*: every dated course on the left,
**only that course's** independent recording sessions (WAV playback,
download, original ASR-window export and status) on the right.
Model Settings no longer contains a "本地数据" page; its
data/clear functions are hosted in the course manager. Empty selection
still gates microphone ASR, but must not block the API Settings button.
Do not merge recording sessions or migrate/rewrite old PCM/ASR evidence.
See `docs/v02-dated-classroom-identity.md` and UI regression tests.

## v0.2 classroom identity and locked transcription (2026-10-17)

Owner changed the data semantics: **one classroom** is identified by a
user-defined course name + local calendar date (canonical name/date
unique key; newly created classrooms have UUID), **not by a start/stop
recording**. The top-left classroom select loads historical transcript
segments and shows `YYYY-MM-DD · name`, with a right-aligned plus button
opening the add-classroom dialog. All live ASR and microphone controls
are locked without a selected classroom. Every Start/Stop creates a
new private recording-session UUID **inside** that classroom; its WAV,
hypotheses, evidence manifest and independent 0-based PCM timeline are
never reused or overwritten. The course/date identity is shared, not
raw audio/sample offsets. Prevent classroom switching/creating during
capture/start/stop. Keep existing v1–v3 session records untouched:
list them in a legacy inferred course/date group, retain original
session IDs, recordings and exports, and reject same-name/date duplicate
course creation. Local IndexedDB v4 adds only a `classrooms` catalogue
store. No shared API account/sync, translation, subtitle heuristic,
or server change. Tests cover duplicate calendar dates and legacy groups.
See `docs/v02-dated-classroom-identity.md`.

## v0.2 whole-recording local playback (explicit user request, 2026-10-17)

The owner explicitly resumed **v0.2 local lesson playback and audio
storage testing**, superseding the previous blanket deferment of
in-app playback for this *whole-recording* scope only. Keep original
browser-direct BYOK and same IndexedDB v3 schema. `recordingWav` and
the `设置 → 本地数据` one-audio-player UI may load old sessions
and must refuse missing/corrupt PCM parts; retain WAV/JSON exports.
Do not conflate full-WAV playback with **v0.6 word/sentence-aligned
playback**, which remains deferred, along with P2 automatic recovery
and 90-minute endurance testing. CI's 30-minute synthetic WAV Blob
checks are not real MacBook Safari 30-minute microphone acceptance.
Prefer preserving raw original data and reasonable blob memory bounds.
See `docs/v02-local-recording-playback.md`.

## P0 durable evidence manifests (Issue #33, 2026-10-17)

Use **IndexedDB schema v3** in the unchanged
`ru-class-local-v1` DB to persist a separate `evidence` manifest
for new lesson recordings. Mark as `complete` only after a successful
clean stop, all observed raw hypotheses saved, no write failures,
actual sample-range continuity and the last window ending on WAV
frame count. Start sessions as `recording` so browser reloads
and quota failures fail closed to `incomplete`; v2 exports without
a manifest are `legacy_unverified`. **Do not** claim exact WER
or word preservation from the completeness flag. Avoid storing
private text, audio, API keys or domains in the manifest.
`selectedModelId` only reflects the user's browser choice; it
does not attest engine model weights/`temperatureInc`.
Export remains `ru-class-asr-windows-v1` with compatible
`windows[]` and optional `metadata`; old offline tools must
continue parsing both formats. Physical Safari v1/v2→v3 upgrades,
multi-tab and storage-failure UX need owner's MacBook acceptance
under Issue #28: CI simulations are not hardware validation.

## Browser-local raw hypothesis journal (integrated from PR #14)

The v2 browser IndexedDB schema extends `ru-class-local-v1` with
a per-lesson `hypotheses` journal. Preserve the *exact* provider
response text (including surrounding whitespace), source `startSample`/
`endSample`, final flag and inference time **before** lossy
`TranscriptBuffer` projection. Never send raw windows or keys to
the RU-Class static server. `设置 → 本地数据 → 下载原始识别窗口`
exports user-selected per-lesson private JSON. Old recordings do not
retroactively gain windows. Failures in browser evidence persistence
must remain visible and must not be reported as a complete journal.
Keep the current transcript reducer unmodified; this feature records
source evidence rather than solving P1 accuracy problems.

Functional code was carried forward from prior PR #14 onto latest
main because the old pull-request branch diverged; it is integrated
for direct user testing. **Automated tests cannot establish physical
Safari IndexedDB v1→v2 migration/multi-tab/export correctness**; retain
[Issue #28](https://github.com/Ran-ying/ru-class/issues/28)
as the real-browser acceptance gate. In particular, do not claim
restoration of historical C2 missing request-window times.
PR #25 remains Draft/off, as does the original P1 evidence
acceptance; do not enable its quarantine merely because the raw
journal now exists.

## P1 same-source 44-window M4 decoder control (2026-10-17)

Read `docs/p1-2026-10-17-44window-m4-controlled-comparison.md`:
the owner reported authentic original 44-row WAV + 44-row JSON
comparison from the physical M4, reusing exact browser sample start/end
and final flags. Fresh small/0.2 matched **44/44 exact provider text**
to the original export; small/0 matched 17/44 and medium/0.2 1/44.
Unchanged reducer: small/0 `152/12/59` and small/0.2
`174/14/73` and medium/0.2 `144/10/22` as
final words/replacement count/replacement tokens. All three passed
mechanical stop-prefix/same-window/double-flush tests.
This is **strong decoding-source reproducibility** but still
`SPEECH_ACCURACY_UNVERIFIED`. No metric justifies claiming
spoken words were recovered/lost, switching medium, or enabling
PR #25. The frontend JSON v1 does **not** attest Whisper deployment
revision or `temperatureInc`; add only honest privacy-safe
metadata in a separate, reviewed schema with backward compatibility.
Preserve original source files and complete/no-failure evidence status.

## P1 numeric-only replacement provenance (2026-10-17)

`scripts/audit-private-replacements.mjs` provides a read-only offline
source/replacement-window trace for the existing `unanchoredReplacement*`
counters. It **does not modify** the browser `TranscriptBuffer`, call a
provider, export any token strings, or prove words were spoken/lost.
Metrics for lexical matches to final/later windows are weaker than
phonetic/acoustic alignment; don't translate candidate counts into WER
or enable Draft PR #25 from numerical diagnostics. Private WAV and raw
window JSON remain owner-local. Read
`docs/p1-private-replacement-audit.md` before interpreting its output.

## Development safety and acceptance

- Preserve all original recognition evidence before any destructive
  caption stabilization. The forward-ported PR #14 raw-window journal is
  integrated into main for owner-requested testing, but requires real
  Safari IndexedDB migration and export verification before physical
  browser acceptance can be claimed.
- PR #13's 64-word cutoff / aggressive mutable-draft rewrite failed the
  two private real-classroom C1/C2 caches and is closed unmerged. Never
  reintroduce without the full documented private regression gate.
- New diagnostic counters are non-destructive; **never** interpret shorter
  final text or fewer repeated n-grams as proved accuracy.
- Keep real private WAV, raw hypotheses, personal domains, bearer tokens,
  model binaries and user-specific logs out of commits.
- Run `npm test`, `npm run typecheck`, `npm run build`. For cross-repo
  compatibility, validate alongside `ru-class-asr`. Their legacy mirrored
  `src/protocol.ts` and `docs/protocol.md` must remain byte-for-byte equal;
  document deprecation in separate pages, not in the mirrored files.
  GitHub CI is not physical Safari/M1/M4/five-minute classroom acceptance.
- M1 synthetic/Metal development smoke and real M4 inference evidence are
  recorded separately. **Owner explicitly resumed v0.2 whole-recording
  in-browser playback**; its bounded scope is documented above. P2
  automatic recovery, sentence-aligned replay, 90-minute endurance and
  background recording remain deferred. Do not modify those features
  incidentally.
- Do not deploy or publish private classroom data as part of a test.
  Use focused branches and explicit PR review for meaningful changes.

## Related independent repository

`Ran-ying/ru-class-asr` serves a Bearer-authenticated OpenAI-compatible
speech API backed by an external whisper.cpp engine. It supports arbitrary
configured listener addresses (loopback is only the default); CORS with
empty `allowedOrigins` is unrestricted, but Bearer remains mandatory.
That service has no dependency on the historical RU-Class WebSocket gateway.
