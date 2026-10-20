import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Browser-only JavaScript is intentionally untyped.
import {requestLocalTranslation,liveTranslationEndpoint,LiveTranslationWorker,splitLiveRussian,LIVE_CHUNK_CHARS} from '../apps/web/live-translation.js';

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
test('full stable+draft RU buffer is translated in ordered short model requests without any truncation',async()=>{
  const stable='Сегодня мы обсуждаем информационную безопасность. '.repeat(34);
  const draft='А сейчас преподаватель объясняет новую часть без пунктуации';
  const source=(stable+draft).trim();
  const chunks=splitLiveRussian(source);
  assert.ok(chunks.length>2);
  assert.equal(chunks.join(' '),source.replace(/\s+/gu,' '));
  assert.ok(chunks.every(x=>x.length<=LIVE_CHUNK_CHARS));
  const sent:string[]=[];const seen:any[]=[];
  const worker=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:0,
    request:async(_p:any,text:string)=>{sent.push(text);return '译文-'+sent.length;},
    onUpdate:(x:any)=>seen.push(x)});
  worker.start('full');
  worker.update(source,'full');
  await worker.tick();
  assert.deepEqual(sent,[...new Set(chunks)],'identical stable chunks reuse one result');
  assert.equal(seen.at(-1).translation,
    chunks.map(chunk=>'译文-'+(sent.indexOf(chunk)+1)).join('\n'));
  assert.equal(seen.at(-1).pending,false);
  assert.equal(seen.at(-1).coveredChunks,chunks.length);
  assert.equal(seen.at(-1).totalChunks,chunks.length);
  // Nothing was appended to permanent RU/ZH history.
  worker.close();
});
test('pending text changes reuse unaffected confirmed chunks and never show old draft translation',async()=>{
  const stable='У нас достаточно длинная стабильная русская лекция. '.repeat(10);
  const seen:any[]=[];const sent:string[]=[];
  const w=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:0,
    request:async(_p:any,text:string)=>{sent.push(text);return '片段 '+sent.length;},
    onUpdate:(x:any)=>seen.push(x)});
  w.start('prefix');
  w.update(stable+'предварительный вариант','prefix');await w.tick();
  const previous=sent.length;
  const first=splitLiveRussian(stable+'предварительный вариант');
  w.update(stable+'уточненный вариант','prefix');
  assert.equal(seen.at(-1).translation,first.slice(0,-1)
    .map(chunk=>'片段 '+(sent.indexOf(chunk)+1)).join('\n'),
    'only identical prefix chunks may be shown before new model output');
  await w.tick();
  assert.ok(sent.length>previous);
  assert.equal(seen.at(-1).pending,false);
  w.close();
});
test('word-free Unicode does not split UTF-16 surrogate pairs or skip characters',()=>{
  const input='😀'.repeat(400);
  const chunks=splitLiveRussian(input);
  assert.equal(chunks.join(''),input);
  assert.ok(chunks.every(s=>s.length<=LIVE_CHUNK_CHARS));
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
test('A→B→A reversion needs a fresh result even when text matches the old rejected request',async()=>{
  let release:(text:string)=>void=()=>{};
  const first=new Promise<string>(resolve=>release=resolve);
  let requests=0;
  const seen:any[]=[];
  const worker=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:100000,
    request:async()=>++requests===1?first:'新版本对应的中文',
    onUpdate:(x:any)=>seen.push(x)});
  worker.start('revert');
  worker.update('Исходная мысль','revert');
  const old=worker.tick();
  worker.update('Измененная мысль','revert');
  worker.update('Исходная мысль','revert');
  release('应丢弃的旧译文');
  await old;
  assert.ok(!seen.some(x=>x.translation==='应丢弃的旧译文'));
  await worker.tick();
  assert.equal(requests,2,'same RU text in a newer revision must be requested again');
  assert.equal(seen.at(-1).translation,'新版本对应的中文');
  worker.close();
});
test('failed current translation clears an old provisional caption, not the Russian source',async()=>{
  let requests=0;
  const seen:any[]=[];const states:any[]=[];
  const worker=new LiveTranslationWorker({profile,coalesceMs:100000,intervalMs:100000,
    request:async()=>{
      if(++requests===1)return '旧中文';
      throw Error('TRANSLATION_HTTP_429');
    },
    onUpdate:(x:any)=>seen.push(x),onState:(x:any)=>states.push(x)});
  worker.start('errors');
  worker.update('Первая мысль.','errors');await worker.tick();
  assert.equal(seen.at(-1).translation,'旧中文');
  worker.update('Другая мысль.','errors');await worker.tick();
  assert.equal(seen.at(-1).translation,'');
  assert.equal(seen.at(-1).error,'TRANSLATION_HTTP_429');
  assert.equal(worker.source,'Другая мысль.');
  assert.ok(states.includes('TRANSLATION_HTTP_429'));
  worker.close();
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

test('full-buffer ZH is not dimmed by pending class or styled in low-contrast grey',()=>{
  const css=readFileSync('apps/web/style.css','utf8');
  const app=readFileSync('apps/web/app.js','utf8');
  assert.match(css,/#live-zh\{color:#172d23;opacity:1;/);
  assert.doesNotMatch(css,/is-pending\{opacity:\.5/);
  assert.doesNotMatch(app,/classList\.add\('is-pending'\)/);
  assert.match(app,/liveWorker\.update\(\[pending,draft\]/);
});
