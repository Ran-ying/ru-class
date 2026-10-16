import { wav } from './audio-window.js';
export interface InferenceAdapter { infer(pcm: Buffer, signal?: AbortSignal): Promise<string>; }
export type AsrOptions = {baseUrl:string; apiKey:string; model:string};
export class OpenAICompatibleAsr implements InferenceAdapter {
  readonly url: string;
  constructor(readonly options: AsrOptions) {
    const url=new URL(options.baseUrl);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('INVALID_ASR_URL');
    if(url.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('ASR_REMOTE_REQUIRES_HTTPS');
    if(options.apiKey.length>1024 || /[\r\n]/.test(options.apiKey) || !/^[a-zA-Z0-9._/-]{1,100}$/.test(options.model)) throw new Error('INVALID_ASR_CONFIG');
    this.url=url.href.replace(/\/$/,'');
  }
  async probe() {
    if(!this.options.apiKey)throw new Error('ASR_API_KEY_REQUIRED');
    const res=await fetch(this.url+'/models',{headers:{Authorization:`Bearer ${this.options.apiKey}`},signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!res.ok) throw new Error(`ASR_HTTP_${res.status}`);
    const body=await res.json() as any;
    if(!Array.isArray(body.data) || !body.data.some((m:any)=>m.id===this.options.model)) throw new Error('ASR_MODEL_UNAVAILABLE');
  }
  async infer(pcm:Buffer, signal?:AbortSignal) {
    const form=new FormData();form.set('file',new Blob([new Uint8Array(wav(pcm))],{type:'audio/wav'}),'window.wav');
    form.set('model',this.options.model);form.set('language','ru');form.set('response_format','json');
    const res=await fetch(this.url+'/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${this.options.apiKey}`},body:form,signal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]),redirect:'error'});
    if(!res.ok) throw new Error(`ASR_HTTP_${res.status}`);
    const reader=res.body!.getReader();let raw='';const decoder=new TextDecoder();
    try {while(true){const {done,value}=await reader.read();if(done)break;raw+=decoder.decode(value,{stream:true});if(raw.length>1024*1024)throw new Error('ASR_RESPONSE_TOO_LARGE');}}finally{await reader.cancel();}
    const body=JSON.parse(raw);
    if(typeof body.text!=='string'||body.text.length>20000)throw new Error('INVALID_ASR_RESPONSE');
    return body.text.trim();
  }
}
