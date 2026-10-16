import test from 'node:test';
import assert from 'node:assert/strict';
const elements=new Map<string,any>();
const get=(id:string)=>{if(!elements.has(id))elements.set(id,{textContent:'',value:'local-test-access-token',disabled:false});return elements.get(id);};
(globalThis as any).document={getElementById:get};
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
  await get('record').onclick();assert.equal(track.stopped,true);assert.equal(JSON.parse(socket.sent.at(-1)).type,'session.stop');
  await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'session.stopped',session_id:id,payload:{}})});
  assert.match(get('status').textContent,/尾部识别完成/);assert.equal(get('record').disabled,false);assert.equal(get('record').textContent,'开始录音');assert.equal(get('ru').hidden,true);assert.equal(get('connection-state').hidden,false);
});
test('gateway disconnection and Worker failure visibly stop browser capture',async()=>{
  captureEnvironment();await readySession();socket.onclose({code:1006});await new Promise(r=>setImmediate(r));assert.equal(track.stopped,true);assert.match(get('error').textContent,/网关连接已断开/);
  captureEnvironment();await readySession();await socket.onmessage({data:JSON.stringify({protocol_version:'0.1',type:'session.error',payload:{code:'WORKER_DISCONNECTED'}})});assert.equal(track.stopped,true);assert.match(get('error').textContent,/ASR Worker 已断开/);
});
test('muted microphone is surfaced as interruption, never fake continued recording',async()=>{
  captureEnvironment();await readySession();track.onmute();await new Promise(r=>setImmediate(r));assert.equal(track.stopped,true);assert.match(get('error').textContent,/麦克风输入暂停/);assert.equal(get('record').disabled,false);
});
