import { Resampler } from './audio.js';
class Capture extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new Resampler(sampleRate); this.pending = []; this.stopped = false;
    this.port.onmessage = ({data}) => {
      if (data === 'flush' && !this.stopped) {
        this.stopped = true; this.pending.push(...this.resampler.push([], true)); this.emit(true);
        this.port.postMessage({type: 'flushed'});
      }
    };
  }
  emit(final = false) {
    while (this.pending.length >= 3200 || (final && this.pending.length)) {
      const samples = Float32Array.from(this.pending.splice(0, 3200));
      this.port.postMessage({type: 'audio', samples, sourceRate: sampleRate}, [samples.buffer]);
    }
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (channels?.length && channels[0].length) {
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
      this.pending.push(...this.resampler.push(mono)); this.emit();
    }
    return true;
  }
}
registerProcessor('ru-capture', Capture);
