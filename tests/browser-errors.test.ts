import test from 'node:test';
import assert from 'node:assert/strict';
const elements=new Map<string,any>();
const get=(id:string)=>{if(!elements.has(id))elements.set(id,{
  textContent:'',value:'local-test-access-token',disabled:false,
  replaceChildren(...options:any[]){this.options=options;this.value=options[0]?.value||'';},
  setAttribute(name:string,value:string){this[name]=value;}
});return elements.get(id);};
(globalThis as any).fetch=async()=>({ok:true,json:async()=>({clientToken:'SIMULATED_BROWSER_TOKEN',asr:{baseUrl:'http://localhost/v1',model:'SIMULATED_TEST',keyConfigured:true},ready:true})});
(globalThis as any).document={getElementById:get,createElement:()=>({value:'',textContent:''})};
(globalThis as any).window={isSecureContext:true,AudioWorkletNode:function(){},addEventListener:()=>{}};
let closed=0;
(globalThis as any).AudioContext=class{state='running';async resume(){}async close(){closed++;this.state='closed';}};
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>{throw new DOMException('Permission denied','NotAllowedError');}}},configurable:true});
await import('../apps/web/app.js' as string);
test('microphone permission refusal is visible and closes AudioContext',async()=>{
  await get('record').onclick();assert.match(get('error').textContent,/麦克风权限被拒绝/);assert.equal(get('record').disabled,false);assert.equal(get('record').textContent,'开始录音');assert.equal(closed,1);
});
test('insecure context reports the HTTPS requirement before recording',async()=>{
  (globalThis as any).window.isSecureContext=false;await get('record').onclick();assert.match(get('error').textContent,/HTTPS/);assert.equal(get('record').disabled,false);
});

let socket:any,worklet:any,track:any;
function captureEnvironment() {
  (globalThis as any).window.isSecureContext=true;
  (globalThis as any).location={protocol:'http:',host:'localhost'};
  track={readyState:'live',stopped:false,stop(){this.stopped=true;}};
  (globalThis as any).navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]});
  (globalThis as any).AudioContext=class {state='running';destination={};audioWorklet={addModule:async()=>{}};async resume(){}async close(){this.state='closed';}createMediaStreamSource(){return {connect(){},disconnect(){}};}};
  (globalThis as any).AudioWorkletNode=class{port:any={postMessage:(value:string)=>{if(value==='flush')this.port.onmessage({data:{type:'flushed'}});}};constructor(){worklet=this;}connect(){}disconnect(){}};
  (globalThis as any).WebSocket=class {static OPEN=1;readyState=1;bufferedAmount=0;sent:any[]=[];onmessage:any;onopen:any;onclose:any;constructor(){socket=this;}send(value:any){this.sent.push(value);}close(){this.readyState=3;this.onclose?.({code:1000});}};
}
async function readySession(){
  await get('record').onclick();socket.onopen();await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'auth.ok',payload:{worker_online:true,worker:{model:'SIMULATED_TEST'}}})});
  const start=JSON.parse(socket.sent.at(-1));
  await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'session.ready',session_id:start.session_id,payload:{worker:{model:'SIMULATED_TEST',os:'test',backend:'mock'}}})});
  assert.equal(get('record').disabled,false);assert.equal(get('record').textContent,'停止录音');assert.equal(get('ru').hidden,false);assert.equal(get('connection-state').hidden,true);assert.match(get('ru').textContent,/开始录音后/);return start.session_id;
}
test('shipped browser lifecycle sends indexed audio and stops capture before final completion',async()=>{
  captureEnvironment();const id=await readySession();
  for(let i=0;i<5;i++)worklet.port.onmessage({data:{type:'audio',samples:new Float32Array(3200),sourceRate:48000}});
  const frames=socket.sent.filter((m:any)=>m instanceof ArrayBuffer);assert.equal(frames.length,5);assert.equal(get('duration').textContent,'00:01');
  const {decodeAudio}=await import('../apps/server/src/protocol.js');const last=decodeAudio(Buffer.from(frames.at(-1)));assert.equal(last.header.payload.start_sample,12800);assert.equal(last.header.session_id,id);
  await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'asr.partial',session_id:id,payload:{text:'Сегодня мы рассматриваем безопасность.',window_start_sample:0,window_end_sample:16000,inference_ms:15}})});
  await get('record').onclick();assert.equal(track.stopped,true);assert.equal(JSON.parse(socket.sent.at(-1)).type,'session.stop');
  await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'session.stopped',session_id:id,payload:{}})});
  assert.equal(get('status').textContent,'');assert.equal(get('record').disabled,false);assert.equal(get('record').textContent,'开始录音');assert.equal(get('ru').hidden,false);assert.match(get('ru').textContent,/Сегодня/);assert.equal(get('connection-state').hidden,true);
});
test('gateway disconnection and Worker failure visibly stop browser capture',async()=>{
  captureEnvironment();await readySession();socket.onclose({code:1006});await new Promise(r=>setImmediate(r));assert.equal(track.stopped,true);assert.match(get('error').textContent,/网关连接已断开/);
  captureEnvironment();await readySession();await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'session.error',payload:{code:'WORKER_DISCONNECTED'}})});assert.equal(track.stopped,true);assert.match(get('error').textContent,/ASR Worker 已断开/);
});
test('muted microphone is surfaced as interruption, never fake continued recording',async()=>{
  captureEnvironment();await readySession();track.onmute();await new Promise(r=>setImmediate(r));assert.equal(track.stopped,true);assert.match(get('error').textContent,/麦克风输入暂停/);assert.equal(get('record').disabled,false);
});

