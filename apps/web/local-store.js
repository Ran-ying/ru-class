// No API credentials are sent to the RU-Class website host. These records
// live in the user's own browser origin, not in a Node.js user account.
const DB_NAME='ru-class-local-v1';
function openDatabase(){
  if(!globalThis.indexedDB)throw new Error('当前浏览器不支持 IndexedDB，不能保存私人数据。');
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('profiles'))db.createObjectStore('profiles',{keyPath:'kind'});
      if(!db.objectStoreNames.contains('lessons'))db.createObjectStore('lessons',{keyPath:'id'});
      if(!db.objectStoreNames.contains('audio'))db.createObjectStore('audio',{keyPath:['lessonId','index']});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('LOCAL_DATABASE_UNAVAILABLE'));
    request.onblocked=()=>reject(new Error('请关闭其他正在升级 RU-Class 的标签页后重试。'));
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
  for(const table of ['profiles','lessons','audio']){
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(table,'readwrite');
      tx.objectStore(table).clear();
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
}
