// No API credentials are sent to the RU-Class website host. These records
// live in the user's own browser origin, not in a Node.js user account.
const DB_NAME='ru-class-local-v1';
function openDatabase(){
  if(!globalThis.indexedDB)throw new Error('当前浏览器不支持 IndexedDB，不能保存私人数据。');
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,3);
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
  return new Blob([JSON.stringify({
    format:'ru-class-asr-windows-v1',
    sample_rate:16000,
    // Optional backwards-compatible metadata; old replay scripts read windows[].
    metadata,
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
export async function recordingWav(lessonId){
  const chunks=await withStore('audio','readonly',s=>s.getAll(IDBKeyRange.bound([lessonId,0],[lessonId,Number.MAX_SAFE_INTEGER])));
  chunks.sort((a,b)=>a.index-b.index);
  let samples=0;
  for(const chunk of chunks)samples+=chunk.data.byteLength/2;
  return new Blob([wavHeader(samples),...chunks.map(c=>c.data)],{type:'audio/wav'});
}
export async function clearBrowserData(){
  const db=await connection();
  for(const table of ['profiles','lessons','audio','hypotheses','evidence']){
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(table,'readwrite');
      tx.objectStore(table).clear();
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
}
