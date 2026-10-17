# P1 M4: reconstructed C1 + C2 focus-only re-inference (operator report, 2026-10-17)

**Status:** `ORIGINAL_WINDOW_PROVENANCE_BLOCKED` ·
`C1_POLICY_RECONSTRUCTION_VALIDATED` · `C2_FULL_WINDOWS_BLOCKED` ·
`NEW_227_WINDOW_REAL_INFERENCE_NOT_RUN` ·
`CAPTION_REDUCER_REGRESSION_NOT_RUN` ·
`SPEECH_ACCURACY_UNVERIFIED`.

**Evidence class:** Private Mac mini DeepSeekHarness numerical report supplied by
the project owner, **not** raw private recording or caches independently replayed
by GitHub CI or this repository maintainer. All audio, original transcripts,
local paths, tokens and raw per-window results stayed on the owner's Mac.
This report does **not** authorize enabling Draft PR #25.

## Hardware / ASR

- Operator M4, 16 GiB, macOS 26.5.2, Node 24.7.0.
- ASR revision `851a03115474865f09b6e7d8f5e82bba4697ec57`,
  whisper.cpp `0c7be696371069e0baa2515ed7aa08d5a5473aa6`.
- Multilingual small SHA-256:
  `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.
- Both `temperatureInc=0` (old) and `0.2` (new) used small weights,
  `temperature=0`, 30 s Node timeout, local private config copies,
  no production config mutation and no repo-default update.
- 10 fresh reported physical M4 Metal engine starts; 256/256 successful
  **local** serial ASR HTTP requests (128 old + 128 new), zero normal-path
  429/5xx/timeout. No Safari/Chrome, live microphone or HTTPS endurance
  acceptance was performed in this experiment.

## Provenance boundary (hard gate)

Original private converted C1/C2 JSON caches with historical SHA-256
`e09920d62fa6d74295aa7729c4648e918b53466d06cb53f54170f82a88f5db08`
(C1, 121 windows) and
`d0bd6abac8f71193b7bf695b90d39b669dbeecc0728a3d346f078d7ca92afc19`
(C2, 106 windows) were **not located on the Mac mini**.

- **C1:** The operator reconstructed 121 source windows from the available
  private 121.855-second 16-kHz mono PCM recording under the *public*
  browser scheduler policy: 8-second ring, first request around 2.0 s,
  subsequent 1.0 s cadence, final flush. The old small/0 inference
  reproduced C1 #30 = three tokens, #120 = fifteen tokens, zero extreme
  lexical loops, and a final 829-word baseline versus historical
  approximate 828. This is `C1_POLICY_RECONSTRUCTION_VALIDATED` only.
  It does **not** prove byte-identical audio windows, original timing,
  identical `final` flags or exact historical cached ASR output.
- **C2:** The exact 106 original realtime
  `window_start_sample`, `window_end_sample`, `final`, request
  ordering and per-window scheduling were unavailable. Only authenticated
  C2 #76/#77 consecutive focus windows and a small set of independent
  offset/focus samples were used. A new fabricated 106-window sequence
  would **not** be a legitimate historical C2 replay. No full C2 session
  or full 227-window claim follows from these partial tests.
- The available private source recording is one local clip, not separately
  independently verified C1 and C2 WAV source files.

## Reconstructed C1: model change, not reducer change

All 121 C1 source-policy windows were sequentially inferred in each
model decoding mode and fed to both the unchanged production
`TranscriptBuffer` and Draft PR #25 `LoopQuarantineTranscript`.

| C1 metric | small/0 | small/0.2 |
| --- | ---: | ---: |
| Inference requests | 121/121 | 121/121 |
| Actual fallback events (p/h) | 0/0 | 24/0 |
| Request mean | 338.8 ms | 388.0 ms |
| Request p50 | 352.1 ms | 369.4 ms |
| Request p95 | 435.3 ms | 548.2 ms |
| Request max | 469.2 ms | 1607.0 ms |
| Lexical extreme-loop windows | 0 | 0 |
| Production reducer final words | **829** | **971** |
| Raw C1 #30 tokens | 3 | **22** |
| Raw C1 #120 tokens | 15 | 15 |
| Old→new visible-projection differences | — | **111/121** |
| Old→new stable-delta differences | — | **20/121** |

For **either** C1 old or new input, PR #25 quarantined **zero**
windows, changed **zero** visible projections / stable deltas and
produced the same final word count as the unchanged production reducer.
The 829→971 (+142) final-token increase and changes in visible captions
are attributable to the *different ASR hypotheses*, not the lexical
guard. These differences **do not establish that any additional words
were actually spoken** and do not prove lower WER. The final C1 #120
hypothesis still had 15 tokens; reported final-facing wording could
differ without a change in stable delta.

## C2 focus only: #76/#77 and independent offsets

For the exact consecutive #76/#77 pair:

| Metric | small/0 | small/0.2 |
| --- | ---: | ---: |
| #76 words / unique / maximum repeated trigram | **164 / 7 / 53** | **13 / 12 / 1** |
| #77 words / unique / maximum repeated trigram | 20 / 17 / 1 | 20 / 17 / 1 |
| Actual fallback events in pair | 0 | 1 |
| Baseline `TranscriptBuffer` subset final words | 184 | 27 |
| PR #25 guarded subset final words | **20** | **27** |
| Quarantine subset index | **0** (corresponding to historical #76) | none |

On old small/0, quarantine removed the #76 extreme loop and
left #77's normal 20-token hypothesis. On new small/0.2, the
model's own real fallback removed the extreme loop and **the guard did
not change this two-window output**. They are observationally
*substitutes for this particular anomaly*, not proof that the guard
has no value on other unseen inputs.

Another chronological **focus-offset subset** reported identical
67-word final output with and without the guard even though the
old version flagged its internal index 2 (historical #76). Thus final
count equality alone does not mean no source windows were quarantined.
The two C2 focus groups and the 24.5-second independent control are
**not** the original 106-window realtime stream and must never be
compared to historical C2 full-final counts (718/723 etc.).

The independent **24.5-second window** was 45 tokens / 6 unique /
8 repeated trigrams for both decoding policies, with zero actual
fallback, and yielded the same 38-word projected standalone output.
Its rate is 5.625 tokens/second, below PR #25's
**≥40 tokens AND ≥8 tokens/second** conservative gate, so no
quarantine is expected. This remains ambiguous without a reliable
acoustic reference.

## Reducer contracts and false positives

| Partial data | Old baseline / guard final words | New baseline / guard final words | Quarantine |
| --- | --- | --- | --- |
| Reconstructed C1 121 | 829 / 829 | 971 / 971 | none |
| C2 #76/#77 subset | 184 / 20 | 27 / 27 | old #76 only |
| C2 focus offsets | 67 / 67 | 67 / 67 | old #76 only |
| 24.5 s singleton | 38 / 38 | 38 / 38 | none |

The owner reports `first-stop / same-range / double-flush` = zero
violations / zero violations / false across each partial replay;
**128 authentic tested inputs per decoding configuration is NOT
the historical 227-prefix acceptance gate**. The original 45
altered-decoding same-range fixtures were unavailable and not rerun.

A synthetic deliberately repeated-phrase counterexample used two
disjoint eight-second windows each containing 120 repeated tokens.
The heuristic quarantined both, reducing 240→0. This is a
**demonstrated potential false-positive against genuine repeated
speech**, not proof that the real lecturer uttered those words.
Do not lower thresholds or deploy automatically.

## Engineering decision and next gate

1. **Keep PR #25 Draft / default OFF / unmerged.** On the new small/0.2
   input examined here, it added no benefit to C1 or C2 #76; its
   synthetic genuine-repeat false positive remains and 24.5 s
   blind spot is not addressed. Its value as an insurance layer for
   unseen extreme loops has not been established.
2. `small + temperatureInc=0.2` is a legitimate **private opt-in
   experiment**, but not a project default, browser rollout, word error
   reduction or proven spoken-word restoration. On reconstructed C1,
   **111 of 121 visible outputs** changed versus small/0 and
   24 fallbacks occurred. Preserve both old and new raw evidence and
   allow rollback before deciding.
3. Most valuable next work is **real-browser source evidence preservation**
   as implemented separately in **PR #14**, including Safari IndexedDB
   v1→v2 upgrade, two-tab blocking/versionchange, raw-hypothesis export,
   provider key absence, source sample range/final correctness and
   visible storage-failure handling. Do not merge PR #14 until that
   physical-browser gate passes.
4. A future independent real session can produce a new complete
   captured C2-style dataset; it will **not** recover old historical
   request timing. In that new dataset run the matched model and
   reducer comparisons using preserved authentic coordinates,
   original 45 fixtures *if independently recovered*, per-window
   append-only contracts, and realistic queueing/latency.
5. Do not demand human Russian listening; however retain
   `SPEECH_ACCURACY_UNVERIFIED`. Avoid longer P2 recording/playback
   features that have been explicitly deferred.

**Release/acceptance:** partial C1 reconstruction and focus-window
engineering checks passed according to the operator, **not** a
`NEW_227_WINDOW_REAL_INFERENCE_PASS` or
`CAPTION_REDUCER_REGRESSION_PASS`. No production settings,
defaults, published website, raw audio, original hypotheses, or API
credentials were changed by this documentation task.
