# P1 / M4: exact-source 44-window small/medium decoder comparison (2026-10-17)

**Evidence type:** owner-supplied DeepSeekHarness real physical Mac mini M4 numerical report, supplemented by an independent SHA-256 / WAV-format / JSON-structure check of the **previously attached** original files in this conversation. The *new per-model ASR output text and actual fallback log* were not available for independent replay here. This document reports the operator's numerical outcomes without putting original Russian transcripts, audio, API credentials, endpoint URLs or private file paths into Git.

**Outcome:** `SOURCE_WAV_MATCH_PASS` · `SAME_PCM_ASR_A_B_PASS` (operator) · `FULL_44_MODEL_REPLAY_PASS` (operator) · `P1_MECHANICAL_PASS` (operator) · `SPEECH_ACCURACY_UNVERIFIED`. **Neither model correctness nor semantic subtitle completeness is demonstrated.**

## Authenticated source and runtime

The original exported browser session contains **44 raw ASR windows**, one `final=true`, in `ru-class-asr-windows-v1` with 16-kHz source sample offsets. It references one **67.5093125-second**, **1,080,149-sample** mono PCM16 WAV. The JSON's last end sample equals the WAV frame count. WAV length was **2,160,342 bytes**, including its header.

| Source | SHA-256 (source evidence only; raw file never committed) |
|---|---|
| Private WAV | `1ef7f57a9a618244901072710002472c83f9e641758986c3c29aa51d28c0d721` |
| Private original 44-row JSON | `69376bd0abe69ada0b1a3a61e6d3ce660b887ec77ce0e8b3c7be1cb2e98de7ab` |

**Verification nuance:** A matching WAV/JSON format, checksums and times prove the supplied files are internally consistent with the operator's selected source; they cannot prove the exact audio spoken by a teacher or the MacBook's private ASR logs. The operator's exact-source re-inference at small/0.2 was reported **byte-identical in all 44 raw texts** to this private browser export, giving a strong reproducible *decoding-output* provenance link without exposing the texts.

- Physical engine: Mac mini M4 (16 GiB), macOS 26.5.2, Node 24.7.0.
- ASR main `851a03115474865f09b6e7d8f5e82bba4697ec57`; whisper.cpp `0c7be696371069e0baa2515ed7aa08d5a5473aa6`.
- Multilingual small GGML SHA256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.
- Multilingual medium GGML SHA256 `6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208`.
- Original 44 exported **[start,end)** sample ranges and `final` flags were reused exactly in each replay, not reconstructed with a new fixed cadence. `temperature=0`; only `temperatureInc` changes within the same small-model test. Medium comparison changes model weight as specified. Private test configuration, no live service/default change and no `WHISPER_*` environment overrides. Medium had a 90s request timeout; the measured latency is not a proposal to permit 90s browser stalls.

## Matched full 44-window runs

The operator inferred **44/44 HTTP 200** with every configuration and ran the same unchanged `TranscriptBuffer` mechanical replay for each sequence, including every stop prefix, same-range idempotence, plain vs duplicate-injected outputs and double-flush.

| Configuration | exact match to original export | Fallback p/h | Mean / P95 / max request latency (ms) | Final projected words | Unanchored replacement events | Tentative candidate tokens |
|---|---:|---:|---:|---:|---:|---:|
| Browser-supplied original export | itself | MacBook server log unavailable | browser-observed only | **174** | **14** | **73** |
| **Small, inc=0** | 17/44 | **0 / 0** | **307.9 / 406.9 / 435.0** | 152 | 12 | 59 |
| **Small, inc=0.2** | **44/44** | **29 / 0** | **457.8 / 1314.6 / 1602.5** | **174** | **14** | **73** |
| **Medium, inc=0.2** | 1/44 | **23 / 2** | **1338.1 / 4289.7 / 7464.4** | 144 | 10 | 22 |

- All tested *mechanical contracts* passed, with **zero** same-range, first-stop and plain/duplicate-injected mismatches, and idempotent double-flush. The original raw export had the same **14 / 73 / 174** metrics and replacement index sequence as fresh small/0.2.
- The original browser export is, with high operator-reported operational evidence, **small/0.2**, not a small/0 baseline. The small/0 result (12 / 59 / 152) is a newly inferred comparison, **not** a claim about a past user session.
- **Small/0.2 increased candidate-replacement signals** (14 vs 12, 73 vs 59 tokens) compared with small/0. It also increased final displayed-word count (174 vs 152). These quantities neither establish recovered words nor prove error.
- **Medium/0.2 reduced replacement indicators** (10 / 22), but also reduced final output to 144 words and had substantially higher latency. No verified reference speech transcript exists to pick an accuracy winner or claim medium is superior.
- Original MacBook-observed latency also includes browser-to-ASR network/request/response costs and should not be equated to local M4 `whisper-server` inference times. A 4.29s p95 medium run is not a demonstrated fit for a 1-second nominal request cadence.

