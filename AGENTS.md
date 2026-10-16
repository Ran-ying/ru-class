# RU-Class development agreement (current: browser-direct BYOK v0.2.1)

- **Most recent and authoritative user decision:** public website, **NO LOGIN**, **NO server accounts or user database**, **NO default API services**. Every visitor including maintainer selects own speech/image/text provider URL, model and API Token. All configuration, recordings, transcripts and lesson data live in **that browser's IndexedDB**.
- **Browser requests the user's third-party API directly.** No RU-Class server API proxy, CORS workaround, server-side ASR, per-user server session, or global model/Token. APIs that do not support browser CORS are unsupported; do not reintroduce fallback proxies without an explicit new user decision.
- `apps/server/src/index.ts` hosts static assets only (or deploy `apps/web` to an HTTPS static host). Legacy `gateway.ts`, `session.ts`, old `config.ts`, and their tests are retained solely for historical reference; they MUST NOT be invoked by the active entrypoint.
- `apps/web/direct-asr.js` performs browser-side 8-second rolling window and serial ASR requests. `apps/web/transcript.js` runs the existing stable/partial Russian algorithm. `apps/web/local-store.js` persists IndexedDB profiles, lessons and chunked WAV audio; do not upload them to RU-Class.
- Browser model setup initially shows API URL and optional Token together, followed by the Fetch Models button; only after discovery show dropdown or manual fallback, then separate Save/Test buttons. Token changes invalidate earlier results; 401/403 allows immediate Token correction and retry. Never assume model availability without provider response.
- Only opt-in exact-origin CORS is allowed in independent `ru-class-asr`. No global CORS wildcard for users' private ASR secrets. API endpoints must be HTTPS except own loopback for development.
- Browser tokens are readable by same-origin JS; keep strict CSP, no third-party injected scripts, disclose this risk and local browser data loss. Never commit real Tokens or audio.
- v0.3 future stable/8-second audio safety gate for DeepSeek has not been implemented. Do not fabricate word timestamps or consume mutable text.
- Run `npm test`, `npm run typecheck`, `npm run build` on both repos. CI simulated tests are not a real Mac/iPad Safari verification. No deployment without user approval.
- See `docs/browser-direct-byok.md` and `docs/byok-public-service.md` for current architecture.

## Historical development notes (superseded whenever conflicting)
# RU-Class current development rules (BYOK v0.1.7)

- **Most recent user decision overrides historical notes**: RU-Class is intended to become a publicly usable BYOK service. EVERY user including the maintainer chooses and provides their own speech, image and text provider URLs, model IDs and API Tokens. No default AI providers or shared/global AI keys.
- `config.json` and deployment environment variables only configure app listeners, origins and site administration. Ignore legacy `ASR_*` variables and legacy `asr`/`models` fields in `config.json`; do NOT reintroduce them as global provider defaults.
- `data/local-models.json` is a temporary **single-user private local testing** profile only. Never use or expose it to public users. Public launch requires authenticated independent user profiles, encrypted credentials, isolated ASR adapters and sessions, SSRF-safe API proxying and quota control. See `docs/byok-public-service.md`.
- Preserve previously approved v0.1.6 model UI, text alignment, audio-window behavior, and independent ru-class-asr API. Changes to v0.2 features still require user approval.
- Do not commit secrets, recordings or private endpoints. Run tests, typecheck and build. Simulated CI is not Mac/iPad field validation. Do not deploy public or local services without authorization.

## Historical development notes (superseded where conflicting)

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

- v0.1.3 approved: hide idle/status text after a normal stop but retain full RU and duration; improve lexical overlap gating against adjacent audio hypotheses and preserve committed prefixes. Settings uses top pill tabs (Models / Access), independent speech/image/text API profiles. Saving each profile persists atomically to private ignored config.json, while testing separately probes only OpenAI-compatible /models; never claim image/text inference works yet. Public site may not edit provider settings. See docs/v0.1.3-notes.md.

- v0.1.4 approved: Settings title+tab pills+close share a non-scrolling header; scroll only the form content. Speech/image/text have independent authenticated model discovery using OpenAI-compatible GET /models through the server, selectable model IDs, and an explicit manual fallback. Discovery must not save credentials, change active ASR, expose keys, or be enabled from the public browser settings mode. Keep Save and Test actions separate. See docs/v0.1.4-notes.md.

- v0.1.5 approved: Model settings must progress API URL → fetch actual model IDs → dropdown-only choice when available, otherwise manual entry → reveal Token → enable Save/Test only when Token exists (or same URL has saved Token). Refresh beside dropdown, preserve selection if still listed. Changing URL resets ALL later steps; never treat 401/403 as empty model list—reveal Token early for retry. Discovery is read-only, local-authenticated and may start without API Key. See docs/v0.1.5-notes.md.

- v0.1.6 approved: after successful or explicitly unsupported model-list discovery, hide the fetch button AND its adjacent text; show model selection/manual input and the Token input simultaneously. Remove the intermediate '填写 Token' toggle. On 401/403 keep the fetch button for retry while exposing the Token input. Use identically sized 20px SVG chevron and refresh icons, with chevron inset. Preserve save/test separation and reset-on-URL-change. See docs/v0.1.6-notes.md.