test('public mode requires a site token and hides local-only ASR editing',async()=>{
  const previousFetch=(globalThis as any).fetch;
  const entries=new Map<string,string>();
  (globalThis as any).sessionStorage={getItem:(k:string)=>entries.get(k)||null,setItem:(k:string,v:string)=>entries.set(k,v),removeItem:(k:string)=>entries.delete(k)};
  get('settings').showModal=()=>{get('settings').open=true;};
  get('settings').close=()=>{get('settings').open=false;};
  (globalThis as any).fetch=async()=>({ok:false,status:403});
  try {
    await get('settings-open').onclick();
    assert.equal(get('site-auth').hidden,false);assert.equal(get('model-cards').hidden,true);
    get('site-token').value='long-public-site-test-token-32-chars';
    get('site-auth').onsubmit({preventDefault(){}});
    assert.equal(entries.get('ru-class-site-token'),'long-public-site-test-token-32-chars');
  }finally{(globalThis as any).fetch=previousFetch;}
});

test('browser app appends only stable deltas and replaces mutable Russian tail',async()=>{
  captureEnvironment();const id=await readySession();
  const next=async(payload:any)=>socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'asr.partial',session_id:id,payload:{
    text:'raw sliding window',window_start_sample:0,window_end_sample:16000,inference_ms:15,...payload
  }})});
  await next({revision:1,stable_delta:'',partial_text:'Сегодня мы обсуждаем'});
  assert.equal(get('ru').textContent,'Сегодня мы обсуждаем');
  await next({revision:2,stable_delta:'Сегодня',partial_text:'мы обсуждаем методы'});
  assert.equal(get('ru').textContent,'Сегодня мы обсуждаем методы');
  await next({revision:3,stable_delta:'мы',partial_text:'обсуждаем методы защиты'});
  assert.equal(get('ru').textContent,'Сегодня мы обсуждаем методы защиты');
  await next({revision:2,stable_delta:'НЕ ДОЛЖНО ДОБАВЛЯТЬСЯ',partial_text:'испорчено'});
  assert.equal(get('ru').textContent,'Сегодня мы обсуждаем методы защиты');
  await next({revision:4,stable_delta:'обсуждаем методы защиты',partial_text:'',final:true});
  assert.equal(get('ru').textContent,'Сегодня мы обсуждаем методы защиты');
  await get('record').onclick();
  await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'session.stopped',session_id:id,payload:{}})});
  assert.equal(get('ru').hidden,false);assert.equal(get('ru').textContent,'Сегодня мы обсуждаем методы защиты');
});


test('tab navigation and model setup require explicit discovery, Token reveal, save and test',async()=>{
  const before=(globalThis as any).fetch;
  const calls:any[]=[];
  (globalThis as any).fetch=async(url:string,init:any)=>{
    if(url==='/api/bootstrap')return {ok:true,status:200,json:async()=>({
      clientToken:'SIMULATED_BROWSER_TOKEN',ready:true,models:{
        speech:{baseUrl:'http://127.0.0.1:8090/v1',model:'small',keyConfigured:true},
        image:{baseUrl:'',model:'',keyConfigured:false},text:{baseUrl:'',model:'',keyConfigured:false}
      }
    })};
    const body=JSON.parse(init.body);calls.push({url,body});
    if(url.endsWith('/list'))return {ok:true,status:200,json:async()=>({models:['vision-a','vision-b']})};
    if(url.endsWith('/save'))return {ok:true,status:200,json:async()=>({profile:{baseUrl:body.baseUrl,model:body.model,keyConfigured:true}})};
    if(url.endsWith('/test'))return {ok:true,status:200,json:async()=>({ok:true})};
    throw Error('Unexpected URL '+url);
  };
  try {
    await get('settings-open').onclick();
    assert.equal(get('panel-models').hidden,false);
    get('tab-access').onclick();assert.equal(get('panel-models').hidden,true);
    get('tab-models').onclick();assert.equal(get('panel-access').hidden,true);
    assert.equal(get('image-model-stage').hidden,true);
    assert.equal(get('image-token-stage').hidden,true);
    assert.equal(get('image-actions').hidden,true);
    get('image-url').value='https://vision.example/v1';
    get('image-url').oninput();
    await get('image-list').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(get('image-model-stage').hidden,false);
    assert.equal(get('image-model-manual-wrap').hidden,true);
    assert.equal(get('image-model-select').options.length,3);
    assert.equal(get('image-model-select').value,'');
    assert.equal(get('image-token-stage').hidden,true);
    get('image-model-select').value='vision-a';
    get('image-model-select').onchange();
    assert.equal(get('image-token-stage').hidden,false);
    assert.equal(get('image-actions').hidden,true);
    assert.equal(calls.length,1);
    get('image-token-open').onclick();
    assert.equal(get('image-key-wrap').hidden,false);
    assert.equal(get('image-actions').hidden,false);
    get('image-key').value='vision-secret';
    get('image-key').oninput();
    assert.equal(get('image-actions').hidden,false);
    get('model-image').onsubmit({preventDefault(){}});
    await new Promise(r=>setImmediate(r));
    assert.equal(calls.filter(x=>x.url.endsWith('/save')).length,1);
    assert.equal(calls.filter(x=>x.url.endsWith('/test')).length,0);
    assert.equal(calls.at(-1).body.model,'vision-a');
    get('image-test').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(calls.filter(x=>x.url.endsWith('/test')).length,1);
    // Other model settings are untouched by saving or testing image.
    assert.equal(get('text-model-stage').hidden,true);
    assert.equal(get('text-token-stage').hidden,true);
  }finally{(globalThis as any).fetch=before;}
});

