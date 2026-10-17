import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// @ts-ignore: pure JS analyzer is intentionally run directly in Node.
import {inspectHypothesis,shadowAudit} from '../scripts/inspect-private-caption-risks.mjs';
// @ts-ignore: keep using actual browser reducer contract.
import {TranscriptBuffer} from '../apps/web/transcript.js';

const S=16000;
const benign='Мы изучаем методы защиты информации сегодня подробно, чтобы понимать систему.';
const abnormal=['Я','не','могу','этого','сейчас','понять','вовсе'];
const repetitive=Array.from({length:164},(_,i)=>abnormal[i%abnormal.length]).join(' ');

test('extreme repeated short vocabulary in 8s raises shadow risk; normal words do not',()=>{
  const suspicious=inspectHypothesis(repetitive,0,8*S);
  assert.equal(suspicious.tokenCount,164);
  assert.equal(suspicious.uniqueCount,7);
  assert.equal(suspicious.lexicalLoopRisk,true);
  assert.ok(suspicious.maxRepeatedTrigram>=20);
  assert.equal(inspectHypothesis(benign,0,8*S).lexicalLoopRisk,false);
});

test('ordinary sincere phrase repetition is not automatically discarded or labeled ground truth',()=>{
  const speech=['Да','да','да','это','так','да','да','да'].join(' ');
  const info=inspectHypothesis(speech,0,8*S);
  assert.equal(info.lexicalLoopRisk,false);
  const report=shadowAudit([{text:speech,start:0,end:8*S,final:true}]);
  assert.equal(report.totals.lexicalLoopRiskWindows,0);
  assert.equal(report.classifiedSpeechAccuracy,'UNVERIFIED');
});

test('an anomaly in a prior index is retained as that index, not misattributed to next correction',()=>{
  const report=shadowAudit([
    {text:benign,start:0,end:8*S},
    {text:repetitive,start:S,end:9*S},
    {text:'Здесь обсуждаются реальные платежи и счета',start:2*S,end:10*S,final:true}
  ]);
  assert.deepEqual(report.lexicalLoopWindows.map((x:{index:number})=>x.index),[1]);
  assert.equal(report.lexicalLoopWindows[0].windowStartSample,S);
  assert.equal(report.lexicalLoopWindows[0].windowEndSample,9*S);
  assert.doesNotMatch(JSON.stringify(report),/платежи|могу|понимать/);
});

test('unanchored replacement risk is indexed and counted without mutating original reducer output',()=>{
  const windows=[
    {text:'Первая длинная часть лекции',start:0,end:2*S},
    {text:'Совершенно новая отдельная мысль',start:S,end:3*S},
    {text:'Непохожее продолжение другой темы',start:2*S,end:4*S,final:true}
  ];
  const plain=new TranscriptBuffer();
  const states=windows.map((w:{text:string,start:number,end:number,final?:boolean})=>plain.update(w.text,w.start,w.end,w.final));
  const before=plain.flush();
  const audit=shadowAudit(windows);
  assert.equal(audit.unanchoredReplacementWindows.length,1);
  assert.equal(audit.unanchoredReplacementWindows[0].index,2);
  assert.equal(audit.totals.unanchoredReplacementEvents,1);
  const after=plain.flush();
  assert.equal(after.stable_delta,'');
  assert.equal(before.stable_delta,'');
  assert.equal(states.length,3);
  assert.doesNotMatch(JSON.stringify(audit),/Первая|Совершенно|Непохожее/);
});

test('same-range replays do not trigger a new candidate-replacement count',()=>{
  const w=[
    {text:'Первая длинная часть лекции',start:0,end:2*S},
    {text:'Совершенно новая отдельная мысль',start:S,end:3*S},
    {text:'Совершенно новый неверный вариант',start:S,end:3*S},
    {text:'Непохожее продолжение другой темы',start:2*S,end:4*S}
  ];
  const report=shadowAudit(w);
  assert.equal(report.totals.unanchoredReplacementEvents,1);
});

test('shadow CLI never exposes private utterances, paths or tokens on stdout',()=>{
  const dir=mkdtempSync(join(tmpdir(),'private-ru-p1-'));
  try{
    const file=join(dir,'windows.json');
    writeFileSync(file,JSON.stringify([
      {text:'Тайная фраза о финансах',window_start_sample:0,window_end_sample:2*S},
      {text:repetitive,window_start_sample:S,window_end_sample:9*S,final:true}
    ]));
    const run=spawnSync(process.execPath,['scripts/inspect-private-caption-risks.mjs',file],
      {encoding:'utf8',cwd:process.cwd()});
    assert.equal(run.status,0,run.stderr);
    const data=JSON.parse(run.stdout);
    assert.equal(data.inputWindows,2);
    assert.equal(data.totals.lexicalLoopRiskWindows,1);
    assert.doesNotMatch(run.stdout,/Тайная|фраза|могу|private-ru-p1|windows.json/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('impossible or out-of-order sample intervals are rejected',()=>{
  assert.throws(()=>inspectHypothesis('hi',-1,1),/INVALID_AUDIO_RANGE/);
  assert.throws(()=>shadowAudit([
    {text:'hi',start:0,end:2*S},
    {text:'no',start:0,end:S}
  ]),/TRANSCRIPT_WINDOW_ORDER/);
});
