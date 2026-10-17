# P1 — Independent Russian ASR cross-check (Mac, private-only)

**Status 2026-10-17: workflow and synthetic tests added; actual Qwen3
inference on the user's Mac is pending.** Do not report that a second
ASR model has successfully recognized C1/C2 unless the real local
run produces a private report.

## Why a second ASR family?

The current RU-Class transcription model is Whisper small and the live
subtitle reducer can conflate repeated spoken text. Previously captured
C1 #30, C2 #77 and C1 #120 have uncertain changes. The local numerical
waveform audit cannot understand Russian. Re-running *the same* Whisper
model is not an independent check.

This experiment uses **Qwen3-ASR**, a separate model family, via
the community's Apple Silicon MLX runtime. The official Qwen3-ASR
supports Russian, and the MLX project supports an explicit local
model directory and reusable Session object:

- [Official Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)
- [Apple Silicon MLX Qwen3-ASR](https://github.com/moona3k/mlx-qwen3-asr)

No RU-Class production API or website settings change. Unlike the
old ASR API, this is a standalone offline diagnostic and is **not**
a new live provider by default.

## 1. Prepare the model on your own Mac

Use a Mac with Apple Silicon (M1/M4) and Python 3.10+.
Download *public model weights only* before running the private script.
One lower-memory option is a 0.6B 4-bit model (~517 MB weights,
actual runtime memory may be higher).

```sh
cd /path/to/RU-Class
python3 -m venv .venv-p1-qwen
source .venv-p1-qwen/bin/activate
python3 -m pip install -U pip
python3 -m pip install 'mlx-qwen3-asr>=0.4.3' 'huggingface_hub[cli]'

mkdir -p "$HOME/Models/qwen3-asr-0.6b-4bit"
hf download moona3k/mlx-qwen3-asr-0.6b-4bit \
  --local-dir "$HOME/Models/qwen3-asr-0.6b-4bit"
```

Check that the local model directory has a `config.json`. Do not
substitute a URL for `--model-dir`. If network access to the model
registry is unavailable, transfer already-downloaded model **weights**
from another trusted Mac; never upload classroom audio to solve this.

## 2. Run input-only validation first

The previously generated C1/C2 private directory must contain
`c1-targeted-private/review-0030.wav`, `review-0120.wav`,
their `-private.json` evidence, and
`c2-targeted-private/review-0077.wav` and `-private.json`.

```sh
python3 scripts/cross-validate-private-asr.py \
  --private-root /absolute/path/to/p1-private-audio-audit/private \
  --dry-run
```

This checks WAV format, the original 16-kHz course-sample coordinates,
focus window boundaries, and JSON linkage for all three cases.
**A dry-run does not recognize audio** and prints an explicit
`VALIDATED_INPUT_ONLY` status.

## 3. Run a new independent local hypothesis

```sh
python3 scripts/cross-validate-private-asr.py \
  --private-root /absolute/path/to/p1-private-audio-audit/private \
  --model-dir "$HOME/Models/qwen3-asr-0.6b-4bit" \
  --output-dir /absolute/path/to/a-new-private-qwen-report-directory
```

The output directory **must not exist** and will be created with
owner-only mode 0700; `cross-asr-private.json` has mode 0600.

The script loads a single pre-downloaded model, sets HF Hub /
Transformers offline mode before import, and performs **six** local
inferences: (a) the full contextual 12s/10s clip and (b) the
*same focused 8-second course-window* Whisper was asked to decode,
for all three cases. It preserves absolute sample coordinates,
SHA-256 of each WAV, the untouched original Whisper candidates,
independent Qwen hypotheses, decoding finish reasons, and lexical
similarity metrics. It never re-runs Whisper.

The terminal prints **only counts and similarity measurements**;
recognized speech and personal local paths are saved solely to
the new private JSON. The runner makes no intentional network calls
and does not send audio to an external API. Do **not** commit, paste,
share or attach this JSON to public issues, Actions or logs.

If a model download is attempted during the private inference,
offline loading will reject it. Do not disable offline flags.

## 4. Classify evidence without over-claiming

Inspect the local `cross-asr-private.json`, listening **only if
someone understands the language**. A second model is *not* audio
ground truth. Even perfect Qwen/Whisper agreement may be a correlated
error; disagreement does not prove a reducer defect.

| Case | Narrow check |
| --- | --- |
| C1 #30 | Compare independently recovered payment discussion against original candidate, next windows and final visible text; possible missing speech versus ASR correction |
| C2 #77 | See whether a separate model produces a plausible normal sentence instead of the 164-token/7-unique-token Whisper loop from window #76 |
| C1 #120 | Compare corrected final phrase to other output; distinguish an actual new phrase from ending transcription differences |

Classify each `INDETERMINATE` until there is supported real-audio
evidence. Report **which output is a hypothesis**, not which is
definitively what the teacher said. A qualified Russian listener is
still best for any disputed spoken words.

If investigating real repetitions, word-level timestamps require an
*additional* forced-aligner model and separate verification. This
script does **not** generate verified word timings and must not
invent them from character positions or energy.

## 5. Acceptance and isolation

- The existing 45 same-sample replay and 227 stop-prefix gates stay in
  place for any future reducer change. C1 has 121 windows, C2 has 106.
- This runner does **not** change `transcript.js`, the ASR service,
  subtitle output, production model selection, raw window journals or
  P2 recording/replay/recovery.
- PR #14 Safari IndexedDB migration/export acceptance is independent.
- GitHub CI uses a **fake Qwen Session and synthetic WAV only**.
  CI passing verifies the local workflow's data integrity and privacy
  boundaries; it cannot prove the model is installed, Russian words are
  accurate, the Mac has enough RAM, or human review happened.
- Issue #16 remains open until private evidence and speech-level
  accuracy decisions justify a separate experimentally measured reducer.

The first completed local run should yield a sanitised summary of
`MODEL_CROSS_CHECK_EXECUTED_NOT_HUMAN_VERIFIED`, per-case word
similarities and a separately stored private file; that is progress,
**not** an approved classroom transcript.
