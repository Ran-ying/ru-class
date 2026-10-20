import {endpoint} from './direct-asr.js';

export const LIVE_MIN_INTERVAL_MS=1500;
export const LIVE_COALESCE_MS=700;
// Each input must fit the M2M100 server's 256-token tokenizer budget as well
// as the authenticated Node gateway's 1200-character bound. This is a
// per-REQUEST limit, never a truncation limit on the visible RU buffer.
export const LIVE_CHUNK_CHARS=380;
export const LIVE_CACHE_LIMIT=1500;

export function liveTranslationEndpoint(profile){
  return endpoint(profile.baseUrl)+'/translate';
}
export async function requestLocalTranslation(profile,text,{signal}={}){
  const url=liveTranslationEndpoint(profile);
  const stop=AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])]);
  let response;
  try{
    response=await fetch(url,{
      method:'POST',mode:'cors',redirect:'error',credentials:'omit',signal:stop,
      headers:{'Content-Type':'application/json',
        ...(profile.apiKey?{Authorization:'Bearer '+profile.apiKey}:{})},
      body:JSON.stringify({text,source:'ru',target:'zh'})
    });
  }catch(e){
    if(signal?.aborted)throw Error('TRANSLATION_CANCELLED');
    if(stop.aborted||e?.name==='TimeoutError')throw Error('TRANSLATION_TIMEOUT');
    throw Error('TRANSLATION_NETWORK_OR_CORS');
  }
  if(!response.ok)throw Error('TRANSLATION_HTTP_'+response.status);
  const raw=await response.text();
  if(raw.length>12000)throw Error('TRANSLATION_RESPONSE_TOO_LARGE');
  let value;
  try{value=JSON.parse(raw);}catch{throw Error('TRANSLATION_INVALID_JSON');}
  if(value?.source!=='ru'||value?.target!=='zh'||
     typeof value.translation!=='string'||!value.translation.trim()||
     value.translation.length>4000)
    throw Error('TRANSLATION_INVALID_RESPONSE');
  return value.translation.trim();
}

