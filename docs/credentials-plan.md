# Credential boundaries and model configuration plan

2026-10-16. This is planning only; v0.1 implements current gateway/Worker authentication.

| Purpose | Current state | Location |
| --- | --- | --- |
| Gateway access: CLIENT_TOKEN | Implemented, entered in top-right Settings | Gateway environment and current page memory; no browser storage |
| Worker identity: WORKER_TOKEN | Implemented, distinct from client access | Gateway and Worker environments; never exposed in browser |
| Speech provider | Local Whisper needs no model API key | Future remote ASR configuration, if authorized, belongs on server |
| Multimodal provider | Planned, not connected | Future independent server-side provider/URL/model/key configuration |
| Language provider | Planned, not connected | Future independent server-side provider/URL/model/key configuration |

Reserve three logical model configuration groups: ASR, multimodal and language. Three groups do not require three nonempty keys: local ASR needs none; a vendor may permit one credential across model types. Keep slots independent so providers and keys can change independently. Never reuse gateway/Worker tokens as vendor API keys.

Settings contains the current gateway input and read-only model planning states. No future model secrets are accepted, stored, transmitted or validated. Future model credentials remain on the backend, with status only returned to the browser. No provider is selected or integrated by this plan.
