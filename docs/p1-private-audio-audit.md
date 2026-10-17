# P1 · Offline C1/C2 audio-evidence review (2026-10-17)

**Scope:** an offline, privacy-preserving diagnostic for the existing rolling
Whisper subtitle loss/repetition problem. This is **not** an ASR engine, a
speech recognizer, a full recording player, an accepted new caption algorithm,
or P2 recording/playback work.

The 2026-10-17 private Codex replay passed *non-regression* on main
`8ec4356` for all 121 C1 and 106 C2 windows, 45 known same-range retries,
and all 227 stop prefixes. It did **not** establish correct spoken-word
recovery. See [current-status.md](current-status.md) and Issue #16.

## Current confirmed ambiguity

The production text-only reducer sees **equal phrases** in overlapping
8-second windows and treats them as one utterance. Yet if phrase A was
spoken at 1–2 seconds and repeated at 10–11 seconds, the windows
`[0,8]` and `[4,12]` share only 4–8 seconds of *silence*. The same text
may indicate **two** speech episodes. In this synthetic case the reducer
outputs one copy. It was already defective before this audit and this
change does not silently alter live subtitles.

The audio audit examines two pieces of evidence together:

1. Lexical identity of adjacent overlapping original ASR hypotheses.
2. Whether the two **non-overlapping** portions of their audio windows
   have sustained sound activity, but their **shared** portion does not.

A match is called `acousticSeparationCandidate`, **not** `confirmedRepeat`.
RMS energy cannot identify speech, words, speaker identity, hallucinations,
or overlapping real voices. Room noise and microphones can generate false
positives or false negatives. Its frame is 20 ms; the minimum contiguous
activity is 80 ms above a configurable RMS amplitude threshold (default
0.02 ≈ -34 dBFS). There is **no automatic subtitle editing**.

## Mac local procedure

Requires Node.js >=22.6 and the **actual matching private 16kHz mono PCM16
WAV**. The raw window JSON can be the PR #14 export (`{windows:[...]}`),
the converted private C1/C2 replay arrays, or JSONL. If WAV and sample
indices use different timelines, **stop**: conversion or renumbering
without a verified sample mapping invalidates the comparison.

Run the numerical-only audit first:

```sh
node scripts/audit-private-audio.mjs \
  --wav /absolute/private/C1-source-16k.wav \
  --windows /absolute/private/C1-fixed-windows-converted.json

node scripts/audit-private-audio.mjs \
  --wav /absolute/private/C2-source-16k.wav \
  --windows /absolute/private/C2-realtime-converted.json
```

It prints the count and window indices of potential **acoustically separate
yet lexically equal** adjacent hypotheses, plus energy measurements.
No recognized text, absolute paths, full audio or tokens are written to
stdout. A result of zero **does not** establish correctness.

To prepare *private* clips and the neighboring original five hypotheses
for listening / audit (each output destination must be new and not already
exist; no data is overwritten):

```sh
node scripts/audit-private-audio.mjs \
  --wav /absolute/private/C1-source-16k.wav \
  --windows /absolute/private/C1-fixed-windows-converted.json \
  --indices 30,120 \
  --output-dir /absolute/private/new-c1-p1-review

node scripts/audit-private-audio.mjs \
  --wav /absolute/private/C2-source-16k.wav \
  --windows /absolute/private/C2-realtime-converted.json \
  --indices 77 \
  --output-dir /absolute/private/new-c2-p1-review
```

Each focused window yields a `review-00xx.wav` clip covering its actual
sample range plus up to 2 seconds on both sides (clamped at the recording
edges) and a `review-00xx-private.json` with ±2 neighboring raw hypotheses.
The private JSON also has the clip's start sample, to avoid silently
resetting the course timeline to zero. Destination directory mode is 0700,
files 0600. Never paste these files, their recognized text or source WAV
into a public PR, GitHub Actions artifact, CI output or public issue.

`--threshold 0.01` or `--threshold 0.04` provides an optional
sensitivity check for **the numerical-only** report. Do not interpret
a result that changes with a chosen threshold as conclusive speech evidence.

## Human classification: targeted three events first

| Source | Original window index | Time of concern | Distinguish |
| --- | ---: | --- | --- |
| C1 | 30 | 24–32 s | Was the previously visible 25-token candidate audible and later omitted, or a rejected ASR rendering? |
| C2 | 77 | 82.2–90.2 s | Is the 164-token/8-second ASR hypothesis a recognizer repetition loop/hallucination? Which actual words are audible? |
| C1 | 120 | Final | Did the three-token candidate represent final correction, speech omitted, or another hypothesis? |

For each, manually classify with actual WAV + before/after hypotheses +
final visible text:

- `ASR_CORRECTION`: the older hypothesis text was wrong; revised text
  better matches audible speech.
- `ASR_HALLUCINATION_OR_LOOP`: the recognizer inserted words or
  repeated text not present in the audio.
- `REAL_SPEECH_OMITTED`: audible words existed but were not present
  in final visible text; identify the **smallest supported audio interval**.
- `TRUE_REPEAT_COLLAPSED`: two audibly separate utterances were wrongly
  rendered only once.
- `INDETERMINATE`: insufficient audio clarity or time attribution.

Reviewers must quote neither individual spoken text nor personal voice
in public reports. Publish only index, anonymized category, result
confidence, counted errors where human-audited, and a clear note if
uncertain. The current 23+20 replacement events and 211+347 token counters
are **diagnostic signals, never a WER or proven word-loss count**.

## Required admission before algorithm changes

1. Preserve the independently verified exact C1/C2 source SHA256 digests
   and sample positions. No inference refresh or generation of missing
   windows during the test.
2. Save and inspect the *private* audio/hypothesis comparison for all
   three prioritized indices. Additional suspicious pairs can be reviewed
   from the numerical report.
3. Build a separate candidate reducer only with independently grounded
   evidence; keep the original live reducer untouched until comparison.
4. Run the existing 45 known retry counterexamples, 227 stop prefixes and
   full C1/C2 window-by-window diff on the candidate. A word-count decrease
   is not automatically an improvement.
5. Do not merge PR #14 without its separate real Safari IndexedDB migration,
   export and storage-failure review. P2 stays deferred.

### Tool limitations and safety

- Only **16kHz mono PCM16 RIFF WAV**, with matching ASR sample coordinates,
  is accepted. The reader parses RIFF chunks and reads bounded regions;
  no resampling, transcription, outbound network or persistent server state.
- Adjacent-window **exact normalized text equality** is a deliberately
  narrow search: near-matches or nonadjacent windows are not covered.
- RMS energy is a reproducible physics-inspired heuristic, **not VAD
  accuracy validation or forced alignment**. No source data is modified.
- The CLI prints only structured numerical metadata. A user-specified
  *private* output directory intentionally stores snippets and raw text;
  this is sensitive source material and must never be committed.

Automated synthetic tests mark the known two-utterance false-dedup
counterexample as a **failing `test.todo`**, not a correctness PASS; they
also cover an acoustic-separation case, a shared-activity negative
case, redaction of CLI output, local excerpt integrity and malformed
inputs. Synthetic passing does **not** count as physical C1/C2 listening.
