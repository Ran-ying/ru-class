# P1: browser-session loop quarantine canary (default OFF)

**Status: DRAFT PRODUCTION CANDIDATE, NOT DEPLOYED.** This is the
first reuse of the PR #22 experimental lexical-loop policy in the
actual **browser** `BrowserAsrSession` pipeline. It is designed to
be explicitly opted into for a **brand-new session** only, while the
current website continues to construct `new BrowserAsrSession(p, ...)`
with no canary options, preserving unchanged baseline captions.

## Why this candidate exists

Private C1/C2 shadow screening reported C1: 121 windows, zero extreme
loop flags; C2: 106 windows, exactly one extreme lexical loop at **#76**
(164 words / 7 distinct in an 8-second window, 20.5 words/sec,
53 repetitions of a three-word run). Independently obtained real
Qwen3-ASR Beijing 6/6 recognition supported an inference-loop hypothesis
but **did not establish speech ground truth**.

Draft PR #22 isolated #76 in a *separate* offline wrapper and the
owner's genuine original C1/C2 replay passed mechanical checks:
- C1: no visible or stable-delta changes across 121 windows.
- C2: first change #76; **30** visible differences (#76–#105),
  **19** changed `stable_delta` windows; baseline vs experimental
  whitespace final word count **718 vs 723**. #77 still contributed
  19 of its 20 consecutive raw words to the experimental final text.
- 45 original same-range replay checks and 227 stop prefixes passed.
- The true identical-spoken-phrase-in-overlapping-windows counterexample
  still fails, and **C1 #30's possible missing phrase was not fixed**.

This candidate is a distinct implementation; the earlier private
replay results **do not automatically transfer to it**. Mac-side
verification must be rerun on this exact branch before admission.

## Exact scope

- `apps/web/asr-loop-risk.js`: one pure JavaScript classifier used
  by both browser candidate and offline
  `scripts/inspect-private-caption-risks.mjs`.
- `apps/web/caption-loop-guard.js`: a session-scoped wrapper around
  a fresh `TranscriptBuffer`; each abnormal source window is kept
  out of the *candidate* text accumulator. It records **only numeric**
  indices/sample intervals and loop statistics. It does **not**
  change or delete the source recording/Whisper result.
- `apps/web/direct-asr.js`: an optional, internal **fourth constructor
  argument** picks the canary. The default constructor, existing site
  `apps/web/app.js`, API profile schema, IndexedDB and user-visible
  UI are unchanged. **No canary control is exposed to website users.**
- `scripts/replay-session-loop-canary.mjs`: runs actual production
  `TranscriptBuffer` beside the actual canary on local private
  original window caches, reporting index and numeric differences only.
  It checks same-sample repeat idempotence and stop-before-display
  consistency at every prefix. No network, model invocation or key.
- `tests/p1-session-loop-canary.test.ts` and
  `tests/p1-browser-canary-replay.test.ts`: synthetic positive and
  negative controls, **including a deliberately demonstrated
  false-positive when genuinely repeated 164-token speech could
  trigger the exact same signal**.

### Developer-only opt-in in a fresh test session

```js
import {BrowserAsrSession} from './apps/web/direct-asr.js';

const baseline = new BrowserAsrSession(profile, onUpdate, onError);
const canary = new BrowserAsrSession(profile, onUpdate, onError, {
  captionPolicy: 'extreme-loop-quarantine'
});
```

The canary is selected before the first audio sample of a new session.
**Do not mutate or hot-swap a running session's text reducer.**
In particular, `stable_delta` already emitted by another strategy
cannot be retracted by the existing UI.

There is deliberately **no** browser setting, persisted profile
option, fallback domain, separate ASR request, cloud key,
server-side processing or automatic per-user rollout.

### Heuristic and residual error risks

A window is quarantined **only** when all conditions match:
at least 40 tokens, at least eight tokens/second, unique-token
ratio ≤0.25 and one repeated three-word group ≥8 times. A plausible
human speaker can still repeat a phrase at high speed. Therefore
this is an **unproven source-risk heuristic**; don't enable it by
default or use it as proof of word-level transcription quality.
No automatically restored C1 #30 words; no solution to same-sounding
genuine repeated phrases crossing windows; no confirmed WER.

If raw window evidence is not preserved (P0 PR #14's Safari
IndexedDB migration/export is still under separate acceptance),
the canary could hide a genuinely spoken but anomalous ASR result
from displayed captions. For this reason it **must remain off by
default and unmerged** pending the gates below.

## Machine-only Mac acceptance

The user has **declined further Russian human listening**; that is
not a gate. Private C1/C2 caches cannot be fetched from GitHub
CI. Run from a separate checkout of this **feature branch**:

```sh
npm ci
npm test
npm run typecheck
npm run build

node scripts/replay-session-loop-canary.mjs \
  /Users/ranying/Documents/Codex/2026-10-16/zhu/work/main-regression-20261017/private/C1-fixed-windows-converted.json

node scripts/replay-session-loop-canary.mjs \
  /Users/ranying/Documents/Codex/2026-10-16/zhu/work/main-regression-20261017/private/C2-realtime-converted.json
```

Confirm input SHA-256 values before relying on cross-experiment
comparisons:
- C1: `e09920d62fa6d74295aa7729c4648e918b53466d06cb53f54170f82a88f5db08`.
- C2: `d0bd6abac8f71193b7bf695b90d39b669dbeecc0728a3d346f078d7ca92afc19`.

Expected directional **checks (not presupposed pass results)**:
1. C1: no loop flags; all 121 per-window visible and stable deltas
   equal the existing baseline. C1 #30/#120 remain eligible to correct
   normally (their possible correctness remains unverified).
2. C2: only #76 flagged; earliest divergence #76; #77 still retains
   later normal hypothesis, without 53 repeated phantom trigrams.
   Compare exact changed-index arrays with the PR #22 reports; differences
   require source-level explanation, not blanket acceptance.
3. All 227 first-stop prefixes and all 225 possible non-final
   same-range repeats zero violations **on this new implementation**.
   Independently run the preexisting 45 C1 altered-decoding
   sample-range fixtures if they are still available; a generic
   same-text replay is **not** equivalent to every historical injection.
4. Verify that there is no canary setting reachable by ordinary users
   or restored sessions. The baseline `BrowserAsrSession` runs with
   the original reducer and the site's production `app.js` never
   selects the new policy.
5. No regression on normal corrections, genuine disjoint spoken
   repetition, failure handling, cancellation or final-stop flush.
   A known overlapping-window true-repeat loss remains a documented
   incorrect case and is **not magically fixed** here.

### Decision gate

- **Engineering mechanical acceptance** can be reported as passed
  once all private deterministic checks pass.
- **Real speech accuracy** stays `SPEECH_ACCURACY_UNVERIFIED`.
  Independent Qwen evidence is useful but not human truth.
- Do **not** merge into main or enable on the public website merely
  because this PR has green synthetic CI. Consider preserving the
  raw hypothesis before projection (PR #14 acceptance), controlling
  how heuristic false positives are surfaced, and a per-new-session
  rollback policy before any opt-in public experiment.
- The original Alibaba temporary key has been disabled; never ask
  for it or regenerate the old ASR report.
- P2 long recordings, full playback, recording recovery remain deferred.

Issue [#16](https://github.com/Ran-ying/ru-class/issues/16)
tracks the P1 acceptance; PR #22 and PR #23 are separate draft
research experiments.
