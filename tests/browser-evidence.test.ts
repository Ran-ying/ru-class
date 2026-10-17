import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny transaction-compatible fake for verifying the v1 -> v4 IndexedDB
// schema and browser-only evidence. It does not impersonate Safari acceptance.
const stores=new Map<string,Map<string,any>>();
const schemas=new Map<string,string|string[]>();
const requestedVersions:number[]=[];
let closeCount=0;
let simulateBlockedOpen=false;
let simulateHypothesisQuotaFailure=false;
const key=(value:any)=>JSON.stringify(value);
const keyParts=(store:string,value:any)=>{
  const path=schemas.get(store)!;
  return Array.isArray(path)?path.map(part=>value[part]):value[path];
};
// Simulate real pre-existing v1 data BEFORE the v2 open/upgrade event.
for(const [name,path] of [
  ['profiles','kind'],['lessons','id'],['audio',['lessonId','index']]
] as [string,string|string[]][]){
  schemas.set(name,path);stores.set(name,new Map());
}
const oldProfile={kind:'speech',baseUrl:'https://v1.example.test/v1',model:'small',apiKey:'v1-private-key'};
const oldLesson={id:'v1-course',startedAt:100,title:'Previous class'};
const oldAudio={lessonId:'v1-course',index:0,data:new Uint8Array([1,2,3,4])};
for(const [name,value] of [
  ['profiles',oldProfile],['lessons',oldLesson],['audio',oldAudio]
] as [string,any][]){
  stores.get(name)!.set(key(keyParts(name,value)),structuredClone(value));
}
const fakeDb={
  close(){closeCount++;},
  onversionchange:undefined as undefined|(()=>void),
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
      get:(id:any)=>request(()=>structuredClone(table.get(key(id)))),
      add:(value:any)=>request(()=>{
        if(name==='hypotheses'&&simulateHypothesisQuotaFailure)throw Error('QuotaExceededError');
        const k=key(keyParts(name,value));
        if(table.has(k))throw Error('ConstraintError');
        table.set(k,structuredClone(value));
        return keyParts(name,value);
      }),
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
    queueMicrotask(()=>{
      if(simulateBlockedOpen){
        simulateBlockedOpen=false;
        req.onblocked?.();
        req.onsuccess?.(); // Another tab eventually closes after the rejection.
      }else{
        req.onupgradeneeded?.();
        req.onsuccess?.();
      }
    });
    return req;
  }
};
(globalThis as any).IDBKeyRange={
  bound:(lower:any,upper:any)=>({lower,upper})
};
// @ts-ignore Browser JS intentionally lacks TS declarations.
const storage = await import('../apps/web/local-store.js');
const {saveHypothesis,lessonHypotheses,lessonHypothesesJson,
  beginEvidenceSession,markEvidenceWriteFailure,finishEvidenceSession,lessonEvidenceStatus,
  saveProfile,loadProfiles,saveLesson,listLessons,
  createClassroom,listClassrooms,listClassroomRecordings,classroomKey,localCalendarDate,
  clearBrowserData}=storage;

test('IndexedDB v4 upgrades a populated v1 DB without deleting profiles, lessons or WAV chunks',async()=>{
  const previous=await loadProfiles();
  assert.deepEqual(requestedVersions,[4]);
  assert.deepEqual([...stores.keys()],['profiles','lessons','audio','hypotheses','evidence','classrooms']);
  assert.equal(previous.speech.apiKey,oldProfile.apiKey);
  assert.equal((await listLessons())[0].title,oldLesson.title);
  assert.deepEqual([...stores.get('audio')!.values()][0].data,oldAudio.data);
  await saveProfile('speech',{baseUrl:'https://example.test/v1',model:'small',apiKey:'private-secret'});
  assert.equal((await loadProfiles()).speech.apiKey,'private-secret');
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
  assert.equal(json.metadata.status,'legacy_unverified',
    'v2 recordings have no saved completeness manifest and cannot claim PASS');
  assert.equal(json.windows.length,2);
  assert.equal(json.windows[0].text,'Первая предварительная фраза');
  assert.ok(!JSON.stringify(json).includes('private-secret'));
  assert.ok(!JSON.stringify(json).includes('другой курс'));
  await saveHypothesis('course-a',{
    text:'Первая предварительная фраза',startSample:0,endSample:32000
  });
  assert.equal((await lessonHypotheses('course-a')).length,2,
    'Retrying same audio endpoint cannot create a second hypothesis');
  await assert.rejects(saveHypothesis('course-a',{
    text:'A new incompatible transcription cannot overwrite old evidence',
    startSample:0,endSample:32000
  }),/ASR_WINDOW_CONFLICT/);
  assert.equal((await lessonHypotheses('course-a'))[0].text,'Первая предварительная фраза');
  await assert.rejects(saveHypothesis('course-a',{
    text:'Первая предварительная фраза',
    startSample:1000,endSample:32000
  }),/ASR_WINDOW_CONFLICT/);
});

