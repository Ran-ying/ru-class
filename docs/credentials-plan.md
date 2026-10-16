# Model credentials · current v0.1

| Service | Current configuration |
| --- | --- |
| Speech recognition | Independent ru-class-asr API base URL, API key and model; main server calls it. ASR_API_KEY matches on both projects. |
| Multimodal | Future independent provider configuration; not implemented |
| Language model | Future independent provider configuration; not implemented |

Local Whisper has no vendor API key, but the independently deployed ASR HTTP service does have its own access key. This is separate from browser/site authentication. Current local browser authentication is automatic; no manually entered gateway token is required. Keys stay in ignored local server env files (0600), or current main process memory after Settings save. Saved key values are never returned to the page; do not add browser storage, public build-time env injection or raw auth/request logging. Changed API address requires a new key instead of silently forwarding a retained key. See api-integration-v0.1.md for access boundaries and API subset.
