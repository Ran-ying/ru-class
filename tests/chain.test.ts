import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { createGateway } from '../apps/server/src/gateway.js';
import { event,encodeAudio,type AudioHeader } from '../apps/server/src/protocol.js';
test('cross-repository HTTP adapter → Worker → gateway → client; early captions and final flush',{skip:!process.env.ASR_REPO},async()=>{
  const asr=resolve(process.env.ASR_REPO!);
  assert.equal(await readFile('docs/protocol.md','utf8'),await readFile(resolve(asr,'docs/protocol.md'),'utf8'));
  assert.equal(await readFile('apps/server/src/protocol.ts','utf8'),await readFile(resolve(asr,'src/protocol.ts'),'utf8'));
  const {WhisperHttp}=await import(pathToFileURL(resolve(asr,'src/inference.ts')).href);
  const {connectWorker}=await import(pathToFileURL(resolve(asr,'src/worker.ts')).href);
  let calls=0;
  const mock=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:`SIMULATED_TEST ${calls}`}));});
  mock.listen(0,'127.0.0.1');await new Promise<void>(r=>mock.once('listening',r));
  const clientToken='client-chain-test-token-24-chars';const workerToken='worker-chain-test-token-24-chars';
  const app=createGateway({clientToken,workerToken});app.server.listen(0,'127.0.0.1');await new Promise<void>(r=>app.server.once('listening',r));
  const port=(app.server.address() as any).port;let worker:any,client:WebSocket|undefined;
  const queue:any[]=[];const waiters:((m:any)=>void)[]=[];
  const next=()=>queue.length?Promise.resolve(queue.shift()):Promise.race([new Promise<any>(r=>waiters.push(r)),new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(new Error('chain timeout')),5000);t.unref();})]);
  try {
    worker=connectWorker(new WhisperHttp(`http://127.0.0.1:${(mock.address() as any).port}/inference`),{url:`ws://127.0.0.1:${port}/ws/worker`,token:workerToken,model:'SIMULATED_TEST',backend:'mock'});
    for(let i=0;i<100;i++){const health=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json());if((health as any).worker_online)break;await new Promise(r=>setTimeout(r,10));}
    client=new WebSocket(`ws://127.0.0.1:${port}/ws/client`,{origin:`http://127.0.0.1:${port}`});
    client.on('message',data=>{const m=JSON.parse(data.toString());const waiter=waiters.shift();if(waiter)waiter(m);else queue.push(m);});
    await new Promise<void>(r=>client!.once('open',r));const id='chain-session-123456';
    const send=(type:string,payload={})=>client!.send(JSON.stringify(event(type,id,payload)));
    send('auth',{token:clientToken});assert.equal((await next()).type,'auth.ok');send('session.start');assert.equal((await next()).type,'session.ready');
    for(let i=0;i<10;i++) {
      const h={...event('audio.frame',id),type:'audio.frame',payload:{seq:i,start_sample:i*3200,sample_count:3200,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:48000,source_start_sample:i*9600,source_end_sample:(i+1)*9600}} as AudioHeader;
      client.send(encodeAudio(h,Buffer.alloc(6400)));
    }
    const partial=await next();assert.equal(partial.type,'asr.partial');assert.match(partial.payload.text,/SIMULATED_TEST/);assert.equal(partial.payload.window_end_sample,32000);
    const h={...event('audio.frame',id),type:'audio.frame',payload:{seq:10,start_sample:32000,sample_count:1600,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:48000,source_start_sample:96000,source_end_sample:100800}} as AudioHeader;
    client.send(encodeAudio(h,Buffer.alloc(3200)));send('session.stop');
    const tail=await next();assert.equal(tail.type,'asr.partial');assert.equal(tail.payload.final,true);assert.equal(tail.payload.window_end_sample,33600);assert.equal((await next()).type,'session.stopped');assert.equal(calls,2);
    // Smoke-test the actual real-time replay CLI against this explicitly simulated engine.
    const temp=await mkdtemp(resolve(tmpdir(),'ru-class-simulated-replay-'));
    try {
      const {wav}=await import(pathToFileURL(resolve(asr,'src/audio-window.ts')).href);
      await writeFile(resolve(temp,'SIMULATED.wav'),wav(Buffer.alloc(16000*2*3.2)));
      await promisify(execFile)(process.execPath,['--import','tsx','scripts/replay.ts',resolve(temp,'SIMULATED.wav'),resolve(temp,'report.json'),'--allow-short'],{cwd:asr,env:{...process.env,CLIENT_TOKEN:clientToken,GATEWAY_CLIENT_URL:`ws://127.0.0.1:${port}/ws/client`,WHISPER_MODEL:'SIMULATED_TEST'},timeout:15000});
      const report=JSON.parse(await readFile(resolve(temp,'report.json'),'utf8'));assert.equal(report.captions_before_stop,true);assert.equal(report.audio_seconds,3.2);assert.equal(report.configured_model,'SIMULATED_TEST');assert.ok(report.inference_ms.count>=2);assert.ok(report.audio_end_to_result_ms.p95>=0);
    } finally {await rm(temp,{recursive:true,force:true});}
  } finally {client?.terminate();worker?.terminate();await app.close();await new Promise<void>(r=>mock.close(()=>r()));}
});
