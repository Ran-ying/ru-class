import {endpoint} from './direct-asr.js';

export const LIVE_MIN_INTERVAL_MS=1500;
export const LIVE_COALESCE_MS=700;
export const LIVE_MAX_SOURCE_CHARS=1100;

// Reuse only the *user-selected speech* API. The anonymous RU-Class website
// has no proxy, globally configured server, or shared API credentials.
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

// The live text is only a projection. Do not consume stable source units,
// write IndexedDB, alter the DeepSeek worker, or infer word timestamps.
export class LiveTranslationWorker{
  constructor({profile,request=requestLocalTranslation,onUpdate=()=>{},
    onState=()=>{},coalesceMs=LIVE_COALESCE_MS,
    intervalMs=LIVE_MIN_INTERVAL_MS}){
    Object.assign(this,{profile,request,onUpdate,onState,coalesceMs,intervalMs});
    this.recordingId='';this.source='';this.revision=0;
    this.closed=false;this.timer=null;this.inFlight=false;this.controller=null;
    this.lastStarted=0;this.lastSent='';this.suspended=false;
  }
  start(recordingId){
    if(this.closed||!recordingId)throw Error('INVALID_LIVE_RECORDING');
    this.recordingId=recordingId;
  }
  update(text,recordingId=this.recordingId){
    if(this.closed||recordingId!==this.recordingId)return;
    if(typeof text!=='string')return;
    if(text===this.source)return;
    this.source=text;this.revision++;
    this.onUpdate({recordingId,revision:this.revision,translation:'',
      pending:Boolean(text.trim())});
    if(!text.trim()){
      // A later utterance may repeat exactly the previous Russian words.
      // Never keep the old dedup signature after the visible buffer cleared.
      this.lastSent='';this.suspended=false;this.clearTimer();return;
    }
    if(this.suspended){this.onState('TRANSLATION_HTTP_404');return;}
    // Route 404: do not issue paid/failed calls per ASR window.
    this.schedule();
  }
  clearTimer(){if(this.timer!==null)clearTimeout(this.timer);this.timer=null;}
  schedule(){
    if(this.closed||this.inFlight||this.suspended||!this.source.trim())return;
    if(this.timer!==null)return; // coalesce without resetting on each ASR update
    const since=performance.now()-this.lastStarted;
    const wait=Math.max(this.coalesceMs,this.lastStarted?this.intervalMs-since:0);
    this.timer=setTimeout(()=>{this.timer=null;void this.tick();},wait);
  }
  async tick(){
    if(this.closed||this.inFlight||this.suspended||!this.source.trim())return;
    const revision=this.revision,recordingId=this.recordingId;
    // Server's fixed input bound is 1200 Unicode chars; use only a readable
    // suffix when a stuck formal history leaves a large source buffer.
    const input=this.source.trim();
    const clipped=input.length>LIVE_MAX_SOURCE_CHARS;
    const text=clipped?input.slice(-LIVE_MAX_SOURCE_CHARS).replace(/^\S*\s/u,'').trim():input;
    if(!text||this.lastSent===text)return;
    this.inFlight=true;this.lastSent=text;this.lastStarted=performance.now();
    const controller=new AbortController();this.controller=controller;
    try{
      const translated=await this.request(this.profile,text,{signal:controller.signal});
      if(this.closed||this.recordingId!==recordingId||this.revision!==revision)return;
      this.onUpdate({recordingId,revision,translation:translated,pending:false,clipped,
        elapsedMs:Math.round(performance.now()-this.lastStarted)});
      this.onState(clipped?'partial':'ready');
    }catch(e){
      if(this.closed||this.recordingId!==recordingId||this.revision!==revision)return;
      const code=e instanceof Error?e.message:'TRANSLATION_FAILED';
      if(code==='TRANSLATION_HTTP_404'||code==='TRANSLATION_HTTP_405')this.suspended=true;
      this.onState(code);
    }finally{
      if(this.controller===controller)this.controller=null;
      this.inFlight=false;
      // A clipped buffer compares different strings to the original source.
      // Only a NEW version can trigger another request; no infinite repeats.
      if(!this.closed&&this.revision!==revision&&!this.suspended)
        this.schedule();
    }
  }
  close(){
    this.closed=true;this.revision++;this.clearTimer();
    this.controller?.abort();this.controller=null;
  }
}
