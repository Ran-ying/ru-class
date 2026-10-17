# P1 experimental subtitle reducer: isolated counterfactual replay

**State: EXPERIMENT ONLY — never loaded by the website. Do not merge this
experimental branch into production before evaluating the genuine private
C1/C2 recordings and an audio-grounded correction reference.**

## 2026-10-17 genuine private-cache mechanical replay result

**Status: `PRIVATE_MECHANICAL_REGRESSION_PASS`; `SPEECH_ACCURACY_UNVERIFIED`; `PR_MUST_REMAIN_DRAFT`.**
A local Codex report executed the exact experimental branch
`83c17a0eed0616248ea364b4b320a66d6d3b15d3` on private converted
C1 (121 windows; SHA-256
`e09920d62fa6d74295aa7729c4648e918b53466d06cb53f54170f82a88f5db08`)
and C2 (106 windows; SHA-256
`d0bd6abac8f71193b7bf695b90d39b669dbeecc0728a3d346f078d7ca92afc19`).
Results below are **operator-reported metrics** from the actual private
replay, not GitHub CI access to private data.

| Metric | C1 | C2 |
| --- | ---: | ---: |
| First baseline/trial visible divergence | none | **#76** |
| Visible-text divergence windows | 0 | **30 (#76–#105)** |
| `stable_delta` divergence windows | 0 | **19** |
| Baseline/trial final word count (whitespace) | 829/829 | 718/723 |
| Extreme loop quarantines in trial | 0 | **1 (#76)** |
| Trial unanchored replacements | 23 | **19** |

At C2 #76 baseline/trial visible counts were 678/531; at #77:
527/544; at #78: 537/547. The dominating three-word loop appeared
53 times in the baseline #76 display, but 0 times in the trial #76,
#77 and final text. Trial #77 and final visible text retained a
19-token consecutive sequence from the 20-token raw #77 hypothesis.
**These are lexical probes, not a human speech-accuracy measurement.**

C1 #30 and #120 visible strings and emitted deltas were unchanged at
all 121 windows. The ledger recorded the #30 overwritten 25-token
candidate and found seven contiguous supporting tokens at #32;
**no words were auto-restored**. The #120 three-token predecessor was
marked `STOP_BEFORE_FUTURE_EVIDENCE`, while the normal final 15-token
correction remained identical to baseline.

The operator independently reran the original **45 same-sample replay
cases** (0 violations for both variants), plus same-interval repeats at
the 120 + 105 non-final windows (0 violations). For **all 227 stop
prefixes**, first flush committed exactly visible text, repeated
flush emitted no extra stable text, and no stable-prefix violation
occurred in either version. `npm test` after enabling localhost
listening: 76 tests, 73 pass, 0 fail, 2 skipped, 1 **known failing
TODO** (genuine speech repetition collapsed by lexical overlap).
`npm run typecheck` and `npm run build` passed.

The difference from earlier published final counts 828/717 is **not
automatically a regression**, because this experiment reports
whitespace-delimited tokens (829/718) rather than the previous
normalization. Compare equivalent definitions before drawing conclusions.

**Important contract nuance:** 19 changed `stable_delta` outputs
between separate baseline/trial sessions do **not alone** violate
append-only semantics *within* either session; both passed
within-strategy prefix and stop tests. However, replacing a reducer
**mid-session** cannot retract baseline stable tokens, so hot switching
is unsupported. Speech accuracy, false-positive suppression of genuine
repetition and safe rollout still need independent admission.

Next research gate: establish an actual spoken-word reference for
C1 #30 and C2 #76/#77 and check C1 #120's final correction; measure
quality gains **against audio**. Do not accept a five-word final-count
increase as five recovered spoken words, and do not merge this draft
based only on mechanical regression success.

## Why now

An operator-provided 2026-10-17 private C1/C2 shadow risk report ran against
`main@cbfb01af4313767578c1efe9d37cc9b7fb4f8612`:

| Private replay | Windows | Lexical-loop flags | Unanchored replacements | Superseded candidate tokens |
| --- | ---: | ---: | ---: | ---: |
| C1 | 121 | 0 | 23 | 211 |
| C2 | 106 | 1, at **index 76** | 20 | 347 |

C2 #76 was 164 normalized words / seven unique words in eight seconds,
20.5 words/s, unique ratio 0.0427 and the most repeated trigram 53 times.
**This is a high-risk ASR loop, not evidence of 164 spoken words.** C2
#77 overwrote that 164-word candidate. C1 #30 overwrote a 25-word
candidate previously supported by a real independent Qwen3-ASR response,
but some similar content is present in subsequent windows and no
Russian-speaking listener has established the true audio transcript.
C1 #120 overwrote a three-word draft with a 15-word final hypothesis
strongly supported by Qwen. **All replacement signals are ambiguous**;
a blanket freeze or delete is unsafe.

The earlier independent Qwen3-ASR run made **6/6 real Beijing API calls**
successfully and all actual private hypotheses remain on the operator's
Mac. The data above are a reported derived summary, **not** an actual
private C1/C2 replay run by GitHub Actions.

## Separate experiment, no production effect

`scripts/experimental-caption-replay.mjs` operates only on existing
private window JSON, never the browser, no audio, no cloud ASR, no keys:

1. Constructs two independent instances. The first is the **unmodified
   production** `TranscriptBuffer`. The second is an **experimental**
   wrapper using a new `TranscriptBuffer` with a separate ingestion
   policy; it does not mutate the production instance.
2. On a heuristic `lexicalLoopRisk` input, the experiment **quarantines
   that window** from the second reducer only. Its original sample
   index, interval and numeric metrics are retained. It does not inject
   silence or invent a missing utterance.
3. When the experiment still sees an unanchored candidate overwritten,
   it keeps the old normalized words **in RAM** for **two subsequent
   windows**, independently measuring whether a later window has
   at least four contiguous matching words. This is a *provisional
   evidence ledger*, not a reason to insert, freeze, or assert speech.
   Text is never emitted by the CLI.
4. Compares baseline vs experimental `stable_delta`, visible drafts
   and final captions as **numerical differences**, with first-divergence
   index and privacy-safe window indices. On every prefix, stop must
   preserve exactly the visible text; same-range retransmission must
   not create new text or ledger events.
5. The earlier known true repeated-speech counterexample still
   **fails correctness** in both reducers. Only audio timing evidence,
   rather than lexical equality, could resolve that case.

### Offline usage on owner's Mac

Update a separate working checkout to the *experimental branch*, keeping
the running production deployment at `main`. Then:

```sh
npm ci
npm test
npm run typecheck
npm run build

node scripts/experimental-caption-replay.mjs \
  /private/path/C1-fixed-windows-converted.json \
  > /private/path/C1-counterfactual-metrics.json

node scripts/experimental-caption-replay.mjs \
  /private/path/C2-realtime-converted.json \
  > /private/path/C2-counterfactual-metrics.json
```

The JSON does **not** contain original Russian speech or visible
captions, but store it privately anyway. The script must exit 0 with:

- `baselineFirstStopViolations=0`;
- `experimentalFirstStopViolations=0`;
- `experimentSameRangeReplayViolations=0`;
- `experimentDoubleFlushStableDelta=false`.

Additionally, separately run the **original 45 same-range replay
counterexamples** and **all 227 stop prefixes** using the existing
private harness. Compare *both* the baseline and experiment against
the actual private recognized utterances and source WAV. The script's
own per-prefix checks are not a substitute for all older known cases.

### Review guidance / not an acceptance decision

The sample flagged as C2 #76 **should** be the primary experimental
quarantine. Verify numerically whether the experimental run no longer
displays the conspicuous loop while also preserving C2 #77's plausible
continuation. **If output shrinks, that alone cannot count as an
accuracy gain.** Inspect any newly divergent indices, not just the
final word count.

C1 #30's candidate-loss risk may remain unchanged because the
quarantine policy intentionally targets only strong lexical loops.
The in-memory ledger indicates later lexical support, never actual
audible validity. The ledger could miss words, match quotations, or
match already retained words; it does **not** yet implement verified
recovery.

C1 #120 should continue to correct its three-word draft. If the
experiment diverges there for reasons unrelated to prior quarantined
inputs, it is a negative signal.

The experiment's changed `stable_delta` cannot be deployed to the
live interface casually: stable text is **append-only** and the old
browser contract cannot retract emitted words. Before any production
replacement, require source-audio-grounded evaluation and a newly
defined transition policy if live stable text might change.

Do not declare P1 accepted until a competent Russian listener (or an
independently validated reference) resolves crucial true-speech
ambiguities, including C1 #30; independent ASR agreement is not WER.

## Out of scope

- No changes to `apps/web/transcript.js`, BrowserAsrSession,
  site UX, provider settings, models, encryption or deployment.
- No P2 long-duration recording, browser playback or recovery.
- P0 PR #14 raw window IndexedDB/Safari acceptance remains separate.
- No publication of actual C1/C2 classroom transcripts or the
  previously disclosed temporary Alibaba API key.

See [Issue #16](https://github.com/Ran-ying/ru-class/issues/16) for
the anonymized evidence chronology and unresolved admission criteria.
