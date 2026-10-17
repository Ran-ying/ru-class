# P1: Real second-model evidence and shadow risk screening (2026-10-17)

## Verified-by-operator report, not speech ground truth

On 2026-10-17, Codex on the user's Mac reported **6/6 successful**
**real** Beijing-region Qwen3-ASR-Flash API requests (three matched
8-second focus windows and three corresponding 10/12-second context
clips). All six returned model `qwen3-asr-flash`, language `ru`, and
`finish_reason=stop`. No new Whisper calls were made.

The private report and actual Russian hypotheses remain on the user's
Mac; only the **derived statistics** below can appear in public GitHub.

| Private focus | Original Whisper focus | Independent Qwen 8s / context | Qwen focus/context lexical similarity to Whisper focus | Reasoned risk (NOT a listener-verified conclusion) |
| --- | ---: | ---: | --- | --- |
| C1 #30 | 3 words | 18 / 35 words | 0 / 0 | Prior displaced 25-word candidate shares 0.651 lexical similarity, including six consecutive words, with Qwen focus. Whisper window #32 still shares 0.700 with Qwen: some content may be retained later; **possible lost/misplaced draft, not proof of 25 lost words** |
| C2 #77 | 20 words | 17 / 25 words | 0.5946 / 0.6222 | *Previous window #76* has 164 tokens, only seven unique, top repeated 3-gram 53 times. Qwen similarity to that loop 0.011: **strong inference-iteration anomaly indication**, not 151 missing words |
| C1 #120 | 15 words | 15 / 16 words | 0.8667 / 0.7742 | Final hypothesis shares 11 contiguous words with Qwen focus, whereas overwritten three-word draft shares only 0.111. This supports a **normal ASR correction**, not blanket preservation of old drafts |

The source report additionally noted a distinct visible-text tally of C1
#30 changing 227→205 versus 219→197 in an earlier replay. Both reflect
a 22-word change; different trace scopes and metrics must not be silently
substituted for one another.

**Human listening is still unperformed**. Every focus remains
`HUMAN_AUDIO_LISTENING_PENDING`, and the overall P1 classroom accuracy
gate is `NOT_ACCEPTED`. Model agreement, lexical similarity and short
8-second recordings do not yield reliable word-level timing, a reference
transcript, or WER. An ASR error is not automatically a reducer error.

## Shadow-only, privacy-safe next experiment

Run the *already captured* private C1 and C2 window JSON (no audio upload,
model inference, network, or production/browser changes):

```sh
node scripts/inspect-private-caption-risks.mjs /private/path/C1-fixed-windows-converted.json
node scripts/inspect-private-caption-risks.mjs /private/path/C2-realtime-converted.json
```

The CLI uses the existing production `TranscriptBuffer` solely for
diagnostics and never exports a hypothesis string. Output includes:

- Window **indices** plus original audio sample ranges when a raw
  hypothesis triggers a **lexical loop risk**.
- Per-window indices and numeric tokens for an **unanchored candidate
  overwrite** already counted by the unmodified reducer.
- Aggregate counts and precise heuristic criteria, never the audio,
  lexical tokens, API Key or private paths.

A lexical-loop risk is flagged **only when all four** independently
motivated synthetic heuristics hold:

1. At least 40 normalized tokens.
2. At least 8 normalized tokens/second of audio.
3. No more than 25% unique normalized tokens.
4. At least one normalized three-word sequence appearing 8+ times.

These values are intentionally conservative and **not empirically
calibrated**. A real teacher can repeat words; Whisper may hallucinate
under low-volume noise; code cannot decide which without real audio.
A C2 #76-like synthetic 164-token/7-unique case is a clear candidate;
a normal eight-token repetitive utterance is **not** flagged. The
existing C1 #30-style no-anchor replacement signal is recorded
independently. **Neither signal deletes, freezes, inserts, or revises
a displayed word**.

The mere existence of `C1 #120`-style candidate replacement must not
prevent legitimate final correction. Accordingly, the proposed next
stage is to compare *separate experimental caption reducers*, using a
proper audio-time/source-evidence ledger rather than blanket
lexical-duplication elimination. Do not ship any experimental policy
before replaying 121 C1 + 106 C2 windows, 45 known same-sample replay
cases, all 227 stop prefixes, and a genuine speech-grounded quality
comparison.

## Experimental design constraints

- The live reducer's `stable_delta` is append-only; changing the
  already emitted stable text is incompatible with the current browser
  contract. A shadow suggestion is not permission to rewrite stable.
- Distinguish **same source sample interval** replay from overlapping
  rolling windows and from two actual repeated utterances.
- Preserve every raw ASR window as optional local evidence: PR #14
  IndexedDB migration/export still requires real Safari acceptance.
- Do not accept new heuristics merely because final word count drops
  or the raw lexical loop no longer displays: word loss and model
  hallucination must be counted separately.
- Keep false-positive rates explicit: real repeated speech may resemble
  a lexical decoding loop; unresolved cases remain uncertain.
- P2 extended recordings, playback and interrupted recovery stay out
  of scope.

## Data security

The operator temporarily used a Beijing pay-as-you-go ASR Key for these
six calls and has reported that the process environment was cleared.
The full secret was previously pasted into a conversation: **revoke or
rotate it and review Alibaba billing/call logs**. Never put credentials,
actual Russian text, original recordings or private reports in GitHub
commits, Issues, CI artifacts or logs.

See [Issue #16](https://github.com/Ran-ying/ru-class/issues/16) for
the chronological anonymized evidence and P1 unresolved admission gate.
