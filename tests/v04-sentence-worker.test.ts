import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser JavaScript has no TS declarations.
import {SentenceWorker,nextReady,validateSentenceResult,requestSentenceBatch,LLM_TIMEOUT_MS,textCompletionBody,textUsage,DEEPSEEK_TRANSLATION_MAX_TOKENS} from '../apps/web/sentence-worker.js';
// @ts-ignore
import {StableUnitJournal,RATE} from '../apps/web/stable-units.js';

const unit=(id:string,text:string)=>({id,text,confirmedWindowEndSample:8*RATE});
test('v0.4 permits multiple formal RU/ZH sentences with exact original prefix',()=>{
  const units=[unit('r:0','Мы обсуждаем безопасность.'),unit('r:1','Следующий пример важен.')];
  const value=validateSentenceResult({
    consumed_units:2,source_prefix:units.map(x=>x.text).join(' '),
    sentences:[{ru:'Мы обсуждаем безопасность.',zh:'我们讨论安全。'},
      {ru:'Следующий пример важен.',zh:'下一个例子很重要。'}]
  },units);
  assert.equal(value.count,2);assert.equal(value.sentences.length,2);
});
test('empty return consumes nothing; malformed and forged source prefixes are rejected',()=>{
  const units=[unit('r:0','Для этого нужно...')];
  assert.equal(validateSentenceResult({consumed_units:0,source_prefix:'',sentences:[]},units).count,0);
  for(const p of [
    {consumed_units:1,source_prefix:'произвольный текст',sentences:[{ru:'x',zh:'y'}]},
    {consumed_units:0,source_prefix:'',sentences:[{ru:'x',zh:'y'}]},
    {consumed_units:2,source_prefix:units[0].text,sentences:[{ru:'x',zh:'y'}]},
    {consumed_units:1,source_prefix:units[0].text,sentences:[]}
  ])assert.throws(()=>validateSentenceResult(p,units),/LLM_/);
});
test('a real confirmed unit four seconds old is sent exactly once after durable storage',async()=>{
  const journal=new StableUnitJournal({classroomId:'class-x',recordingId:'recording-x',startedAt:1780000000000});
  journal.add({stable_delta:'Это пример',window_start_sample:0,window_end_sample:8*RATE});
  journal.add({stable_delta:'',window_start_sample:8*RATE,window_end_sample:12*RATE});
  const committed:any[]=[];let requests=0,saves=0;
  const worker=new SentenceWorker({
    journal,profile:{},intervalMs:10,
    request:async(_:unknown,units:any[])=>{requests++;return {
      consumed_units:1,source_prefix:units[0].text,
      sentences:[{ru:'Это пример.',zh:'这是一个例子。'}]
    };},
    save:async(rows:any[])=>{saves++;committed.push(...rows);},
    onCommit:()=>{}
  });
  await worker.tick();worker.close();
  assert.equal(requests,1);assert.equal(saves,1);
  assert.equal(committed.length,1);
  assert.deepEqual(committed[0].consumedUnitIds,['recording-x:0']);
  assert.equal(journal.ready().length,0);
});
test('write failure does not acknowledge or silently drop the untranslated Russian prefix',async()=>{
  const journal=new StableUnitJournal({classroomId:'class-x',recordingId:'recording-write',startedAt:1780000000000});
  journal.add({stable_delta:'Данная фраза завершена.',window_start_sample:0,window_end_sample:8*RATE,final:true});
  const errors:string[]=[];
  const worker=new SentenceWorker({
    journal,profile:{},intervalMs:10,
    request:async(_:unknown,units:any[])=>({consumed_units:1,source_prefix:units[0].text,
      sentences:[{ru:'Данная фраза завершена.',zh:'这句话已结束。'}]}),
    save:async()=>{throw Error('QuotaExceededError');},
    onError:(e:string)=>errors.push(e)
  });
  await worker.tick();worker.close();
  assert.equal(errors[0],'QuotaExceededError');
  assert.equal(journal.ready().length,1,'no local commit, so no ACK');
});
test('stale response after a course switch/cancellation is not committed',async()=>{
  const journal=new StableUnitJournal({classroomId:'first',recordingId:'rec-first',startedAt:1780000000000});
  journal.add({stable_delta:'Старая информация',window_start_sample:0,window_end_sample:8*RATE,final:true});
  let resolveRequest:(x:any)=>void=()=>{};
  let commits=0;
  const worker=new SentenceWorker({journal,profile:{},intervalMs:10,
    request:()=>new Promise(resolve=>{resolveRequest=resolve;}),
    save:async()=>{commits++;}});
  const task=worker.tick();worker.close();
  resolveRequest({consumed_units:1,source_prefix:'Старая информация',
    sentences:[{ru:'Старая информация',zh:'旧信息'}]});
  await task;
  assert.equal(commits,0);
});
test('browser-direct OpenAI chat interface sends isolated user profile and no central proxy',async()=>{
  const original=globalThis.fetch;
  let url='',auth='',req:any;
  (globalThis as any).fetch=async(input:any,options:any)=>{
    url=String(input);auth=options.headers.Authorization;req=JSON.parse(options.body);
    return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({
      choices:[{message:{content:JSON.stringify({
        consumed_units:1,source_prefix:'Это тест',sentences:[{ru:'Это тест.',zh:'这是测试。'}]
      })}}]
    })};
  };
  try{
    const response=await requestSentenceBatch({baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:'synthetic-test'},[
      {id:'r:0',text:'Это тест',finalBatch:true}
    ]);
    assert.equal(url,'https://api.deepseek.com/v1/chat/completions');
    assert.equal(auth,'Bearer synthetic-test');
    assert.equal(req.model,'deepseek-chat');
    assert.equal(req.messages[1].role,'user');
    assert.equal(response.consumed_units,1);
  }finally{(globalThis as any).fetch=original;}
});

