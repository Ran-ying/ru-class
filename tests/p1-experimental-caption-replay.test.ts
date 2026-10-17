import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// @ts-ignore: offline-only JS experiment has no TS declarations.
import {counterfactualReplay,ExperimentalCaptionBuffer} from '../scripts/experimental-caption-replay.mjs';
// @ts-ignore: actual browser reducer remains unchanged.
import {TranscriptBuffer} from '../apps/web/transcript.js';

const S=16000;
const base='Сегодня мы разбираем безопасные платежи через интернет';
const loop=Array.from({length:164},(_,i)=>['Я','не','могу','этого','сейчас','понять','вовсе'][i%7]).join(' ');
const fresh='А теперь обсуждаем электронный кошелёк и банк';
function w(text:string,start:number,end:number,final=false){
  return {text,start:start*S,end:end*S,final};
}

test('an extreme synthetic 164-token loop is quarantined in experimental output only',()=>{
  const input=[
    w(base,0,8),
    w(loop,1,9),
    w(fresh,2,10,true)
  ];
  const result=counterfactualReplay(input);
  assert.equal(result.inputWindows,3);
  assert.deepEqual(result.loopWindows.map((x:{index:number})=>x.index),[1]);
  assert.equal(result.firstDivergenceIndex,1);
  assert.ok(result.displayChangedWindows>=1);
  assert.equal(result.humanAudioVerified,false);
  assert.equal(result.productionCodeChanged,false);
  assert.deepEqual(result.replayContracts,{
    baselineFirstStopViolations:0,experimentalFirstStopViolations:0,
    experimentSameRangeReplayViolations:0,experimentDoubleFlushStableDelta:false
  });
  assert.doesNotMatch(JSON.stringify(result),/интернет|кошелёк|этого/);
});

test('clean final ASR correction keeps the unmodified reducer output exactly',()=>{
  const input=[
    w('А здесь подпись банка',0,8),
    w('А здесь подпись банка в электронном кошельке',1,9,true)
  ];
  const report=counterfactualReplay(input);
  assert.equal(report.loopWindows.length,0);
  assert.equal(report.displayChangedWindows,0);
  assert.equal(report.finalComparison.finalStringsEqual,true);
  assert.equal(report.replayContracts.experimentalFirstStopViolations,0);
});

test('later four-word support is recorded but never reinserted into the caption',()=>{
  const input=[
    w('Первая длинная часть лекции',0,2),
    w('Совершенно новая отдельная мысль',1,3),
    w('Непохожее продолжение другой темы',2,4),
    w('Совершенно новая отдельная мысль продолжается',3,5,true)
  ];
  const report=counterfactualReplay(input);
  assert.equal(report.candidateReplacements.length,1);
  assert.equal(report.candidateReplacements[0].replacementIndex,2);
  assert.equal(report.laterLexicalSupport.length,1);
  assert.equal(report.laterLexicalSupport[0].supportingWindowIndex,3);
  assert.ok(report.laterLexicalSupport[0].matchedContiguousTokens>=4);
  assert.equal(report.displayChangedWindows,0,
    'Ledger is advisory; it does not insert or freeze unverified phrases');
});

test('unconfirmed candidate expires numerically; actual audio remains unverified',()=>{
  const input=[
    w('Первая длинная часть лекции',0,2),
    w('Совершенно новая отдельная мысль',1,3),
    w('Непохожее продолжение другой темы',2,4),
    w('Другой разговор на следующем занятии',3,5),
    w('Тема теперь вообще другая',4,6,true)
  ];
  const report=counterfactualReplay(input);
  assert.equal(report.candidateReplacements.length,1);
  assert.equal(report.laterLexicalSupport.length,0);
  assert.equal(report.unresolvedCandidates.length,1);
  assert.equal(report.unresolvedCandidates[0].resolution,'NO_MATCH_IN_TWO_SUBSEQUENT_WINDOWS');
});

test('existing genuine repeated phrase in disjoint audio is not suppressed',()=>{
  const phrase='Мы изучаем методы защиты информации';
  const input=[w(phrase,0,2),w(phrase,12,14,true)];
  const report=counterfactualReplay(input);
  assert.equal(report.finalComparison.finalStringsEqual,true);
  assert.equal(report.displayChangedWindows,0);
  assert.equal(report.loopWindows.length,0);
});

test('existing adjacent overlap repeated-speech false dedup is not claimed fixed',()=>{
  const phrase='Мы изучаем методы защиты информации';
  const input=[w(phrase,0,8),w(phrase,4,12,true)];
  const report=counterfactualReplay(input);
  assert.equal(report.finalComparison.finalStringsEqual,true);
  assert.equal(report.displayChangedWindows,0);
  assert.equal(report.finalComparison.verifiedSpokenWordGain,null);
});

test('same-range replay is inert even if a lexically anomalous window was quarantined',()=>{
  const trial=new ExperimentalCaptionBuffer();
  trial.update(base,0,8*S);
  trial.update(loop,S,9*S);
  const before=JSON.stringify(trial.publicMetrics());
  const dup=trial.update(loop,S,9*S);
  assert.equal(dup.stable_delta,'');
  assert.equal(JSON.stringify(trial.publicMetrics()),before);
});

test('CLI reports only numerical comparisons; never recognized words or private path',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ru-class-private-counterfactual-'));
  try{
    const path=join(dir,'classroom.json');
    writeFileSync(path,JSON.stringify([
      {text:base,window_start_sample:0,window_end_sample:8*S},
      {text:loop,window_start_sample:S,window_end_sample:9*S},
      {text:fresh,window_start_sample:2*S,window_end_sample:10*S,final:true}
    ]));
    const run=spawnSync(process.execPath,['scripts/experimental-caption-replay.mjs',path],
      {encoding:'utf8',cwd:process.cwd()});
    assert.equal(run.status,0,run.stderr);
    const report=JSON.parse(run.stdout);
    assert.equal(report.loopWindows[0].index,1);
    assert.doesNotMatch(run.stdout,/Сегодня|Я не могу|электронный|ru-class-private-counterfactual|classroom.json/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('rejects malformed and non-monotonic sample positions',()=>{
  assert.throws(()=>counterfactualReplay([
    {text:'ok',start:0,end:2*S},
    {text:'no',start:S,end:1.5*S}
  ]),/INVALID_WINDOW_1/);
  const trial=new ExperimentalCaptionBuffer();
  trial.update('ok',0,2*S);
  assert.throws(()=>trial.update('older',0,S),/TRANSCRIPT_WINDOW_ORDER/);
});
