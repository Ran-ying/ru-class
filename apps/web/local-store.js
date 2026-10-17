// No API credentials are sent to the RU-Class website host. These records
// live in the user's own browser origin, not in a Node.js user account.
const DB_NAME='ru-class-local-v1';
function openDatabase(){
  if(!globalThis.indexedDB)throw new Error('当前浏览器不支持 IndexedDB，不能保存私人数据。');
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,4);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('profiles'))db.createObjectStore('profiles',{keyPath:'kind'});
      if(!db.objectStoreNames.contains('lessons'))db.createObjectStore('lessons',{keyPath:'id'});
      if(!db.objectStoreNames.contains('audio'))db.createObjectStore('audio',{keyPath:['lessonId','index']});
      // v2: private, append-only raw ASR-window evidence. This is deliberately
      // independent of the lossy stable/partial subtitle projection.
      if(!db.objectStoreNames.contains('hypotheses'))db.createObjectStore('hypotheses',{keyPath:['lessonId','endSample']});
      // v3: separate fail-closed session manifest; never overwrite with lesson updates.
      if(!db.objectStoreNames.contains('evidence'))db.createObjectStore('evidence',{keyPath:'lessonId'});
      // v4: a logical classroom (name + local calendar date) owns recordings.
      if(!db.objectStoreNames.contains('classrooms'))db.createObjectStore('classrooms',{keyPath:'key'});
    };
    // Another tab may request an upgrade while this tab holds an open handle.
    // Release the old handle rather than blocking the schema migration.
    let blocked=false;
    request.onsuccess=()=>{
      const db=request.result;
      // A request can succeed AFTER onblocked already rejected its promise.
      // Do not leak that late connection or let it replace the rejected state.
      if(blocked){db.close();return;}
      db.onversionchange=()=>{
        db.close();
        dbPromise=null; // The next operation must obtain a fresh connection.
      };
      resolve(db);
    };
    request.onerror=()=>reject(request.error||new Error('LOCAL_DATABASE_UNAVAILABLE'));
    request.onblocked=()=>{
      blocked=true;
      reject(new Error('请关闭其他正在升级 RU-Class 的标签页后重试。'));
    };
  });
}
let dbPromise;
function connection(){
  if(!dbPromise)dbPromise=openDatabase().catch(e=>{dbPromise=null;throw e;});
  return dbPromise;
}
async function withStore(table,mode,operation){
  const db=await connection();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(table,mode);
    const request=operation(tx.objectStore(table));
    let result;
    request.onsuccess=()=>{result=request.result;};
    request.onerror=()=>reject(request.error);
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||new Error('LOCAL_WRITE_FAILED'));
    tx.onabort=()=>reject(tx.error||new Error('LOCAL_TRANSACTION_ABORTED'));
  });
}
export async function loadProfiles(){
  const rows=await withStore('profiles','readonly',s=>s.getAll());
  const profiles={};
  for(const item of rows)if(['speech','image','text'].includes(item.kind)){
    profiles[item.kind]={baseUrl:item.baseUrl,model:item.model,apiKey:item.apiKey};
  }
  return profiles;
}
export async function saveProfile(kind,account){
  if(!['speech','image','text'].includes(kind))throw new Error('INVALID_KIND');
  await withStore('profiles','readwrite',s=>s.put({...account,kind}));
}

/**
 * A classroom is a calendar-date/name identity. A recording is one immutable
 * session (its own UUID and PCM/ASR coordinates). Never reuse session ids when
 * the user presses Start again in the same classroom.
 */
