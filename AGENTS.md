# Repository working agreement

- Read PROJECT_SPEC.md and docs/decisions.md before changes. Only v0.1 is approved; later versions require the user's explicit direction.
- Keep architecture, module responsibilities, protocol and development evidence in the repository as code evolves. Update docs/acceptance-v0.1.md with honest test results.
- Never commit .env, secrets, personal paths/private domains, model binaries, classroom audio or unredacted logs. Use placeholders in public examples.
- Gateway code is cross-platform Node.js/TypeScript. Browser code uses standard Web APIs. No production VPS changes without explicit deployment authorization.
- Run npm test, npm run typecheck and npm run build. Joint tests use ASR_REPO=../ru-class-asr npm test. Synchronize protocol.ts and docs/protocol.md with ru-class-asr; do not create a third repository.
- Simulated tests must remain labeled. Required M4/Metal + five-minute Russian/browser validation is independent and stays pending until measured.

- User clarification, 2026-10-16: M1 is the current development/integration machine. M4 formal hardware acceptance is deferred to a later stage; do not block current development on M4 availability or mislabel M1 measurements as M4.
