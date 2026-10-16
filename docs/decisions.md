# v0.1 implementation decisions

- Scope is PROJECT_SPEC.md v1.2, sections 10–12. Translation, local archival, confirmed history, LocalAgreement, note editing and ZIP export are deferred.
- Node.js 22.6+ / TypeScript, `ws`, static standard browser JS. Two independent npm projects; no third repository and no duplicated whisper.cpp checkout in Git.
- Authentication uses distinct random gateway access / Worker tokens; browser token is entered by the operator and remains in page memory. No credential is bundled. Public deployment requires same-origin HTTPS and WSS.
- One Worker and one active classroom. Worker initiates its connection; whisper-server stays local. Production infrastructure has not been changed.
- v0.1 displays the newest overlapping window as a replacement. This prevents cumulative duplicate paragraphs without claiming v0.3 stable transcript semantics. Text that scrolls out of the window is not archived in this version.
- Default inference: multilingual small, Russian, 8-second maximum window, 1-second audio step, first attempt at 2 seconds. These are unvalidated starting parameters. One running inference coalesces new audio to the latest window; memory is bounded. Stop drains capture and flushes the newest audio.
- whisper-server is an external resident service; the portable HTTP adapter sends 16 kHz mono PCM WAV using multipart `/inference`. A real inference probe runs before Worker registration. Configured model/backend names are not hardware proof. Actual Metal/CPU evidence belongs in the independent hardware report.
- Both repositories carry protocol 0.1 definitions/documentation; contract checks prevent drift. No future shared package is introduced.
- No automatic browser reconnect or recording persistence. Capture stops with an explicit error on lost connections, observable discontinuity, suspended audio or track end. This behavior must not be described as offline recovery.
- Platform statements distinguish architecture from validation. Automated tests may run on any supported Node environment; real M4/Metal + foreground browser acceptance remains separate.
