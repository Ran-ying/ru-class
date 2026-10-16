import { readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export type Kind = 'speech' | 'image' | 'text';
export type ModelAccount = { baseUrl: string; model: string; apiKey: string };
export type Accounts = Record<Kind, ModelAccount>;

export function emptyAccount(): ModelAccount { return {baseUrl:'', model:'', apiKey:''}; }
export function publicAccount(account: ModelAccount) {
  return {baseUrl:account.baseUrl, model:account.model, keyConfigured:!!account.apiKey};
}
export function validKind(value: string): value is Kind {
  return value==='speech' || value==='image' || value==='text';
}
export function normalizeAccount(input: unknown, previous: ModelAccount): ModelAccount {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('INVALID_MODEL_CONFIG');
  const body=input as Record<string,unknown>;
  const baseUrl=body.baseUrl, model=body.model, key=body.apiKey;
  if(typeof baseUrl!=='string'||typeof model!=='string'||typeof key!=='string')throw new Error('INVALID_MODEL_CONFIG');
  if(!baseUrl || !model || baseUrl.length>1024 || model.length>100 || key.length>1024 || /[\r\n]/.test(key) || !/^[a-zA-Z0-9._/-]+$/.test(model))throw new Error('INVALID_MODEL_CONFIG');
  const parsed=new URL(baseUrl);
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('INVALID_MODEL_URL');
  if(parsed.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))throw new Error('MODEL_REMOTE_REQUIRES_HTTPS');
  // Blank key only retains the previous secret for the *same* endpoint.
  if(!key && previous.baseUrl !== baseUrl)throw new Error('NEW_MODEL_URL_REQUIRES_KEY');
  return {baseUrl:baseUrl.replace(/\/+$/,''), model, apiKey:key||previous.apiKey};
}

export async function probeAccount(account: ModelAccount):Promise<void> {
  if(!account.apiKey)throw new Error('MODEL_API_KEY_REQUIRED');
  const url=new URL(account.baseUrl);
  if(!['http:','https:'].includes(url.protocol))throw new Error('INVALID_MODEL_URL');
  const response=await fetch(account.baseUrl.replace(/\/+$/,'')+'/models',{
    headers:{Authorization:'Bearer '+account.apiKey},
    signal:AbortSignal.timeout(10000),redirect:'error'
  });
  if(!response.ok)throw new Error('MODEL_HTTP_'+response.status);
  // Probe only OpenAI-compatible model discovery. Never claim image/text inference passed.
  const data=await response.json() as {data?:Array<{id?:string}>};
  if(!Array.isArray(data.data)||!data.data.some(x=>x?.id===account.model))throw new Error('MODEL_NOT_LISTED');
}

export function envSpeechOverride():boolean {
  return ['ASR_BASE_URL','ASR_MODEL','ASR_API_KEY'].some(k=>process.env[k]!==undefined);
}

export function createModelStore(path:string, initial:Accounts) {
  const file=resolve(path);
  const models:Accounts={speech:{...initial.speech},image:{...initial.image},text:{...initial.text}};
  let queue:Promise<void>=Promise.resolve();
  async function persist(kind:Kind, account:ModelAccount) {
    // Serialize writes to preserve independent provider edits and unrelated config.json fields.
    const job=queue.then(async()=>{
      let root:Record<string,unknown>={};
      try {const content=JSON.parse(await readFile(file,'utf8'));if(!content||typeof content!=='object'||Array.isArray(content))throw new Error('INVALID_SETTINGS_FILE');root=content;}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const existing=(root.models&&typeof root.models==='object'&&!Array.isArray(root.models))?root.models as Record<string,unknown>:{};
      root.models={...existing,[kind]:account};
      // Keep existing settings (including listen and site) untouched. Speech in models
      // takes precedence over older "asr" JSON on restart.
      const temp=resolve(dirname(file),'.'+basename(file)+'.'+randomBytes(8).toString('hex')+'.tmp');
      try {
        await writeFile(temp,JSON.stringify(root,null,2)+'\n',{mode:0o600,flag:'wx'});
        await chmod(temp,0o600);
        await rename(temp,file);
      } catch(e){await unlink(temp).catch(()=>{});throw e;}
    });
    queue=job.catch(()=>{});
    await job;
    models[kind]={...account};
  }
  return {models,persist};
}

/**
 * Discover models without persisting configuration or changing the active ASR.
 * Only the authenticated local settings API may call this function. An API's
 * model listing can contain other modalities; it is not proof of inference.
 */
export function discoveryAccount(input: unknown, previous: ModelAccount): ModelAccount {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_MODEL_CONFIG');
  const body=input as Record<string, unknown>;
  if(typeof body.baseUrl!=='string'||typeof body.apiKey!=='string')throw new Error('INVALID_MODEL_CONFIG');
  const baseUrl=body.baseUrl.trim();
  const apiKey=body.apiKey;
  if(!baseUrl||baseUrl.length>1024||apiKey.length>1024||/[\r\n]/.test(apiKey))throw new Error('INVALID_MODEL_CONFIG');
  let url:URL;
  try{url=new URL(baseUrl);}catch{throw new Error('INVALID_MODEL_URL');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('INVALID_MODEL_URL');
  if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('MODEL_REMOTE_REQUIRES_HTTPS');
  const normalized=baseUrl.replace(/\/+$/,'');
  // A new provider may expose public /models without requiring credentials.
  // An empty key never reuses a secret from any different provider.
  return {baseUrl:normalized, model:'lookup',apiKey:apiKey||(normalized===previous.baseUrl?previous.apiKey:'')};
}
export async function listAvailableModels(account: ModelAccount):Promise<string[]> {
  const response=await fetch(account.baseUrl.replace(/\/+$/,'')+'/models',{
    headers:{...(account.apiKey?{Authorization:'Bearer '+account.apiKey}:{}),Accept:'application/json'},
    signal:AbortSignal.timeout(10000),redirect:'error'
  });
  if(!response.ok) throw new Error('MODEL_HTTP_'+response.status);
  const reader=response.body?.getReader();
  if(!reader) throw new Error('MODEL_LIST_UNAVAILABLE');
  const chunks:Uint8Array[]=[];
  let total=0;
  try {
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      total+=part.value.byteLength;
      if(total>1024*1024)throw new Error('MODEL_LIST_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  let value:unknown;
  try{
    const buffer=Buffer.concat(chunks.map(c=>Buffer.from(c)));
    value=JSON.parse(buffer.toString('utf8'));
  }catch{throw new Error('INVALID_MODEL_LIST');}
  if(!value||typeof value!=='object'||!Array.isArray((value as {data?:unknown}).data))throw new Error('INVALID_MODEL_LIST');
  const entries=(value as {data:unknown[]}).data;
  if(entries.length>5000)throw new Error('MODEL_LIST_TOO_LARGE');
  const ids=new Set<string>();
  for(const entry of entries){
    if(!entry||typeof entry!=='object')continue;
    const id=(entry as {id?:unknown}).id;
    if(typeof id==='string'&&id.length<=100&&/^[a-zA-Z0-9._/-]+$/.test(id))ids.add(id);
  }
  return [...ids].sort((a,b)=>a.localeCompare(b));
}