test('text model timeout and one-sentence-per-pair contract use bounded requests',async()=>{
  assert.equal(LLM_TIMEOUT_MS,45000);
  const previous=globalThis.fetch;
  globalThis.fetch=(async()=>{
    throw new DOMException('request timed out','TimeoutError');
  }) as typeof fetch;
  try{
    await assert.rejects(requestSentenceBatch(
      {baseUrl:'https://example.test/v1',model:'test-model',apiKey:'test-key'},
      [{text:'Это тест.',id:'synthetic-0'}]),/LLM_TIMEOUT/);
  }finally{globalThis.fetch=previous;}
  const source=readFileSync('apps/web/sentence-worker.js','utf8');
  assert.match(source,/Return ONE Russian sentence and its ONE matching Simplified Chinese translation/);
  assert.match(source,/result\.length>=8/);
  assert.match(source,/size\+unit\.text\.length\+1>1600/);
});

// Confirmed source remains in its own recording and is drained serially
// after final ASR flush, without requiring any new microphone input.
test('finalized worker drains all pending sentence units in order',async()=>{
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  for(let i=0;i<4;i++)journal.add({stable_delta:'Фраза '+i+'.',
    window_start_sample:i*RATE,window_end_sample:(i+1)*RATE,final:i===3});
  let calls=0,running=0,maxRunning=0,report:any;
  const saved:any[]=[];
  let resolveDone:(value:unknown)=>void=()=>{};
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const worker=new SentenceWorker({journal,profile:{},intervalMs:2,
    request:async(_:unknown,ready:any[])=>{
      calls++;running++;maxRunning=Math.max(running,maxRunning);
      await Promise.resolve();
      running--;
      return {consumed_units:1,source_prefix:ready[0].text,
        sentences:[{ru:ready[0].text,zh:'示例翻译。'}]};
    },
    save:async(rows:any[])=>{saved.push(...rows);},
    onDrain:(status:any)=>{report=status;resolveDone(status);}
  });
  worker.start();
  await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('drain hung')),2500))]);
  assert.equal(calls,4);
  assert.equal(maxRunning,1);
  assert.deepEqual(saved.map(s=>s.index),[0,1,2,3]);
  assert.equal(journal.ready().length,0);
  assert.equal(report.status,'complete');
  assert.equal(report.pending,0);
});
test('final zero-unit LLM response pauses boundedly and keeps original Russian',async()=>{
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  journal.add({stable_delta:'Остаток',window_start_sample:0,window_end_sample:RATE,final:true});
  let calls=0;
  const worker=new SentenceWorker({journal,profile:{},intervalMs:2,
    request:async()=>{calls++;return {consumed_units:0,source_prefix:'',sentences:[]};},
    save:async()=>assert.fail('nothing was translated')});
  const report=new Promise<any>(resolve=>{worker.onDrain=resolve;});
  worker.start();
  const status=await Promise.race([report,new Promise((_,reject)=>setTimeout(()=>reject(Error('pause hung')),2500))]);
  assert.equal(calls,2,'only one final empty retry');
  assert.equal(status.status,'paused');
  assert.equal(status.pending,1);
  assert.equal(status.reason,'LLM_NO_PROGRESS');
  assert.equal(journal.ready().length,1);
});
test('new recording does not cancel finished-recording background translation',()=>{
  const app=readFileSync('apps/web/app.js','utf8');
  assert.match(app,/const translationWorkers=new Map\(\)/);
  assert.match(app,/if\(sentenceWorker&&!sentenceWorker\.journal\.finalized\)/);
  assert.match(app,/translationWorkers\.set\(id,worker\)/);
  assert.match(app,/if\(recordingId===lessonId\)renderCaption\(\)/);
});