export function classroomKey(title,date){
  if(typeof title!=='string'||typeof date!=='string')throw Error('INVALID_CLASSROOM');
  const name=title.normalize('NFKC').replace(/\s+/gu,' ').trim();
  if(!name||name.length>120||!/^(\d{4})-(\d{2})-(\d{2})$/u.test(date))
    throw Error('INVALID_CLASSROOM');
  const [year,month,day]=date.split('-').map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day));
  if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()+1!==month||parsed.getUTCDate()!==day)
    throw Error('INVALID_CLASSROOM_DATE');
  return date+'\u001f'+name.toLocaleLowerCase();
}
function normalizedName(title){
  return title.normalize('NFKC').replace(/\s+/gu,' ').trim();
}
export function localCalendarDate(timestamp){
  const date=new Date(timestamp);
  if(!Number.isFinite(date.getTime()))throw Error('INVALID_CLASSROOM_DATE');
  const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0');
  return year+'-'+month+'-'+String(date.getDate()).padStart(2,'0');
}
export function recordingClassroomKey(recording){
  if(typeof recording?.classroomKey==='string')return recording.classroomKey;
  // V1–v3 recordings: preserve the original session, infer a grouping without
  // changing its bytes, id, source date, PCM chunks or raw hypotheses.
  return classroomKey(recording?.title||'未命名课堂',
    recording?.lessonDate||localCalendarDate(recording.startedAt));
}
export async function listClassrooms(){
  const [catalog,sessions]=await Promise.all([
    withStore('classrooms','readonly',s=>s.getAll()),listLessons()
  ]);
  const groups=new Map();
  for(const item of catalog)groups.set(item.key,{...item,sessionCount:0});
  for(const session of sessions){
    let key;
    try{key=recordingClassroomKey(session);}catch{continue;}
    if(!groups.has(key)){
      const date=key.slice(0,10);
      groups.set(key,{
        id:'legacy:'+encodeURIComponent(key),key,date,
        title:normalizedName(session.title||'未命名课堂'),
        createdAt:session.startedAt,sessionCount:0,legacy:true
      });
    }
    groups.get(key).sessionCount++;
  }
  return [...groups.values()].sort((a,b)=>
    b.date.localeCompare(a.date)||a.title.localeCompare(b.title,'zh-CN'));
}
export async function createClassroom({title,date}){
  const key=classroomKey(title,date);
  const existing=await listClassrooms();
  if(existing.some(x=>x.key===key))throw Error('CLASSROOM_ALREADY_EXISTS');
  const item={
    id:crypto.randomUUID(),key,title:normalizedName(title),date,
    createdAt:Date.now()
  };
  // Atomic add prevents two tabs creating identical name/date records.
  await withStore('classrooms','readwrite',s=>s.add(item));
  return item;
}
/**
 * Rename the logical classroom while preserving its stable UUID and all
 * original per-recording IDs, PCM, hypothesis and evidence blobs.
 *
 * The v4 classroom store is keyed by date/name; changing the name requires
 * rekeying the catalog row AND its recording metadata atomically. Both stores
 * share one transaction so a Safari crash cannot leave orphaned recordings.
 * Legacy implicit groups are materialized only when explicitly renamed.
 */
export async function renameClassroom(oldKey,title){
  if(typeof oldKey!=='string'||!/^\d{4}-\d{2}-\d{2}\u001f/u.test(oldKey))
    throw Error('INVALID_CLASSROOM_KEY');
  const date=oldKey.slice(0,10);
  const nextKey=classroomKey(title,date),nextTitle=normalizedName(title);
  const db=await connection();
  const stableId=crypto.randomUUID(); // Only used if this was a virtual legacy group.
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['classrooms','lessons'],'readwrite');
    const catalog=tx.objectStore('classrooms'),recordings=tx.objectStore('lessons');
    let catalogRows,sessionRows,result,reason=null,processed=false;
    const fail=code=>{reason=code;try{tx.abort();}catch{}};
    const finish=()=>{
      if(processed||!catalogRows||!sessionRows)return;
      processed=true;
      const existing=catalogRows.find(x=>x.key===oldKey);
      const owned=sessionRows.filter(x=>{
        try{return recordingClassroomKey(x)===oldKey;}catch{return false;}
      });
      if(!existing&&!owned.length){fail('CLASSROOM_NOT_FOUND');return;}
      // Protect against both explicitly created and old implicit classrooms.
      const occupied=catalogRows.some(x=>x.key===nextKey&&x.key!==oldKey)||
        sessionRows.some(x=>{
          try{return nextKey!==oldKey&&recordingClassroomKey(x)===nextKey;}
          catch{return false;}
        });
      if(occupied){fail('CLASSROOM_ALREADY_EXISTS');return;}
      result={
        ...(existing||{id:stableId,createdAt:Date.now()}),
        key:nextKey,date,title:nextTitle
      };
      if(nextKey!==oldKey&&existing)catalog.delete(oldKey);
      // The same transaction serializes the unique-key operation across tabs.
      if(nextKey===oldKey&&existing)catalog.put(result);
      else catalog.add(result);
      for(const row of owned)recordings.put({
        ...row,title:nextTitle,lessonDate:date,
        classroomKey:nextKey,classroomId:result.id
      });
    };
    const a=catalog.getAll(),b=recordings.getAll();
    a.onsuccess=()=>{catalogRows=a.result;finish();};
    b.onsuccess=()=>{sessionRows=b.result;finish();};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(Error(reason||'CLASSROOM_RENAME_FAILED'));
    tx.onabort=()=>reject(Error(reason||'CLASSROOM_RENAME_FAILED'));
  });
}

