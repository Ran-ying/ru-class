# RU-Class v0.3 — stable captions, source-window provenance and future DeepSeek input

## Scope

The existing production `TranscriptBuffer` applies LocalAgreement-style
overlap stabilization, emitting `stable_delta` and `partial_text`.
**v0.3 does not replace this matching algorithm**, modify the Whisper
decode settings, or run DeepSeek. It improves the observable state and
adds source evidence for future v0.4 sentence splitting/translation.

- The live Russian area renders the **immutable confirmed prefix**
  and **replaceable draft tail** as two visually distinct spans
  (`#ru-stable`, `#ru-draft`). The final stop `flush` transfers the
  visible draft into the stable prefix as in the original reducer.
- Each accepted **stable delta** generates a unique `StableUnitJournal`
  item with `classroomId`, `recordingId`, stable session-local ordinal,
  Russian text, source ASR confirmation-window start/end samples,
  a *wall-clock estimate* of that confirmation window end and explicit
  null **spoken-word** start/end timestamps.
- These items are saved alongside the corresponding independent
  recording metadata as `stableUnits[]` in the existing IndexedDB
  `lessons` store. Original 8s raw ASR hypotheses stay intact in
  `hypotheses` and WAV PCM stays in `audio`; no new IndexedDB store,
  key mutation or cloud sync is introduced. Old recordings with no
  `stableUnits[]` remain valid and display their original transcript.
- The classroom-wide bilingual history still spans multiple separate
  recordings chronologically, with recording boundaries intact.
  Where stable units exist, the history displays the number and last
  **confirmation window** time, explicitly *not* a word or sentence
  time. Chinese stays a placeholder until real translation is available.

## The user's 8-second DeepSeek idea: useful boundary, not automatic truth

The Whisper client sends an 8-second sliding PCM window. Once the
current rolling window start has moved beyond a source sample, that
audio sample will not appear in a **new** 8-second window (barring
session restart/replay). **This alone does not prove a correct,
immutable transcription**: the hypothesis may have remained tentative,
Whisper might have omitted some utterance, and no ASR word timestamp
is available to attribute a phrase to the old sample.

The `StableUnitJournal.ready()` API therefore uses **two gates**:
1. The text must have **already been emitted by `stable_delta`**.
   Never age `partial_text` or a raw `unanchored` hypothesis into
   stability simply because eight seconds have passed.
2. During a live recording, the *window that confirmed this text*
   must itself have ended **at least eight seconds before the latest
   processed ASR window end**, expressed as 128,000 16-kHz samples.
   This is deliberately conservative and can add substantially more
   than 8 seconds of perceived lag.
   At clean session stop, after `flush`, all remaining stable units
   are eligible without an additional timer.

Stable units receive deterministic `recordingId:ordinal` IDs.
A future v0.4 consumer can mark actual successful sends with
`acknowledge(ids)` to prevent sending the same unit twice. This
**in-memory eligibility helper is not yet a durable, exactly-once
DeepSeek job queue**: v0.4 must supply authenticated user-selected
API credentials, serial timer-based processing, persistence/retry
semantics, sentence splitting/correction, prefix verification and
stale-response protection. Nor is a stable unit necessarily a
syntactically complete **sentence**; v0.4 handles sentence boundaries.

## Time semantics (important)

The `window_start_sample` / `window_end_sample` from each ASR request
come from the 16kHz **recording-session** PCM timeline. When the first
actual browser audio chunk is received, the application estimates a
capture epoch from `Date.now() - sampleCount / 16000 * 1000`. A
stable unit's `estimatedConfirmationWallTimeMs` is **that estimated
epoch + confirmation-window-end audio offset**, not the actual time
the Russian words were uttered. AudioWorklet buffering, request lag,
microphone scheduling and word placement within the overlapping
window preclude exact speech timestamps.

Do not assert word-level/sentence-level audio ranges at v0.3.
`speechStartSample` and `speechEndSample` remain **null**.
Independent Start/Stop segments each have distinct PCM zero-time
origins and recording UUIDs. The classroom history sorts them by
recording metadata; it never concatenates offsets across pauses.

## v0.3.1 private source-window replay and export verification

Starting with newly recorded v0.3 sessions, the existing
`ru-class-asr-windows-v1` private JSON download may include the
**optional** `recording` identity (`recording_id`, `classroom_id`,
`started_at_ms`) and `source_units[]` containing the original
confirmed Russian `stable_delta` text plus its existing, estimated
**confirmation-window** provenance. This is a backward-compatible
extension: `windows[]` stays untouched, legacy recordings that
never saved units omit these fields, and old replay scripts continue
to operate. Exports contain **private classroom speech**; do not
commit them to Git, upload them to CI, or share them publicly.

A new entirely local tool:

```sh
node scripts/audit-stable-source.mjs '/private/path/asr-windows.json'
```

replays the actual browser `TranscriptBuffer` against the exported
ordered Whisper raw windows, including the special stop case where
the final `flush` had no additional provider window. It compares
the resulting stable deltas with `source_units[]` and checks
recording/classroom UUID, unit ordinal, exact confirming ASR sample
coordinates, explicit unknown spoken-word start/end, consistent
estimated capture-time epoch and ordinary source sample ordering.
It prints only numerical counters and `source_units_replay_match`
or `source_unit_mismatch`/unverified status, **never raw Russian
text, API keys, private paths or sound**. A matching completed-session
audit is deterministic engineering equivalence, not a verified WER
or true individual word alignment.

The `StableUnitJournal.ready()` interface now uses only internally
recorded ASR window progress and actual final state. Callers cannot
supply fake future audio sample values or a forged final flag to
prematurely bypass the proposed 8-second v0.4 preparation gate.
No scheduled DeepSeek requests, translations, text correction,
model changes or lossy caption edits are introduced.

The old private sessions lack `source_units[]` by construction:
the audit reports `legacy_no_source_units`, **not** a fabricated
historical PASS. Sessions with source evidence but incomplete
raw-window journal report `source_units_match_incomplete_session`
rather than complete-session success. CI tests use only synthetic
Russian placeholders; real Safari recording/export/reload remains
a separate physical-owner test.

## Acceptance

- No modification to the already regression-tested text matching
  or old 44-window output/replay contracts.
- Verify immutable stable prefix, replaceable draft, final `flush`
  and no duplicate stable unit from the same original delta.
- Verify a 7-second-old confirmed unit remains withheld, an 8-second
  confirmed unit becomes eligible, a 30-second-old *draft* stays
  ineligible, and distinct recording IDs remain isolated.
- Verify observed source sample provenance is retained on save/reload;
  legacy recordings retain their original transcript.
- UI tests and Node tests are **not** MacBook Safari long-recording,
  audio-word alignment or Russian WER checks.

**This v0.3 work does not activate text/image model inference or
DeepSeek. The v0.4 call contract remains separately scoped.**
