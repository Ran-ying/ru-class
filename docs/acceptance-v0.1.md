# v0.1 implementation and acceptance report

Date: 2026-10-16. Scope: PROJECT_SPEC.md planning revision 1.2, v0.1 only.

**Overall status: IMPLEMENTED / AUTOMATED_TESTS_PASSED / PENDING_HARDWARE_VALIDATION.** The code is delivered; required Mac mini M4/Metal + five-minute Russian real microphone or real-time replay acceptance has not passed and must not be claimed complete.

## Delivered

- Two independent Node.js/TypeScript projects with pinned npm lockfiles, documented module boundaries and protocol 0.1.
- Standard browser microphone capture, channel mixing, streaming low-pass resampling from actual AudioContext rate to 16 kHz mono PCM16, indexed binary frames and original sample mapping.
- Authenticated gateway, independent browser/Worker tokens, same-origin check, single-session routing, size/rate/sequence/sample checks, liveness and explicit failure states.
- Worker-initiated gateway connection; platform-neutral, bounded rolling audio windows; one HTTP inference at a time against external resident whisper-server; intermediate pending work coalescing; stop flush/cancel and old-result suppression.
- Responsive 2:1 web page, RU live window replacement, duration/state/error/model/OS/backend configuration display and separately labeled latency metrics. Future history/Chinese features are explicit empty states.
- Startup inference probe, reproducible macOS/VPS setup instructions, privacy-reduced real-time replay metrics script, tests, architecture/decisions/development records and working agreements.

## Verified evidence

Environment: macOS **27.0** arm64, **Apple M1 / 8 GB MacBook Air**, Node.js **v25.9.0**, npm **11.12.1**. This is not Mac mini M4. Local checks do not imply other Node versions or operating systems have been author-tested.

| Check | Result | Evidence / limits |
| --- | --- | --- |
| ru-class automated tests, including joint contract test | PASS: 9/9 | `ASR_REPO=../ru-class-asr npm test`; audio encoding, 44.1/48 kHz duration, high-frequency filtering, malformed frames, continuity, browser permission-denial logic, HTTPS requirement, authentication/origin, routing, unknown session and Worker disconnect |
| Cross-repository chain | PASS, simulated | Actual HTTP adapter → actual Worker → actual gateway → WS client, with clearly named `SIMULATED_TEST` HTTP output; receives partial before stop, final tail before stopped; protocol source/doc copies match |
| Replay CLI smoke | PASS, simulated | Included in joint test: 2.2-second synthetic WAV paced at real time with `--allow-short`; checks captions before stop and aggregate metrics output. Not five-minute Russian acceptance |
| ru-class-asr automated tests | PASS: 6/6 | Simulated five-minute frame sequence stays within 8-second PCM buffer; WAV format; single concurrent inference; pending work coalescing; short/empty tail flush; cancellation; HTTP request/response and failure handling |
| Both projects TypeScript checks | PASS | `npm run typecheck` |
| Both projects builds | PASS | `npm run build` |
| Production npm dependency audit | PASS | `npm audit --omit=dev`: 0 vulnerabilities; both projects use the same locked runtime dependency |
| Actual browser page and controls | PASS, limited visual smoke | Codex in-app browser; 1366×900 desktop and 390×844 narrow layout; module/styles load, placeholders visible, missing-token click prompt; no console errors/warnings observed. No microphone permission was granted in this smoke test |
| Public content review | PASS for delivered source | No real credentials/local env, private audio/models/raw logs or user absolute paths included; fixture tokens are test-only strings; `.env`, logs, models/audio and generated artifacts ignored |

Tests that call DOM stubs are explicitly simulated logic checks, not Safari microphone tests. Five minutes of synthetic frames are accelerated unit input, not a five-minute hardware run. Test execution details are recorded in the development log and can be reproduced with the commands above.

## Required acceptance still pending

| Requirement | Status |
| --- | --- |
| Actual Mac mini M4, multilingual small model, confirmed Metal engine logs | PENDING_HARDWARE_VALIDATION |
| Actual Russian input for at least five minutes; continued responsive page; no whole-window cumulative duplication | PENDING_HARDWARE_VALIDATION |
| Real inference mean / p50 / p95, audio-end-to-display and acoustic latency | NOT MEASURED; no simulated numbers presented as real performance |
| Actual microphone permission refusal, browser network interruption and Worker interruption while recording | Pending device/browser validation; automated failure paths passed |
| Safari/iPad foreground audio and layout | Pending actual device validation; responsive emulation is not an iPad test |
| Production VPS HTTPS/WSS deployment | Not performed; separate deployment authorization required |

The required M4, whisper-server/model and five-minute Russian recording were unavailable in this execution environment. Follow `docs/hardware-validation.md` and run the provided replay driver on that machine. Keep raw evidence private, commit only redacted findings, then update both acceptance reports. Do not change overall status to accepted before those measurements exist.

## Known v0.1 limits

Only the latest overlapping window is shown; no full transcript archive or stable LocalAgreement exists yet. If inference is slower than audio, coalescing bounds memory and keeps the latest window but may leave unrecognized earlier audio; real hardware performance determines whether defaults are usable. Window alignment is not word-level timing. The displayed network/inference latency estimate excludes device capture buffering, filter lookahead and frame batching. Backend is reported as unverified configuration until independently checked.

No local permanent recording, automatic browser reconnect/resume, translation, confirmed bilingual history, sentence playback, ZIP archives or AI notes were implemented. Later versions remain subject to explicit user approval. v0.1 must not be the only copy of an important classroom recording.

Code and documentation are committed independently in each repository. Commit identifiers are listed in the delivery report and available via `git log --oneline`; this report does not invent a self-referential commit hash.

## Source baselines and reproducible evidence

- ru-class implementation: `d07280d4a8f51ba93907388f90be1ac7f0426a4c` — `feat: implement v0.1 live Russian transcription pipeline`
- ru-class-asr implementation: `0134b428f080e24a35bcc7dd3b8eafb6c19d8f2a` — `feat: implement v0.1 portable whisper HTTP worker`
- Each repository retains its own final successful test output in [test-results-v0.1.txt](test-results-v0.1.txt). Run `npm ci`, `npm run typecheck`, `npm run build` in both repositories, then the test commands above.
- UI evidence is stored in ru-class under `docs/screenshots/`. Architecture and module ownership are in [architecture.md](architecture.md); implementation choices are in [decisions.md](decisions.md).
- These are local Git commits. No GitHub push, release tag or production deployment has been performed.