export async function listClassroomRecordings(classroomKeyValue){
  if(typeof classroomKeyValue!=='string'||!classroomKeyValue)
    throw Error('INVALID_CLASSROOM_KEY');
  return (await listLessons()).filter(session=>{
    try{return recordingClassroomKey(session)===classroomKeyValue;}
    catch{return false;}
  }).sort((a,b)=>a.startedAt-b.startedAt);
}

export async function saveLesson(lesson){
  await withStore('lessons','readwrite',s=>s.put(lesson));
}
export async function listLessons(){
  const rows=await withStore('lessons','readonly',s=>s.getAll());
  return rows.sort((a,b)=>b.startedAt-a.startedAt);
}
/**
 * Original Whisper hypotheses are retained so an imperfect rolling-text
 * assembler cannot be the only surviving record of a classroom's content.
 * They never leave the user's browser except via explicit local download.
 */
export async function saveHypothesis(lessonId,hypothesis){
  if(typeof lessonId!=='string'||!lessonId||typeof hypothesis?.text!=='string'||
     hypothesis.text.length>20000||!Number.isSafeInteger(hypothesis.startSample)||
     !Number.isSafeInteger(hypothesis.endSample)||hypothesis.startSample<0||
     hypothesis.endSample<=hypothesis.startSample)throw Error('INVALID_ASR_HYPOTHESIS');
  const entry={
    lessonId,startSample:hypothesis.startSample,endSample:hypothesis.endSample,
    text:hypothesis.text,final:hypothesis.final===true,
    inferenceMs:Number.isFinite(hypothesis.inferenceMs)?Math.max(0,hypothesis.inferenceMs):null
  };
  // Store by the audio position, not receipt order. The first provider
  // response is immutable evidence: do not silently overwrite it with a
  // second decoding for the same endSample. Identical retry is idempotent.
  const key=[lessonId,entry.endSample];
  const existing=await withStore('hypotheses','readonly',s=>s.get(key));
  if(existing){
    if(existing.startSample===entry.startSample && existing.text===entry.text &&
       existing.final===entry.final)return;
    throw Error('ASR_WINDOW_CONFLICT');
  }
  // add() rather than put(): atomically refuses an unexpected concurrent
  // conflicting write from another tab instead of erasing first evidence.
  await withStore('hypotheses','readwrite',s=>s.add(entry));
}
export async function lessonHypotheses(lessonId){
  if(typeof lessonId!=='string'||!lessonId)throw Error('INVALID_LESSON_ID');
  const rows=await withStore('hypotheses','readonly',s=>s.getAll(
    IDBKeyRange.bound([lessonId,0],[lessonId,Number.MAX_SAFE_INTEGER])
  ));
  rows.sort((a,b)=>a.endSample-b.endSample);
  // Exclude the IndexedDB key and credentials from portable private evidence.
  return rows.map(x=>({
    text:x.text,window_start_sample:x.startSample,
    window_end_sample:x.endSample,final:x.final,
    inference_ms:x.inferenceMs
  }));
}
/**
 * Local source-evidence state. A "complete" label is issued only after an
 * explicit clean stop, durable commit, and source-sample/count checks.
 * An unclosed session or failed manifest write is always incomplete/unknown.
 * The caller-supplied model ID is NOT server-side model or decoder attestation.
 */
