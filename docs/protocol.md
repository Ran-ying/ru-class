# RU-Class wire protocol 0.1

This document is identical in both repositories. `src/protocol.ts` in the Worker and `apps/server/src/protocol.ts` in the gateway are contract copies; change the version and contract tests together. v0.1 does not emit `asr.stable` or confirmed sentences.

## Transport and authentication

The browser connects to `/ws/client`; the Worker actively connects to `/ws/worker`. Public transport must use HTTPS/WSS. HTTP/WS is supported only for loopback development. The gateway listens on loopback by default; terminate TLS at an independently configured reverse proxy with WebSocket upgrade support. Set `PUBLIC_ORIGIN` to the exact public origin. Browser Origin must match. No token is placed in a URL, browser bundle, log or cookie.

Within 5 seconds, send `auth` with `payload: {"token":"<local secret>"}`. Distinct gateway `CLIENT_TOKEN` and `WORKER_TOKEN` values must each have at least 24 characters. The gateway replies `auth.ok`. A Worker must then send `worker.ready` after its inference probe succeeds. One authenticated Worker connection and one recording session are supported. Gateway ping/pong checks detect broken peers. Reloading or losing a connection ends the session; no recording, reconnect recovery or retransmission is provided in v0.1.

## JSON envelope

All control events use UTF-8 JSON:

```json
{"protocol_version":"0.1","type":"session.start","session_id":"4ccd5b95-5119-41e3-95fa-c7f3f2eef399","message_id":"2a01e190-039a-45f9-a615-f57c7c95d312","payload":{}}
```

All five fields are required. `payload` is an object. Connection-wide events use an empty session ID. Recording IDs are 16–64 ASCII letters, digits or hyphens; clients generate UUIDs. `message_id` is nonempty and identifies the event; replay/resume semantics are not implemented. TypeScript definitions and runtime validation live in the protocol files noted above.

| Direction | Type | Payload / behavior |
| --- | --- | --- |
| Both peers → gateway | `auth` | `{token: string}` |
| Gateway → peer | `auth.ok` | `{worker_online: boolean, worker: object}` |
| Worker → gateway | `worker.ready` | `{model: string, os: string, backend: string, ready: true}`; model is configured, `backend` is `unverified:auto` or `unverified:cpu` until verified externally from engine logs |
| Client → gateway → Worker | `session.start` | `{lesson_name?: string}`; name stays in browser, gateway forwards an empty payload |
| Gateway → client | `session.ready` | `{worker: object}`; microphone frames may start now |
| Client → gateway → Worker | `session.stop` | `{}`; stop capture, send all queued frames first, await final inference |
| Worker → gateway → client | `session.stopped` | `{}`; all final results already sent |
| Gateway → Worker | `session.cancel` | `{}`; discard session and abort active inference |
| Worker → gateway → client | `asr.partial` | See below; replace current RU window text, never append whole window |
| Gateway → client | `connection.status` | `{worker_online: boolean, worker?: object}` |
| Gateway → client / Worker → gateway | `session.error` | `{code: string}`; client ends capture and displays an error |
| Peer → gateway / gateway → peer | `ping` / `pong` | `{}`; optional application heartbeat, separate from WS control ping |

Unknown events, wrong protocol, malformed metadata and non-owner sessions are rejected. Oversized WS messages close the connection (40,000-byte maximum). Authentication failures close with code 1008. Error codes include `WORKER_OFFLINE`, `SESSION_BUSY`, `UNKNOWN_SESSION`, `INVALID_AUDIO_METADATA`, `AUDIO_DISCONTINUITY`, `WORKER_DISCONNECTED`, `WORKER_UNAVAILABLE_OR_SLOW`, `INFERENCE_FAILED`, `STOP_TIMEOUT`, `INVALID_MESSAGE`. No audio payload or recognized classroom text is logged by default.

## Binary `audio.frame`

One WS binary message contains 4 ASCII magic bytes `RUC1`, a 4-byte unsigned little-endian JSON-header byte length, the UTF-8 JSON envelope, then signed 16-bit little-endian mono PCM. Header length is at most 4096 bytes. Audio is not base64 encoded. Maximum 16,000 samples (1 second) per frame; the browser normally sends 3200 samples (200 ms), with a shorter final frame.

```json
{"protocol_version":"0.1","type":"audio.frame","session_id":"4ccd5b95-5119-41e3-95fa-c7f3f2eef399","message_id":"73d2c164-92dd-4128-9ad0-832cbdac2d01","payload":{"seq":0,"start_sample":0,"sample_count":3200,"sample_rate":16000,"channels":1,"encoding":"pcm_s16le","source_sample_rate":48000,"source_start_sample":0,"source_end_sample":9600}}
```

`seq` starts at zero and increases by one. `start_sample` starts at zero and equals the prior end. PCM byte length must equal `sample_count * 2`. `sample_rate` is exactly 16000, `channels` exactly 1, and `encoding` exactly `pcm_s16le`. `source_*` records the original AudioContext sample mapping (16–192 kHz), rounded to the nearest source sample; the source boundaries must be contiguous and agree with the 16 kHz timeline within two target samples. All sample and sequence fields are safe integers. Missing, duplicated or out-of-order frames cause a visible continuity error and end capture; v0.1 does not silently insert samples or sort frames into a recoverable stream.

The AudioWorklet mixes input channels and applies a streaming windowed-sinc low-pass filter before resampling. Filter context spans render blocks. Sample indices represent captured audio, never packet arrival time. Browser suspension / microphone track ending is surfaced as an error. This cannot guarantee all OS-level capture gaps are detectable; foreground device validation remains required.

## `asr.partial`

```json
{"protocol_version":"0.1","type":"asr.partial","session_id":"4ccd5b95-5119-41e3-95fa-c7f3f2eef399","message_id":"58793213-c4d5-49c1-af52-e549e2374bcf","payload":{"text":"Сегодня мы изучаем защиту информации.","window_start_sample":0,"window_end_sample":96000,"sample_rate":16000,"inference_ms":750,"queue_audio_ms":600,"alignment_quality":"window_only","final":false}}
```

The audio range is `[window_start_sample, window_end_sample)` in the single course timeline. Seconds equal samples / 16000. It is window alignment, not word alignment. The UI replaces the current window text; old windows leave the live display. Full transcript history and LocalAgreement belong to later versions. Stop flushes remaining audio even when shorter than the initial 2-second inference threshold; an empty session finishes without inference. There is at most one inference request per Worker session and one coalesced latest pending window. Memory is bounded by the configured window. Cancelled or disconnected sessions never emit late results.

## Metrics

`window span` is window samples / sample rate. `inference_ms` measures HTTP inference on the Worker, excluding audio collection. `queue_audio_ms` is newer audio accumulated during that inference. The browser's audio-end-to-display measurement uses its own monotonic clock: result display time minus sending time of the frame containing the returned window end. It excludes microphone/device capture buffering, worklet filtering and frame batching; do not label it complete acoustic latency. Real replay reports the same network/queue/inference estimate separately from window span. No clocks are subtracted across machines.
