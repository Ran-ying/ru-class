import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser-only module with no TypeScript declaration.
import {loadProfiles,saveProfile,saveLesson,listLessons,saveAudioChunk,recordingWav,saveTextRequestMetric,loadTextRequestMetrics,clearBrowserData} from '../apps/web/local-store.js';

// Minimal asynchronous IndexedDB contract to exercise real store transactions,
// browser-only persistence, composite chunk keys and clear without a DOM.
test('local browser profiles, text and WAV chunks persist independently and can be cleared',async()=>{
  const savedIdb=(globalThis as any).indexedDB;
  const savedRange=(globalThis as any).IDBKeyRange;
  const objects=new Map<string,{path:any,records:Map<string,any>}>();
  const db:any={
    objectStoreNames:{contains:(name:string)=>objects.has(name)},
    createObjectStore:(name:string,settings:any)=>objects.set(name,{path:settings.keyPath,records:new Map()}),
    transaction:(name:string,_mode:string)=>{
      const record=objects.get(name)!;
      const tx:any={oncomplete:null,onerror:null,onabort:null};
      const operation=(kind:string,value?:any)=>{
        const req:any={onsuccess:null,onerror:null,result:undefined};
        queueMicrotask(()=>{
          if(kind==='put'){
            const kp=record.path;
            const key=Array.isArray(kp)?kp.map((k:string)=>value[k]):value[kp];
            record.records.set(JSON.stringify(key),structuredClone(value));req.result=key;
          } else if(kind==='clear')record.records.clear();
          else if(kind==='getAll'){
            req.result=[...record.records.values()].filter(v=>!value||
              (Array.isArray(value.lower)&&v.lessonId===value.lower[0]&&v.index>=value.lower[1]&&v.index<=value.upper[1]));
          }
          req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());
        });
        return req;
      };
      tx.objectStore=()=>({put:(v:any)=>operation('put',v),getAll:(r?:any)=>operation('getAll',r),clear:()=>operation('clear')});
      return tx;
    }
  };
  (globalThis as any).indexedDB={open:()=>{
    const request:any={result:db,onsuccess:null,onerror:null,onupgradeneeded:null,onblocked:null};
    queueMicrotask(()=>{request.onupgradeneeded?.();queueMicrotask(()=>request.onsuccess?.());});
    return request;
  }};
  (globalThis as any).IDBKeyRange={bound:(lower:any,upper:any)=>({lower,upper})};
  const speech={baseUrl:'https://own-asr.example/v1',model:'small',apiKey:'my-private-token'};
  try{
    await saveProfile('speech',speech);
    assert.deepEqual((await loadProfiles()).speech,speech);
    assert.equal((await loadProfiles()).image,undefined);
    const newSpeech={...speech,extraParams:{temperature:0.2,prompt:'security lecture'}};
    await saveProfile('speech',newSpeech);
    assert.deepEqual((await loadProfiles()).speech,newSpeech,
      'JSON parameters persist independently of audio and private text');
    await saveLesson({id:'lesson-001',title:'Russian lecture',startedAt:10,durationSeconds:0.4,transcript:'Привет мир',outcome:'completed',hasAudio:true});
    await saveAudioChunk('lesson-001',0,new Float32Array([0,1]));
    await saveAudioChunk('lesson-001',1,new Float32Array([-1,0]));
    const lesson=(await listLessons())[0];
    assert.equal(lesson.transcript,'Привет мир');
    const wav=await recordingWav('lesson-001');
    assert.equal(wav.size,52);
    const bytes=new Uint8Array(await wav.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');
    assert.equal(new DataView(bytes.buffer).getUint32(40,true),8);
    await saveTextRequestMetric({at:12345,provider:'DeepSeek',model:'deepseek-flash',
      status:'ok',elapsedMs:1500,totalTokens:200,reasoningTokens:0,
      promptTokens:120,completionTokens:80,cacheHitTokens:10,
      apiKey:'secret must not persist',prompt:'sensitive text must not persist'});
    const savedMetrics=await loadTextRequestMetrics();
    assert.equal(savedMetrics.length,1);
    assert.equal(savedMetrics[0].totalTokens,200);
    assert.equal(savedMetrics[0].reasoningTokens,0);
    assert.doesNotMatch(JSON.stringify(savedMetrics),/secret must not persist|sensitive text must not persist/);
    assert.ok(objects.has('llmMetrics'),'non-destructive browser upgrade must add diagnostic store');
    await clearBrowserData();
    assert.deepEqual(await loadTextRequestMetrics(),[]);
    assert.deepEqual(await loadProfiles(),{});
    assert.deepEqual(await listLessons(),[]);
  }finally{
    if(savedIdb===undefined)delete (globalThis as any).indexedDB;else (globalThis as any).indexedDB=savedIdb;
    if(savedRange===undefined)delete (globalThis as any).IDBKeyRange;else (globalThis as any).IDBKeyRange=savedRange;
  }
});
