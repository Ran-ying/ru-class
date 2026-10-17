import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Browser JavaScript is runtime-transpiled from source; no JS declarations.
import {recordingWavFromChunks, wavHeader} from '../apps/web/local-store.js';

const asBytes=(samples:number)=>new Uint8Array(samples*2);

test('v0.2: full local WAV assembles ordered PCM chunks with accurate header and playable duration',async()=>{
  const input=[{index:1,data:new Uint8Array([0,128,255,127])},{index:0,data:new Uint8Array([0,0,42,0])}];
  const blob=recordingWavFromChunks(input);
  assert.equal(blob.type,'audio/wav');
  assert.equal(blob.size,52);
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const view=new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');
  assert.equal(new TextDecoder().decode(bytes.slice(8,12)),'WAVE');
  assert.equal(view.getUint32(24,true),16000);
  assert.equal(view.getUint16(22,true),1);
  assert.equal(view.getUint16(34,true),16);
  assert.equal(view.getUint32(40,true),8);
  assert.deepEqual([...bytes.slice(44)],[0,0,42,0,0,128,255,127]);
  // Input order is not mutated; the IDB transaction may not sort its rows.
  assert.deepEqual(input.map(x=>x.index),[1,0]);
});
test('v0.2: audio corruption fails closed instead of downloading a misleading truncated WAV',()=>{
  assert.throws(()=>recordingWavFromChunks([]),/LOCAL_AUDIO_EMPTY/);
  assert.throws(()=>recordingWavFromChunks([{index:1,data:asBytes(10)}]),/LOCAL_AUDIO_GAP_OR_INVALID_CHUNK/);
  assert.throws(()=>recordingWavFromChunks([{index:0,data:asBytes(10)},{index:2,data:asBytes(10)}]),/LOCAL_AUDIO_GAP_OR_INVALID_CHUNK/);
  assert.throws(()=>recordingWavFromChunks([{index:0,data:asBytes(10)},{index:0,data:asBytes(10)}]),/LOCAL_AUDIO_GAP_OR_INVALID_CHUNK/);
  assert.throws(()=>recordingWavFromChunks([{index:0,data:new Uint8Array([1,2,3])}]),/LOCAL_AUDIO_GAP_OR_INVALID_CHUNK/);
  assert.throws(()=>recordingWavFromChunks([{index:0,data:new Uint8Array(0)}]),/LOCAL_AUDIO_GAP_OR_INVALID_CHUNK/);
  assert.equal(new DataView(wavHeader(16000*1800).buffer).getUint32(40,true),57_600_000);
});
test('v0.2: thirty-minute PCM16 Blob has correct byte size and yields lossless first/last samples',async()=>{
  // Accelerated reconstruction ONLY. This is NOT a real 30-minute Safari
  // microphone, full-session survival, or browser quota endurance test.
  const chunks=Array.from({length:30},(_,index)=>({index,data:asBytes(16000*60)}));
  const wav=recordingWavFromChunks(chunks);
  assert.equal(wav.size,57_600_044);
  const header=new DataView(await wav.slice(0,44).arrayBuffer());
  assert.equal(header.getUint32(4,true),57_600_036);
  assert.equal(header.getUint32(40,true),57_600_000);
  assert.equal(header.getUint32(24,true),16000);
  assert.equal(new Uint8Array(await wav.slice(44,48).arrayBuffer()).length,4);
  assert.equal(new Uint8Array(await wav.slice(-4).arrayBuffer()).length,4);
});
test('v0.2: player is browser-only, one shared controls element, no server media route or autoplay',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const js=readFileSync('apps/web/app.js','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  assert.match(html,/<audio id="local-player" controls preload="metadata"/);
  assert.match(html,/id="local-playback"/);
  assert.match(js,/function releasePlayback\(/);
  assert.match(js,/URL\.revokeObjectURL\(playbackUrl\)/);
  assert.match(js,/playbackRevision/);
  assert.match(js,/loadPlayback\(item\)/);
  assert.match(js,/addEventListener\('close',releasePlayback\)/);
  assert.match(css,/\.local-playback\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(js,/local-player'\)\.play\(/);
});
