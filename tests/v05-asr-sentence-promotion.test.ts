import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser-only LocalAgreement implementation.
import {TranscriptBuffer} from '../apps/web/transcript.js';
// @ts-ignore Browser-only immutable source journal.
import {StableUnitJournal} from '../apps/web/stable-units.js';
// @ts-ignore Browser-only formal DeepSeek worker.
import {SentenceWorker,nextReady} from '../apps/web/sentence-worker.js';
const RATE=16000;
test('two distinct overlapping windows confirming the same full sentence immediately promote stable source',async()=>{
  const asr=new TranscriptBuffer();
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  const first=asr.update('Сегодня мы изучаем защиту информации.',0,8*RATE);
  journal.add({...first,window_start_sample:0,window_end_sample:8*RATE});
  assert.equal(first.stable_delta,'');
  assert.equal(first.partial_text,'Сегодня мы изучаем защиту информации.');
  const second=asr.update('Сегодня мы изучаем защиту информации.',RATE,9*RATE);
  journal.add({...second,window_start_sample:RATE,window_end_sample:9*RATE});
  assert.equal(second.stable_delta,'Сегодня мы изучаем защиту информации.');
  assert.equal(second.partial_text,'');
  assert.equal(journal.ready().length,0,'legacy four-second fallback still untouched');
  assert.equal(nextReady(journal)[0].text,second.stable_delta,
    'complete sentence must be eligible for DeepSeek without waiting 4 more seconds');
  let persisted:any[]=[];
  const worker=new SentenceWorker({journal,profile:{},intervalMs:100000,
    request:async(_profile:any,units:any[])=>({
      consumed_units:1,source_prefix:units[0].text,
      sentences:[{ru:units[0].text,zh:'今天我们学习信息保护。'}]
    }),save:async(rows:any[])=>{persisted=rows;}});
  await worker.tick();worker.close();
  assert.equal(persisted.length,1);
  assert.equal(journal.delivered.size,1);
});
test('different interpretation or changed terminal punctuation does not prematurely confirm draft',()=>{
  const asr=new TranscriptBuffer();
  asr.update('Сегодня мы изучаем защиту информации.',0,8*RATE);
  const next=asr.update('Сегодня мы изучаем защиту информации?',RATE,9*RATE);
  assert.equal(next.stable_delta,'');
  assert.match(next.partial_text,/информации\./);
});
test('ellipsis is never a confirmed terminal sentence boundary',()=>{
  const asr=new TranscriptBuffer();
  asr.update('Сегодня, наверное, стоит подумать...',0,8*RATE);
  const next=asr.update('Сегодня, наверное, стоит подумать...',RATE,9*RATE);
  assert.equal(next.stable_delta,'');
  assert.match(next.partial_text,/подумать\.\.\./);
});
test('same exact sample-range replay is not a second confirmation',()=>{
  const asr=new TranscriptBuffer();
  asr.update('Это полное предложение.',0,8*RATE);
  const duplicate=asr.update('Это полное предложение.',0,8*RATE);
  assert.equal(duplicate.stable_delta,'');
  assert.equal(duplicate.partial_text,'Это полное предложение.');
});
test('identical overlapping long speech without punctuation advances confirmed prefix for semantic DeepSeek',()=>{
  const transcript=new TranscriptBuffer();
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'no-period',startedAt:1000});
  const speech='Сегодня преподаватель подробно объясняет студентам способы надежной защиты информации при использовании различных цифровых устройств в университетской аудитории';
  const first=transcript.update(speech,0,8*RATE);
  journal.add({...first,window_start_sample:0,window_end_sample:8*RATE});
  const second=transcript.update(speech,RATE,9*RATE);
  journal.add({...second,window_start_sample:RATE,window_end_sample:9*RATE});
  assert.ok(second.stable_delta.split(' ').length>=12);
  assert.ok(second.partial_text.split(' ').length<=3);
  assert.deepEqual(journal.ready(),[],'unpunctuated fallback still waits');
  assert.equal(nextReady(journal).length,1,
    'semantic probe is now eligible without 4 extra seconds for confirmed long prefix');
});
test('a silence gap is not two uninterrupted matching confirmations',()=>{
  const asr=new TranscriptBuffer();
  asr.update('Здесь электронный шокер.',0,2*RATE);
  asr.update('',0,3*RATE);
  const next=asr.update('Здесь электронный шокер.',0,4*RATE);
  assert.equal(next.stable_delta,'');
  assert.equal(next.partial_text,'Здесь электронный шокер.');
  const correction=asr.update('Здесь электронный кошелёк.',0,5*RATE);
  assert.equal(correction.stable_delta,'');
});
test('early sentence ACK removes only durable confirmed RU from bottom projection',()=>{
  const asr=new TranscriptBuffer();
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  const first=asr.update('Первое предложение. И новые слова',0,8*RATE);
  journal.add({...first,window_start_sample:0,window_end_sample:8*RATE});
  const confirmed=asr.update('Первое предложение. И новые слова',RATE,9*RATE);
  journal.add({...confirmed,window_start_sample:RATE,window_end_sample:9*RATE});
  assert.equal(confirmed.stable_delta,'Первое предложение.');
  assert.equal(confirmed.partial_text,'И новые слова');
  journal.acknowledge(journal.units.map((x:any)=>x.id));
  const confirmedText=journal.units.filter((x:any)=>journal.delivered.has(x.id)).map((x:any)=>x.text).join(' ');
  const entire=[confirmed.stable_delta,confirmed.partial_text].filter(Boolean).join(' ');
  const remainder=entire.slice(confirmedText.length).trimStart();
  assert.equal(remainder,'И новые слова');
});
