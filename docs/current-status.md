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
- An independent PR #14 adds *browser-local raw ASR window evidence* before
  the lossy subtitle projection. Its storage migration and export still need
  real Safari testing. Do not merge without its documented review gate in
  `docs/asr-evidence-v0.1.md` on that PR branch.
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

**Private listening review queue:** C1 index 30 (24–32 s, an earlier visible
25-token tentative candidate disappeared), C2 index 77 (82.2–90.2 s,
164-token candidate inside an eight-second window containing obvious
repetition, suggesting an ASR hallucination/decode loop), and the final C1
index 120 (short correction still triggered the diagnostic). Review
original WAV and nearby raw hypotheses locally. The same candidate may be
counted more than once, or be entirely erroneous; do not call 43 events
43 lost phrases.

**Confirmed synthetic counterexample to the lexical overlap algorithm:**
two identical genuine utterances at 1–2 s and 10–11 s appear in ASR windows
`[0,8]` and `[4,12]`. The windows overlap during silence (4–8 s), but
text-only matching collapses both recognized sentences to one. The old
baseline fails the same test. This demonstrates a correctness limitation;
it does not prove that this particular error occurred in C1/C2. Resolving
it reliably needs better audio-time evidence, e.g. speech regions or
timed tokens from a compatible provider, not merely more aggressive lexical
deduplication.

**Remaining admission:** complete private audio listening and a
separately measured candidate algorithm against both caches before any
caption reducer replacement. Retain raw hypotheses (PR #14 is still
awaiting Safari IndexedDB migration/export acceptance) and exclude
deferred P2 recording/playback/recovery from this work. Track the
remaining P1 work in [Issue #16](https://github.com/Ran-ying/ru-class/issues/16).

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

**C1/C2 private source audio is not accessible from GitHub CI.** Real
listening results are still needed for C1 #30, C2 #77 and C1 #120.
No new Whisper inference and no P2 long-recording/playback changes.

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
4. Independently inspect unanchored transitions against the source WAV:
   correction versus genuinely new teacher speech is unknowable from lexical
   similarity alone. Increased/decreased diagnostic counters are *signals*,
   never proof of quality.
5. Compare audible omissions, accidental duplication, hallucinations and
   speaker repetition against a locally reviewed transcript; no acceptance
   based solely on shorter output, fewer matched words or green CI.

The private original recording and caches are **not available to GitHub CI**.
Do not report those checks as passed until run locally with recorded results.

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
