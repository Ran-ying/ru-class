import {mergeTextParameters} from './api-parameters.js';
import {isSentenceEnd} from './stable-units.js';
export const LLM_TIMEOUT_MS=45000;
export const DEEPSEEK_TRANSLATION_MAX_TOKENS=2048;

// Only the official provider gets vendor-specific fields. Never infer from
// model names (custom OpenAI-compatible providers may reuse these IDs).
export function textCompletionBody({baseUrl,model,messages,extraParams}){
  return mergeTextParameters({baseUrl,model,messages,extraParams});
}
const tokenCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;
export function textUsage(usage){
  return {
    promptTokens:tokenCount(usage?.prompt_tokens),
    completionTokens:tokenCount(usage?.completion_tokens),
    totalTokens:tokenCount(usage?.total_tokens),
    reasoningTokens:tokenCount(usage?.completion_tokens_details?.reasoning_tokens),
    cacheHitTokens:tokenCount(usage?.prompt_cache_hit_tokens)
  };
}
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
export async function requestSentenceBatch(profile,units,{signal,onTelemetry=()=>{}}={}){
  const {endpoint,validateProfile}=await import('./direct-asr.js');
  const {baseUrl,model,apiKey,extraParams}=validateProfile(profile,'text');
  const source=units.map(u=>u.text).join(' ');
  if(source.length>4500)throw Error('LLM_INPUT_TOO_LONG');
  const messages=[
    {role:'system',content:'You process Russian classroom ASR stable fragments. Return ONLY a JSON object with consumed_units, source_prefix, and sentences array of {ru,zh}. Consume a PREFIX of WHOLE fragments and copy the exact joined raw source into source_prefix. Correct clear Russian ASR mistakes and punctuation in ru without fabricating information. Return ONE Russian sentence and its ONE matching Simplified Chinese translation per sentences array element. Split long responses into multiple aligned sentence pairs; never put multiple sentences or newlines in a single row. Multiple sentence-pair elements are allowed. Use Russian meaning and syntax as well as punctuation to decide if an already-confirmed utterance is a complete independent sentence. A sentence may be complete WITHOUT terminal punctuation. Only consume a prefix of WHOLE fragments which expresses one or more complete thoughts; do not consume an unfinished final clause, dangling conjunction/preposition, dependent condition, or a question still awaiting completion. If uncertain, return consumed_units 0, source_prefix empty and sentences []; wait for further confirmed fragments. When final, process meaningful remaining fragments. Never modify source_prefix.'},
    {role:'user',content:JSON.stringify({final:Boolean(units[0]?.finalBatch),fragments:units.map((u,i)=>({n:i+1,text:u.text})),source})}
  ];
  let response;
  const timeoutSignal=AbortSignal.timeout(LLM_TIMEOUT_MS);
  const started=performance.now();
  const deepseek=new URL(baseUrl).hostname==='api.deepseek.com';
  let metricStatus='LLM_REQUEST_INCOMPLETE',usage=null;
  let raw;
  try{
    response=await fetch(endpoint(baseUrl)+'/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',
        ...(apiKey?{Authorization:'Bearer '+apiKey}:{})},
      body:JSON.stringify(textCompletionBody({baseUrl,model,messages,extraParams})),redirect:'error',
      credentials:'omit',signal:AbortSignal.any([timeoutSignal,...(signal?[signal]:[])])
    });
    if(!response.ok)throw Error('LLM_HTTP_'+response.status);
    if(Number(response.headers.get('content-length')||0)>100000)throw Error('LLM_RESPONSE_TOO_LARGE');
    raw=await response.text();
    if(raw.length>100000)throw Error('LLM_RESPONSE_TOO_LARGE');
    let data;
    try{data=JSON.parse(raw);}catch{throw Error('LLM_INVALID_JSON');}
    usage=data?.usage;
    if(data?.choices?.[0]?.finish_reason==='length')throw Error('LLM_OUTPUT_TRUNCATED');
    let content=data?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||content.length>16000)throw Error('LLM_INVALID_RESPONSE');
    content=content.trim();
    const fence=String.fromCharCode(96).repeat(3);
    if(content.startsWith(fence+'json')&&content.endsWith(fence))content=content.slice(fence.length+4,-fence.length).trim();
    let parsed;
    try{parsed=JSON.parse(content);}catch{throw Error('LLM_INVALID_JSON');}
    metricStatus='ok';
    return parsed;
  }catch(e){
    metricStatus=signal?.aborted?'LLM_CANCELLED':
      timeoutSignal.aborted||e?.name==='TimeoutError'?'LLM_TIMEOUT':
      e instanceof Error&&e.message.startsWith('LLM_')?e.message:'LLM_NETWORK_FAILED';
    throw Error(metricStatus);
  }finally{
    // One local-only, content-free record per HTTP attempt, including errors
    // and timeouts. Telemetry failure must never affect recording/translation.
    try{onTelemetry({
      at:Date.now(),provider:deepseek?'DeepSeek':'OpenAI 兼容',
      model:model.slice(0,100),status:metricStatus,
      elapsedMs:Math.max(0,Math.round(performance.now()-started)),
      ...textUsage(usage)
    });}catch{}
  }
}
// The ASR stability gate is authoritative. A completed punctuation-delimited
// prefix is sent immediately. For already-confirmed speech with NO punctuation
// allow a conservative, bounded semantic probe: DeepSeek may decide a Russian
// thought is complete without a final period, or return consumed_units:0.
// A new probe for the same bounded prefix is forbidden until source changes.
export const SEMANTIC_PROBE_MIN_WORDS=9;
export const SEMANTIC_PROBE_SINGLE_WINDOW_WORDS=16;
export const SEMANTIC_PROBE_MAX_UNITS=16;
export const SEMANTIC_PROBE_MAX_CHARS=3200;
function probeEligible(units){
  const text=units.map(u=>u.text).join(' ');
  const count=text.trim().split(/\s+/u).filter(Boolean).length;
  const windows=new Set(units.map(u=>u.confirmedWindowEndSample));
  return count>=SEMANTIC_PROBE_MIN_WORDS&&
    (windows.size>=2||count>=SEMANTIC_PROBE_SINGLE_WINDOW_WORDS);
}
export function nextReady(journal,{minUnits=0}={}){
  const pending=journal.units.filter(unit=>!journal.delivered.has(unit.id));
  if(!pending.length)return [];
  const required=Math.min(SEMANTIC_PROBE_MAX_UNITS,Math.max(0,minUnits));
  const limit=Math.max(8,required);
  const charLimit=required>8?SEMANTIC_PROBE_MAX_CHARS:1600;
  const batch=[];let size=0,sentences=0,lastSentenceIndex=-1;
  for(const unit of pending){
    if(batch.length>=limit||(batch.length&&size+unit.text.length+1>charLimit))break;
    batch.push(unit);size+=unit.text.length+1;
    if(isSentenceEnd(unit.text)){
      sentences++;lastSentenceIndex=batch.length-1;
      if(sentences>=2&&batch.length>=required)break;
    }
  }
  if(lastSentenceIndex>=0&&lastSentenceIndex+1>=required)
    return batch.slice(0,lastSentenceIndex+1);
  // A word-complete thought may have no Whisper period at all. Probe
  // the SHORTEST prefix with enough stable context, rather than shipping
  // eight units that could each contain another sentence. If a prior probe
  // returned zero, required grows so newly confirmed context can be seen.
  const semantic=[];
  const probeLimit=Math.max(6,required);
  for(const unit of batch){
    if(semantic.length>=probeLimit)break;
    semantic.push(unit);
    if(semantic.length>=required&&probeEligible(semantic))return semantic;
  }
  // Keep the established +4s fallback for short, ambiguous confirmed text.
  // The final flush still releases every remaining stable unit.
  const ready=journal.ready(),result=[];size=0;
  for(const unit of ready){
    if(result.length>=8||(result.length&&size+unit.text.length+1>1600))break;
    result.push(unit);size+=unit.text.length+1;
  }
  return result;
}
export class SentenceWorker{
  constructor({journal,profile,save,onCommit=()=>{},onError=()=>{},onDrain=()=>{},onRequestMetric=()=>{},request=requestSentenceBatch,intervalMs=800}){
    if(!journal||typeof save!=='function')throw Error('LLM_INVALID_WORKER');
    Object.assign(this,{journal,profile,save,onCommit,onError,onDrain,onRequestMetric,request,intervalMs});
    this.closed=false;this.running=false;this.timer=null;this.controller=null;
    this.nextIndex=0;this.lastEmptySignature='';
    this.failedSignature='';this.failuresOnSignature=0;
    this.emptySignature='';this.emptyOnSignature=0;
    this.lastEmptyFrontier=0;this.lastEmptyBatchSize=0;
  }
  // Called once for the post-stop drain. "complete" means all confirmed units
  // are durably ACKed; "paused" means the original RU remains recoverable.
  reportDrain(status,reason=''){
    if(this.closed||!this.journal.finalized)return;
    this.closed=true;
    if(this.timer!==null)clearTimeout(this.timer);
    this.timer=null;
    this.onDrain({status,pending:this.journal.ready().length,reason});
  }
  schedule(ms=this.intervalMs){
    if(this.closed||this.timer!==null)return;
    this.timer=setTimeout(()=>{this.timer=null;void this.tick();},ms);
  }
  start(){this.schedule(0);}
  wake(){
    if(this.closed)return;
    if(this.timer!==null)clearTimeout(this.timer);
    this.timer=null;this.schedule(0);
  }
  async tick(){
    if(this.closed||this.running)return;
    if(this.lastEmptySignature&&!this.journal.finalized&&
       this.journal.units.length<=this.lastEmptyFrontier){
      // Both the ASR window clock and our poll timer may advance without
      // new stable text. Do not re-bill for the exact same source prefix.
      this.schedule();return;
    }
    // When a bounded probe returned zero and more stable units arrived,
    // enlarge its oldest-source prefix to include new context. Otherwise a
    // capped batch could be queried forever without ever seeing the words
    // that complete the sentence. No new text => no repeated paid probe.
    const moreSinceEmpty=this.lastEmptySignature&&
      this.journal.units.length>this.lastEmptyFrontier;
    const minUnits=moreSinceEmpty?
      Math.min(SEMANTIC_PROBE_MAX_UNITS,this.lastEmptyBatchSize+1):0;
    const ready=nextReady(this.journal,{minUnits});
    if(!ready.length){
      if(this.journal.finalized)this.reportDrain('complete');
      else this.schedule();
      return;
    }
    const signature=ready.map(u=>u.id).join('|')+'|'+this.journal.finalized;
    const sourceFrontier=this.journal.units.length;
    if(signature===this.lastEmptySignature){
      if(this.journal.finalized)this.reportDrain('paused',
        this.failedSignature===signature?'LLM_RETRY_EXHAUSTED':'LLM_NO_PROGRESS');
      else this.schedule();
      return;
    }
    this.running=true;this.controller=new AbortController();
    const signal=this.controller.signal;
    let delay=this.intervalMs;
    try{
      const payload=await this.request(this.profile,ready.map(u=>({...u,finalBatch:this.journal.finalized})),
        {signal,onTelemetry:this.onRequestMetric});
      if(this.closed||signal.aborted)return;
      const accepted=validateSentenceResult(payload,ready);
      if(!accepted.count){
        // Final flush may arrive while the previous request was in flight.
        // Retry a final empty response once, but never spin or charge forever.
        if(this.emptySignature!==signature){this.emptySignature=signature;this.emptyOnSignature=0;}
        this.emptyOnSignature++;
        if(this.journal.finalized&&this.emptyOnSignature===1){delay=1000;return;}
        this.lastEmptySignature=signature;
        this.lastEmptyFrontier=sourceFrontier;
        this.lastEmptyBatchSize=ready.length;
        return;
      }
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
      this.lastEmptyFrontier=0;this.lastEmptyBatchSize=0;
      this.failedSignature='';this.failuresOnSignature=0;
      this.emptySignature='';this.emptyOnSignature=0;
      delay=0; // Drain remaining eligible sentences immediately after ACK.
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
        if(this.journal.finalized){
          const remaining=this.journal.ready();
          if(!remaining.length)this.reportDrain('complete');
          else if(signature===this.lastEmptySignature)this.reportDrain('paused',
            this.failedSignature===signature?'LLM_RETRY_EXHAUSTED':'LLM_NO_PROGRESS');
          else this.schedule(delay);
        }else this.schedule(delay);
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
