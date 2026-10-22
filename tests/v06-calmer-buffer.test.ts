import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser JavaScript has no TS declarations.
import {DraftDisplay} from '../apps/web/caption-display.js';
// @ts-ignore
import {LiveTranslationWorker,splitLiveRussian,openingKey} from '../apps/web/live-translation.js';
// @ts-ignore
import {validateSentenceResult,nextReady,SETTLE_SAMPLES} from '../apps/web/sentence-worker.js';
// @ts-ignore
import {StableUnitJournal,RATE} from '../apps/web/stable-units.js';

test('draft shows agreed words plus one new word, so the window-edge tail does not jump',()=>{
  const d=new DraftDisplay({fresh:1});
  assert.equal(d.update('Сегодня мы'),'Сегодня');                       // nothing agreed yet
  assert.equal(d.update('Сегодня мы изучаем шифро'),'Сегодня мы изучаем'); // 2 agreed + 1 new
  // Whisper rewrites the cut-off tail: the agreed words stay put.
  assert.equal(d.update('Сегодня мы изучаем шифрование.'),'Сегодня мы изучаем шифрование.');
  assert.equal(d.update(''),'');
});
test('confirmed words leave the draft without disturbing the remaining display',()=>{
  const d=new DraftDisplay({fresh:1});
  d.update('Первое слово второе');d.update('Первое слово второе третье');
  assert.equal(d.update('второе третье четвёртое','Первое слово'),'второе третье четвёртое');
});
test('live ZH is split per sentence so finished sentences keep their translation',()=>{
  assert.deepEqual(splitLiveRussian('Первое. Второе предложение? И ещё'),['Первое.','Второе предложение?','И ещё']);
  assert.equal(openingKey('Сегодня, мы изучаем'),'сегодня мы');
});
test('a sentence still being spoken keeps its previous translation marked stale, never blank',async()=>{
  const seen:any[]=[];const profile={baseUrl:'https://asr.example/v1',model:'m',apiKey:'k'};
  const w=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:0,
    request:async(_p:any,text:string)=>'译:'+text,onUpdate:(x:any)=>seen.push(x)});
  w.start('r');
  w.update('Готово. Сегодня мы','r');await w.tick();
  w.update('Готово. Сегодня мы изучаем','r');           // tail changed, not yet translated
  const parts=seen.at(-1).parts;
  assert.deepEqual(parts[0],{text:'译:Готово.',state:'ready'});
  assert.deepEqual(parts[1],{text:'译:Сегодня мы',state:'stale'});
  assert.equal(seen.at(-1).translation,'译:Готово.','verified translation never includes stale text');
  await w.tick();
  assert.deepEqual(seen.at(-1).parts[1],{text:'译:Сегодня мы изучаем',state:'ready'});
  w.close();
});
test('an open tail unit can never be consumed into history',()=>{
  const units=[{id:'1',text:'Первое.'},{id:'2',text:'который'}];
  assert.throws(()=>validateSentenceResult({consumed_units:2,source_prefix:'Первое. который',
    sentences:[{ru:'Первое, который.',zh:'第一个。'}]},units,{openTail:true}),/LLM_INVALID_CONSUMPTION/);
  assert.equal(validateSentenceResult({consumed_units:1,source_prefix:'Первое.',
    sentences:[{ru:'Первое.',zh:'第一。'}]},units,{openTail:true}).count,1);
});
test('a mid-sentence pause no longer splits: the continuation is visible before commit',()=>{
  const j=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:0});
  j.add({stable_delta:'Таблицу меняет назначенный человек.',window_start_sample:0,window_end_sample:8*RATE});
  j.add({stable_delta:'',window_start_sample:RATE,window_end_sample:10*RATE});
  assert.deepEqual(nextReady(j),[],'2 s pause: still open');
  j.add({stable_delta:'который отвечает за доступ.',window_start_sample:3*RATE,window_end_sample:11*RATE});
  const batch=nextReady(j);
  assert.deepEqual(batch.map((u:any)=>u.text),['Таблицу меняет назначенный человек.','который отвечает за доступ.']);
  assert.equal(batch.openTail,true,'the model sees the continuation and can keep the sentence together');
  assert.equal(SETTLE_SAMPLES,4*RATE);
});
