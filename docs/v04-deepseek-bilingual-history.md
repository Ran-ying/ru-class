# RU-Class v0.4.0 — DeepSeek-compatible sentence correction and bilingual history

**Status (2026-10-18):** delivered to `main` and CI passing; actual Safari and real-provider end-to-end verification remains open in [Issue #47](https://github.com/Ran-ying/ru-class/issues/47).

## Scope

The v0.4 milestone in PROJECT_SPEC.md explicitly requires **DeepSeek text-model configuration, serialized setTimeout requests for segmentation / Russian correction / formal Chinese translation, and a persistent upper RU/ZH history**. v0.5 is the separate, higher-frequency *bottom RU/ZH live draft translation*. This implementation stays browser-direct: each user selects an OpenAI-compatible text model with an HTTPS/CORS-capable /v1 base URL, model ID, and private Token under Settings. The public RU-Class static server does not receive classroom text or credentials. Calling a configured provider sends confirmed Russian source fragments to **that provider**; the provider may charge for tokens. Configuring only speech ASR keeps all transcription working without any translated history.

## Data contract / model safety

Existing LocalAgreement `stable_delta` emits source units tagged with a recording UUID, classroom UUID, and confirmation-window sample position. The v0.3 `StableUnitJournal.ready()` only returns text at least **8 seconds after its confirmation window end**, or remaining final-flush stable units. `partial_text` is never sent.

A single `SentenceWorker` runs at most one HTTP POST to `/chat/completions` at a time using recursive `setTimeout`, never `setInterval`. The body uses a system prompt with the source fragments and asks the model to return an exact JSON object:

```json
{
  "consumed_units": 2,
  "source_prefix": "exact original first two stable fragments joined by spaces",
  "sentences": [
    {"ru": "punctuated / corrected Russian sentence", "zh": "简体中文正式翻译"}
  ]
}
```

The app **rejects** a response unless `source_prefix` is a byte-for-byte prefix comprising the first `consumed_units` **whole** stable units. It accepts multiple RU/ZH sentences or an empty response with `consumed_units:0` and no sentences. This is a structural origin check, **not a semantic correctness guarantee**: the model may still hallucinate or translate incorrectly. Russian transcription/Whisper raw hypotheses remain immutable. Pending unprocessed text stays visible below, and processing errors do not block microphone capture or RU subtitles.

All accepted sentences from a response are saved as one local IndexedDB **v5** transaction in a separate `sentences` object store keyed by `[recordingId,index]`. Only after a durable store commit does the browser acknowledge source-unit consumption and append formal RU/ZH sentences to the *selected classroom's* upper history. A same-day classroom's multiple Start/Stop recordings appear together in chronological order, but retain independent recording UUIDs, audio ranges and source ASR evidence. Existing v1–v4 data is not rewritten. Non-translated source text remains accessible and is never deleted.

## Staleness / failures / limitations

- Closing the page, switching sessions or microphone failure cancels the old worker; in-flight responses after cancellation cannot be added to the new session.
- Timeouts / 4xx / 5xx / malformed model JSON / invalid prefix trigger a visible nonfatal status. No source units are acknowledged on failure, so the original RU is retained.
- The current background worker is **per active recording**. Stopping a recording triggers a final drain asynchronously; starting a fresh one cancels the prior worker. Untranslated remainder stays as original RU; a user can manually retry still-unconsumed stable source in a normally completed recording, using the course manager.
- Short stable fragments are not necessarily complete sentences. Empty model responses are allowed and should not cause an expensive tight polling loop; new confirmed units unlock another attempt.
- This version does **not** produce live Chinese for the lower draft RU buffer: that is v0.5. It does not provide exact word-level timestamps or whole-class audio concatenation.
- The project cannot claim a real provider call, semantic translation correctness, real MacBook Safari acceptance, cost or end-to-end latency from synthetic CI.

## Manual recovery of a completed recording

The first implementation's final asynchronous DeepSeek drain could be
canceled by immediately starting a new recording or closing Safari.
Its untranslated Russian is still preserved as `stableUnits[]`, but
that alone did not permit safe continuation of the exact recording.
The new **explicit**, per-recording `恢复未完成翻译` action in
**课程管理** restores progress from browser-local `stableUnits[]`
and already committed `sentences` rows:

1. Accept only a recording with `outcome === 'completed'`, a valid
   source-unit ledger and a stable recording/classroom ID. A real
   interruption or legacy recording without stable units cannot be
   treated as verified final audio.
2. Verify the saved sentence batches' `consumedUnitIds` against
   the **ordered exact prefix** of the recording's distinct source
   unit IDs. Multiple sentences from the same reply share one
   consumed prefix. Do not compare by Russian surface text:
   genuinely repeated phrases may be identical yet independent.
3. Rehydrate the journal's acknowledged IDs and the next sentence
   index; if none remain, **do not make any network request**.
   Otherwise run one serial provider worker on the remaining
   finalized units, saving new bilingual rows only after validation.
4. Remain opt-in. Opening the page or course manager does not
   automatically call a potentially billable API. A new recording
   can still cancel an in-flight previous-session request; the
   user can repeat the explicit recovery later.

This is **at-least-once processing with durable local deduplication**
at the unit-ID level, **not guaranteed exactly-once provider billing**:
a provider could bill a request just before a client timeout or
browser close without delivering a response. The original Whisper
audio and hypotheses remain unchanged.

## Owner physical acceptance

On MacBook Safari, configure the **文字** model (your own HTTPS base URL + model + Token), then select a classroom and begin a Russian microphone recording. Observe the RU lower area remains live while the upper history gradually receives paired Russian and Chinese sentences, with at least an eight-second confirmation delay. During continuous speech, multiple sentences should append without replacing earlier rows. If the model returns no completed sentence, the lower original RU should remain visible. Stop while a fragment is unfinished, verify the final flush may enqueue one last model request, then reload and confirm bilingual history persists alongside the original audio and ASR JSON.

Test a model timeout or simulated offline state: the lower Russian captions must continue, and untranslated original text must remain recoverable. Manually retry a normally completed recording from the course manager; verify saved batches are not resent, repeated same-text units remain distinct, and interrupted sessions are ineligible. Synthetic unit/HTTP tests do **not** count as that physical acceptance.


## v0.4.0 Safari acceptance follow-up (2026-10-18)

- Settings header now has API 配置 / 关于 tabs, with the close button aligned to the right. No user credentials are displayed on About.
- Display the already persisted RU/ZH pairs as **one aligned row per sentence** within each recording's chronological history group, not two unsynchronized columns of independent paragraphs. Pending raw ASR is separately disclosed and never presented as a completed translation.
- After a successful durable sentence batch commit and ACK, the acknowledged original stable prefix disappears promptly from the lower RU caption; tentative ASR stays. On history reload, the remaining raw suffix is reconstructed only from valid saved **unit IDs and source prefixes**. On uncertain metadata, preserve original raw text rather than drop it. A timeout does not ACK or delete source.
- The text-provider timeout is now 45 seconds for the full response body, and each request contains at most 8 confirmed units / approximately 1600 characters (unless one indivisible stable unit is longer). Timeout, CORS, billing and DeepSeek availability still require real Safari tests; this is not proof of successful provider operation.
