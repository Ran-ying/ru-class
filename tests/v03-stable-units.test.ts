import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser ESM JS module intentionally has no TypeScript declarations.
import {StableUnitJournal,RATE,STABLE_AGE_SAMPLES} from '../apps/web/stable-units.js';
import {readFileSync} from 'node:fs';

const setup=(id='recording-1')=>
  new StableUnitJournal({classroomId:'class-1',recordingId:id,startedAt:1760000000000});
const row=(delta:string,endSeconds:number,opts:{start?:number;final?:boolean}={})=>({
  stable_delta:delta,partial_text:'',
  window_start_sample:(opts.start??Math.max(0,endSeconds-8))*RATE,
  window_end_sample:endSeconds*RATE,final:opts.final??false
});

test('8-second rule applies AFTER stable confirmation, not from an inferred word timestamp',()=>{
  const j=setup();
  const result=j.add(row('Мы изучаем',8));
  assert.equal(result.length,1);
  assert.equal(result[0].id,'recording-1:0');
  assert.equal(result[0].confirmedWindowEndSample,8*RATE);
  assert.equal(result[0].speechStartSample,null);
  assert.equal(result[0].speechEndSample,null);
  assert.equal(result[0].timeBasis,'estimated_capture_epoch_plus_confirmation_window_end');
  assert.deepEqual(j.ready(),[],'confirmed text at t=8 is not immediately LLM eligible');
  j.add(row('',15));
  assert.deepEqual(j.ready(),[],'t=15 still younger than 8 seconds after confirmation');
  j.add(row('',16));
  assert.deepEqual(j.ready().map((x:any)=>x.id),['recording-1:0']);
  assert.equal(STABLE_AGE_SAMPLES,128000);
  j.acknowledge(['recording-1:0']);
  assert.deepEqual(j.ready(),[],'at-least-once downstream sends require an explicit acknowledgement');
});
test('unanchored or partial tail must not become DeepSeek input merely after 8 sec',()=>{
  const j=setup();
  j.add({...row('',8),partial_text:'Эти слова могут измениться'});
  j.add({...row('',40),partial_text:'Но распознавание еще не подтвердило'});
  assert.deepEqual(j.export(),[]);
  assert.deepEqual(j.ready(),[]);
});
test('final stop flush releases remaining confirmed words only; sessions stay independent',()=>{
  const a=setup('segment-A');
  a.add(row('Первая фраза',8));
  a.add(row('закончена',9,{final:true}));
  assert.deepEqual(a.ready().map((x:any)=>x.id),['segment-A:0','segment-A:1']);
  assert.throws(()=>a.add(row('снова',10)),/UNIT_JOURNAL_FINALIZED/);
  const b=setup('segment-B');
  b.add(row('Вторая фраза',8));
  assert.deepEqual(b.ready(),[]);
  assert.equal(b.units[0].ordinal,0);
  assert.notEqual(a.units[0].id,b.units[0].id);
});
test('same-name repeated phrases remain distinct independent confirmations',()=>{
  const j=setup();
  j.add(row('повторим термин',8));
  j.add(row('повторим термин',18));
  assert.deepEqual(j.export().map((x:any)=>x.id),['recording-1:0','recording-1:1']);
  assert.deepEqual(j.ready().map((x:any)=>x.id),['recording-1:0']);
});
test('invalid sample ranges, out-of-order windows and invalid ack fail explicitly',()=>{
  const j=setup();
  assert.throws(()=>j.add(row('first',8,{start:9})),/INVALID_UNIT_WINDOW/);
  j.add(row('first',8));
  assert.throws(()=>j.add(row('backward',7)),/INVALID_UNIT_WINDOW/);
  assert.throws(()=>j.acknowledge(['recording-1:44']),/UNKNOWN_UNIT_ACK/);
});
test('page keeps visually separate stable and draft RU spans, session metadata stays in browser only',()=>{
  const html=readFileSync('apps/web/index.html','utf8');
  const js=readFileSync('apps/web/app.js','utf8');
  const css=readFileSync('apps/web/style.css','utf8');
  assert.match(html,/id="ru-stable"/);
  assert.match(html,/id="ru-draft"/);
  assert.match(js,/sourceJournal=new StableUnitJournal/);
  assert.match(js,/stableUnits:sourceJournal\?\.export\(\)\|\|\[\]/);
  assert.match(js,/sourceJournal\?\.add\(update\)/);
  assert.match(css,/#ru-draft/);
  assert.doesNotMatch(js,/fetch\([^)]*deepseek/iu);
});
