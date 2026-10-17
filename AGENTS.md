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

## P1 browser-session loop canary — default OFF (draft)

`apps/web/asr-loop-risk.js` and
`apps/web/caption-loop-guard.js` expose a conservative lexically
abnormal-ASR-window quarantine candidate. It is reachable only via an
explicit developer-only fourth `BrowserAsrSession` constructor
argument `{captionPolicy:'extreme-loop-quarantine'}` for a **new
session**. The existing website, persisted profiles and user controls
do NOT select it; the default remains original `TranscriptBuffer`.
Read `docs/p1-browser-loop-canary.md`.

This is a research opt-in, NOT a production-recommended setting.
Possible genuine repeated speech can be falsely quarantined. A running
session must never switch reducer strategy after sending append-only
`stable_delta`. The Mac must replay this new browser canary over all
private C1/C2 original windows and inherited duplicate/stop gates;
the earlier PR #22 results do NOT constitute acceptance of this
separate implementation. Preserve original ASR-window evidence (PR #14
Safari gate) before any public canary. No Russian human listening or
further revoked-key cloud call is required.

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

## Development safety and acceptance

- Preserve all original recognition evidence before any destructive
  caption stabilization. PR #14 implements a private raw-window journal
  but requires real Safari IndexedDB migration and export validation; it
  must not be merged based solely on simulated tests.
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
- M1 synthetic/Metal development smoke is recorded; M4 is deferred.
  **P2 full recording recovery, in-app replay and endurance work is deferred
  by the user.** Do not modify these features as an incidental refactor.
- Do not deploy or publish private classroom data as part of a test.
  Use focused branches and explicit PR review for meaningful changes.

## Related independent repository

`Ran-ying/ru-class-asr` serves a Bearer-authenticated OpenAI-compatible
speech API backed by an external whisper.cpp engine. It supports arbitrary
configured listener addresses (loopback is only the default); CORS with
empty `allowedOrigins` is unrestricted, but Bearer remains mandatory.
That service has no dependency on the historical RU-Class WebSocket gateway.