const RATE=16000;
const safeCount=value=>Number.isSafeInteger(value)&&value>=0;
export async function beginEvidenceSession(lessonId,{clientVersion,selectedModelId}){
  if(typeof lessonId!=='string'||!lessonId||
    typeof clientVersion!=='string'||!/^[\w.-]{1,48}$/.test(clientVersion)||
    typeof selectedModelId!=='string'||!/^[a-zA-Z0-9._/-]{1,100}$/.test(selectedModelId))
    throw Error('INVALID_EVIDENCE_SESSION');
  await withStore('evidence','readwrite',s=>s.add({
    lessonId,clientVersion,selectedModelId,state:'recording',
    receivedCount:null,failedCount:0,frameCount:null
  }));
}
export async function markEvidenceWriteFailure(lessonId){
  const prior=await withStore('evidence','readonly',s=>s.get(lessonId));
  if(!prior)throw Error('EVIDENCE_SESSION_MISSING');
  // Best effort: a full IndexedDB quota can prevent even this status update.
  // Its persisted "recording" state still fails closed after reload.
  await withStore('evidence','readwrite',s=>s.put({
    ...prior,state:'incomplete',failedCount:(prior.failedCount||0)+1
  }));
}
export async function finishEvidenceSession(lessonId,{receivedCount,failedCount,frameCount,completed}){
  if(!safeCount(receivedCount)||!safeCount(failedCount)||!safeCount(frameCount)||
    typeof completed!=='boolean')throw Error('INVALID_EVIDENCE_COUNTS');
  const prior=await withStore('evidence','readonly',s=>s.get(lessonId));
  if(!prior)throw Error('EVIDENCE_SESSION_MISSING');
  const windows=await lessonHypotheses(lessonId);
  const valid=windows.length>0&&windows.length===receivedCount &&
    windows.every((w,i)=>Number.isSafeInteger(w.window_start_sample)&&
      w.window_start_sample>=0&&w.window_end_sample<=frameCount&&
      w.window_end_sample>w.window_start_sample&&
      (i===0?w.window_start_sample===0:
      w.window_start_sample<=windows[i-1].window_end_sample))&&
    windows.at(-1).window_end_sample===frameCount;
  const complete=completed && valid && failedCount===0 && prior.failedCount===0;
  await withStore('evidence','readwrite',s=>s.put({
    ...prior,state:complete?'complete':'incomplete',
    receivedCount,failedCount:Math.max(prior.failedCount,failedCount),
    frameCount
  }));
  return complete;
}
export async function lessonEvidenceStatus(lessonId){
  if(typeof lessonId!=='string'||!lessonId)throw Error('INVALID_LESSON_ID');
  const [record,windows]=await Promise.all([
    withStore('evidence','readonly',s=>s.get(lessonId)),
    lessonHypotheses(lessonId)
  ]);
  if(!record)return {
    status:'legacy_unverified',clientVersion:null,selectedModelId:null,
    modelSource:null,receivedCount:null,savedCount:windows.length,
    failedCount:null,frameCount:null
  };
  const complete=record.state==='complete'&&safeCount(record.receivedCount)&&
    record.receivedCount===windows.length&&record.failedCount===0&&
    safeCount(record.frameCount)&&windows.length>0&&
    windows.at(-1).window_end_sample===record.frameCount&&
    windows.every((w,i)=>w.window_start_sample>=0&&
      w.window_end_sample<=record.frameCount&&
      (i===0?w.window_start_sample===0:
       w.window_start_sample<=windows[i-1].window_end_sample));
  return {
    status:complete?'complete':'incomplete',
    clientVersion:record.clientVersion,
    selectedModelId:record.selectedModelId,
    modelSource:'user_selected_unverified',
    receivedCount:record.receivedCount,
    savedCount:windows.length,failedCount:record.failedCount,
    frameCount:record.frameCount
  };
}

