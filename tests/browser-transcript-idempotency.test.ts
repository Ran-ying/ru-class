import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// @ts-ignore Intentional import of the production browser JavaScript module.
import {TranscriptBuffer} from '../apps/web/transcript.js';

// The UI's *actual* stable_delta + partial_text contract: stable deltas
// cannot be retracted, and the latest partial text replaces the old draft.
class Recorder {
  buffer=new TranscriptBuffer();
  stable='';
  partial='';
  current(){
    return [this.stable,this.partial].filter(Boolean).join(' ');
  }
  update(text:string,start:number,end:number,final=false){
    const row=this.buffer.update(text,start,end,final);
    if(row.stable_delta)this.stable=[this.stable,row.stable_delta].filter(Boolean).join(' ');
    this.partial=row.partial_text;
    return {...row,display:this.current()};
  }
  flush(){
    const row=this.buffer.flush();
    if(row.stable_delta)this.stable=[this.stable,row.stable_delta].filter(Boolean).join(' ');
    this.partial=row.partial_text;
    return {...row,display:this.current()};
  }
}
const S=16000;

test('same sample interval replay is idempotent for every intermediate state',()=>{
  const r=new Recorder();
  const sample=[
    ['Вот теперь мы рассмотрим денежные операции',0,2],
    ['мы рассмотрим денежные операции в банкомате',1,3],
    ['рассмотрим денежные операции в банкомате подробно',2,4],
    ['новое предложение начинается здесь совершенно иначе',3,5],
    ['предложение начинается здесь совершенно иначе сейчас',4,6],
    ['теперь обсудим цифровой кошелёк и банк',5,7],
    ['обсудим цифровой кошелёк и банк отдельно',6,8],
    ['ещё один неожиданный фрагмент произнесён преподавателем',7,9],
    ['один неожиданный фрагмент произнесён преподавателем вслух',8,10]
  ] as const;
  for(const [hypothesis,start,end] of sample){
    r.update(hypothesis,start*S,end*S);
    const before=r.current();
    const stableBefore=r.stable;
    const replay=r.update(hypothesis,start*S,end*S);
    assert.equal(replay.stable_delta,'','no stable words may be emitted for identical audio');
    assert.equal(r.current(),before,'same audio replay must not alter visible text');
    assert.equal(r.stable,stableBefore,'stable content must not change');
  }
  const a=r.flush();const final=r.current();const b=r.flush();
  assert.equal(a.partial_text,'');
  assert.equal(b.stable_delta,'');
  assert.equal(b.partial_text,'');
  assert.equal(r.current(),final);
});

test('different decoding of the same sample range is not a new spoken sentence',()=>{
  const r=new Recorder();
  const first=r.update('Здесь есть электронный кошелёк',0,2*S);
  const revision=r.update('Здесь электронный шокер',0,2*S);
  assert.equal(revision.stable_delta,'');
  assert.equal(revision.display,first.display);
  r.flush();
  assert.equal(r.current(),'Здесь есть электронный кошелёк');
});

test('unchanged overlapping hypotheses do not append fresh copies',()=>{
  const r=new Recorder();
  for(let second=2;second<=8;second++){
    const row=r.update('Я могу узнать где вы платили',Math.max(0,second-8)*S,second*S);
    assert.equal(row.display,'Я могу узнать где вы платили',String(second));
  }
  assert.equal(r.flush().display,'Я могу узнать где вы платили');
});

test('a genuine repeated utterance in disjoint audio ranges is not deleted',()=>{
  const r=new Recorder();
  r.update('Я могу узнать где вы платили',0,2*S);
  r.update('Я могу узнать где вы платили',12*S,14*S);
  const final=r.flush();
  assert.equal(final.display,'Я могу узнать где вы платили Я могу узнать где вы платили');
});

test('ordered adjacent rolling hypotheses maintain first words and one tail',()=>{
  const r=new Recorder();
  const out=[
    r.update('Сегодня мы будем обсуждать методы защиты',0,8*S),
    r.update('мы будем обсуждать методы защиты информации',S,9*S),
    r.update('будем обсуждать методы защиты информации сегодня',2*S,10*S),
    r.update('обсуждать методы защиты информации сегодня подробно',3*S,11*S),
    r.flush()
  ];
  assert.equal(out.at(-1)?.display,'Сегодня мы будем обсуждать методы защиты информации сегодня подробно');
});

test('independent new classroom topic with a new anchor is retained',()=>{
  const r=new Recorder();
  r.update('Первое длинное предложение',0,2*S);
  r.update('длинное предложение закончено',S,3*S);
  r.update('Это совсем другая тема',2*S,4*S);
  r.update('совсем другая тема сегодня',3*S,5*S);
  assert.equal(r.flush().display,'Первое длинное предложение закончено Это совсем другая тема сегодня');
});

test('realistic repeated words in a single ASR hypothesis remain intact',()=>{
  const r=new Recorder();
  r.update('Да да да это всё верно',0,3*S);
  r.update('да да это всё верно наверное',S,4*S);
  const finished=r.flush().display;
  assert.match(finished,/Да да да/);
  assert.match(finished,/наверное/);
});

test('empty windows and stop preserve stable content, do not double flush',()=>{
  const r=new Recorder();
  r.update('Здесь число и подпись банка',0,2*S);
  r.update('число и подпись банка находится здесь',S,3*S);
  r.update('',2*S,4*S);
  const quiet=r.update('',3*S,5*S);
  assert.equal(quiet.partial_text,'');
  const finalized=quiet.display;
  assert.equal(r.flush().display,finalized);
  assert.equal(r.flush().stable_delta,'');
});

test('out-of-order older audio is rejected; identical current audio is not',()=>{
  const r=new Recorder();
  r.update('Первая гипотеза',0,2*S);
  r.update('Вторая гипотеза',S,3*S);
  assert.throws(()=>r.update('Устаревший пакет',0,2*S),/TRANSCRIPT_WINDOW_ORDER/);
  assert.doesNotThrow(()=>r.update('Вторая гипотеза',S,3*S));
});

test('privacy-safe local replay CLI can verify a synthetic cache without printing speech',()=>{
  const run=spawnSync(process.execPath,[
    'scripts/replay-browser-transcript.mjs',
    'tests/fixtures/synthetic-window-hypotheses.json'
  ],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const report=JSON.parse(run.stdout);
  assert.equal(report.inputWindows,5);
  assert.equal(report.sameRangeReplayViolations,0);
  assert.equal(report.sameRangeReplayStableDeltas,0);
  assert.equal(report.doubleFlushSafe,true);
  assert.ok(report.finalWordCount>0);
  assert.doesNotMatch(run.stdout,/кошельке|защиты/,'Report must not leak raw classroom transcript');
});
