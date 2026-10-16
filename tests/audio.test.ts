import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Continuity, decodeAudio, event, type AudioHeader, parseEvent } from '../apps/server/src/protocol.js';
// Browser source is imported directly so the tested encoder/resampler is the shipped code.
const {Resampler,encodeFrame} = await import('../apps/web/audio.js' as string);
test('44.1/48 kHz streaming resampling preserves duration across arbitrary blocks', () => {
  for(const rate of [44100,48000]) {
    const resampler = new Resampler(rate); let output:number[] = [];
    for(let start=0;start<rate;start+=128) output.push(...resampler.push(Array.from({length:Math.min(128,rate-start)},(_,i)=>0.5*Math.sin(2*Math.PI*1000*(start+i)/rate))));
    output.push(...resampler.push([],true));
    assert.equal(output.length,16000);
    const rms = Math.sqrt(output.slice(100,-100).reduce((s:number,v:number)=>s+v*v,0)/(output.length-200));
    assert.ok(rms>0.34 && rms<0.36);
    assert.ok(resampler.buffer.length < 100);
  }
});
test('resampling filters out frequencies above target Nyquist', () => {
  const r = new Resampler(48000); const out:number[] = [];
  for(let start=0;start<48000;start+=128) out.push(...r.push(Array.from({length:Math.min(128,48000-start)},(_,i)=>Math.sin(2*Math.PI*12000*(start+i)/48000))));
  out.push(...r.push([],true));
  const rms=Math.sqrt(out.slice(100,-100).reduce((s,v)=>s+v*v,0)/(out.length-200)); assert.ok(rms<0.02);
});
test('browser PCM encoding, clamping and original sample mapping round-trip', () => {
  const continuity = new Continuity();
  for(let seq=0;seq<20;seq++) {
    const data=Buffer.from(encodeFrame('1234567890123456','id',seq,seq*3200,Float32Array.from([-2,-1,0,1,2,...Array(3195).fill(0)]),44100));
    const {header,pcm}=decodeAudio(data); continuity.accept(header);
    assert.equal(pcm.readInt16LE(0),-32768); assert.equal(pcm.readInt16LE(6),32767);
    assert.equal(header.payload.source_start_sample,seq*8820);
  }
  assert.equal(continuity.sample,64000);
});
test('protocol rejects malformed envelopes, oversized/truncated/mismatched audio and discontinuities', () => {
  assert.throws(()=>parseEvent('{}'));
  const packet=Buffer.from(encodeFrame('1234567890123456','id',0,0,new Float32Array(3200),48000));
  assert.throws(()=>decodeAudio(packet.subarray(0,packet.length-1)));
  const corrupt=Buffer.from(packet); corrupt.writeUInt32LE(999999,4); assert.throws(()=>decodeAudio(corrupt));
  const {header}=decodeAudio(packet); const c=new Continuity(); c.accept(header); assert.throws(()=>c.accept(header),/AUDIO_DISCONTINUITY/);
  const invalid={...header,payload:{...header.payload,sample_rate:48000}};
  const json=Buffer.from(JSON.stringify(invalid)); const prefix=Buffer.alloc(8);prefix.write('RUC1');prefix.writeUInt32LE(json.length,4);
  assert.throws(()=>decodeAudio(Buffer.concat([prefix,json,Buffer.alloc(6400)])),/INVALID_AUDIO_METADATA/);
});
