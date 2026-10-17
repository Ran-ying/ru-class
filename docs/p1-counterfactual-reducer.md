# P1 experimental subtitle reducer: isolated counterfactual replay

**State: EXPERIMENT ONLY — never loaded by the website. Do not merge this
experimental branch into production before evaluating the genuine private
C1/C2 recordings and an audio-grounded correction reference.**

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