// Deterministically partition ALL uncommitted visible RU into small, ordered,
// nonoverlapping chunks. Preserve the text (modulo visible whitespace
// normalization); never silently omit older confirmed text to fit one call.
// Ending a chunk at punctuation avoids costly retokenization when new words
// arrive in the subsequent ASR window. Long unspaced text is still covered.
export function splitLiveRussian(text,maxChars=LIVE_CHUNK_CHARS){
  if(!Number.isInteger(maxChars)||maxChars<16)throw Error('LIVE_CHUNK_SIZE');
  const source=String(text||'').trim().replace(/\s+/gu,' ');
  if(!source)return [];
  const chunks=[];let current='';
  const flush=()=>{if(current){chunks.push(current);current='';}};
  for(const word of source.split(' ')){
    if(current&&current.length+1+word.length>maxChars)flush();
    if(word.length>maxChars){
      // Avoid splitting UTF-16 surrogate pairs for long nonspaced content.
      const symbols=Array.from(word);
      let pos=0;
      while(pos<symbols.length){
        let fragment='';
        while(pos<symbols.length&&fragment.length+symbols[pos].length<=maxChars)
          fragment+=symbols[pos++];
        if(current)flush();
        chunks.push(fragment);
      }
      continue;
    }
    current=current?current+' '+word:word;
    if(current.length>=150&&/[.!?。！？]["'»”）)\]]*$/u.test(word))flush();
  }
  flush();
  return chunks;
}

export class LiveTranslationWorker{
  constructor({profile,request=requestLocalTranslation,onUpdate=()=>{},
    onState=()=>{},coalesceMs=LIVE_COALESCE_MS,intervalMs=LIVE_MIN_INTERVAL_MS}){
    Object.assign(this,{profile,request,onUpdate,onState,coalesceMs,intervalMs});
    this.recordingId='';this.source='';this.revision=0;
    this.closed=false;this.timer=null;this.inFlight=false;this.controller=null;
    this.lastStarted=0;this.suspended=false;this.cache=new Map();
  }
  start(recordingId){
    if(this.closed||!recordingId)throw Error('INVALID_LIVE_RECORDING');
    this.recordingId=recordingId;
  }
  // The snapshot is the ENTIRE lower buffer: unconsumed confirmed stable RU
  // plus the last replaceable ASR hypothesis (roughly the rolling 8s window).
  // The formal DeepSeek history may consume only confirmed units, never draft.
  update(text,recordingId=this.recordingId){
    if(this.closed||recordingId!==this.recordingId||typeof text!=='string')return;
    if(text===this.source)return;
    this.source=text;this.revision++;
    this.emitCached(this.revision);
    if(!text.trim()){
      this.suspended=false;this.cache.clear();
      this.clearTimer();this.onState('waiting');return;
    }
    if(this.suspended){this.onState('TRANSLATION_HTTP_404');return;}
    this.schedule();
  }
  chunks(){return splitLiveRussian(this.source);}
  cachedPrefix(chunks=this.chunks()){
    const translated=[];
    for(const chunk of chunks){
      if(!this.cache.has(chunk))break;
      translated.push(this.cache.get(chunk));
    }
    return {translated,covered:translated.length,total:chunks.length};
  }
  emitCached(revision=this.revision,elapsedMs,error){
    if(this.closed)return;
    const {translated,covered,total}=this.cachedPrefix();
    this.onUpdate({recordingId:this.recordingId,revision,
      translation:translated.join('\n'),pending:covered<total,
      coveredChunks:covered,totalChunks:total,elapsedMs,error});
  }
  remember(chunk,translation){
    this.cache.delete(chunk);this.cache.set(chunk,translation);
    while(this.cache.size>LIVE_CACHE_LIMIT)this.cache.delete(this.cache.keys().next().value);
  }
  clearTimer(){if(this.timer!==null)clearTimeout(this.timer);this.timer=null;}
  schedule(){
    if(this.closed||this.inFlight||this.suspended||!this.source.trim()||this.timer!==null)return;
    const since=performance.now()-this.lastStarted;
    const wait=Math.max(this.coalesceMs,this.lastStarted?this.intervalMs-since:0);
    this.timer=setTimeout(()=>{this.timer=null;void this.tick();},Math.max(0,wait));
  }
  async tick(){
    if(this.closed||this.inFlight||this.suspended||!this.source.trim())return;
    this.clearTimer();
    const revision=this.revision,recordingId=this.recordingId;
    const chunks=this.chunks();
    this.inFlight=true;
    const controller=new AbortController();this.controller=controller;
    let elapsedMs;
    try{
      for(const chunk of chunks){
        if(this.closed||controller.signal.aborted||this.revision!==revision)break;
        if(!this.cache.has(chunk)){
          const cooldown=this.lastStarted?this.intervalMs-(performance.now()-this.lastStarted):0;
          if(cooldown>0){
            await new Promise(resolve=>setTimeout(resolve,cooldown));
            if(this.closed||controller.signal.aborted||this.revision!==revision)break;
          }
          this.lastStarted=performance.now();
          const translation=await this.request(this.profile,chunk,{signal:controller.signal});
          if(typeof translation!=='string'||!translation.trim()||translation.length>4000)
            throw Error('TRANSLATION_INVALID_RESPONSE');
          elapsedMs=Math.round(performance.now()-this.lastStarted);
          // Never cache an obsolete ASR hypothesis: A→B→A must not
          // silently resurrect the first A response.
          if(this.closed||controller.signal.aborted||this.revision!==revision)break;
          this.remember(chunk,translation.trim());
        }
        if(this.closed||controller.signal.aborted||this.revision!==revision)break;
        this.emitCached(revision,elapsedMs);
      }
      if(!this.closed&&this.revision===revision){
        this.onState('ready',elapsedMs);
      }
    }catch(e){
      if(!this.closed&&!controller.signal.aborted&&this.revision===revision){
        const code=e instanceof Error?e.message:'TRANSLATION_FAILED';
        if(code==='TRANSLATION_HTTP_404'||code==='TRANSLATION_HTTP_405')this.suspended=true;
        // Leave only the accurately matched cached prefix on screen.
        this.emitCached(revision,undefined,code);
        this.onState(code);
      }
    }finally{
      if(this.controller===controller)this.controller=null;
      this.inFlight=false;
      if(!this.closed&&!this.suspended&&this.revision!==revision)this.schedule();
    }
  }
  close(){
    this.closed=true;this.revision++;this.clearTimer();this.controller?.abort();
    this.controller=null;this.cache.clear();
  }
}
