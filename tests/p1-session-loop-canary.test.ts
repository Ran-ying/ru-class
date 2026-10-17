import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore: actual public-browser JavaScript modules are deliberately used.
import {LoopQuarantineTranscript} from '../apps/web/caption-loop-guard.js';
// @ts-ignore: production reducer stays unchanged.
import {TranscriptBuffer} from '../apps/web/transcript.js';
// @ts-ignore: shared risk function also runs in Safari, no Node APIs.
import {inspectHypothesis} from '../apps/web/asr-loop-risk.js';
// @ts-ignore: historical private shadow detector now uses the same classifier.
import {inspectHypothesis as shadowCheck} from '../scripts/inspect-private-caption-risks.mjs';
// @ts-ignore: browser session, not an old server gateway.
import {BrowserAsrSession,RATE} from '../apps/web/direct-asr.js';

const S=16000;
const seven=['Я','не','могу','этого','сейчас','понять','вовсе'];
const loop=Array.from({length:164},(_,i)=>seven[i%seven.length]).join(' ');
const opening='Сегодня мы обсуждаем банковские переводы и платежи';
const after='В следующем вопросе рассматриваем банковские переводы в интернете';

function displayed(buffer:any,arr:{stable:string,partial:string},result:any) {
  if(result.stable_delta)arr.stable=[arr.stable,result.stable_delta].filter(Boolean).join(' ');
  arr.partial=result.partial_text;
  return [arr.stable,arr.partial].filter(Boolean).join(' ');
}
function replay(input:{text:string,start:number,end:number,final?:boolean}[],filter:boolean){
  const t:any=filter?new LoopQuarantineTranscript():new TranscriptBuffer();
  const progress={stable:'',partial:''};
  const steps=input.map(x=>displayed(t,progress,t.update(x.text,x.start,x.end,x.final)));
  const stopped=displayed(t,progress,t.flush());
  return {t,steps,stopped};
}

test('browser classifier remains numerically identical to shadow-only source',()=>{
  for(const text of [loop,opening,'Да да да да','',Array.from({length:75},(_,i)=>seven[i%7]).join(' ')]){
    assert.deepEqual(inspectHypothesis(text,0,8*S),shadowCheck(text,0,8*S));
  }
  assert.equal(inspectHypothesis(loop,0,8*S).lexicalLoopRisk,true);
  assert.equal(inspectHypothesis(opening,0,8*S).lexicalLoopRisk,false);
});

test('default BrowserAsrSession keeps exact old TranscriptBuffer class',()=>{
  const profile={baseUrl:'https://asr.example/v1',model:'small',apiKey:''};
  const baseline=new BrowserAsrSession(profile,()=>{},()=>{});
  assert.equal(baseline.captionPolicy,'baseline');
  assert.ok(baseline.transcript instanceof TranscriptBuffer);
  const canary=new BrowserAsrSession(profile,()=>{},()=>{},
    {captionPolicy:'extreme-loop-quarantine'});
  assert.equal(canary.captionPolicy,'extreme-loop-quarantine');
  assert.ok(canary.transcript instanceof LoopQuarantineTranscript);
  assert.throws(()=>new BrowserAsrSession(profile,()=>{},()=>{},
    {captionPolicy:'unknown-mode'}),/INVALID_CAPTION_POLICY/);
  baseline.cancel();canary.cancel();
});

test('C2-like 164-word loop quarantined; next rolling hypothesis retained',()=>{
  const input=[
    {text:opening,start:0,end:8*S},
    {text:loop,start:S,end:9*S},
    {text:after,start:2*S,end:10*S,final:true}
  ];
  const b=replay(input,false);
  const c=replay(input,true);
  assert.equal(c.t.diagnostics().observedWindows,3);
  assert.deepEqual(c.t.diagnostics().quarantinedWindows.map((x:{index:number})=>x.index),[1]);
  assert.ok(c.steps[2].includes('банковские переводы'));
  assert.ok(!c.steps[1].includes('Я не могу этого сейчас понять'));
  assert.ok(b.steps[1].includes('Я не могу этого сейчас понять'));
  assert.ok(!c.stopped.includes('Я не могу этого сейчас понять'));
  assert.equal(c.t.flush().stable_delta,'');
});

test('same sample-range retransmission of quarantined window remains inert',()=>{
  const t:any=new LoopQuarantineTranscript();
  t.update(opening,0,8*S);
  t.update(loop,S,9*S);
  const before=JSON.stringify(t.diagnostics());
  const result=t.update('alternate decoder without loop',S,9*S);
  assert.equal(result.stable_delta,'');
  assert.equal(JSON.stringify(t.diagnostics()),before);
  assert.throws(()=>t.update('out of order older audio',0,8*S),
    /TRANSCRIPT_WINDOW_ORDER/);
});

test('benign correction has bit-identical stable/draft output at each window',()=>{
  const input=[
    {text:'Сегодня нам нужна цифровая подпись банка',start:0,end:8*S},
    {text:'нам нужна цифровая подпись банка для платежей',start:S,end:9*S},
    {text:'цифровая подпись банка для платежей далее',start:2*S,end:10*S,final:true}
  ];
  assert.deepEqual(replay(input,false).steps,replay(input,true).steps);
  assert.equal(replay(input,true).stopped,replay(input,false).stopped);
  assert.deepEqual(replay(input,true).t.diagnostics().quarantinedWindows,[]);
});

test('genuine repetition in disjoint intervals is retained by canary',()=>{
  const phrase='Я могу узнать когда вы платили';
  const input=[
    {text:phrase,start:0,end:2*S},
    {text:phrase,start:12*S,end:14*S,final:true}
  ];
  const expected=phrase+' '+phrase;
  assert.equal(replay(input,true).stopped,expected);
  assert.equal(replay(input,false).stopped,expected);
});

test('extremely rapid real repetition remains a known false-positive risk',()=>{
  // A lexical filter has no evidence that the teacher did NOT say the
  // words. This is a deliberately acknowledged blocker for default-on.
  assert.equal(inspectHypothesis(loop,0,8*S).lexicalLoopRisk,true);
  assert.equal(replay([{text:loop,start:0,end:8*S,final:true}],true).stopped,'');
  assert.notEqual(replay([{text:loop,start:0,end:8*S,final:true}],false).stopped,'');
});

test('actual BrowserAsrSession uses selected per-session reducer without a new provider',async()=>{
  const updates:any[]=[];
  const profile={baseUrl:'https://asr.example/v1',model:'small',apiKey:''};
  const s:any=new BrowserAsrSession(profile,(u:any)=>updates.push(u),
    ()=>assert.fail('unexpected network access'),{captionPolicy:'extreme-loop-quarantine'});
  const queue=[opening,loop,after];
  s.transcribe=async()=>queue.shift()!;
  // Use the real rolling AudioRing timestamps; bypass microphone timers.
  s.ring.push(new Float32Array(8*RATE));
  await s.run();
  s.ring.push(new Float32Array(RATE));
  await s.run();
  s.ring.push(new Float32Array(RATE));
  await s.run(true);
  assert.equal(queue.length,0);
  assert.equal(updates.length,3);
  assert.equal(s.transcript.diagnostics().quarantinedWindows.length,1);
  assert.equal(updates[1].stable_delta,'');
  assert.equal(updates[2].final,true);
  assert.ok(updates[2].stable_delta.includes('банковские переводы'));
  assert.ok(!updates.map(u=>u.stable_delta+' '+u.partial_text).join(' ').includes('Я не могу этого'));
  s.cancel();
});
