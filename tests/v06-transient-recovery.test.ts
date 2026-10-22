import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser-style JS is tested directly as a production module.
import {BrowserAsrSession,isTransientAsrError,asrFailureReason,ASR_STARTUP_FAILURES} from '../apps/web/direct-asr.js';
// @ts-ignore
import {SentenceWorker} from '../apps/web/sentence-worker.js';
// @ts-ignore
import {StableUnitJournal,RATE} from '../apps/web/stable-units.js';

const R=16000;
const profile={baseUrl:'https://asr.example/v1',model:'small',apiKey:'k'};
function withFetch(handler:(n:number)=>Response|Promise<Response>){
  const original=globalThis.fetch;let n=0;
  globalThis.fetch=(async()=>handler(n++)) as any;
  return ()=>{globalThis.fetch=original;};
}
const ok=(text:string)=>new Response(JSON.stringify({text,segments:[]}),{status:200});

test('transient ASR errors are classified apart from configuration errors',()=>{
  for(const m of ['ASR_HTTP_502','ASR_HTTP_503','ASR_HTTP_429','ASR_HTTP_408','API 请求超时','INVALID_ASR_RESPONSE',
    '无法直接连接此 API。可能不支持 CORS、网络不可达或 TLS 证书无效；RU-Class 不提供代理。'])
    assert.equal(isTransientAsrError(new Error(m)),true,m);
  assert.equal(isTransientAsrError(new SyntaxError('Unexpected token')),true);
  for(const m of ['ASR_HTTP_401','ASR_HTTP_403','ASR_HTTP_404','ASR_HTTP_400','REQUEST_ABORTED'])
    assert.equal(isTransientAsrError(new Error(m)),false,m);
});
test('a 502 during a lesson is retried with backoff and does not end the session',async()=>{
  const errors:unknown[]=[],retries:any[]=[],recovered:any[]=[],updates:any[]=[];
  const restore=withFetch(n=>n===0?ok('Добрый день.'):n<3?new Response('{}',{status:502}):ok('Добрый день. Начнём.'));
  const session=new BrowserAsrSession(profile,(u:any)=>updates.push(u),(e:unknown)=>errors.push(e),()=>{},
    {onRetry:(r:any)=>retries.push(r),onRecover:(r:any)=>recovered.push(r)});
  try{
    session.ring.push(new Float32Array(4*R));
    await session.run();                       // success
    session.ring.push(new Float32Array(R));await session.run(); // 502 #1
    assert.equal(session.active,true);
    assert.equal(retries.length,1);assert.equal(retries[0].delayMs,1000);
    await session.run();                       // still backing off: no request
    assert.equal(retries.length,1);
    session.retryAt=0;session.ring.push(new Float32Array(R));await session.run(); // 502 #2
    assert.equal(retries[1].delayMs,2000);
    session.retryAt=0;session.ring.push(new Float32Array(R));await session.run(); // recovered
    assert.deepEqual(recovered,[{failures:2}]);
    assert.equal(errors.length,0);
    assert.equal(updates.length,2);
  }finally{session.cancel();restore();}
});
test('a bad token still stops the session immediately',async()=>{
  const errors:unknown[]=[];
  const restore=withFetch(()=>new Response('{}',{status:401}));
  const session=new BrowserAsrSession(profile,()=>{},(e:unknown)=>errors.push(e));
  try{
    session.ring.push(new Float32Array(4*R));
    await assert.rejects(session.run(),/ASR_HTTP_401/);
  }finally{session.cancel();restore();}
});
test('an address that never answered fails after a few attempts instead of retrying silently',async()=>{
  const restore=withFetch(()=>{throw new TypeError('Failed to fetch');});
  const session=new BrowserAsrSession(profile,()=>{},()=>{});
  try{
    session.ring.push(new Float32Array(4*R));
    for(let i=1;i<ASR_STARTUP_FAILURES;i++){session.retryAt=0;session.ring.push(new Float32Array(R));await session.run();}
    session.retryAt=0;session.ring.push(new Float32Array(R));
    await assert.rejects(session.run(),/无法直接连接/);
  }finally{session.cancel();restore();}
});
test('Stop still completes when the server is down for the tail window',async()=>{
  const updates:any[]=[];
  const restore=withFetch(n=>n===0?ok('Добрый день.'):new Response('{}',{status:503}));
  const session=new BrowserAsrSession(profile,(u:any)=>updates.push(u),()=>{});
  try{
    session.ring.push(new Float32Array(4*R));await session.run();
    session.ring.push(new Float32Array(R));
    await session.stop();
    assert.equal(session.active,false);
    const last=updates.at(-1);
    assert.equal(last.final,true);assert.equal(last.tail_lost,true);
  }finally{session.cancel();restore();}
});
test('a text-model outage while recording is retried with backoff, never blocked for the lesson',async()=>{
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:0});
  journal.add({stable_delta:'Фраза завершена.',window_start_sample:0,window_end_sample:8*RATE});
  journal.add({stable_delta:'',window_start_sample:8*RATE,window_end_sample:13*RATE});
  let calls=0;const delays:number[]=[];
  const worker=new SentenceWorker({journal,profile:{},intervalMs:10,
    request:async(_:unknown,units:any[])=>{calls++;if(calls<=5)throw Error('LLM_HTTP_503');
      return {consumed_units:1,source_prefix:units[0].text,sentences:[{ru:'Фраза завершена.',zh:'句子结束了。'}]};},
    save:async()=>{}});
  const schedule=worker.schedule.bind(worker);
  worker.schedule=(ms?:number)=>{delays.push(ms??worker.intervalMs);};
  for(let i=0;i<6;i++)await worker.tick();
  worker.schedule=schedule;worker.close();
  assert.equal(calls,6,'same prefix keeps being retried during the lesson');
  assert.deepEqual(delays.slice(0,5),[5000,10000,20000,40000,60000]);
  assert.equal(journal.ready().length,0);
});
test('after Stop a failing drain is still bounded to three attempts',async()=>{
  const journal=new StableUnitJournal({classroomId:'c',recordingId:'r',startedAt:0});
  journal.add({stable_delta:'Фраза.',window_start_sample:0,window_end_sample:8*RATE,final:true});
  let calls=0;const drains:any[]=[];
  const worker=new SentenceWorker({journal,profile:{},intervalMs:10,
    request:async()=>{calls++;throw Error('LLM_HTTP_503');},save:async()=>{},onDrain:(d:any)=>drains.push(d)});
  worker.schedule=()=>{};
  for(let i=0;i<5;i++)await worker.tick();
  assert.equal(calls,3);
  assert.equal(drains[0]?.status,'paused');assert.equal(drains[0]?.reason,'LLM_RETRY_EXHAUSTED');
});
test('mid-lesson retry reasons are short',()=>{
  assert.equal(asrFailureReason('ASR_HTTP_429'),'服务器忙（429）');
  assert.equal(asrFailureReason('ASR_HTTP_502'),'服务器错误（HTTP 502）');
  assert.equal(asrFailureReason('API 请求超时'),'请求超时');
  assert.equal(asrFailureReason('无法直接连接此 API。可能不支持 CORS'),'网络连接失败');
});