The exact zero-based trigger indices are:
- Original and small/0.2: `6, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 37`.
- Small/0: `4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 26, 37`.
- Medium/0.2: `4, 8, 11, 12, 13, 14, 15, 25, 26, 27`.

These reflect different ASR texts going into the **same** caption algorithm; changed indices, shorter word count or fewer replacement events cannot by themselves determine which words actually occurred.

## Authentic four focus pairs

All sample ranges are `sample_rate=16000` and come from the original exported 44 windows. Model runs used identical source PCM16 slices:

| Source window → successor (0-based) | Small/0 source→next (tokens; fallback; lexical sim) | Small/0.2 source→next | Medium/0.2 source→next |
|---|---|---|---|
| **5→6** (3–11 s / 5–13 s) | 18→15; 0/0; .222 | 19→18; 1/1; .105 | 20→9; 1/1; .100 |
| **27→28** (35–43 s / 38–46 s) | 8→11; 0/0; .000 | 11→11; 1/0; .000 | 14→12; 0/0; .000 |
| **9→10** (12–20 s / 14–22 s) | 9→3; 0/0; .111 | 8→1; 1/1; .125 | 8→6; 0/1; .000 |
| **23→24** (30–38 s / 32–40 s) | 19→2; 0/0; .000 | 7→3; 1/1; .000 | 4→2; 1/1; .000 |

The per-pair `sim` figures are *normalized Levenshtein similarity of the ASR hypotheses*, not acoustic word alignment or truthful lexical preservation. Across the eight original focus positions the mean old/new comparison similarities were **.3985** (small/0 vs small/0.2), **.1461** (small/0 vs medium/0.2) and **.1862** (small/0.2 vs medium/0.2). All focus windows had maximum repeated trigram counts of **0–2**, not extreme loops. Operator focus-only latencies: mean/P95/max in ms were **313.9 / 376.3 / 379.7** for small/0, **576.7 / 1259.0 / 1606.8** for small/0.2, **1486.7 / 3396.3 / 4352.9** for medium/0.2.

## Engineering interpretation and next gate

1. **Decoding-output provenance is now strong on this one real session.** The browser 14 / 73 / 174 baseline is exactly reproducible under small/0.2 in this controlled engine. However the *export JSON itself contains no model weight/revision, decoder setting or ASR deployment proof*. Extend the browser-local evidence provenance/completeness scheme only with **honestly observable** metadata: model ID as selected in the UI, app version, source sample rate, stable audio fingerprint, journal save-failure/incompleteness signal. Never pretend the frontend can attest the server's actual `temperatureInc` without authenticated server metadata.
2. Three full 44-window **mechanical regressions passed** without any new `TranscriptBuffer` heuristic. Leave the live stable/draft reducer unchanged. Lexical candidate churn remains ambiguous: no positive evidence that arbitrary removal or reinsertion of the 73 candidate tokens would recover real speech. Don't revive PR #13 or enable PR #25 (known synthetic genuine-repeat false-positive risk).
3. Preserve raw hypotheses, run authentic new-session Safari IndexedDB migration/multi-tab/storage-failure tests in [Issue #28](https://github.com/Ran-ying/ru-class/issues/28), and make evidence completeness auditable. Future proposed changes to caption assembly should be separate, offline, non-destructive A/B branches with per-prefix consistency, including genuinely repeated speech counterexamples.
4. The small/0.2 optional local experiment is **not proven optimal speech recognition**; do not flip the repo default or local owner's active config. Medium isn't a justified real-time upgrade on this evidence. Postpone another temperature increment sweep until additional independent audio supplies new uncertainty.
5. The old historical C2 106-window timing and original 45 fixtures remain missing. New verified 44-window source evidence cannot retrospectively restore them. `SPEECH_ACCURACY_UNVERIFIED`.

**No original WAV, Russian hypothesis text, API key, private browser path or speaker identity is included.**
