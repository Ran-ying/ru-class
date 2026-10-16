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
  assert.equal(report.firstStopVisibilityViolations,0);
  assert.equal(report.plainVsInjectedMismatches,0);
  assert.equal(report.doubleFlushSafe,true);
  assert.ok(report.finalWordCount>0);
  assert.doesNotMatch(run.stdout,/кошельке|защиты/,'Report must not leak raw classroom transcript');
});

test('non-consecutive silence separated by unchanged speech must not prematurely finalize an old wrong word',()=>{
  const r=new Recorder();
  const rows=[
    ['Здесь электронный шокер',0,2],
    ['',0,3],
    ['Здесь электронный шокер',0,4],
    ['',0,5],
    ['Здесь электронный кошелёк',0,6]
  ] as const;
  for(const [text,start,end] of rows)r.update(text,start*S,end*S);
  assert.equal(r.flush().display,'Здесь электронный кошелёк');
  assert.equal(r.flush().stable_delta,'');
});

test('an alternative unanchored draft is committed exactly as displayed when recording stops',()=>{
  const r=new Recorder();
  const tok=(s:string)=>s.split(' ').map(display=>({display,key:display.toLowerCase()}));
  r.buffer.pending=tok('можно было на сень');
  r.buffer.unanchored=tok('можно было на 7-й перекат');
  const preliminary=r.buffer.state();
  r.partial=preliminary.partial_text;
  assert.equal(r.current(),'можно было на 7-й перекат');
  const stopped=r.flush();
  assert.equal(stopped.partial_text,'');
  assert.equal(stopped.display,'можно было на 7-й перекат');
  assert.doesNotMatch(stopped.display,/сень/);
  assert.equal(r.flush().stable_delta,'');
});

test('an unanchored hypothesis matching an already-stable tail is not redisplayed at stop',()=>{
  const r=new Recorder();
  r.update('Я могу узнать где вы платили',0,2*S);
  r.flush();
  const tok=(s:string)=>s.split(' ').map(display=>({display,key:display.toLowerCase()}));
  r.buffer.unanchored=tok('где вы платили когда вы платили');
  const preview=r.buffer.state();
  r.partial=preview.partial_text;
  assert.equal(preview.partial_text,'когда вы платили');
  const displayed=r.current();
  assert.equal(r.flush().display,displayed);
  assert.equal(r.flush().stable_delta,'');
});

test('first stop/flush never resurrects a previously hidden draft interpretation',()=>{
  const seq=[
    ['Карточка просто клалась в этот блокнотик',0,2],
    ['просто клалась в этот блокнотик и уносилась',1,3],
    ['клалась в этот блокнотик и уносилась куда-то',2,4],
    ['Потому что карточка отслеживается',3,5],
    ['карточка отслеживается когда вы платили',4,6],
    ['Вы действительно рискуете всем своим счётом',5,7],
    ['действительно рискуете всем своим счётом',6,8],
    ['Я могу узнать где вы платили',7,9],
    ['узнать где вы платили когда платили',8,10]
  ] as const;
  for(let stopAt=1;stopAt<=seq.length;stopAt++){
    const r=new Recorder();
    for(const [text,start,end] of seq.slice(0,stopAt))r.update(text,start*S,end*S);
    const before=r.current();
    assert.equal(r.flush().display,before,'stop at prefix '+stopAt);
    assert.equal(r.flush().stable_delta,'','repeated stop at prefix '+stopAt);
  }
});


test('moving overlapping windows must not reconfirm words already in stable tail',()=>{
  const r=new Recorder();
  r.update('Я могу узнать где вы платили',0,2*S);
  r.flush(); // An immutable stable prefix, as in an earlier rolling-window commit.
  const tok=(s:string)=>s.split(' ').map(display=>({
    display,key:display.normalize('NFKC').toLowerCase()
  }));
  // An ASR alternate from the same overlapping acoustic passage refers back
  // to the stable tail, while the next window corroborates and extends it.
  r.buffer.unanchored=tok('где вы платили когда вы платили');
  r.buffer.lastHypothesis=tok('где вы платили когда вы платили');
  r.buffer.lastWindowStart=S;
  r.buffer.lastWindowEnd=3*S;
  const preview=r.buffer.state();
  r.partial=preview.partial_text;
  const before=r.current();
  assert.equal(before,'Я могу узнать где вы платили когда вы платили');
  const after=r.update('вы платили когда вы платили наличными',2*S,4*S);
  assert.equal(after.display,'Я могу узнать где вы платили когда вы платили наличными');
  assert.equal(r.flush().display,after.display);
  assert.equal(r.flush().stable_delta,'');
});

test('overlap reconciles alternative draft without confirming both interpretations',()=>{
  const r=new Recorder();
  const tok=(s:string)=>s.split(' ').map(display=>({
    display,key:display.normalize('NFKC').toLowerCase()
  }));
  r.buffer.stable=tok('Сегодня обсуждаем оплату картой здесь');
  r.buffer.sentStable=r.buffer.stable.length;
  r.stable='Сегодня обсуждаем оплату картой здесь';
  r.buffer.pending=[];
  r.buffer.unanchored=tok('оплату картой здесь электронный кошелёк');
  r.buffer.lastHypothesis=tok('оплату картой здесь электронный кошелёк');
  r.buffer.lastWindowStart=S;
  r.buffer.lastWindowEnd=3*S;
  const preview=r.buffer.state();
  r.partial=preview.partial_text;
  const before=r.current();
  assert.equal(before,'Сегодня обсуждаем оплату картой здесь электронный кошелёк');
  const result=r.update('картой здесь электронный кошелёк и наличные',2*S,4*S);
  assert.equal(result.display,'Сегодня обсуждаем оплату картой здесь электронный кошелёк и наличные');
  assert.equal(r.flush().display,result.display);
});

test('a clearly independent moving-window topic remains available',()=>{
  const r=new Recorder();
  r.update('Карточка отслеживается банком',0,2*S);
  r.update('Совсем другая тема здесь',S,3*S);
  r.update('другая тема здесь объясняется подробно',2*S,4*S);
  const finished=r.flush();
  assert.match(finished.display,/Карточка отслеживается банком/);
  assert.match(finished.display,/Совсем другая тема здесь объясняется подробно/);
});