test('model list refresh, empty/manual fallback and changing API address reset the workflow',async()=>{
  const before=(globalThis as any).fetch;
  let listing=['vision-a','vision-b'];
  const seen:any[]=[];
  (globalThis as any).fetch=async(url:string,init:any)=>{
    if(url==='/api/bootstrap')return {ok:true,status:200,json:async()=>({
      clientToken:'SIMULATED_BROWSER_TOKEN',ready:true,models:{
        speech:{baseUrl:'http://127.0.0.1:8090/v1',model:'small',keyConfigured:true},
        image:{baseUrl:'',model:'',keyConfigured:false},text:{baseUrl:'',model:'',keyConfigured:false}
      }
    })};
    assert.equal(url,'/api/models/image/list');
    seen.push(JSON.parse(init.body));
    return {ok:true,status:200,json:async()=>({models:listing})};
  };
  try{
    await get('settings-open').onclick();
    get('image-url').value='https://vision.example/v1';
    get('image-url').oninput();
    await get('image-list').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(get('image-model-select').options.length,3);
    assert.equal(get('image-model-select').value,'');
    assert.equal(get('image-model-manual-wrap').hidden,true);
    assert.equal(get('image-model').required,false);
    assert.equal(get('image-model-choice').hidden,false); // Refresh button belongs to visible select row.
    get('image-model-select').value='vision-b';
    get('image-model-select').onchange();
    listing=['vision-b','vision-c'];
    await get('image-refresh').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(get('image-model-select').options.length,3);
    assert.equal(get('image-model-select').value,'vision-b');
    listing=[];
    await get('image-refresh').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(get('image-model-choice').hidden,true);
    assert.equal(get('image-model-manual-wrap').hidden,false);
    get('image-model').value='custom-model';
    get('image-model').oninput();
    get('image-token-open').onclick();
    assert.equal(get('image-actions').hidden,true);
    get('image-key').value='image-secret';
    get('image-key').oninput();
    assert.equal(get('image-actions').hidden,false);
    get('image-url').value='https://changed.example/v1';
    get('image-url').oninput();
    assert.equal(get('image-model-stage').hidden,true);
    assert.equal(get('image-token-stage').hidden,true);
    assert.equal(get('image-actions').hidden,true);
    assert.equal(get('image-key').value,'');
    assert.equal(get('image-model').value,'');
    assert.equal(seen.length,3);
  }finally{(globalThis as any).fetch=before;}
});

test('401 model discovery asks for Token before proceeding without opening save actions',async()=>{
  const before=(globalThis as any).fetch;
  let requests=0;
  (globalThis as any).fetch=async(url:string,init:any)=>{
    if(url==='/api/bootstrap')return {ok:true,status:200,json:async()=>({
      clientToken:'SIMULATED_BROWSER_TOKEN',ready:true,models:{speech:{},image:{},text:{}}
    })};
    requests++;assert.equal(url,'/api/models/text/list');
    const {apiKey}=JSON.parse(init.body);
    return apiKey ? {ok:true,status:200,json:async()=>({models:['text-model']})} :
      {ok:false,status:400,json:async()=>({error:'MODEL_HTTP_401'})};
  };
  try{
    await get('settings-open').onclick();
    get('text-url').value='https://restricted.example/v1';
    get('text-url').oninput();
    await get('text-list').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(get('text-model-stage').hidden,true);
    assert.equal(get('text-token-stage').hidden,false);
    assert.equal(get('text-actions').hidden,true);
    assert.match(get('text-model-count').textContent,/先填写 Token/);
    get('text-token-open').onclick();
    assert.equal(get('text-key-wrap').hidden,false);
    assert.equal(get('text-actions').hidden,true);
    get('text-key').value='secret-token';
    await get('text-list').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(get('text-model-select').value,'');
    assert.equal(get('text-actions').hidden,true);
    get('text-model-select').value='text-model';
    get('text-model-select').onchange();
    assert.equal(get('text-actions').hidden,false);
    assert.equal(requests,2);
  }finally{(globalThis as any).fetch=before;}
});
