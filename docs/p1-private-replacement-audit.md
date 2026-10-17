# P1 numeric audit of unstable raw ASR candidates

This **strictly offline, read-only** tool locates the source window and
the later window that triggers each existing
`TranscriptBuffer.unanchoredReplacementCount` increment. It is for
**diagnostics only**; it never changes the production browser
`TranscriptBuffer` algorithm or uses a model, microphone or network.

## Running on a user's private window export

```sh
node scripts/replay-browser-transcript.mjs /private/lesson-asr-windows.json
node scripts/audit-private-replacements.mjs /private/lesson-asr-windows.json
```

Input is either an array of windows or
`{ "format": "ru-class-asr-windows-v1", "sample_rate": 16000, "windows": [...] }`
(or JSONL). Each window needs recognized text and its actual
`window_start_sample`, `window_end_sample` (16-kHz source sample
positions), plus an optional `final`. The original exported JSON
**stays local**; never commit or paste the unredacted file into
public GitHub comments or CI.

The second command outputs **only JSON numerical data**, such as:

```json
{
  "format": "ru-class-numeric-unanchored-audit-v1",
  "inputWindows": 3,
  "finalWordCount": 6,
  "ambiguousCandidateReplacements": 1,
  "ambiguousCandidateTokens": 3,
  "events": [
    {
      "replacingWindowIndex": 2,
      "replacingWindowStartSample": 32000,
      "replacingWindowEndSample": 160000,
      "candidateSourceWindowIndex": 1,
      "candidateSourceStartSample": 16000,
      "candidateSourceEndSample": 144000,
      "candidateTokens": 3,
      "finalLexicalMultisetMatches": 0,
      "longestContiguousFinalMatch": 0,
      "longestContiguousLaterRawMatch": 0
    }
  ]
}
```

(The example is a fully synthetic English fixture; no classroom text
is included.) **Indices are 0-based**. Divide sample coordinates by
16,000 for seconds. The source index is inferred by tracking the
identity of the current **tentative/unanchored** hypothesis across
reducer updates; the trigger is the later window at which an existing
replacement counter increments. These are source *window* boundaries,
**not word timestamps**.

The three lexical metrics count only weak text matches:

- `finalLexicalMultisetMatches`: candidate keys also appearing in
  the final assembled text with frequency limits.
- `longestContiguousFinalMatch`: longest consecutive candidate key
  sequence found anywhere in the final displayed text.
- `longestContiguousLaterRawMatch`: longest consecutive candidate
  key sequence in **any single raw window after the replacement**.

These numbers are **neither confirmed spoken words retained nor
confirmed lost words**. A repeated common token can match a different
spoken occurrence; the same utterance can be decoded with entirely
different words, especially technical Russian vocabulary. A zero
lexical match does not prove an omission, and a positive match does
not prove preservation of an audio source. Comparing
`finalLexicalMultisetMatches` across events and adding it up can
double-count final words: events are not disjoint.

No transcribed strings, token identities, user file paths, audio,
keys or URLs are printed even on invalid input. The local tool may
**read** actual private text in memory, so run it only in a trusted
local environment. The output is appropriate for a numerical bug
report after reviewing that sample indices are not themselves
sensitive.

## Acceptance and engineering boundary

- Compare summary counts to existing
  `scripts/replay-browser-transcript.mjs` on the *same* authentic
  exported input: event count, candidate token count and final word
  count must match.
- The numeric tool must report real source sample ranges for each
  event without altering or replay-injecting an ASR window into the
  live reducer.
- A synthetic genuinely repeated phrase can be confused with a
  rewrite: do **not** drop, freeze or reinsert text because it
  matches these diagnostic counters.
- The new short real user recording does **not** retroactively
  restore historical C2 window timing or count as the old 227-window
  acceptance. RU-Class [Issue #28](https://github.com/Ran-ying/ru-class/issues/28)
  tracks real Safari raw-window capture/export acceptance and
  [Issue #16](https://github.com/Ran-ying/ru-class/issues/16)
  tracks P1 assembly limitations. PR #25 lexical quarantine remains
  Draft/OFF/unmerged and `SPEECH_ACCURACY_UNVERIFIED`.
