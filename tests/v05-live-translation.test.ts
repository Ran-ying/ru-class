import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Browser-only JavaScript is intentionally untyped.
import {requestLocalTranslation,liveTranslationEndpoint,LiveTranslationWorker,LIVE_MAX_SOURCE_CHARS} from '../apps/web/live-translation.js';

const profile={baseUrl:'https://asr.example.test/v1',model:'small',apiKey:'fake-secret'};
test('local translation URL derives only from the configured ASR profile',()=>{
  assert.equal(liveTranslationEndpoint(profile),'https://asr.example.test/v1/translate');
  assert.equal(liveTranslationEndpoint({...profile,baseUrl:'http://127.0.0.1:3000/v1'}),
    'http://127.0.0.1:3000/v1/translate');
  assert.throws(()=>liveTranslationEndpoint({...profile,baseUrl:'http://remote.example/v1'}));
});
test('browser sends RU to user-selected authenticated endpoint and validates translation',async()=>{
  const before=globalThis.fetch;
  let url:any,opts:any;
  (globalThis as any).fetch=async(uri:any,options:any)=>{
    url=uri;opts=options;
    return {ok:true,text:async()=>JSON.stringify({
      translation:'信息保护很重要。',source:'ru',target:'zh'
    })};
  };
  try{
    assert.equal(await requestLocalTranslation(profile,'Защита информации важна.'),
      '信息保护很重要。');
    assert.equal(url,'https://asr.example.test/v1/translate');
    assert.equal(opts.method,'POST');
    assert.equal(opts.headers.Authorization,'Bearer fake-secret');
    assert.equal(opts.credentials,'omit');
    assert.deepEqual(JSON.parse(opts.body),{
      text:'Защита информации важна.',source:'ru',target:'zh'
    });
  }finally{(globalThis as any).fetch=before;}
});
test('bad translation schema, unsupported endpoint and network problems fail safely',async()=>{
  const before=globalThis.fetch;
  try{
    for(const output of [
      {translation:'',source:'ru',target:'zh'},
      {translation:'hello',source:'en',target:'zh'},
      {translation:'hello',source:'ru',target:'en'}
    ]){
      (globalThis as any).fetch=async()=>({ok:true,text:async()=>JSON.stringify(output)});
      await assert.rejects(requestLocalTranslation(profile,'text'),/TRANSLATION_INVALID_RESPONSE/);
    }
    (globalThis as any).fetch=async()=>({ok:false,status:404});
    await assert.rejects(requestLocalTranslation(profile,'text'),/TRANSLATION_HTTP_404/);
    (globalThis as any).fetch=async()=>{throw new TypeError('network');};
    await assert.rejects(requestLocalTranslation(profile,'text'),/TRANSLATION_NETWORK_OR_CORS/);
  }finally{(globalThis as any).fetch=before;}
});
test('late response cannot override a newer RU revision',async()=>{
  let began:()=>void=()=>{},finish:(s:string)=>void=()=>{};
  const started=new Promise<void>(resolve=>{began=resolve;});
  const response=new Promise<string>(resolve=>{finish=resolve;});
  let requests=0;const seen:any[]=[];
  const worker=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:100000,
    request:async()=>{requests++;began();return response;},onUpdate:(x:any)=>seen.push(x)});
  worker.start('r1');worker.update('Первый вариант','r1');
  const inFlight=worker.tick();await started;
  worker.update('Исправленный вариант','r1');
  finish('旧版本的翻译');await inFlight;
  assert.equal(requests,1);
  assert.ok(!seen.some(s=>s.translation==='旧版本的翻译'));
  assert.equal(worker.revision,2);
  worker.close();
});
test('new recording/close invalidates in-flight requests without affecting ASR',async()=>{
  let finish:(s:string)=>void=()=>{};let called=0;
  const slow=new Promise<string>(resolve=>{finish=resolve;});
  const seen:any[]=[];
  const worker=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:100000,
    request:async()=>{called++;return slow;},onUpdate:(x:any)=>seen.push(x)});
  worker.start('a');worker.update('Русский','a');
  const inFlight=worker.tick();
  worker.close();finish('过期中文');await inFlight;
  worker.update('новое','a');await worker.tick();
  assert.equal(called,1);
  assert.ok(!seen.some(s=>s.translation==='过期中文'));
});
test('large pending RU is bounded and no unchanged clipped source loops',async()=>{
  let count=0;let textLength=0;const seen:any[]=[];
  const worker=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:100000,
    request:async(_profile:any,text:string)=>{count++;textLength=text.length;return '本地翻译';},
    onUpdate:(x:any)=>seen.push(x)});
  worker.start('long');
  worker.update('русские слова '.repeat(150),'long');
  await worker.tick();
  assert.equal(count,1);
  assert.ok(textLength>0&&textLength<=LIVE_MAX_SOURCE_CHARS);
  assert.equal(seen.at(-1).clipped,true);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(count,1,'same long buffer must not cause recurring paid requests');
  worker.close();
});
test('the same Russian utterance may be spoken again after the buffer empties',async()=>{
  let requests=0;
  const w=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:100000,
    request:async()=>{requests++;return '译文';}});
  w.start('repeat');
  w.update('Да, правильно.','repeat');await w.tick();
  w.update('','repeat');
  w.update('Да, правильно.','repeat');await w.tick();
  w.close();
  assert.equal(requests,2,'a new utterance must not be hidden by last request deduplication');
});
test('UI projects only uncommitted RU and never writes provisional ZH into history',()=>{
  const js=readFileSync('apps/web/app.js','utf8');
  const html=readFileSync('apps/web/index.html','utf8');
  const served=readFileSync('apps/server/src/site.ts','utf8');
  const module=readFileSync('apps/web/live-translation.js','utf8');
  assert.match(html,/id="live-translation-enable"/);
  assert.match(html,/id="live-zh"/);
  assert.match(js,/liveWorker\.update\(\[pending,draft\]\.filter\(Boolean\)\.join\(' '\),lessonId\)/);
  assert.match(js,/new LiveTranslationWorker\(/);
  assert.match(served,/\/live-translation\.js/);
  assert.doesNotMatch(module,/saveBilingualSentences|saveLesson|indexedDB|localStorage/);
});
