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
- This branch adds **non-destructive diagnostic counters** for unrelated
  unmatched-window replacements, exposed only in the local replay report.
  These count ambiguity, not confirmed lost speech; the live text algorithm
  has deliberately not been replaced.

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
development smoke*, NOT a five-minute microphone/classroom acceptance,
NOT evidence of browser-direct v0.2 acceptance, and NOT an M4 result.
The later Mac mini M4 formal hardware check remains separate and pending.

## Historic files retained for reference only

`apps/server/src/gateway.ts`, `session.ts`, older server tests and
`docs/protocol.md` belong to the pre-v0.2 gateway design. Older
`docs/acceptance-v0.1.md`, `docs/api-integration-v0.1.md`,
`docs/reverse-proxy.md` and most of `PROJECT_SPEC.md` may mention the
retired topology. Do not use those as live installation instructions.
