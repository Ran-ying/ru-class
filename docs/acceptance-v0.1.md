# v0.1 development delivery and acceptance report

Date: 2026-10-16. Scope: PROJECT_SPEC.md revision 1.2 plus the user's M1-first implementation clarification. Only v0.1 is implemented.

**Current delivery: M1_DEVELOPMENT_READY / AUTOMATED_TESTS_PASSED / M1_REAL_ENGINE_SMOKE_PASSED.** Mac mini M4 formal acceptance is **PENDING_HARDWARE_VALIDATION**, intentionally deferred by the user. It does not block M1 development.

## Delivered implementation

- Independent Node.js/TypeScript gateway and Worker projects with lockfiles, standard browser JS and fixed protocol 0.1. Architecture and module ownership are recorded in `architecture.md`.
- Browser microphone permissions, AudioWorklet channel mixing and streaming low-pass resampling from actual source rate to 16 kHz mono PCM16; binary audio frames carry session, sequence, target sample position and original sample mapping.
- Independent client/Worker tokens, exact browser origin check, session ownership, bounded message sizes, strict audio metadata and continuity validation, heartbeat and explicit failures. Local secrets remain ignored and readable only by the local user.
- Worker-initiated connection to gateway, platform-neutral resident whisper-server HTTP adapter, actual startup inference probe, bounded overlapping windows and serial/coalesced inference. Stop flushes remaining input; cancelled sessions suppress stale results.
- Actual 1:1 fullscreen desktop page and narrow layout, replacement RU live window, duration/state/error indicators and separately labeled latency metrics. Chinese/history features remain explicit future-version placeholders.
- macOS/VPS setup and troubleshooting, real-time replay driver, synthetic developer text fixture, tests, architecture decisions, development log, backend evidence and honest acceptance limits. No production service was modified.

## Verification

Environment: macOS 27.0, Apple M1 / 8 GB MacBook Air, arm64, Node.js v25.9.0, npm 11.12.1. Results below do not imply other OS/browser/Node versions have been author-tested.

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Main automated suite | PASS 12/12 | `ASR_REPO=../ru-class-asr npm test`; audio resampling/encoding, sampling metadata, malformed frames, continuity, WS auth/origin/session routing/errors, browser permission/HTTPS checks, capture/stop/disconnection/mute lifecycle |
| Joint contract and complete chain | PASS, simulated engine | Real HTTP adapter → real Worker → real gateway → WS client with `SIMULATED_TEST` output; early partial and final tail checked, protocol source/doc copies match; actual replay CLI smoke-tested with 2.2-second synthetic fixture |
| Worker core suite | PASS 6/6 | Accelerated five-minute simulated frames stay within 8-second buffer; WAV format, single inference, coalescing, flush, empty stop, cancellation, HTTP response/error handling |
| Both typechecks and builds | PASS | `npm run typecheck` and `npm run build`, directly in both target repositories after `npm ci` |
| Runtime dependency audit | PASS | `npm audit --omit=dev`: 0 vulnerabilities; both projects share the same locked runtime dependency |
| Actual in-app browser visual/interaction smoke | PASS, limited | 1366×900 and 390×844; correct layout/placeholders, missing-token prompt, no console warning/error observed. No physical microphone capture was used in this smoke |
| M1 actual Whisper/Metal chain | PASS, development smoke | Actual multilingual small and actual Metal logs; 101.16-second synthetic Russian WAV paced in real time, 506 frames/101 results, captions before stop, stop acknowledgment; see `m1-development.md` |
| Public-source review | PASS for delivered files | No real credentials/private keys or personal absolute paths found. Local env, raw logs, audio, models and generated artifacts are ignored. Committed media is limited to clean UI screenshots; test source text is synthetic |

Each repository's full successful automated output is retained in [test-results-v0.1.txt](test-results-v0.1.txt). Actual M1 measurements, model hash, engine revision and methodology are in [m1-development.md](m1-development.md), [metrics](m1-replay-metrics.json) and [backend evidence](m1-backend-evidence.txt).

Automated DOM stubs and `SIMULATED_TEST` HTTP fixtures prove logic only. Accelerated five-minute synthetic frame input is not a five-minute hardware run. The M1 real engine run uses explicitly synthetic speech and lasts 101.16 seconds; it is not the required M4/natural classroom acceptance.

## Actual M1 performance summary

Multilingual small; 8 s maximum window, 1 s step, 2 s first threshold. In this one warmed run, HTTP inference averaged 763.2 ms with p95 852.9 ms. Audio-frame-end sent to replay-result received averaged 771.9 ms with p95 863.9 ms. The latter excludes microphone buffering, AudioWorklet/frame batching and UI rendering, and must not be presented as complete acoustic subtitle latency. The backend was verified from actual `using MTL0 backend` / `Apple M1` startup lines, independently of the Worker's honest unverified configuration label.

## Deferred formal acceptance and remaining checks

| Requirement | Status |
| --- | --- |
| Mac mini M4 actual hardware/model/Metal and performance | PENDING_HARDWARE_VALIDATION; intentionally deferred |
| At least five minutes of natural Russian/microphone or authorized real-time replay, responsive live page and repetition review | Deferred formal acceptance |
| Physical microphone capture and foreground Safari/iPad behavior | Operator/device validation pending; standard API and simulated lifecycle tests are complete |
| Actual browser network/Worker interruption while recording | Automated paths passed; real browser/device interruption check pending |
| Complete acoustic-to-subtitle latency | Not measured; replay transport/inference figures above are separately labeled |
| Production VPS HTTPS/WSS deployment | Not performed; requires separate deployment authorization |

Follow [hardware-validation.md](hardware-validation.md) at the later M4 stage. Record M1 and M4 findings separately, retain raw private evidence locally and commit only redacted findings.

## Known v0.1 boundaries

Only the newest overlapping RU window is displayed; no full transcript archive or stable LocalAgreement exists. Slow inference coalesces pending work and can leave earlier audio unrecognized; it bounds memory and keeps current input. Window ranges are not word alignment. No permanent classroom recording, browser reconnect/recovery, translation, committed bilingual history, sentence playback, ZIP archive or AI notes was implemented. v0.1 must not be the only copy of important classroom audio. Later versions require explicit user direction.

Implementation source baselines: main `d07280d4a8f51ba93907388f90be1ac7f0426a4c`, M1 browser lifecycle refinement `8a3be3715ced8013d6a23c9d3fcf2500ac3ef414`; Worker core `0134b428f080e24a35bcc7dd3b8eafb6c19d8f2a`. Subsequent commits record evidence. Git history is local; no GitHub push, release tag or production deployment was performed.

UI revision 2026-10-16: fixed viewport, equal desktop columns, no document scrolling/top/bottom bars; gateway token moved into Settings. This UI change leaves audio and inference protocol unchanged. Layout checks are recorded in the development log.

UI revision checks passed: 1366×900, 390×844 and 900×400 document heights matched viewport heights. Desktop widths were 683/683. Settings open/close and missing-token redirect were checked in the actual browser; main regression 12/12, typecheck and build passed. No new model integration or key storage was added.

Compact-controls revision 2026-10-16: left workspace course input, one recording button/right with timer/left, RU/ZH-only labels and connection-aware RU placeholder. Main regression 12/12, typecheck/build and desktop/narrow visual checks passed; source lifecycle state tests use explicit browser stubs. See ui-recording-controls-v0.1.md.
