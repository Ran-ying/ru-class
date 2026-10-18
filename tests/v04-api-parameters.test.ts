import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser-side plain JavaScript intentionally has no TS declarations.
import {defaultApiParameters,isOfficialDeepSeek,parseApiParameters,
  mergeTextParameters,applySpeechParameters} from '../apps/web/api-parameters.js';
// @ts-ignore
import {BrowserAsrSession,validateProfile} from '../apps/web/direct-asr.js';
// @ts-ignore
import {textCompletionBody,requestSentenceBatch} from '../apps/web/sentence-worker.js';

test('official DeepSeek only gets prefilled nonthinking JSON, user may override',()=>{
  assert.equal(isOfficialDeepSeek('https://api.deepseek.com/v1'),true);
  assert.equal(isOfficialDeepSeek('https://api.deepseek.com'),true);
  for(const url of ['https://api.deepseek.com.evil.test/v1',
    'http://api.deepseek.com/v1','https://deepseek.com/v1']){
    assert.equal(isOfficialDeepSeek(url),false);
    assert.deepEqual(defaultApiParameters('text',url),{});
  }
  assert.deepEqual(defaultApiParameters('text','https://api.deepseek.com/v1'),
    {thinking:{type:'disabled'},max_tokens:2048,stream:false});
  assert.deepEqual(defaultApiParameters('speech','https://api.deepseek.com/v1'),{});
  const old=validateProfile({baseUrl:'https://api.deepseek.com/v1',
    model:'deepseek-flash',apiKey:'secret'},'text');
  assert.equal(old.extraParams.thinking.type,'disabled','previously saved provider must keep nonthinking default');
  const selected=validateProfile({baseUrl:'https://api.deepseek.com/v1',
    model:'deepseek-flash',apiKey:'secret',
    extraParams:JSON.stringify({thinking:{type:'enabled'},max_tokens:4096,stream:false})},'text');
  const body=textCompletionBody({...selected,messages:[{role:'user',content:'ok'}]});
  assert.equal(body.thinking.type,'enabled','explicit user JSON must win');
  assert.equal(body.max_tokens,4096);
  assert.equal(body.stream,false);
  assert.deepEqual(body.messages,[{role:'user',content:'ok'}]);
});
test('provider extras compose with required text protocol fields but cannot override them',()=>{
  const messages=[{role:'user',content:'123'}];
  const body=mergeTextParameters({baseUrl:'https://text.provider.test/v1',model:'some-model',
    messages,extraParams:parseApiParameters('{"temperature":0.4,"response_format":{"type":"json_object"},"top_p":0.9}','text')});
  assert.equal(body.model,'some-model');
  assert.equal(body.temperature,0.4);
  assert.equal(body.top_p,0.9);
  assert.equal(body.response_format.type,'json_object');
  assert.deepEqual(body.messages,messages);
  assert.ok(!('thinking' in body));
  assert.ok(!('stream' in body),'generic API wire format remains compatible');
  for(const key of ['model','messages','file','headers','authorization','apiKey',
    'baseUrl','tools','tool_choice','functions','__proto__','constructor']){
    const bad=JSON.stringify({[key]:key==='model'?'other':'x'});
    assert.throws(()=>parseApiParameters(bad,'text'),/额外参数不能修改系统字段/);
  }
  assert.throws(()=>parseApiParameters('{"stream":true}','text'),/stream 必须为 false/);
  assert.throws(()=>parseApiParameters('{"n":2}','text'),/n 必须为 1/);
  assert.throws(()=>parseApiParameters('["not object"]','text'),/JSON 对象/);
  assert.throws(()=>parseApiParameters('{broken','text'),/有效的 JSON/);
  assert.throws(()=>parseApiParameters(JSON.stringify({prompt:'x'.repeat(8200)}),'text'),/8192/);
});
test('speech JSON scalar fields become multipart form entries without changing core fields',()=>{
  const form=new FormData();
  form.set('file',new Blob(['fake audio']),'window.wav');
  form.set('model','small');form.set('language','ru');form.set('response_format','json');
  applySpeechParameters(form,parseApiParameters('{"temperature":0.2,"prompt":"俄语术语","vad_filter":true}','speech'));
  assert.equal(form.get('language'),'ru');
  assert.equal(form.get('model'),'small');
  assert.equal(form.get('response_format'),'json');
  assert.equal(form.get('temperature'),'0.2');
  assert.equal(form.get('prompt'),'俄语术语');
  assert.equal(form.get('vad_filter'),'true');
  for(const key of ['file','model','language','response_format'])
    assert.throws(()=>parseApiParameters(JSON.stringify({[key]:'something'}),'speech'),/不能修改|不能覆盖/);
  for(const extra of [{word_timestamps:[0,1]},{nested:{a:1}},{item:null}])
    assert.throws(()=>parseApiParameters(extra,'speech'),/只能是字符串、数字或布尔值/);
});
test('actual ASR transcription forwards scalar extras but retains required FormData',async()=>{
  const originalFetch=globalThis.fetch;
  let seen:any=null;
  (globalThis as any).fetch=async(_url:any,options:any)=>{
    seen=options.body;
    return {ok:true,status:200,json:async()=>({text:'Привет'}),headers:new Headers()};
  };
  const session=new BrowserAsrSession({
    baseUrl:'https://speech.example.test/v1',model:'small',apiKey:'secret',
    extraParams:{prompt:'security lecture',temperature:0.3}
  },()=>{},()=>{});
  try{
    const text=await session.transcribe({pcm:new Float32Array(16000)});
    assert.equal(text,'Привет');
    assert.equal(seen.get('prompt'),'security lecture');
    assert.equal(seen.get('temperature'),'0.3');
    assert.equal(seen.get('model'),'small');
    assert.equal(seen.get('language'),'ru');
    assert.equal(seen.get('response_format'),'json');
    assert.ok(seen.get('file') instanceof Blob);
  }finally{session.cancel();(globalThis as any).fetch=originalFetch;}
});
test('text request forwards chosen extras without leaking to an unrelated provider',async()=>{
  const before=globalThis.fetch;let payload:any;
  (globalThis as any).fetch=async(_url:any,options:any)=>{
    payload=JSON.parse(options.body);
    return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({
      choices:[{message:{content:JSON.stringify({
        consumed_units:1,source_prefix:'Привет',
        sentences:[{ru:'Привет.',zh:'你好。'}]
      })}}]
    })};
  };
  try{
    await requestSentenceBatch({baseUrl:'https://api.deepseek.com/v1',
      model:'deepseek-flash',apiKey:'secret',
      extraParams:{thinking:{type:'enabled'},max_tokens:1024,stream:false}},
    [{text:'Привет',id:'r:0'}]);
    assert.equal(payload.thinking.type,'enabled');
    assert.equal(payload.max_tokens,1024);
    assert.equal(payload.stream,false);
    await requestSentenceBatch({baseUrl:'https://api.custom.test/v1',
      model:'some-model',apiKey:'secret',extraParams:{top_p:0.7}},
    [{text:'Привет',id:'r:0'}]);
    assert.equal(payload.top_p,0.7);
    assert.ok(!('thinking' in payload));
    assert.ok(!('stream' in payload));
  }finally{(globalThis as any).fetch=before;}
});
