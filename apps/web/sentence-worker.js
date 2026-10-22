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
export function validateSentenceResult(payload,units,{openTail=false}={}){
  if(!Array.isArray(units)||!units.length)throw Error('LLM_SOURCE_UNAVAILABLE');
  const count=payload?.consumed_units;
  const max=units.length-(openTail?1:0);
  if(!Number.isSafeInteger(count)||count<0||count>max)throw Error('LLM_INVALID_CONSUMPTION');
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
    {role:'system',content:'You process Russian classroom ASR stable fragments. Return ONLY a JSON object with consumed_units, source_prefix, and sentences array of {ru,zh}. Consume a PREFIX of WHOLE fragments and copy the exact joined raw source into source_prefix. Correct clear Russian ASR mistakes and punctuation in ru without fabricating information. Each sentences array element is one history row: Russian text and its matching Simplified Chinese translation, with no newlines. A row is normally ONE sentence, but group 2-3 consecutive closely related SHORT sentences (each under about 6 words, e.g. "Вот. Всё, финал." or a short question and its answer) into one row so the history reads as natural chunks of roughly 8-25 words; never group unrelated or long sentences. Split long text into multiple aligned rows. Multiple row elements are allowed. Use Russian meaning and syntax as well as punctuation to decide if an already-confirmed utterance is a complete independent sentence. A sentence may be complete WITHOUT terminal punctuation. Only consume a prefix of WHOLE fragments which expresses one or more complete thoughts; do not consume an unfinished final clause, dangling conjunction/preposition, dependent condition, or a question still awaiting completion. This is real, noisy classroom speech: misrecognized or garbled words are NOT a reason to wait. In ru, actively correct ASR errors from context (near-homophones, broken word forms, wrong case endings, e.g. "в алетронном шоте" -> "в электронном счёте"); keep a word unchanged only when no plausible correction exists, and never add content that was not said. Whisper often puts a period where the speaker merely paused or where its audio window ended: if the next fragment continues the same clause (starts lowercase, with a conjunction or preposition, a dependent clause, or completes the thought), that period is wrong, so merge them into ONE natural sentence. Prefer complete, natural sentences; never emit a 1-3 word fragment as its own sentence unless it is a genuine standalone utterance (e.g. a reply, a greeting, a short question to the class), merge it with its neighbour instead. Consume through the last fragment that ends a complete thought; leave a trailing fragment that may still continue for the next request. Only if no complete thought is present, return consumed_units 0, source_prefix empty and sentences []; wait for further confirmed fragments. When final or flush is true, these fragments are overdue: you MUST consume at least the first fragment, and should consume all of them unless the last one is clearly an unfinished clause. When final, process meaningful remaining fragments. Never end a row with an unfinished clause or a dangling word (то, и, а, но, что, если, когда, который, чем, a preposition); if a sentence continues into a fragment you may not consume, stop BEFORE the fragment where that sentence starts and leave it for the next request. zh must be entirely natural Simplified Chinese: never leave Russian words in it; translate fillers such as вот, ну, так naturally or omit them, and write names in Chinese characters. If open_tail is true, the LAST fragment is still being spoken: never consume it; use it only to judge whether the sentence in the previous fragments continues (if it does, do not consume that unfinished sentence either). Never modify source_prefix.'},
    {role:'user',content:JSON.stringify({final:Boolean(units[0]?.finalBatch),...(units[0]?.flushBatch?{flush:true}:{}),...(units.at(-1)?.openTail?{open_tail:true}:{}),fragments:units.map((u,i)=>({n:i+1,text:u.text})),source})}
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
    // Models fence JSON as ```json, ```JSON or a bare ```; accept all three.
    const fenced=content.match(new RegExp('^'+fence+'(?:json)?\\s*([\\s\\S]*?)\\s*'+fence+'$','i'));
    if(fenced)content=fenced[1];
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
export const SEMANTIC_PROBE_SINGLE_WINDOW_WORDS=12;
export const SEMANTIC_PROBE_MAX_UNITS=16;
export const SEMANTIC_PROBE_MAX_CHARS=3200;
function probeEligible(units){
  const text=units.map(u=>u.text).join(' ');
  const count=text.trim().split(/\s+/u).filter(Boolean).length;
  const windows=new Set(units.map(u=>u.confirmedWindowEndSample));
  return count>=SEMANTIC_PROBE_MIN_WORDS&&
    (windows.size>=2||count>=SEMANTIC_PROBE_SINGLE_WINDOW_WORDS);
}
// The newest confirmed unit may still be growing: teachers pause mid-sentence
// and the continuation ("который...", "при ...") is confirmed seconds later.
// Committing it early splits one sentence into two history rows. Until it is
// SETTLED (nothing new for SETTLE_SAMPLES of ASR time, or the lesson stopped)
// it is sent only as an open tail: context the model must not consume, so it
// can tell whether the previous fragment's sentence continues. Up to
// LOOKAHEAD_UNITS settled units after the last sentence end are also sent.
export const SETTLE_SAMPLES=4*16000;
export const LOOKAHEAD_UNITS=2;
export function nextReady(journal,{minUnits=0}={}){
  const all=journal.units.filter(unit=>!journal.delivered.has(unit.id));
  if(!all.length)return [];
  const open=!journal.finalized&&
    journal.lastWindowEnd-all.at(-1).confirmedWindowEndSample<SETTLE_SAMPLES;
  const pending=open?all.slice(0,-1):all;
  const withTail=batch=>{
    if(open&&batch.length&&batch.at(-1)===pending.at(-1)){
      const out=[...batch,all.at(-1)];out.openTail=true;return out;
    }
    return batch;
  };
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
  if(lastSentenceIndex>=0&&lastSentenceIndex+1>=required){
    // Whisper's periods are often false (a pause, the window edge): include
    // the following units so the model can merge a continuation.
    const more=pending.slice(lastSentenceIndex+1,lastSentenceIndex+1+LOOKAHEAD_UNITS);
    return withTail([...batch.slice(0,lastSentenceIndex+1),...more]);
  }
  // A word-complete thought may have no Whisper period at all. Probe
  // the SHORTEST prefix with enough stable context, rather than shipping
  // eight units that could each contain another sentence. If a prior probe
  // returned zero, required grows so newly confirmed context can be seen.
  const semantic=[];
  const probeLimit=Math.max(6,required);
  for(const unit of batch){
    if(semantic.length>=probeLimit)break;
    semantic.push(unit);
    if(semantic.length>=required&&probeEligible(semantic))return withTail(semantic);
  }
  // Keep the established +4s fallback for short, ambiguous confirmed text.
  // The final flush still releases every remaining stable unit.
  const settledIds=new Set(pending.map(u=>u.id));
  const ready=journal.ready().filter(u=>settledIds.has(u.id)),result=[];size=0;
  for(const unit of ready){
    if(result.length>=8||(result.length&&size+unit.text.length+1>1600))break;
    result.push(unit);size+=unit.text.length+1;
  }
  return withTail(result);
}
/**
 * v0.6: audio range of each committed sentence, from the consumed source units'
 * Whisper-segment word times. One sentence per unit maps directly; otherwise
 * sentences split the batch's word timeline in proportion to their word counts
 * (the model may correct words, so this is an estimate). null when untimed.
 */
export function sentenceTimes(units,sentences){
  const words=text=>String(text).trim().split(/\s+/u).filter(Boolean).length||1;
  const span=times=>{
    const valid=times.filter(t=>Array.isArray(t));
    return valid.length?[Math.min(...valid.map(t=>t[0])),Math.max(...valid.map(t=>t[1]))]:null;
  };
  const unitTimes=u=>Array.isArray(u.wordTimes)?u.wordTimes:Array(words(u.text)).fill(null);
  if(sentences.length===units.length)return units.map(u=>span(unitTimes(u)));
  const timeline=units.flatMap(unitTimes);
  const key=w=>w.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
  const source=units.flatMap(u=>String(u.text).trim().split(/\s+/u)).map(key);
  const counts=sentences.map(x=>words(x.ru));
  const total=counts.reduce((a,b)=>a+b,0);
  // Each sentence starts where its first word appears in the source (the model
  // may drop or fix words, which skews pure proportions); else by word share.
  const starts=[0];
  let before=counts[0];
  for(let i=1;i<sentences.length;i++){
    const first=key(String(sentences[i].ru).trim().split(/\s+/u)[0]||'');
    const guess=Math.floor(timeline.length*before/total);
    let found=-1;
    if(first)for(let k=starts[i-1]+1;k<Math.min(source.length,guess+12);k++)if(source[k]===first){
      found=k;if(k>=guess-3)break;
    }
    starts.push(found>starts[i-1]?found:Math.max(starts[i-1]+1,guess));
    before+=counts[i];
  }
  return starts.map((from,i)=>span(timeline.slice(from,Math.max(from+1,starts[i+1]??timeline.length))));
}
// Live-history backstop. Real classroom ASR is noisy enough that the model can
// keep answering consumed_units 0, leaving every sentence in the buffer until
// Stop. Once the oldest pending confirmed unit is this far behind the ASR
// clock, ask with flush:true for a punctuation-bounded prefix that MUST be
// consumed, so history keeps moving during the lesson.
export const FLUSH_AGE_SAMPLES=15*16000;
export function overdueBatch(journal){
  if(journal.finalized)return [];
  const pending=journal.units.filter(unit=>!journal.delivered.has(unit.id));
  const cutoff=journal.lastWindowEnd-FLUSH_AGE_SAMPLES;
  if(!pending.length||pending[0].confirmedWindowEndSample>cutoff)return [];
  const batch=[];let size=0,lastSentence=-1;
  for(const unit of pending){
    if(batch.length>=8||(batch.length&&size+unit.text.length+1>1600))break;
    batch.push(unit);size+=unit.text.length+1;
    if(isSentenceEnd(unit.text))lastSentence=batch.length-1;
  }
  if(lastSentence>=0)return batch.slice(0,lastSentence+1);
  // No punctuation at all: release only the units that are themselves overdue.
  const old=batch.filter(unit=>unit.confirmedWindowEndSample<=cutoff);
  return old.length?old:batch.slice(0,1);
}
export class SentenceWorker{
  constructor({journal,profile,save,onCommit=()=>{},onError=()=>{},onDrain=()=>{},onRequestMetric=()=>{},request=requestSentenceBatch,intervalMs=800}){
    if(!journal||typeof save!=='function')throw Error('LLM_INVALID_WORKER');
    Object.assign(this,{journal,profile,save,onCommit,onError,onDrain,onRequestMetric,request,intervalMs});
    this.closed=false;this.running=false;this.timer=null;this.controller=null;
    this.nextIndex=0;this.lastEmptySignature='';
    this.failedSignature='';this.failuresOnSignature=0;this.consecutiveFailures=0;
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
    const overdue=overdueBatch(this.journal);
    const flush=overdue.length>0;
    // An overdue flush may run without new text (the teacher paused after a
    // sentence); its own signature still forbids re-billing the same prefix.
    if(!flush&&this.lastEmptySignature&&!this.journal.finalized&&
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
    const ready=flush?overdue:nextReady(this.journal,{minUnits});
    if(!ready.length){
      if(this.journal.finalized)this.reportDrain('complete');
      else this.schedule();
      return;
    }
    const signature=ready.map(u=>u.id).join('|')+'|'+this.journal.finalized+'|'+flush;
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
      const payload=await this.request(this.profile,ready.map((u,i)=>({...u,finalBatch:this.journal.finalized,...(flush?{flushBatch:true}:{}),
          ...(ready.openTail&&!flush&&i===ready.length-1?{openTail:true}:{})})),
        {signal,onTelemetry:this.onRequestMetric});
      if(this.closed||signal.aborted)return;
      const accepted=validateSentenceResult(payload,ready,{openTail:Boolean(ready.openTail)&&!flush});
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
      const times=sentenceTimes(consumed,accepted.sentences);
      const rows=accepted.sentences.map((s,i)=>({
        ...(times[i]?{startSample:times[i][0],endSample:times[i][1],timeSource:'whisper_segment_interpolated'}:{}),
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
      this.failedSignature='';this.failuresOnSignature=0;this.consecutiveFailures=0;
      this.emptySignature='';this.emptyOnSignature=0;
      delay=0; // Drain remaining eligible sentences immediately after ACK.
      this.onCommit(rows);
    }catch(e){
      if(!this.closed&&!signal.aborted){
        if(this.failedSignature===signature)this.failuresOnSignature++;
        else{this.failedSignature=signature;this.failuresOnSignature=1;}
        // While recording, a provider outage must not stall history for the
        // rest of the lesson: retry with backoff (5 s doubling to 60 s) for
        // as long as it lasts. Failed requests are not billed. After Stop the
        // drain stays bounded: three failures pause it for manual recovery.
        this.consecutiveFailures++;
        delay=Math.min(60000,5000*2**(this.consecutiveFailures-1));
        if(this.journal.finalized&&this.failuresOnSignature>=3)this.lastEmptySignature=signature;
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
