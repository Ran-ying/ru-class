# Development log

## 2026-10-16 · v0.1 implementation

Read the existing planning specification before implementation. Both repositories initially contained only README and LICENSE; PROJECT_SPEC.md was an existing untracked user document and is preserved.

Implemented the versioned binary PCM protocol, authenticated gateway, single-session routing, browser AudioWorklet capture/resampling, responsive 2:1 page, configurable Worker HTTP adapter, bounded rolling window and stop/cancel handling. Architecture and protocol decisions are recorded alongside code. Automated validation and final acceptance evidence are recorded in `docs/acceptance-v0.1.md` when completed.

No later-version feature or production VPS deployment is authorized by this implementation log. Public documentation uses placeholders; local tokens, private configuration, audio and logs are ignored by Git.

### Validation and correction

- Joint main suite: 9/9 pass, including actual Worker/gateway/HTTP adapter with SIMULATED_TEST responses and a 2.2-second paced replay CLI smoke. Worker core: 6/6 pass. Both typechecks and builds pass.
- Fixed test-listener cleanup and handshake-error handling in tests. Corrected stop timeouts to allow an in-flight inference plus final flush, dropped cancelled/stale session results, and prevented old browser sockets from changing a newer session.
- Checked the actual page in the in-app browser at 1366×900 and 390×844; fixed narrow placeholder/subtitle overlap. Missing-token interaction works; no console warning/error observed. Actual microphone/Safari/iPad validation remains pending.
- Hardware query confirms the implementation host is Apple M1 / 8 GB. It is not the required M4; no Metal or Russian performance claim is made. Real validation instructions and privacy-reduced replay metrics are supplied.
- Only v0.1 code and explicit future-feature placeholders are present. No production infrastructure was changed. Final public-source scanning and repository commits are part of delivery.

### Repository delivery

Source baselines: ru-class `d07280d4a8f51ba93907388f90be1ac7f0426a4c`; ru-class-asr `0134b428f080e24a35bcc7dd3b8eafb6c19d8f2a`. Final tests were run directly in the target repositories after `npm ci`; both typechecks/builds succeeded. Main: 9/9 including the joint chain; Worker: 6/6. Successful console evidence is in `docs/test-results-v0.1.txt`. Runtime dependency audit found 0 vulnerabilities. Public-source review found no real secret/private key or personal absolute path; local environment, media/models/logs and generated artifacts are ignored.

The actual page was checked without granting microphone access. M4/Metal and five-minute Russian real acceptance are PENDING_HARDWARE_VALIDATION. Git history is local; no remote push or production deployment occurred.

### M1-first user direction and real integration

The user explicitly selected M1 development now and M4 formal acceptance later. This is recorded in PROJECT_SPEC section 16 (main), both AGENTS agreements and decisions. The browser now surfaces muted/ended input and rejects a dead track at session start; actual shipped JS lifecycle is covered by simulated capture/stop/disconnection/mute tests. Main suite increased from 9 to 12 passing tests; Worker remains 6 passing tests. Both builds/typechecks passed.

Built official whisper.cpp 1.9.5-dev at 0c7be696371069e0baa2515ed7aa08d5a5473aa6 with Metal on Apple M1 / 8 GB. The public multilingual small model passed its publisher SHA-256 check. Actual startup logs show MTL0/Apple M1; only redacted evidence is committed. A real 101.164625-second locally synthesized Russian WAV was paced through the real loopback gateway, Worker and resident engine: 506 frames, 101 results, captions before stop and successful stop handshake. Mean HTTP inference 763.2 ms/p95 852.9 ms; replay end-to-result mean 771.9 ms/p95 863.9 ms, excluding microphone/browser buffering/rendering. Audio/raw logs and local distinct random tokens are ignored, not committed. See m1-development.md and m1-replay-metrics.json. No M4, five-minute natural speech or production deployment claim is made.

### Fullscreen layout and settings · 2026-10-16

Changed desktop layout to 1:1 and fixed 100dvh with no document scrolling. Removed visible header/footer; recording limitations remain documented. Added an accessible native Settings dialog, moving the existing gateway token there while preserving page-memory-only handling and recording-time input locking. Three model-provider planning states are read-only; no future credentials or model integrations were added. See credentials-plan.md.

UI validation: main regression 12/12 passed; TypeScript and build passed. Actual browser measured desktop 1366×900 with two 683×900 columns and document/body height 900; narrow 390×844 had document/body height 844 and live panel ending at 844. Short landscape 900×400 had document height 400 with Settings open; dialog stayed within viewport. Verified Settings open/close and missing-token auto-open. No console warnings/errors observed. No audio/inference code changed or performance benchmark repeated. New clean desktop/narrow/settings screenshots are retained in main docs/screenshots.

### Compact caption controls and course placement (2026-10-16)

Moved course name above the left workspace and kept it available on narrow screens. Removed the live heading and engine suffixes; added a left timer/right single recording control. Initial disconnected connection/Worker messages now occupy the RU placeholder position; the ready message is revealed only for an authenticated available Worker. Stop/error paths restore a visible connection state. Worker diagnostics remain in Settings. Updated lifecycle assertions verify one-button start/stop and connected/offline visibility. Regression 12/12, typecheck and build passed; desktop/narrow browser layout and empty-token Settings flow passed. See ui-recording-controls-v0.1.md.

### Global bottom toolbar (2026-10-16)

Moved record toggle, duration, metrics and Settings into one viewport-wide bottom row. Supersedes earlier live-toolbar/top-right Settings placement. Main joint regression 12/12, typecheck and build passed. Actual browser at 1366×900, 390×844 and 900×400 confirmed no document overflow and toolbar at viewport bottom; Settings open/close passed, no warning/error observed. Public-source scan passed. Audio protocol unchanged; M4 formal acceptance remains deferred. See ui-bottom-toolbar-v0.1.md.
