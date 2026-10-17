import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {wavHeader} from '../apps/web/local-store.js';
// @ts-ignore The legacy transcript module has no TypeScript declaration.
import {TranscriptBuffer} from '../apps/web/transcript.js';
// @ts-ignore Offline Node script intentionally has no TypeScript declaration.
import {audit,loadWindows,openWave,probeAdjacentExactMatches} from '../scripts/audit-private-audio.mjs';

const RATE=16000;
const PHRASE='Мы изучаем методы защиты информации';
function fixture(intervals:[[number,number],...Array<[number,number]>],duration=12){
  const dir=mkdtempSync(join(tmpdir(),'ru-class-p1-'));
  const data=Buffer.alloc(duration*RATE*2);
  for(const [start,end] of intervals){
    for(let i=Math.ceil(start*RATE);i<Math.floor(end*RATE);i++){
      data.writeInt16LE(Math.round(0.25*32767*Math.sin(i*2*Math.PI*440/RATE)),i*2);
    }
  }
  const wav=join(dir,'input.wav');
  writeFileSync(wav,Buffer.concat([Buffer.from(wavHeader(duration*RATE)),data]));
  const windows=join(dir,'windows.json');
  writeFileSync(windows,JSON.stringify({format:'ru-class-asr-windows-v1',sample_rate:16000,windows:[
    {text:PHRASE,window_start_sample:0,window_end_sample:8*RATE},
    {text:PHRASE,window_start_sample:4*RATE,window_end_sample:12*RATE,final:true}
  ]}));
  return {dir,wav,windows,clean(){rmSync(dir,{recursive:true,force:true});}};
}

test.todo('known limitation: two spoken copies in overlapping windows should remain two utterances',()=>{
  const buf=new TranscriptBuffer();
  const original=buf.update(PHRASE,0,8*RATE);
  const repeated=buf.update(PHRASE,4*RATE,12*RATE);
  const end=buf.flush();
  const visible=[original.stable_delta,repeated.stable_delta,end.stable_delta,end.partial_text]
    .filter(Boolean).join(' ');
  // This assertion currently fails by design and stays TODO until a
  // time-grounded reducer is independently validated on private C1/C2 audio.
  assert.equal(visible,PHRASE+' '+PHRASE);
});

test('separate audible regions on exclusive sides of overlapping windows are flagged, not silently equated',()=>{
  const f=fixture([[1,2],[10,11]]);
  try{
    const rows=loadWindows(f.windows),wav=openWave(f.wav);
    try{
      const candidates=probeAdjacentExactMatches(wav,rows);
      assert.equal(candidates.length,1);
      assert.deepEqual([candidates[0].previousIndex,candidates[0].currentIndex],[0,1]);
      assert.equal(candidates[0].overlapStartSample,4*RATE);
      assert.equal(candidates[0].overlapEndSample,8*RATE);
      assert.equal(candidates[0].early.active,true);
      assert.equal(candidates[0].shared.active,false);
      assert.equal(candidates[0].late.active,true);
    }finally{wav.close();}
  }finally{f.clean();}
});

test('activity in the shared intersection makes identical text acoustically indeterminate',()=>{
  const f=fixture([[1,2],[5,6],[10,11]]);
  try{const wav=openWave(f.wav);
    try{assert.equal(probeAdjacentExactMatches(wav,loadWindows(f.windows)).length,0);}
    finally{wav.close();}
  }finally{f.clean();}
});

test('local report does not publish recognized text; opt-in excerpts stay in private mode',()=>{
  const f=fixture([[1,2],[10,11]]);
  try{
    const out=join(f.dir,'new-private-review');
    const result=audit({wavPath:f.wav,windows:loadWindows(f.windows),indices:[1],outputDir:out});
    assert.equal(result.inputWindows,2);
    assert.equal(result.separatedAcousticCandidates.length,1);
    assert.equal(result.reviewed.length,1);
    assert.doesNotMatch(JSON.stringify(result),/Мы изучаем|методы защиты/);
    const row=result.reviewed[0];
    const transcript=readFileSync(join(out,row.privateNeighborFile),'utf8');
    assert.match(transcript,/Мы изучаем методы защиты/);
    const wav=readFileSync(join(out,row.audioFile));
    assert.equal(wav.toString('ascii',0,4),'RIFF');
    assert.equal(wav.readUInt32LE(24),RATE);
    assert.equal(wav.length,44+(row.clipEndSample-row.clipStartSample)*2);
    if(process.platform!=='win32'){
      assert.equal(statSync(out).mode&0o777,0o700);
      assert.equal(statSync(join(out,row.privateNeighborFile)).mode&0o777,0o600);
      assert.equal(statSync(join(out,row.audioFile)).mode&0o777,0o600);
    }
  }finally{f.clean();}
});

test('CLI emits only anonymized numerical metadata, without ASR text or absolute source paths',()=>{
  const f=fixture([[1,2],[10,11]]);
  try{
    const run=spawnSync(process.execPath,['scripts/audit-private-audio.mjs','--wav',f.wav,'--windows',f.windows],{
      encoding:'utf8',cwd:process.cwd()
    });
    assert.equal(run.status,0,run.stderr);
    const summary=JSON.parse(run.stdout);
    assert.equal(summary.separatedAcousticCandidates.length,1);
    assert.doesNotMatch(run.stdout,/Мы изучаем|методы защиты/);
    assert.doesNotMatch(run.stdout,/ru-class-p1-|input.wav|windows.json/);
  }finally{f.clean();}
});

test('invalid or out-of-order samples and wrong WAV formats are rejected, not guessed',()=>{
  const f=fixture([[1,2],[10,11]]);
  try{
    const bad=join(f.dir,'bad.json');
    writeFileSync(bad,JSON.stringify([{text:'abc',window_start_sample:0,window_end_sample:10},
      {text:'def',window_start_sample:0,window_end_sample:9}]));
    assert.throws(()=>loadWindows(bad),/INVALID_WINDOW_1/);
    const altered=join(f.dir,'bad.wav');
    const bytes=readFileSync(f.wav);bytes.writeUInt32LE(48000,24);
    writeFileSync(altered,bytes);
    assert.throws(()=>openWave(altered),/WAV_MUST_BE_16KHZ_MONO_PCM16/);
    assert.throws(()=>audit({wavPath:f.wav,windows:[{text:'hi',start:0,end:20*RATE}]}),/WINDOW_OUTSIDE_AUDIO/);
  }finally{f.clean();}
});
