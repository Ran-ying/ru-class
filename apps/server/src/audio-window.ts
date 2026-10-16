import { AudioHeader, Continuity, RATE } from './protocol.js';
export class AudioWindow {
  continuity = new Continuity();
  pcm = Buffer.alloc(0);
  constructor(readonly maxSamples = RATE * 8) {
    if (!Number.isSafeInteger(maxSamples) || maxSamples < RATE || maxSamples > RATE * 30) throw new Error('INVALID_WINDOW_SIZE');
  }
  push(header: AudioHeader, pcm: Buffer) {
    this.continuity.accept(header);
    this.pcm = Buffer.concat([this.pcm, pcm]);
    if (this.pcm.length > this.maxSamples * 2) this.pcm = Buffer.from(this.pcm.subarray(-this.maxSamples * 2));
  }
  snapshot() {
    const end = this.continuity.sample;
    return {pcm: Buffer.from(this.pcm), start: end - this.pcm.length / 2, end};
  }
}
export function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(36+pcm.length,4); h.write('WAVEfmt ',8); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(1,22); h.writeUInt32LE(RATE,24); h.writeUInt32LE(RATE*2,28); h.writeUInt16LE(2,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(pcm.length,40);
  return Buffer.concat([h,pcm]);
}