test('DeepSeek official host disables thinking and bounds output, other providers stay compatible',()=>{
  const messages=[{role:'user',content:'short test'}];
  const deepseek=textCompletionBody({baseUrl:'https://api.deepseek.com/v1',
    model:'deepseek-flash',messages});
  assert.deepEqual(deepseek.thinking,{type:'disabled'});
  assert.equal(deepseek.max_tokens,2048);
  assert.equal(DEEPSEEK_TRANSLATION_MAX_TOKENS,2048);
  assert.equal(deepseek.stream,false);
  const generic=textCompletionBody({baseUrl:'https://ai.example.test/v1',
    model:'deepseek-flash',messages});
  assert.deepEqual(generic,{model:'deepseek-flash',temperature:0,messages});
  const impersonator=textCompletionBody({baseUrl:'https://api.deepseek.com.attacker.test/v1',
    model:'deepseek-flash',messages});
  assert.deepEqual(impersonator,generic);
});
test('each DeepSeek request reports sanitized token usage and elapsed time',async()=>{
  const before=globalThis.fetch;
  let body:any,results:any[]=[];
  (globalThis as any).fetch=async(_url:string,options:any)=>{
    body=JSON.parse(options.body);
    return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({
      choices:[{finish_reason:'stop',message:{content:JSON.stringify({
        consumed_units:1,source_prefix:'Фраза',
        sentences:[{ru:'Фраза.',zh:'一句话。'}]})}}],
      usage:{prompt_tokens:170,completion_tokens:28,total_tokens:198,
        completion_tokens_details:{reasoning_tokens:0},prompt_cache_hit_tokens:10}
    })};
  };
  try{
    const result=await requestSentenceBatch(
      {baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'secret'},
      [{id:'1',text:'Фраза',finalBatch:true}],
      {onTelemetry:(metric:any)=>{results.push(metric);}});
    assert.equal(result.consumed_units,1);
    assert.equal(body.thinking.type,'disabled');
    assert.equal(body.max_tokens,2048);
    assert.equal(body.stream,false);
    assert.equal(results.length,1);
    assert.equal(results[0].provider,'DeepSeek');
    assert.equal(results[0].status,'ok');
    assert.equal(results[0].totalTokens,198);
    assert.equal(results[0].reasoningTokens,0);
    assert.equal(results[0].cacheHitTokens,10);
    assert.ok(results[0].elapsedMs>=0);
    assert.doesNotMatch(JSON.stringify(results),/secret|Фраза|chat\/completions/);
  }finally{(globalThis as any).fetch=before;}
});
test('truncated DeepSeek completion fails closed but retains available usage',async()=>{
  const before=globalThis.fetch;
  const events:any[]=[];
  (globalThis as any).fetch=async()=>({
    ok:true,headers:new Headers(),text:async()=>JSON.stringify({
      choices:[{finish_reason:'length',message:{content:'{\"incomplete\":'}}],
      usage:{prompt_tokens:10,completion_tokens:2048,total_tokens:2058}
    })
  });
  try{
    await assert.rejects(requestSentenceBatch(
      {baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'secret'},
      [{id:'1',text:'Фраза'}],{onTelemetry:(m:any)=>events.push(m)}
    ),/LLM_OUTPUT_TRUNCATED/);
    assert.equal(events.length,1);
    assert.equal(events[0].status,'LLM_OUTPUT_TRUNCATED');
    assert.equal(events[0].totalTokens,2058);
    assert.equal(events[0].reasoningTokens,null,'unreported usage must not be interpreted as zero');
  }finally{(globalThis as any).fetch=before;}
});
test('text provider errors and missing usage generate a single safe metric',async()=>{
  const before=globalThis.fetch;
  const events:any[]=[];
  (globalThis as any).fetch=async()=>{throw new TypeError('provider unavailable');};
  try{
    await assert.rejects(requestSentenceBatch(
      {baseUrl:'https://example.test/v1',model:'text',apiKey:'private'},
      [{id:'1',text:'сырой текст'}],{onTelemetry:(m:any)=>events.push(m)}
    ),/LLM_NETWORK_FAILED/);
    assert.equal(events.length,1);
    assert.equal(events[0].status,'LLM_NETWORK_FAILED');
    assert.equal(events[0].totalTokens,null);
    assert.equal(events[0].reasoningTokens,null);
    assert.equal(events[0].provider,'OpenAI 兼容');
    assert.equal(textUsage({completion_tokens_details:{reasoning_tokens:3}}).reasoningTokens,3);
  }finally{(globalThis as any).fetch=before;}
});

