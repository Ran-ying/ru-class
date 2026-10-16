# Repository working agreement

- Read PROJECT_SPEC.md and docs/decisions.md before changes. Only v0.1 and its v0.1.1 bug/config fixes are approved; later versions require explicit user direction.
- Keep architecture, module responsibilities, protocol and development evidence in the repository as code evolves. Update docs/acceptance-v0.1.md with honest test results.
- Never commit .env, secrets, personal paths/private domains, model binaries, classroom audio or unredacted logs. Use placeholders in public examples.
- Gateway code is cross-platform Node.js/TypeScript. Browser code uses standard Web APIs. No production VPS changes without explicit deployment authorization.
- Run npm test, npm run typecheck and npm run build. Joint tests use ASR_REPO=../ru-class-asr npm test. Synchronize protocol.ts and docs/protocol.md with ru-class-asr; do not create a third repository.
- Simulated tests must remain labeled. Required M4/Metal + five-minute Russian/browser validation is independent and stays pending until measured.

- User clarification, 2026-10-16: M1 is the current development/integration machine. M4 formal hardware acceptance is deferred to a later stage; do not block current development on M4 availability or mislabel M1 measurements as M4.

- Latest user correction: default ASR entry point serves an independent OpenAI-compatible HTTP API; main server calls URL/model/key and owns window scheduling. No outbound Worker is required in normal startup. Keep current contract in docs/api-integration-v0.1.md; older Worker docs/tests are migration history. Local setup remains loopback-only until public site authentication/deployment is reviewed. Toolbar belongs to the right half.
 
- v0.1.1 is approved for fixes only. Runtime listener/public Origin/ASR config comes from ignored private `config.json` (or environment overrides). Public deployments require HTTPS `site.publicOrigin` and strong `site.accessToken`; never return public bootstrap credentials or ASR API Key to browsers. Keep exact-origin checks and the independent HTTP ASR topology; legacy active Worker design is superseded. v0.2 still needs explicit user approval.

- v0.1.2 was approved to preserve cumulative Russian text. The main server emits stable_delta and replaceable partial_text per asr.partial with session revision. Do not concatenate raw overlapping Whisper window text; do not consume stable words until the future sentence-commit version. This is in-memory only and not v0.2 audio persistence. See docs/transcript-v0.1.2.md.
