export function validateSentenceResult(payload,units){
  if(!Array.isArray(units)||!units.length)throw Error('LLM_SOURCE_UNAVAILABLE');
  const count=payload?.consumed_units;
  if(!Number.isSafeInteger(count)||count<0||count>units.length)throw Error('LLM_INVALID_CONSUMPTION');
  const prefix=units.slice(0,count).map(u=>u.text).join(' ');
  if(payload.source_prefix!==prefix)throw Error('LLM_PREFIX_MISMATCH');
  if(!Array.isArray(payload.sentences)||payload.sentences.length>12)throw Error('LLM_INVALID_SENTENCES');
  if(!count){
    if(payload.sentences.length)throw Error('LLM_UNCONSUMED_SENTENCES');
    return {count:0,prefix:'',sentences:[]};
  }
  if(!payload.sentences.length)throw Error('LLM_MISSING_SENTENCES');
  const sentences=payload.sentences.map(row=>{
    if(typeof row?.ru!=='string'||typeof row?.zh!=='string'||!row.ru.trim()||
      !row.zh.trim()||row.ru.length>4000||row.zh.length>4000)throw Error('LLM_INVALID_SENTENCE');
    return {ru:row.ru.trim(),zh:row.zh.trim()};
  });
  if(sentences.map(s=>s.ru).join(' ').length>prefix.length*2+150)throw Error('LLM_EXCESSIVE_REWRITE');
  return {count,prefix,sentences};
}
export async function requestSentenceBatch(profile,units,{signal}={}){
  const {endpoint,validateProfile}=await import('./direct-asr.js');
  const {baseUrl,model,apiKey}=validateProfile(profile);
  const source=units.map(u=>u.text).join(' ');
  if(source.length>4500)throw Error('LLM_INPUT_TOO_LONG');
  const messages=[
    {role:'system',content:'You process Russian classroom ASR stable fragments. Return ONLY a JSON object with consumed_units, source_prefix, and sentences array of {ru,zh}. Consume a PREFIX of WHOLE fragments and copy the exact joined raw source into source_prefix. Correct clear Russian ASR mistakes and punctuation in ru without fabricating information. Translate each sentence to Simplified Chinese in zh. Multiple sentences allowed. If no complete sentence yet, return consumed_units 0, source_prefix empty and sentences []. When final, process meaningful remaining fragments. Never modify source_prefix.'},
    {role:'user',content:JSON.stringify({final:Boolean(units[0]?.finalBatch),fragments:units.map((u,i)=>({n:i+1,text:u.text})),source})}
  ];
  let response;
  try{
    response=await fetch(endpoint(baseUrl)+'/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',
        ...(apiKey?{Authorization:'Bearer '+apiKey}:{})},
      body:JSON.stringify({model,temperature:0,messages}),redirect:'error',
      credentials:'omit',signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])
    });
  }catch(e){
    if(signal?.aborted)throw Error('LLM_CANCELLED');
    if(e?.name==='TimeoutError')throw Error('LLM_TIMEOUT');
    throw Error('LLM_NETWORK_FAILED');
  }
  if(!response.ok)throw Error('LLM_HTTP_'+response.status);
  if(Number(response.headers.get('content-length')||0)>100000)throw Error('LLM_RESPONSE_TOO_LARGE');
  const raw=await response.text();
  if(raw.length>100000)throw Error('LLM_RESPONSE_TOO_LARGE');
  let data;
  try{data=JSON.parse(raw);}catch{throw Error('LLM_INVALID_JSON');}
  let content=data?.choices?.[0]?.message?.content;
  if(typeof content!=='string'||content.length>16000)throw Error('LLM_INVALID_RESPONSE');
  content=content.trim();
  const fence=String.fromCharCode(96).repeat(3);
  if(content.startsWith(fence+'json')&&content.endsWith(fence))content=content.slice(fence.length+4,-fence.length).trim();
  try{return JSON.parse(content);}catch{throw Error('LLM_INVALID_JSON');}
}
function nextReady(journal){
  const ready=journal.ready(),result=[];let size=0;
  for(const unit of ready){
    if(result.length>=20||(result.length&&size+unit.text.length+1>4500))break;
    result.push(unit);size+=unit.text.length+1;
  }
  return result;
}
export class SentenceWorker{
  constructor({journal,profile,save,onCommit=()=>{},onError=()=>{},request=requestSentenceBatch,intervalMs=1200}){
    if(!journal||typeof save!=='function')throw Error('LLM_INVALID_WORKER');
    Object.assign(this,{journal,profile,save,onCommit,onError,request,intervalMs});
    this.closed=false;this.running=false;this.timer=null;this.controller=null;
    this.nextIndex=0;this.lastEmptySignature='';
    this.failedSignature='';this.failuresOnSignature=0;
  }
  schedule(ms=this.intervalMs){
    if(this.closed||this.timer!==null)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.tick();},ms);
  }
  start(){this.schedule();}
  wake(){
    if(this.closed)return;
    if(this.timer!==null)clearTimeout(this.timer);
    this.timer=null;this.schedule(0);
  }
  async tick(){
    if(this.closed||this.running)return;
    const ready=nextReady(this.journal);
    if(!ready.length){if(!this.journal.finalized)this.schedule();return;}
    const signature=ready.map(u=>u.id).join('|')+'|'+this.journal.finalized;
    if(signature===this.lastEmptySignature){if(!this.journal.finalized)this.schedule();return;}
    this.running=true;this.controller=new AbortController();
    const signal=this.controller.signal;
    let delay=this.intervalMs;
    try{
      const payload=await this.request(this.profile,ready.map(u=>({...u,finalBatch:this.journal.finalized})),{signal});
      if(this.closed||signal.aborted)return;
      const accepted=validateSentenceResult(payload,ready);
      if(!accepted.count){this.lastEmptySignature=signature;return;}
      const consumed=ready.slice(0,accepted.count);
      const rows=accepted.sentences.map((s,i)=>({
        recordingId:this.journal.recordingId,classroomId:this.journal.classroomId,
        index:this.nextIndex+i,ru:s.ru,zh:s.zh,sourcePrefix:accepted.prefix,
        consumedUnitIds:consumed.map(u=>u.id),
        lastConfirmationSample:consumed.at(-1).confirmedWindowEndSample
      }));
      await this.save(rows);
      if(this.closed||signal.aborted)return;
      this.journal.acknowledge(consumed.map(u=>u.id));
      this.nextIndex+=rows.length;
      this.lastEmptySignature='';
      this.failedSignature='';this.failuresOnSignature=0;
      this.onCommit(rows);
    }catch(e){
      if(!this.closed&&!signal.aborted){
        delay=5000;
        if(this.failedSignature===signature)this.failuresOnSignature++;
        else{this.failedSignature=signature;this.failuresOnSignature=1;}
        // A permanently invalid API/token must not generate unbounded paid
        // retries. New confirmed text or a final flush forms a new signature.
        if(this.failuresOnSignature>=3)this.lastEmptySignature=signature;
        this.onError(e instanceof Error?e.message:'LLM_PROCESSING_ERROR');
      }
    }finally{
      this.running=false;this.controller=null;
      if(!this.closed){
        if(!this.journal.finalized)this.schedule(delay);
        else if(this.journal.ready().length&&signature!==this.lastEmptySignature)this.schedule(delay);
      }
    }
  }
  finish(){this.wake();}
  close(){
    this.closed=true;
    if(this.timer!==null)clearTimeout(this.timer);
    this.timer=null;this.controller?.abort();
  }
}
