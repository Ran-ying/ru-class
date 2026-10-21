import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {BrowserAsrSession,validSegments} from '../apps/web/direct-asr.js';
// @ts-ignore
import {TranscriptBuffer,segmentWordTimes} from '../apps/web/transcript.js';
// @ts-ignore
import {StableUnitJournal} from '../apps/web/stable-units.js';

const R=16000;
test('a provider rejecting verbose_json is retried once as json and stays on json',async()=>{
  const original=globalThis.fetch;const formats:string[]=[];
  globalThis.fetch=(async(_u:any,o:any)=>{const f=String(o.body.get('response_format'));formats.push(f);
    return f==='verbose_json'?new Response('{}',{status:400}):new Response(JSON.stringify({text:'Да'}),{status:200});}) as any;
  const session=new BrowserAsrSession({baseUrl:'https://asr.example/v1',model:'small',apiKey:'k'},()=>{},()=>{});
  try{
    assert.deepEqual(await session.transcribe({pcm:new Float32Array(R)}),{text:'Да',segments:null});
    assert.deepEqual(await session.transcribe({pcm:new Float32Array(R)}),{text:'Да',segments:null});
    assert.deepEqual(formats,['verbose_json','json','json']);
  }finally{session.cancel();globalThis.fetch=original;}
});
test('segment lists are validated; malformed timing is dropped, never fatal',()=>{
  assert.deepEqual(validSegments([{start:0,end:1,text:'a'}],8),[{start:0,end:1,text:'a'}]);
  for(const bad of [[{start:2,end:1,text:'a'}],[{start:0,end:9,text:'a'}],[{start:3,end:4,text:'a'},{start:1,end:2,text:'b'}],'x',undefined])
    assert.equal(validSegments(bad,8),null);
});
test('word times interpolate within a segment and become absolute samples',()=>{
  const t=segmentWordTimes([{start:1,end:3,text:' Аб вг.'}],10*R);
  assert.deepEqual(t.map((x:any)=>x.display),['Аб','вг.']);
  assert.equal(t[0].startSample,10*R+R);
  assert.equal(t[1].endSample,10*R+3*R);
  assert.ok(t[0].endSample<=t[1].startSample);
});
test('stable units carry speech start/end from the window segments that confirmed them',()=>{
  const b=new TranscriptBuffer();
  const j=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:0});
  const text=' Добрый день!\n Сегодня мы изучаем.';
  const seg=[{start:3,end:4,text:' Добрый день!'},{start:4,end:6,text:' Сегодня мы изучаем.'}];
  for(const [s,e] of [[0,8],[1,9]]){
    // The second window starts 1 s later, so the same speech is 1 s earlier in it.
    const shifted=seg.map(x=>({...x,start:x.start-s,end:x.end-s}));
    j.add({...b.update(text,s*R,e*R,false,shifted),window_start_sample:s*R,window_end_sample:e*R});
  }
  j.add({...b.flush(),window_start_sample:R,window_end_sample:9*R,final:true});
  assert.deepEqual(j.units.map((u:any)=>u.text),['Добрый день!','Сегодня мы изучаем.']);
  assert.deepEqual(j.units.map((u:any)=>[u.speechStartSample,u.speechEndSample]),[[3*R,4*R],[4*R,6*R]]);
  assert.equal(j.units[0].speechTimeSource,'whisper_segment_interpolated');
  assert.equal(j.units[1].wordTimes.length,3);
});
test('untimed providers keep the v0.3 null speech times',()=>{
  const b=new TranscriptBuffer();
  const j=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:0});
  for(const [s,e] of [[0,8],[1,9]])j.add({...b.update('Добрый день!',s*R,e*R),window_start_sample:s*R,window_end_sample:e*R});
  j.add({...b.flush(),window_start_sample:R,window_end_sample:9*R,final:true});
  assert.equal(j.units[0].speechStartSample,null);
  assert.equal(j.units[0].speechTimeSource,undefined);
});
