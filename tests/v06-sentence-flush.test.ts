import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser JavaScript has no TS declarations.
import {SentenceWorker,overdueBatch,FLUSH_AGE_SAMPLES,requestSentenceBatch} from '../apps/web/sentence-worker.js';
// @ts-ignore
import {StableUnitJournal,RATE} from '../apps/web/stable-units.js';

// Real classroom ASR (2026-10-22): DeepSeek answered consumed_units 0 to every
// live probe, so nothing reached history until Stop. Overdue units must flush.
function journalWith(parts:[string,number][]){
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1780000000000});
  let start=0;
  for(const [text,end] of parts){journal.add({stable_delta:text,window_start_sample:start,window_end_sample:end*RATE});start=end*RATE;}
  return journal;
}
test('nothing is overdue while the oldest pending unit is younger than the flush age',()=>{
  const journal=journalWith([['У вас на флешке?',8],['Продаются эти деньги.',12]]);
  assert.equal(FLUSH_AGE_SAMPLES,15*RATE);
  assert.deepEqual(overdueBatch(journal),[]);
});
test('an overdue backlog is cut at its last sentence end',()=>{
  const journal=journalWith([['У вас на флешке?',8],['Продаются эти деньги.',12],['когда вы',16],['рассчитываетесь',20],['',24]]);
  assert.deepEqual(overdueBatch(journal).map((u:any)=>u.text),['У вас на флешке?','Продаются эти деньги.']);
});
test('an overdue backlog without punctuation releases only its overdue units',()=>{
  const journal=journalWith([['когда вы',8],['рассчитываете эти',12],['деньги набирая',26]]);
  assert.deepEqual(overdueBatch(journal).map((u:any)=>u.text),['когда вы']);
});
test('a stalled model still advances history: overdue units are sent with flush and committed',async()=>{
  const journal=journalWith([['У вас на флешке?',8],['Продаются эти деньги.',12],['когда вы',16],['',24]]);
  const seen:any[]=[];const committed:any[]=[];
  const worker=new SentenceWorker({journal,profile:{},intervalMs:10,
    request:async(_:unknown,units:any[])=>{
      seen.push(units.map(u=>({text:u.text,flush:Boolean(u.flushBatch)})));
      if(!units[0].flushBatch)return {consumed_units:0,source_prefix:'',sentences:[]};
      return {consumed_units:units.length,source_prefix:units.map(u=>u.text).join(' '),
        sentences:units.map(u=>({ru:u.text,zh:'译'}))};
    },
    save:async(rows:any[])=>{committed.push(...rows);}});
  await worker.tick();worker.close();
  assert.equal(seen.length,1);
  assert.deepEqual(seen[0],[{text:'У вас на флешке?',flush:true},{text:'Продаются эти деньги.',flush:true}]);
  assert.equal(committed.length,2);
});
test('an empty overdue reply is not re-billed for the same prefix without new text',async()=>{
  const journal=journalWith([['У вас на флешке?',8],['',24]]);
  let requests=0;
  const worker=new SentenceWorker({journal,profile:{},intervalMs:10,
    request:async()=>{requests++;return {consumed_units:0,source_prefix:'',sentences:[]};},
    save:async()=>{}});
  await worker.tick();
  const pending=worker.timer;clearTimeout(pending);worker.timer=null;
  await worker.tick();worker.close();
  assert.equal(requests,1);
});
test('the request tells the model about flush and asks it to correct ASR words',async()=>{
  const original=globalThis.fetch;let body:any;
  globalThis.fetch=(async(_u:string,options:any)=>{body=JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{message:{content:'{"consumed_units":0,"source_prefix":"","sentences":[]}'}}]}),{status:200});}) as any;
  try{
    await requestSentenceBatch({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'k'},
      [{id:'1',text:'Фраза.',finalBatch:false,flushBatch:true}]);
  }finally{globalThis.fetch=original;}
  assert.equal(JSON.parse(body.messages[1].content).flush,true);
  assert.match(body.messages[0].content,/actively correct ASR errors/);
  assert.match(body.messages[0].content,/flush is true/);
});