export async function lessonHypothesesJson(lessonId){
  const windows=await lessonHypotheses(lessonId);
  if(!windows.length)throw Error('此课程没有原始 ASR 窗口记录（可能是升级前的课程）。');
  const metadata=await lessonEvidenceStatus(lessonId);
  const lesson=await withStore('lessons','readonly',s=>s.get(lessonId));
  // v0.3 extension is optional, and only present for actual v0.3 sessions.
  // Older exports retain their exact prior shape. This portable copy remains
  // PRIVATE: the already exported window text and the stable deltas are speech.
  const sourceUnits=Array.isArray(lesson?.stableUnits)?
    {source_units:lesson.stableUnits.map(unit=>({...unit}))}:{};
  const recording=Array.isArray(lesson?.stableUnits)?{
    recording_id:lessonId,
    classroom_id:typeof lesson.classroomId==='string'?lesson.classroomId:null,
    started_at_ms:Number.isFinite(lesson.startedAt)?lesson.startedAt:null
  }:null;
  return new Blob([JSON.stringify({
    format:'ru-class-asr-windows-v1',
    sample_rate:16000,
    // Optional backwards-compatible metadata; old replay scripts read windows[].
    metadata,
    ...(recording?{recording}:{}),
    ...sourceUnits,
    windows
  },null,2)],{type:'application/json'});
}
export function pcm16(samples){
  const bytes=new Uint8Array(samples.length*2);
  const view=new DataView(bytes.buffer);
  for(let i=0;i<samples.length;i++){
    const value=Math.max(-1,Math.min(1,samples[i]));
    view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return bytes;
}
export async function saveAudioChunk(lessonId,index,samples){
  const data=pcm16(samples);
  await withStore('audio','readwrite',s=>s.put({lessonId,index,data}));
}
export function wavHeader(sampleCount){
  const header=new ArrayBuffer(44);const view=new DataView(header);
  function ascii(at,text){for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));}
  ascii(0,'RIFF');view.setUint32(4,36+sampleCount*2,true);ascii(8,'WAVE');
  ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);
  ascii(36,'data');view.setUint32(40,sampleCount*2,true);
  return new Uint8Array(header);
}
/**
 * Build one playable/downloadable WAV without silently joining discontiguous
 * audio or producing a valid-looking empty file. Browser Blob holds immutable
 * PCM parts; this does not transcode/upsample the private source.
 */
export function recordingWavFromChunks(chunks){
  if(!Array.isArray(chunks)||!chunks.length)throw Error('LOCAL_AUDIO_EMPTY');
  const ordered=[...chunks].sort((a,b)=>a.index-b.index);
  let samples=0;
  for(let i=0;i<ordered.length;i++){
    const {index,data}=ordered[i];
    if(index!==i || !(data instanceof Uint8Array) || !data.byteLength ||
       data.byteLength%2!==0)throw Error('LOCAL_AUDIO_GAP_OR_INVALID_CHUNK');
    samples+=data.byteLength/2;
    // RIFF WAV uses 32-bit chunk sizes, not extensible RF64.
    if(!Number.isSafeInteger(samples)||samples*2+36>0xFFFFFFFF)
      throw Error('LOCAL_WAV_TOO_LARGE');
  }
  return new Blob([wavHeader(samples),...ordered.map(c=>c.data)],{type:'audio/wav'});
}
export async function recordingWav(lessonId){
  if(typeof lessonId!=='string'||!lessonId)throw Error('INVALID_LESSON_ID');
  const chunks=await withStore('audio','readonly',s=>s.getAll(
    IDBKeyRange.bound([lessonId,0],[lessonId,Number.MAX_SAFE_INTEGER])
  ));
  return recordingWavFromChunks(chunks);
}
export async function clearBrowserData(){
  const db=await connection();
  for(const table of ['profiles','lessons','audio','hypotheses','evidence','classrooms']){
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(table,'readwrite');
      tx.objectStore(table).clear();
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
}