test('empty evidence export is reported clearly for recordings created before schema v2',async()=>{
  await assert.rejects(lessonHypothesesJson('older-lesson'),/没有原始 ASR 窗口记录/);
});


test('a v2 database with saved raw windows migrates to v3 without deleting records',async()=>{
  // The v3 store is absent in the seeded v2 fixture; preserve old stores.
  fakeDb.onversionchange!();
  stores.delete('evidence');schemas.delete('evidence');
  const oldRow=[...stores.get('hypotheses')!.values()][0];
  const before=requestedVersions.length;
  assert.equal((await lessonHypotheses('course-a')).length,2);
  assert.equal(requestedVersions.length,before+1);
  assert.deepEqual(stores.get('evidence')!.size,0);
  assert.ok([...stores.get('hypotheses')!.values()].some(x=>x.text===oldRow.text));
  assert.equal((await lessonEvidenceStatus('course-a')).status,'legacy_unverified');
});

test('a successful new recording exports truthful selected-model provenance and complete marker',async()=>{
  await beginEvidenceSession('new-complete',{clientVersion:'0.2.2',selectedModelId:'small'});
  const before=await lessonEvidenceStatus('new-complete');
  assert.equal(before.status,'incomplete','an open session is never declared complete');
  await saveHypothesis('new-complete',{text:'Первые слова',startSample:0,endSample:32000,final:false});
  await saveHypothesis('new-complete',{text:'Последняя фраза',startSample:0,endSample:48000,final:true});
  assert.equal(await finishEvidenceSession('new-complete',{
    receivedCount:2,failedCount:0,frameCount:48000,completed:true
  }),true);
  const exported=JSON.parse(await (await lessonHypothesesJson('new-complete')).text());
  assert.equal(exported.format,'ru-class-asr-windows-v1');
  assert.deepEqual(exported.windows.map((x:any)=>x.window_end_sample),[32000,48000]);
  assert.deepEqual(exported.windows.map((x:any)=>x.final),[false,true]);
  assert.deepEqual(exported.metadata,{
    status:'complete',clientVersion:'0.2.2',selectedModelId:'small',
    modelSource:'user_selected_unverified',receivedCount:2,savedCount:2,
    failedCount:0,frameCount:48000
  });
  assert.ok(!JSON.stringify(exported).includes('private-secret'));
  assert.ok(!JSON.stringify(exported).includes('https://'));
});

