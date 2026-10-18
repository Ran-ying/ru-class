// One bounded, browser-local JSON object per API profile. This module does
// not allow custom credentials, endpoint changes or transport overrides.
export const MAX_API_EXTRA_JSON_CHARS=8192;
const protectedFields=new Set(['model','messages','file','headers','authorization',
  'api_key','apikey','apiKey','baseUrl','url','endpoint','functions',
  'function_call','tools','tool_choice','__proto__','constructor','prototype']);
export function isOfficialDeepSeek(baseUrl){
  try{
    const url=new URL(baseUrl);
    return url.protocol==='https:'&&url.hostname==='api.deepseek.com'&&
      !url.username&&!url.password;
  }catch{return false;}
}
export function defaultApiParameters(kind,baseUrl){
  return kind==='text'&&isOfficialDeepSeek(baseUrl)?
    {thinking:{type:'disabled'},max_tokens:2048,stream:false}:{};
}
export function parseApiParameters(value,kind){
  if(!['speech','image','text'].includes(kind))throw Error('INVALID_API_KIND');
  let obj=value;
  if(value===undefined||value===null||value==='')obj={};
  if(typeof obj==='string'){
    if(obj.length>MAX_API_EXTRA_JSON_CHARS)throw Error('额外参数 JSON 不能超过 8192 个字符');
    try{obj=JSON.parse(obj);}catch{throw Error('额外参数不是有效的 JSON');}
  }
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('额外参数必须是 JSON 对象');
  const json=JSON.stringify(obj);
  if(!json||json.length>MAX_API_EXTRA_JSON_CHARS)throw Error('额外参数 JSON 不能超过 8192 个字符');
  // JSON round-trip discards prototype properties and rejects cyclic objects.
  const result=JSON.parse(json);
  for(const [key,v] of Object.entries(result)){
    if(protectedFields.has(key)||protectedFields.has(key.toLowerCase()))
      throw Error('额外参数不能修改系统字段：'+key);
    if(kind==='speech'){
      if(['language','response_format'].includes(key))
        throw Error('语音识别固定使用俄语与 JSON 响应，不能覆盖：'+key);
      if(v===null||!['string','boolean','number'].includes(typeof v)||
         (typeof v==='number'&&!Number.isFinite(v)))
        throw Error('语音额外参数只能是字符串、数字或布尔值：'+key);
    }else if(kind==='text'){
      if(key==='stream'&&v!==false)throw Error('文字接口暂不支持流式响应，stream 必须为 false');
      if(key==='n'&&v!==1)throw Error('文字接口每次只能请求一份结果，n 必须为 1');
    }
  }
  return result;
}
export function mergeTextParameters({baseUrl,model,messages,extraParams}){
  const extras=extraParams===undefined?
    defaultApiParameters('text',baseUrl):parseApiParameters(extraParams,'text');
  const body={model,temperature:0,...extras,messages};
  // The caller cannot accept SSE. Generic providers retain their prior
  // wire format unless an explicit stream:false was provided.
  return body;
}
export function applySpeechParameters(form,extraParams){
  const fields=parseApiParameters(extraParams,'speech');
  for(const [key,value] of Object.entries(fields))form.set(key,String(value));
  return form;
}
