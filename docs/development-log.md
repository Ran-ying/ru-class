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
