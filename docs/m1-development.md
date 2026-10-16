# M1 development integration · v0.1

Date: 2026-10-16. User direction: develop on the current M1 now; perform Mac mini M4 formal acceptance later. M4 availability does not block this development delivery.

## Actual environment and method

- MacBook Air, Apple M1, 8 GB RAM, macOS 27.0, arm64; Node.js v25.9.0, npm 11.12.1, CMake 4.4.4.
- Official whisper.cpp **1.9.5-dev**, commit `0c7be696371069e0baa2515ed7aa08d5a5473aa6`, built with `GGML_METAL=ON` and Apple Clang 21. Model: multilingual **small**, 487,601,967 bytes; publisher SHA-256 verified as `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.
- Actual startup logs report `whisper_backend_init_gpu: using MTL0 backend` and `ggml_metal_init: found device: Apple M1`; see [redacted engine evidence](m1-backend-evidence.txt). Metal selection is verified from these logs, independently of the Worker's `unverified:auto` configuration label.
- Gateway and Worker are separate real Node processes on the M1, connected over loopback WS; the external resident whisper-server is reached over loopback HTTP. No mock adapter or external inference API was used in this run. Production VPS/HTTPS/WSS was not deployed or tested.
- Test audio is **synthetic Russian speech**, generated locally using the already installed macOS Milena voice at 165 words/minute, then converted by ffmpeg to 16 kHz mono PCM16 WAV. Source text is in `ru-class-asr/tests/fixtures/ru-m1-smoke.txt`. It is not a private classroom recording or microphone capture.
- Audio hash: `44e2d02d06a8b8eacf3107b4c9f77aa577fd25cdc4725d31e92f9631496f06ce`. Duration: **101.164625 seconds**. Audio is not committed.
- Before measurement, the resident service completed a one-second silence startup probe and an eight-second real inference check. The latter returned: “Сегодня мы начинаем лекцию по информационной безопасности.” This matches the generated source's opening sentence. No numerical word-error-rate claim is made.
- Measured replay: 8 s maximum window, 1 s audio step, 2 s first inference threshold; frames are normally 200 ms. The actual replay command used `--allow-short`, explicitly marking this as a development smoke test rather than five-minute formal acceptance.

## Actual results

| Metric | Mean | p50 | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Worker HTTP inference round trip | 763.2 ms | 773.8 ms | 852.9 ms | 975.4 ms |
| Audio-frame end sent → result received | 771.9 ms | 775.7 ms | 863.9 ms | 1433.7 ms |
| Recognition window span | 7.79 s | 8.00 s | 8.00 s | 8.00 s |

**506 frames / 101 results**, with results arriving before stop. The replay completed the `session.stopped` handshake, including the Worker's stop/flush path. Wall time from replay start through stop confirmation: **102.62 seconds**. No connection/inference error was observed during this run. Maximum consecutive identical result texts was **2**; this diagnostic alone does not establish word-level correctness or duplicate-free natural classroom transcription.

The measured end-to-result figure uses one monotonic clock in the paced replay client. It **excludes physical microphone/device buffering, browser AudioWorklet filtering, frame batching and UI rendering**. It is not complete acoustic-to-subtitle latency. HTTP inference time also includes WAV/multipart construction and local HTTP overhead. These are measurements of one warmed M1 run, not a performance guarantee for M4, Safari, iPad or other platforms.

Raw privacy-reduced statistics are in [m1-replay-metrics.json](m1-replay-metrics.json). The driver deliberately retains `actual_backend: UNVERIFIED_CHECK_ENGINE_LOGS` because it cannot verify a GPU itself; the separate startup evidence above supplies that verification for this run. Tokens, hostnames, absolute paths, raw logs, audio and complete recognized text were excluded from the committed evidence.

## Reproduce development smoke

Use the normal README setup. Start a real whisper-server and real Worker, and configure distinct ignored local access tokens. From the Worker repository, after generating or obtaining an authorized 16 kHz mono PCM16 WAV:

```sh
# macOS synthetic developer input; keep generated files ignored
mkdir -p artifacts
say -v Milena -r 165 -f tests/fixtures/ru-m1-smoke.txt -o artifacts/ru-smoke.aiff
ffmpeg -i artifacts/ru-smoke.aiff -ar 16000 -ac 1 -c:a pcm_s16le artifacts/ru-smoke.wav
# Supply CLIENT_TOKEN locally via an env file or environment; never commit it.
GATEWAY_CLIENT_URL=ws://localhost:3912/ws/client node --env-file=../ru-class/.env --import tsx scripts/replay.ts artifacts/ru-smoke.wav artifacts/replay.json --allow-short
```

The localhost port shown here is the actual independent development setup; examples in README use port 3000 by default. Public deployments must use WSS. Do not run the replay while another classroom is active, since v0.1 permits one session.

## Development delivery and later acceptance

The actual page was visually checked in the in-app browser at 1366×900 and 390×844; missing-token interaction works and no console warnings/errors were seen. Browser microphone capture remains to be exercised by the operator; this replay does not prove a physical microphone or Safari/iPad path. Automated browser lifecycle tests use explicit stubs and cover frame encoding, stop, disconnection, Worker errors and microphone mute.

The current development source is ru-class `8a3be3715ced8013d6a23c9d3fcf2500ac3ef414` and ru-class-asr core `0134b428f080e24a35bcc7dd3b8eafb6c19d8f2a`; later commits record documentation/evidence. Main automated suite: **12/12 passed**; Worker suite: **6/6 passed**. Both typechecks/builds passed. See each repository's `test-results-v0.1.txt`.

**M1 real-engine development smoke: PASSED. Mac mini M4 formal acceptance: PENDING_HARDWARE_VALIDATION, intentionally deferred by the user.** The required five-minute natural Russian/microphone or authorized real-time replay, real browser interruption checks, M4 performance and actual foreground iPad/Safari checks remain separate. Only v0.1 was developed.
