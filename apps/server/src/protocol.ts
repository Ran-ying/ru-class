import { randomUUID } from 'node:crypto';

export const VERSION = '0.1';
export const RATE = 16000;
export const MAX_FRAME_SAMPLES = 16000;
export type Envelope = {protocol_version: string; type: string; session_id: string; message_id: string; payload: Record<string, any>};
export type WorkerStatus = {model: string; os: string; backend: string; ready: true};
export type PartialPayload = {text: string; window_start_sample: number; window_end_sample: number; sample_rate: 16000; inference_ms: number; queue_audio_ms: number; alignment_quality: 'window_only'; final: boolean; stable_delta?: string; partial_text?: string; revision?: number};
type Message<T extends string, P> = Omit<Envelope, 'type' | 'payload'> & {type: T; payload: P};
export type ControlMessage =
  | Message<'auth', {token: string}>
  | Message<'auth.ok', {worker_online: boolean; worker: Partial<WorkerStatus>}>
  | Message<'worker.ready', WorkerStatus>
  | Message<'session.start', {lesson_name?: string}>
  | Message<'session.ready', {worker: WorkerStatus}>
  | Message<'session.stop' | 'session.stopped' | 'session.cancel' | 'ping' | 'pong', Record<string, never>>
  | Message<'asr.partial', PartialPayload>
  | Message<'session.error', {code: string}>
  | Message<'connection.status', {worker_online: boolean; worker?: WorkerStatus}>;
export type AudioHeader = Envelope & {type: 'audio.frame'; payload: {seq: number; start_sample: number; sample_count: number; sample_rate: number; channels: number; encoding: string; source_sample_rate: number; source_start_sample: number; source_end_sample: number}};
export function event(type: string, session_id = '', payload: Record<string, any> = {}): Envelope {
  return {protocol_version: VERSION, type, session_id, message_id: randomUUID(), payload};
}
export function parseEvent(data: string): Envelope {
  const m = JSON.parse(data);
  if (m.protocol_version !== VERSION || typeof m.type !== 'string' || typeof m.session_id !== 'string' || typeof m.message_id !== 'string' || !m.message_id || !m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) throw new Error('INVALID_ENVELOPE');
  return m;
}
export function decodeAudio(data: Buffer): {header: AudioHeader; pcm: Buffer} {
  if (data.length < 8 || data.toString('ascii', 0, 4) !== 'RUC1') throw new Error('INVALID_AUDIO_HEADER');
  const size = data.readUInt32LE(4);
  if (size < 2 || size > 4096 || data.length < 8 + size) throw new Error('INVALID_AUDIO_HEADER');
  const header = parseEvent(data.toString('utf8', 8, 8 + size)) as AudioHeader;
  const p = header.payload;
  const pcm = data.subarray(8 + size);
  if (header.type !== 'audio.frame' || !header.session_id || !Number.isSafeInteger(p.seq) || p.seq < 0 || !Number.isSafeInteger(p.start_sample) || p.start_sample < 0 || !Number.isSafeInteger(p.sample_count) || p.sample_count < 1 || p.sample_count > MAX_FRAME_SAMPLES || p.sample_rate !== RATE || p.channels !== 1 || p.encoding !== 'pcm_s16le' || pcm.length !== p.sample_count * 2 || !Number.isSafeInteger(p.source_sample_rate) || p.source_sample_rate < RATE || p.source_sample_rate > 192000 || !Number.isSafeInteger(p.source_start_sample) || !Number.isSafeInteger(p.source_end_sample) || p.source_start_sample < 0 || p.source_end_sample <= p.source_start_sample || Math.abs(p.source_start_sample / p.source_sample_rate - p.start_sample / RATE) > 2 / RATE || Math.abs(p.source_end_sample / p.source_sample_rate - (p.start_sample + p.sample_count) / RATE) > 2 / RATE) throw new Error('INVALID_AUDIO_METADATA');
  return {header, pcm};
}
export function encodeAudio(header: AudioHeader, pcm: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(8); prefix.write('RUC1'); prefix.writeUInt32LE(json.length, 4);
  return Buffer.concat([prefix, json, pcm]);
}
export class Continuity {
  seq = 0; sample = 0; source = 0;
  accept(h: AudioHeader) {
    const p = h.payload;
    if (p.seq !== this.seq || p.start_sample !== this.sample || p.source_start_sample !== this.source) throw new Error('AUDIO_DISCONTINUITY');
    this.seq++; this.sample += p.sample_count; this.source = p.source_end_sample;
  }
}
