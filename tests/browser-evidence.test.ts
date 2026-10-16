import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny transaction-compatible fake for verifying the v1 -> v2 IndexedDB
// schema and browser-only evidence. It does not impersonate Safari acceptance.
const stores=new Map<string,Map<string,any>>();
const schemas=new Map<string,string|string[]>();
const requestedVersions:number[]=[];
const key=(value:any)=>JSON.stringify(value);
const keyParts=(store:string,value:any)=>{
  const path=schemas.get(store)!;
  return Array.isArray(path)?path.map(part=>value[part]):value[path];
};
const fakeDb={
  objectStoreNames:{contains:(name:string)=>stores.has(name)},
  createObjectStore(name:string,args:{keyPath:string|string[]}){
    stores.set(name,new Map());schemas.set(name,args.keyPath);
  },
  transaction(name:string){
    const table=stores.get(name);
    if(!table)throw Error('Unknown store: '+name);
    const tx:any={};
    const request=(op:()=>any)=>{
      const r:any={result:undefined,error:null};
      queueMicrotask(()=>{
        try{r.result=op();r.onsuccess?.();tx.oncomplete?.();}
        catch(e){r.error=e;r.onerror?.();tx.onerror?.();}
      });
      return r;
    };
    tx.objectStore=()=>({
      put:(value:any)=>request(()=>{
        table.set(key(keyParts(name,value)),structuredClone(value));
        return keyParts(name,value);
      }),
      getAll:(range?:{lower:any;upper:any})=>request(()=>{
        const list=[...table.values()];
        return list.filter(v=>{
          if(!range)return true;
          const current=keyParts(name,v);
          return Array.isArray(current)&&current[0]===range.lower[0]&&
            current[1]>=range.lower[1]&&current[1]<=range.upper[1];
        }).map(v=>structuredClone(v));
      }),
      clear:()=>request(()=>{table.clear();return undefined;})
    });
    return tx;
  }
};
(globalThis as any).indexedDB={
  open:(_name:string,version:number)=>{
    requestedVersions.push(version);
    const req:any={result:fakeDb,error:null};
    queueMicrotask(()=>{req.onupgradeneeded?.();req.onsuccess?.();});
    return req;
  }
};
(globalThis as any).IDBKeyRange={
  bound:(lower:any,upper:any)=>({lower,upper})
};
// @ts-ignore Browser JS intentionally lacks TS declarations.
const {saveHypothesis,lessonHypotheses,lessonHypothesesJson,
  saveProfile,loadProfiles,saveLesson,listLessons,clearBrowserData}=
  await import('../apps/web/local-store.js');

test('IndexedDB v2 adds hypothesis store without erasing old v1 stores',async()=>{
  const oldProfile={baseUrl:'https://example.test/v1',model:'small',apiKey:'private-secret'};
  await saveProfile('speech',oldProfile);
  assert.deepEqual(requestedVersions,[2]);
  assert.deepEqual([...stores.keys()],['profiles','lessons','audio','hypotheses']);
  assert.equal((await loadProfiles()).speech.apiKey,oldProfile.apiKey);
  await saveLesson({id:'course-a',startedAt:12345,title:'Local class'});
  assert.equal((await listLessons())[0].title,'Local class');
});

test('raw ASR hypotheses survive caption rewrites and are exported as private portable JSON',async()=>{
  await saveHypothesis('course-a',{
    text:'Первая предварительная фраза',startSample:0,endSample:32000,
    inferenceMs:810,final:false
  });
  await saveHypothesis('course-a',{
    text:'Поправленная фраза без старого текста',startSample:16000,endSample:48000,
    inferenceMs:720,final:true
  });
  await saveHypothesis('course-b',{text:'Секретный другой курс',
    startSample:0,endSample:20000,final:true});
  let entries=await lessonHypotheses('course-a');
  assert.equal(entries.length,2);
  assert.deepEqual(entries.map((x:any)=>x.window_end_sample),[32000,48000]);
  assert.equal(entries[0].text,'Первая предварительная фраза');
  assert.equal(entries[1].text,'Поправленная фраза без старого текста');
  assert.equal(entries[1].final,true);
  const json=JSON.parse(await (await lessonHypothesesJson('course-a')).text());
  assert.equal(json.format,'ru-class-asr-windows-v1');
  assert.equal(json.sample_rate,16000);
  assert.equal(json.windows.length,2);
  assert.equal(json.windows[0].text,'Первая предварительная фраза');
  assert.ok(!JSON.stringify(json).includes('private-secret'));
  assert.ok(!JSON.stringify(json).includes('другой курс'));
  await saveHypothesis('course-a',{
    text:'Первая предварительная фраза',startSample:0,endSample:32000
  });
  assert.equal((await lessonHypotheses('course-a')).length,2,
    'Retrying same audio endpoint cannot create a second hypothesis');
});

test('validate hypotheses before writing and clear private evidence with browser data',async()=>{
  await assert.rejects(saveHypothesis('course-a',{text:'test',
    startSample:0,endSample:0}),/INVALID_ASR_HYPOTHESIS/);
  await assert.rejects(saveHypothesis('course-a',{text:'test',
    startSample:-1,endSample:10}),/INVALID_ASR_HYPOTHESIS/);
  await clearBrowserData();
  assert.deepEqual(await lessonHypotheses('course-a'),[]);
  assert.deepEqual(await loadProfiles(),{});
  assert.deepEqual(await listLessons(),[]);
});