test('a complete confirmed sentence is eligible immediately, no extra 4s clock',()=>{
  const j=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  j.add({stable_delta:'Завершённое предложение.',window_start_sample:0,window_end_sample:4*RATE});
  assert.deepEqual(j.ready(),[],'legacy age gate still requires 4s for fallback');
  assert.deepEqual(nextReady(j).map((x:any)=>x.text),['Завершённое предложение.']);
});
test('one model call contains at most two completed sentences and no unconfirmed tail',()=>{
  const j=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  j.add({stable_delta:'Первое. Второе. Третье. И ещё',
    window_start_sample:0,window_end_sample:RATE});
  assert.deepEqual(nextReady(j).map((x:any)=>x.text),['Первое.','Второе.']);
  j.acknowledge(nextReady(j).map((x:any)=>x.id));
  assert.deepEqual(nextReady(j).map((x:any)=>x.text),['Третье.']);
  j.acknowledge(nextReady(j).map((x:any)=>x.id));
  assert.deepEqual(nextReady(j),[],'unfinished tail is held until aged or full stop');
  j.add({stable_delta:' продолжается.',window_start_sample:RATE,
    window_end_sample:2*RATE});
  assert.deepEqual(nextReady(j).map((x:any)=>x.text),['И ещё','продолжается.'],
    'a new confirmed sentence-ending fragment promptly releases its incomplete prefix');
});
test('as each complete sentence arrives, each durable commit appears separately before Stop',async()=>{
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  const saved:any[]=[];const commits:number[]=[];
  const worker=new SentenceWorker({journal,profile:{},intervalMs:100000,
    request:async(_:unknown,batch:any[])=>({
      consumed_units:batch.length,source_prefix:batch.map((x:any)=>x.text).join(' '),
      sentences:batch.map((x:any)=>({ru:x.text,zh:'句子。'}))
    }),
    save:async(rows:any[])=>{saved.push(...rows);},
    onCommit:(rows:any[])=>commits.push(rows.length)
  });
  journal.add({stable_delta:'Первая закончена.',window_start_sample:0,window_end_sample:RATE});
  await worker.tick();
  assert.deepEqual(commits,[1]);
  assert.equal(journal.ready().length,0);
  journal.add({stable_delta:'Вторая закончена.',window_start_sample:RATE,window_end_sample:2*RATE});
  await worker.tick();
  worker.close();
  assert.deepEqual(commits,[1,1],'new sentence is committed on a separate update, not in a burst');
  assert.equal(saved.length,2);
  assert.deepEqual(saved.map(x=>x.consumedUnitIds),[['r:0'],['r:1']]);
});
test('trailing ellipsis is incomplete and does not trigger speculative fast translation',()=>{
  const j=new StableUnitJournal({classroomId:'c',recordingId:'ellipsis',startedAt:1000});
  j.add({stable_delta:'Ну, я думаю... Тогда продолжим',
    window_start_sample:0,window_end_sample:RATE});
  assert.deepEqual(nextReady(j),[],
    'ellipsis is not a full sentence boundary before the old age threshold');
  j.add({stable_delta:' после примера.',window_start_sample:RATE,window_end_sample:2*RATE});
  assert.deepEqual(nextReady(j).map((x:any)=>x.text),[
    'Ну, я думаю...','Тогда продолжим','после примера.']);
});
test('confirmed speech without sentence punctuation keeps conservative aged fallback',()=>{
  const j=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:1000});
  j.add({stable_delta:'Незаконченная мысль',window_start_sample:0,window_end_sample:RATE});
  assert.deepEqual(nextReady(j),[]);
  j.add({stable_delta:'',window_start_sample:RATE,window_end_sample:5*RATE});
  assert.deepEqual(nextReady(j).map((x:any)=>x.text),['Незаконченная мысль']);
});
