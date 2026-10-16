import { performance } from 'node:perf_hooks';
import { AudioWindow } from './audio-window.js';
import { type AudioHeader, RATE } from './protocol.js';
import { type InferenceAdapter } from './inference.js';
export type Result = {text: string; window_start_sample: number; window_end_sample: number; sample_rate: number; inference_ms: number; queue_audio_ms: number; alignment_quality: string; final: boolean};
// One inference in flight. New audio replaces pending work, keeping memory and lag bounded.
export class Session {
  readonly audio: AudioWindow;
  private running = false;
  private stopping = false;
  private cancelled = false;
  private lastEnd = 0;
  private controller = new AbortController();
  private finish?: () => void;
  private stopped = new Promise<void>(resolve => { this.finish = resolve; });
  constructor(readonly adapter: InferenceAdapter, readonly onResult: (result: Result) => void, readonly onError: () => void, readonly windowSeconds = 8, readonly stepSeconds = 1, readonly minSeconds = 2) { this.audio = new AudioWindow(RATE * windowSeconds); }
  push(header: AudioHeader, pcm: Buffer) {
    if (this.stopping || this.cancelled) throw new Error('SESSION_STOPPING');
    this.audio.push(header, pcm); void this.pump();
  }
  async stop() { this.stopping = true; void this.pump(); return this.stopped; }
  cancel() { this.cancelled = true; this.controller.abort(); this.finish?.(); }
  private async inferWithBusyRetry(pcm: Buffer): Promise<string> {
    // Another client may briefly occupy the independent ASR API.
    // Keep the current capture session alive while retrying bounded 429 responses.
    for (let retry = 0; ; retry++) {
      try { return await this.adapter.infer(pcm, this.controller.signal); }
      catch (e) {
        if (this.cancelled || !(e instanceof Error) || e.message !== 'ASR_HTTP_429' || retry >= 3) throw e;
        await new Promise<void>((resolve, reject) => {
          const signal = this.controller.signal;
          const onAbort = () => { clearTimeout(timer); reject(new Error('SESSION_CANCELLED')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 400 * 2 ** retry);
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, {once: true});
        });
      }
    }
  }
  private async pump() {
    if (this.running || this.cancelled) return;
    const snapshot = this.audio.snapshot();
    if (snapshot.end === this.lastEnd) { if (this.stopping) this.finish?.(); return; }
    if (!this.stopping && (snapshot.end < RATE * this.minSeconds || snapshot.end - this.lastEnd < RATE * this.stepSeconds)) return;
    this.running = true; this.lastEnd = snapshot.end;
    const start = performance.now();
    try {
      const text = await this.inferWithBusyRetry(snapshot.pcm);
      if (!this.cancelled) this.onResult({text, window_start_sample:snapshot.start, window_end_sample:snapshot.end, sample_rate:RATE, inference_ms:performance.now()-start, queue_audio_ms:(this.audio.continuity.sample-snapshot.end)/RATE*1000, alignment_quality:'window_only', final:this.stopping && this.audio.continuity.sample === snapshot.end});
    } catch {
      if (!this.cancelled) { this.cancelled = true; this.onError(); this.finish?.(); }
    } finally {
      this.running = false;
      if (!this.cancelled) void this.pump();
    }
  }
}
