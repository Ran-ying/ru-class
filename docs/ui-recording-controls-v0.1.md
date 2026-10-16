# Compact caption controls validation (2026-10-16)

- One visible recording action in the live panel, start/stop routed through the existing capture/flush lifecycle. Connecting and stopping disable repeated activation.
- RU/ZH labels have no Whisper/Live suffix. No live-caption or rolling-window heading is rendered.
- Initial disconnected state renders connection status and waiting Worker text; the ready placeholder is hidden. Authenticated Worker-ready state and return to disconnected/stopped state are covered by the actual shipped JS lifecycle tests with explicit browser stubs.
- Course name is in the left workspace; narrow screens retain its compact row.
- Actual browser: 1366x900, equal desktop halves, document height 900; one recording button, time x=708 and action x=1258. Narrow 390x844: document height 844, course input visible, recording toolbar inside viewport. Settings prompt from a blank token works.
- ASR_REPO=../ru-class-asr npm test: 12/12 passed. npm run typecheck and npm run build passed.
- Browser debugger synchronization failed on the old tab; a fresh tab in the same browser recovered and was used for the checks above. No physical microphone/model performance claim is added by these UI checks.
- No wire protocol, inference adapter, model service or permanent storage feature was added. Existing M1 benchmark evidence is retained independently.
