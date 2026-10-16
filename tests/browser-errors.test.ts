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
  await get('start').onclick();assert.match(get('error').textContent,/麦克风权限被拒绝/);assert.equal(get('start').disabled,false);assert.equal(get('stop').disabled,true);assert.equal(closed,1);
});
test('insecure context reports the HTTPS requirement before recording',async()=>{
  (globalThis as any).window.isSecureContext=false;await get('start').onclick();assert.match(get('error').textContent,/HTTPS/);assert.equal(get('start').disabled,false);
});
