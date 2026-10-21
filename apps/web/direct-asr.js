import {wavHeader} from './local-store.js';
import {TranscriptBuffer} from './transcript.js';
import {captionProjectionText} from './asr-hallucination.js';
import {parseApiParameters,applySpeechParameters,defaultApiParameters} from './api-parameters.js';

export const RATE=16000;
export const WINDOW_SECONDS=8;
export function endpoint(baseUrl){
  if(typeof baseUrl!=='string'||baseUrl.length>1024||!baseUrl)throw Error('请填写自己的 API 地址');
  let url;
  try{url=new URL(baseUrl);}catch{throw Error('API 地址格式不正确');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('API 地址格式不正确');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('远程 API 必须使用 HTTPS');
  return url.href.replace(/\/+$/,'');
}
function headers(apiKey){
  return {...(apiKey?{Authorization:'Bearer '+apiKey}:{})};
}
export function validateProfile(data,kind='text'){
  const baseUrl=endpoint(data.baseUrl);
  const model=data.model?.trim();
  if(!model||model.length>100||!/^[a-zA-Z0-9._/-]+$/.test(model))throw Error('请选择或填写有效的模型 ID');
  if(typeof data.apiKey!=='string'||data.apiKey.length>1024||/[\r\n]/.test(data.apiKey))throw Error('Token 格式无效');
  const extraParams=data.extraParams===undefined?
    defaultApiParameters(kind,baseUrl):parseApiParameters(data.extraParams,kind);
  return {baseUrl,model,apiKey:data.apiKey,extraParams};
}
async function apiFetch(url,options={},timeout=30000){
  try{
    return await fetch(url,{...options,signal:AbortSignal.any([
      AbortSignal.timeout(timeout),...(options.signal?[options.signal]:[])
    ]),redirect:'error',credentials:'omit'});
  }catch(e){
    if(options.signal?.aborted)throw new Error('REQUEST_ABORTED');
    if(e?.name==='TimeoutError')throw new Error('API 请求超时');
    if(e instanceof TypeError)throw new Error('无法直接连接此 API。可能不支持 CORS、网络不可达或 TLS 证书无效；RU-Class 不提供代理。');
    throw e;
  }
}
export async function discoverModels(baseUrl,apiKey=''){
  const root=endpoint(baseUrl);
  const res=await apiFetch(root+'/models',{headers:{...headers(apiKey),Accept:'application/json'}},10000);
  if(!res.ok){
    if([404,405,501].includes(res.status))return {models:[],unsupported:true};
    throw new Error('MODEL_HTTP_'+res.status);
  }
  const raw=await res.text();
  if(raw.length>1024*1024)throw Error('模型列表过大');
  let data;try{data=JSON.parse(raw);}catch{throw Error('INVALID_MODEL_LIST');}
  if(!Array.isArray(data?.data))return {models:[],unsupported:true};
  if(data.data.length>5000)throw Error('模型列表过大');
  const ids=new Set();
  for(const item of data.data){
    if(typeof item?.id==='string'&&item.id.length<=100&&/^[a-zA-Z0-9._/-]+$/.test(item.id))ids.add(item.id);
  }
  return {models:[...ids].sort((a,b)=>a.localeCompare(b)),unsupported:false};
}
export async function testConnection(account){
  const {models,unsupported}=await discoverModels(account.baseUrl,account.apiKey);
  if(unsupported)throw Error('该 API 不提供 /models 列表，无法使用当前测试方式确认模型');
  if(!models.includes(account.model))throw Error('所选模型不在 API 返回的模型列表中');
  return true;
}
export class AudioRing{
  constructor(maxSamples=8*RATE){
    this.maxSamples=maxSamples;
    this.samples=new Float32Array(maxSamples);
    this.count=0;
    this.end=0;
  }
  push(samples){
    if(!samples?.length)return;
    const count=Math.min(samples.length,this.maxSamples);
    const part=samples.subarray(samples.length-count);
    if(count>=this.maxSamples){
      this.samples.set(part);
      this.count=count;
    }else{
      const evict=Math.max(0,this.count+count-this.maxSamples);
      if(evict){this.samples.copyWithin(0,evict,this.count);this.count-=evict;}
      this.samples.set(part,this.count);
      this.count+=count;
    }
    this.end+=samples.length;
  }
  snapshot(){
    return {start:this.end-this.count,end:this.end,pcm:this.samples.slice(0,this.count)};
  }
}
export function wavBlob(samples){
  const pcm=new Uint8Array(samples.length*2);
  const view=new DataView(pcm.buffer);
  for(let i=0;i<samples.length;i++){
    const value=Math.max(-1,Math.min(1,samples[i]));
    view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return new Blob([wavHeader(samples.length),pcm],{type:'audio/wav'});
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class BrowserAsrSession {
  constructor(profile,onUpdate,onError,onRawHypothesis=()=>{}){
    this.profile=validateProfile(profile,'speech');
    this.onUpdate=onUpdate;this.onError=onError;
    this.onRawHypothesis=onRawHypothesis;
    this.ring=new AudioRing();
    this.transcript=new TranscriptBuffer();
    this.latestEnd=0;
    this.active=true;
    this.inFlight=null;
    this.timer=null;
    this.lastSentEnd=0;
    this.startAt=0;
    this.controller=new AbortController();
  }
  push(samples){
    if(!this.active)return;
    this.ring.push(samples);
    // Trigger first inference after ~2 seconds; thereafter at most once/second.
    if(this.ring.end>=2*RATE && !this.startAt){
      this.startAt=performance.now();
      void this.run(false).catch(e=>this.fail(e));
      this.timer=setInterval(()=>void this.run(false).catch(e=>this.fail(e)),1000);
    }
  }
  async transcribe(snapshot){
    const {baseUrl,model,apiKey,extraParams}=this.profile;
    const form=new FormData();
    form.set('file',wavBlob(snapshot.pcm),'window.wav');
    form.set('model',model);
    form.set('language','ru');
    form.set('response_format','json');
    applySpeechParameters(form,extraParams);
    let response;
    for(let attempt=0;attempt<4;attempt++){
      response=await apiFetch(baseUrl+'/audio/transcriptions',{
        method:'POST',headers:headers(apiKey),body:form,signal:this.controller.signal
      },30000);
      if(response.status!==429 || attempt===3)break;
      await sleep([400,800,1600][attempt]);
    }
    if(!response.ok)throw Error('ASR_HTTP_'+response.status);
    const result=await response.json();
    if(typeof result?.text!=='string'||result.text.length>20000)throw Error('INVALID_ASR_RESPONSE');
    return result.text;
  }
  async run(final=false){
    if(this.inFlight)return this.inFlight;
    if(!this.active&&!final)return;
    const snapshot=this.ring.snapshot();
    if(snapshot.end===this.lastSentEnd || !snapshot.pcm.length){
      if(final){
        const update=this.transcript.flush();
        this.onUpdate({...update,window_start_sample:snapshot.start,window_end_sample:snapshot.end,inference_ms:0,final:true});
      }
      return;
    }
    const task=(async()=>{
      const start=performance.now();
      const text=await this.transcribe(snapshot);
      if(!this.active&&!final)return;
      const raw={
        // Preserve the exact provider text before any lossy transcript
        // stabilization. A projection failure must not erase this evidence.
        text,startSample:snapshot.start,endSample:snapshot.end,
        inferenceMs:performance.now()-start,final
      };
      await this.onRawHypothesis(raw);
      this.lastSentEnd=snapshot.end;
      // Silent windows can yield Whisper subtitle-credit hallucinations. Treat
      // those segments as no speech in the caption only; raw evidence is kept.
      const result=this.transcript.update(captionProjectionText(text),snapshot.start,snapshot.end,final);
      this.onUpdate({...result,
        raw_hypothesis_text:text,
        window_start_sample:snapshot.start,window_end_sample:snapshot.end,
        inference_ms:performance.now()-start,final});
    })();
    this.inFlight=task;
    try{await task;}finally{this.inFlight=null;}
  }
  async stop(){
    clearInterval(this.timer);
    this.timer=null;
    // Await the previous rolling inference, then process any unsent tail.
    if(this.inFlight)await this.inFlight;
    await this.run(true);
    this.active=false;
  }
  cancel(){
    this.active=false;clearInterval(this.timer);this.timer=null;this.controller.abort();
  }
  fail(e){
    if(this.active){this.cancel();this.onError(e);}
  }
}
