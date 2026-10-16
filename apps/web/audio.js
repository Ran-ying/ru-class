export const OUTPUT_RATE = 16000;
// Streaming windowed-sinc low-pass resampler. Retains filter context between render blocks.
export class Resampler {
  constructor(rate) {
    if (!Number.isFinite(rate) || rate < OUTPUT_RATE || rate > 192000) throw new Error('Unsupported microphone sample rate');
    this.rate = rate; this.ratio = rate / OUTPUT_RATE; this.radius = 32;
    this.buffer = []; this.base = 0; this.total = 0; this.output = 0;
  }
  push(input, final = false) {
    this.buffer.push(...input); this.total += input.length;
    const result = [];
    const limit = Math.floor(this.total / this.ratio);
    while (this.output < limit) {
      const position = (this.output + 0.5) * this.ratio - 0.5;
      if (!final && Math.ceil(position + this.radius) >= this.total) break;
      let sum = 0, weights = 0;
      const cutoff = 0.45 / this.ratio;
      for (let i = Math.ceil(position - this.radius); i <= Math.floor(position + this.radius); i++) {
        const x = i - position;
        const sinc = Math.abs(x) < 1e-10 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
        const weight = sinc * (0.5 + 0.5 * Math.cos(Math.PI * x / this.radius));
        sum += (this.buffer[i - this.base] ?? 0) * weight; weights += weight;
      }
      result.push(sum / weights); this.output++;
    }
    const keepFrom = Math.max(this.base, Math.floor((this.output + 0.5) * this.ratio - 0.5 - this.radius));
    const remove = Math.min(this.buffer.length, keepFrom - this.base);
    this.buffer.splice(0, remove); this.base += remove;
    return result;
  }
}
export function encodeFrame(sessionId, messageId, seq, startSample, samples, sourceRate) {
  const header = {protocol_version: '0.1', type: 'audio.frame', session_id: sessionId, message_id: messageId, payload: {seq, start_sample: startSample, sample_count: samples.length, sample_rate: OUTPUT_RATE, channels: 1, encoding: 'pcm_s16le', source_sample_rate: sourceRate, source_start_sample: Math.round(startSample * sourceRate / OUTPUT_RATE), source_end_sample: Math.round((startSample + samples.length) * sourceRate / OUTPUT_RATE)}};
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new ArrayBuffer(8 + json.length + samples.length * 2);
  const view = new DataView(out);
  new Uint8Array(out).set([82, 85, 67, 49]); view.setUint32(4, json.length, true);
  new Uint8Array(out, 8, json.length).set(json);
  samples.forEach((value, i) => { const v = Math.max(-1, Math.min(1, value)); view.setInt16(8 + json.length + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true); });
  return out;
}