test('write/quota failure persists an incomplete label across database reopen',async()=>{
  await beginEvidenceSession('quota-fail',{clientVersion:'0.2.2',selectedModelId:'small'});
  await saveHypothesis('quota-fail',{text:'Сохранено',startSample:0,endSample:32000,final:false});
  simulateHypothesisQuotaFailure=true;
  try{
    await assert.rejects(saveHypothesis('quota-fail',{
      text:'Потерянное окно',startSample:16000,endSample:48000,final:true
    }),/QuotaExceededError/);
  }finally{simulateHypothesisQuotaFailure=false;}
  await markEvidenceWriteFailure('quota-fail');
  assert.equal(await finishEvidenceSession('quota-fail',{
    receivedCount:2,failedCount:1,frameCount:48000,completed:true
  }),false);
  fakeDb.onversionchange!(); // same-origin tab is re-opened: manifest survives
  const exportRow=JSON.parse(await (await lessonHypothesesJson('quota-fail')).text());
  assert.equal(exportRow.metadata.status,'incomplete');
  assert.equal(exportRow.metadata.receivedCount,2);
  assert.equal(exportRow.metadata.savedCount,1);
  assert.equal(exportRow.metadata.failedCount,1);
  assert.equal(exportRow.windows.length,1);
});
test('clean stop refuses COMPLETE if the captured WAV end or response count disagrees',async()=>{
  await beginEvidenceSession('mismatch',{clientVersion:'0.2.2',selectedModelId:'small'});
  await saveHypothesis('mismatch',{text:'Only one',startSample:0,endSample:32000});
  assert.equal(await finishEvidenceSession('mismatch',{
    receivedCount:1,failedCount:0,frameCount:48000,completed:true
  }),false);
  assert.equal((await lessonEvidenceStatus('mismatch')).status,'incomplete');
  await beginEvidenceSession('interrupted',{clientVersion:'0.2.2',selectedModelId:'small'});
  await saveHypothesis('interrupted',{text:'Some text',startSample:0,endSample:32000});
  assert.equal(await finishEvidenceSession('interrupted',{
    receivedCount:1,failedCount:0,frameCount:32000,completed:false
  }),false);
  assert.equal((await lessonEvidenceStatus('interrupted')).status,'incomplete');
});
test('old portable v1 exports stay compatible with both offline numeric replay tools',async()=>{
  const rows=await lessonHypotheses('new-complete');
  const oldExport={format:'ru-class-asr-windows-v1',sample_rate:16000,windows:rows};
  const freshExport=JSON.parse(await (await lessonHypothesesJson('new-complete')).text());
  const {execFileSync}=await import('node:child_process');
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {join}=await import('node:path');
  const {tmpdir}=await import('node:os');
  const dir=await mkdtemp(join(tmpdir(),'ru-class-portability-'));
  try{
    for(const [name,payload] of [['old',oldExport],['new',freshExport]] as const){
      const file=join(dir,name+'.json');
      await writeFile(file,JSON.stringify(payload));
      const replay=JSON.parse(execFileSync(process.execPath,['scripts/replay-browser-transcript.mjs',file],{encoding:'utf8'}));
      const numeric=JSON.parse(execFileSync(process.execPath,['scripts/audit-private-replacements.mjs',file],{encoding:'utf8'}));
      assert.equal(replay.inputWindows,2);
      assert.equal(numeric.inputWindows,2);
      assert.equal(numeric.finalWordCount,replay.finalWordCount);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('a versionchange releases the old handle and the next operation reopens it',async()=>{
  const firstOpen=requestedVersions.length;
  const beforeClose=closeCount;
  assert.equal(typeof fakeDb.onversionchange,'function');
  fakeDb.onversionchange!();
  assert.equal(closeCount,beforeClose+1);
  assert.ok((await listLessons()).some((x:any)=>x.id==='course-a'));
  assert.equal(requestedVersions.length,firstOpen+1);
});

test('a blocked upgrade rejects clearly and closes any subsequent late success',async()=>{
  // Move the current fake connection out of service so the next open is blocked.
  fakeDb.onversionchange!();
  const before=closeCount;
  simulateBlockedOpen=true;
  await assert.rejects(listLessons(),/请关闭其他正在升级/);
  await Promise.resolve();
  assert.equal(closeCount,before+1,'Late successful open must close an unowned handle');
  assert.ok((await listLessons()).some((x:any)=>x.id==='course-a'),
    'A later, unblocked attempt should recover without losing v1 data');
});


test('dated classroom identity is unique per normalized course name and local day; sessions retain UUIDs',async()=>{
  const date='2026-10-17';
  const classroom=await createClassroom({title:'信息安全导论',date});
  assert.match(classroom.id,/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
  assert.equal(classroom.key,classroomKey(' 信息安全导论 ',date));
  await assert.rejects(createClassroom({title:' 信息安全导论 ',date}),/CLASSROOM_ALREADY_EXISTS/);
  const next=await createClassroom({title:'信息安全导论',date:'2026-10-18'});
  assert.notEqual(next.key,classroom.key);
  await assert.rejects(createClassroom({title:'安全',date:'2026-02-30'}),/INVALID_CLASSROOM_DATE/);
  const sessions=[
    {id:'session-uuid-1',classroomId:classroom.id,classroomKey:classroom.key,
      title:classroom.title,lessonDate:classroom.date,startedAt:1792200000000,
      transcript:'Первая часть',durationSeconds:120,hasAudio:true},
    {id:'session-uuid-2',classroomId:classroom.id,classroomKey:classroom.key,
      title:classroom.title,lessonDate:classroom.date,startedAt:1792200120000,
      transcript:'Вторая часть',durationSeconds:60,hasAudio:true}
  ];
  for(const session of sessions)await saveLesson(session);
  assert.deepEqual((await listClassroomRecordings(classroom.key)).map((s:any)=>s.id),
    ['session-uuid-1','session-uuid-2']);
  assert.equal((await listClassroomRecordings(next.key)).length,0,
    'another day with the same name must not include previous audio sessions');
  const grouped=await listClassrooms();
  assert.equal(grouped.find((x:any)=>x.id===classroom.id)?.sessionCount,2);
  assert.equal(grouped.find((x:any)=>x.id===next.id)?.sessionCount,0);
  assert.equal((await listLessons()).filter((s:any)=>s.classroomKey===classroom.key).length,2);
});

test('v1-v3 recordings group into date/name classrooms WITHOUT overwriting original records',async()=>{
  const before=structuredClone((await listLessons()).find((x:any)=>x.id==='v1-course'));
  assert.ok(before);
  const catalog=await listClassrooms();
  const date=localCalendarDate(before.startedAt);
  const key=classroomKey(before.title,date);
  const grouped=catalog.find((x:any)=>x.key===key);
  assert.ok(grouped?.id.startsWith('legacy:'));
  assert.ok((await listClassroomRecordings(key)).some((x:any)=>x.id==='v1-course'));
  await assert.rejects(createClassroom({title:before.title,date}),/CLASSROOM_ALREADY_EXISTS/);
  assert.deepEqual((await listLessons()).find((x:any)=>x.id==='v1-course'),before);
  assert.ok([...stores.get('audio')!.values()].some((a:any)=>a.lessonId==='v1-course'),
    'old WAV chunks must retain their original session UUID');
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
  assert.equal(stores.get('evidence')!.size,0);
  assert.equal(stores.get('classrooms')!.size,0);
});
