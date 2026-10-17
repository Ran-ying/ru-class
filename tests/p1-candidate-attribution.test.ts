import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// @ts-ignore: this is an isolated JavaScript research tool.
import {matchedWordMask,auditAttribution,readCrossAsr} from '../scripts/audit-candidate-attribution.mjs';

const S=16000;
const make=(text:string,start:number,end:number,final=false)=>({
  text,start:start*S,end:end*S,final
});
const windows=[
  make('Первый раздел лекции подробно',0,2),
  make('Совершенно новая отдельная мысль',1,3),
  make('Непохожее продолжение другой темы',2,4),
  make('Совершенно новая отдельная мысль продолжается',3,5),
  make('И наконец другие предметы лекции сегодня',4,6,true)
];
const model={focus:'Совершенно новая отдельная мысль',
             context:'Потом совершенно новая отдельная мысль продолжается'};

test('finds longest contiguous candidate match, not isolated common stopwords',()=>{
  const a=['а','новая','отдельная','мысль','это'];
  const b=['как','новая','отдельная','мысль','далее'];
  const out=matchedWordMask(a,b);
  assert.equal(out.maxContiguousRun,3);
  assert.deepEqual(out.mask,[false,true,true,true,false]);
  const weak=matchedWordMask(a,['а','ну','отдельная']);
  assert.equal(weak.matchedCandidateWords,0);
});

test('C1-like overwritten hypothesis receives independent and later support but never restoration',()=>{
  const report=auditAttribution(windows,model,'C1',2);
  assert.equal(report.target.case,'C1');
  assert.equal(report.target.index,2);
  assert.equal(report.candidateWords,4);
  assert.equal(report.target.candidateSource.windowIndex,1);
  assert.equal(report.target.candidateSourceAndReplacementWindowsOverlap,true);
  assert.ok(report.independentModel.focusedMaxContiguousMatch>=4);
  assert.ok(report.subsequentWindows.maxContiguousMatch>=4);
  assert.ok(report.subsequentWindows.modelAndLaterSupportedWords>=4);
  assert.equal(report.admission.status,'REVIEW_ONLY_NO_AUTOMATIC_RESTORATION');
  assert.equal(report.admission.trueWordRecovery,null);
  assert.equal(report.admission.measuredSpeechOmissions,null);
  assert.equal(report.admission.productionChanged,false);
  assert.doesNotMatch(JSON.stringify(report),/Совершенно|лекции|Непохожее/);
});

test('normal final replacement is never declared a verified dropped sentence',()=>{
  const seq=[
    make('Теперь мы говорим о деньгах',0,2),
    make('Новая совершенно ошибочная версия',1,3),
    make('Теперь мы говорим о деньгах и банке',2,4,true)
  ];
  // The candidate is conditional: if no reducer replacement actually
  // occurred for this exact sequence, the tool fails closed.
  try{
    const report=auditAttribution(seq,{
      focus:'Теперь мы говорим о деньгах и банке',
      context:'Теперь мы говорим о деньгах и банке'},'C1',2);
    assert.equal(report.admission.measuredSpeechOmissions,null);
    assert.equal(report.admission.verifiedWordTimestamps,false);
  }catch(e){
    assert.match(String(e),/FOCUSED_WINDOW_NOT_REPLACEMENT/);
  }
});

test('later window boundary cannot manufacture a four-word continuous support match',()=>{
  const seq=[
    make('Первый раздел лекции подробно',0,2),
    make('Совершенно новая отдельная мысль',1,3),
    make('Непохожее продолжение другой темы',2,4),
    make('Совершенно новая',3,5),
    make('отдельная мысль продолжается',4,6,true)
  ];
  const report=auditAttribution(seq,model,'C1',2);
  assert.equal(report.subsequentWindows.maxContiguousMatch,2);
  assert.equal(report.subsequentWindows.matchedCandidateWords,0,
    'No >=3-token run occurs inside either independent later window');
});

test('focus and metadata must match actual sample coordinates and original Whisper text',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ru-p1-cross-fixture-'));
  try{
    const path=join(dir,'cross.json');
    const input={
      format:'ru-class-p1-dashscope-cross-asr-private-v1',
      cases:[{
        case:'C1 #2',
        input:{
          focused_window_start_sample:2*S,
          focused_window_end_sample:4*S,
          sample_rate:16000
        },
        original_whisper_focused_window:windows[2].text,
        independent_dashscope_qwen3_asr:{
          focused_8s_text:model.focus,context_text:model.context,
          focused_language:'ru',context_language:'ru',
          focused_finish_reason:'stop',context_finish_reason:'stop'
        }
      }]
    };
    writeFileSync(path,JSON.stringify(input));
    assert.equal(readCrossAsr(path,'C1',2,windows[2]).focus,model.focus);
    input.cases[0].input.focused_window_end_sample+=1;
    writeFileSync(path,JSON.stringify(input));
    assert.throws(()=>readCrossAsr(path,'C1',2,windows[2]),
      /CROSS_ASR_COORDINATE_MISMATCH/);
    input.cases[0].input.focused_window_end_sample-=1;
    input.cases[0].original_whisper_focused_window='not original';
    writeFileSync(path,JSON.stringify(input));
    assert.throws(()=>readCrossAsr(path,'C1',2,windows[2]),
      /CROSS_ASR_WHISPER_MISMATCH/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CLI output contains only numeric indices and evidence counts, never Russian transcripts or paths',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ru-p1-private-'));
  try{
    const wpath=join(dir,'windows.json'),cpath=join(dir,'cloud-private.json');
    writeFileSync(wpath,JSON.stringify(windows.map(x=>({
      text:x.text,window_start_sample:x.start,window_end_sample:x.end,final:x.final
    }))));
    writeFileSync(cpath,JSON.stringify({
      format:'ru-class-p1-dashscope-cross-asr-private-v1',
      cases:[{
        case:'C1 #2',
        input:{focused_window_start_sample:windows[2].start,
               focused_window_end_sample:windows[2].end,sample_rate:16000},
        original_whisper_focused_window:windows[2].text,
        independent_dashscope_qwen3_asr:{
          focused_8s_text:model.focus,context_text:model.context,
          focused_language:'ru',context_language:'ru',
          focused_finish_reason:'stop',context_finish_reason:'stop'
        }
      }]
    }));
    const run=spawnSync(process.execPath,['scripts/audit-candidate-attribution.mjs',
      '--windows',wpath,'--cross-asr',cpath,'--case','C1','--index','2'],
      {encoding:'utf8',cwd:process.cwd()});
    assert.equal(run.status,0,run.stderr);
    const result=JSON.parse(run.stdout);
    assert.equal(result.candidateWords,4);
    assert.equal(result.target.index,2);
    assert.doesNotMatch(run.stdout+run.stderr,
      /Совершенно|Непохожее|мысль|cloud-private|ru-p1-private|windows.json/);
    const negative=spawnSync(process.execPath,['scripts/audit-candidate-attribution.mjs',
      '--windows',wpath,'--cross-asr',cpath,'--case','C1','--index','999'],
      {encoding:'utf8',cwd:process.cwd()});
    assert.equal(negative.status,1);
    assert.doesNotMatch(negative.stderr,/ru-p1-private|Совершенно/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('never guess a replacement when the reducer did not actually discard a candidate',()=>{
  assert.throws(()=>auditAttribution([
    make('Привет мир',0,2),
    make('Привет мир снова',1,3,true)
  ],{focus:'Привет мир снова',context:'Привет мир снова'},'C1',1),
  /FOCUSED_WINDOW_NOT_REPLACEMENT/);
});
