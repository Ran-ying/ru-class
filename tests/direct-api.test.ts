import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import WebSocket from 'ws';
import http from 'node:http';
import {createGateway} from '../apps/server/src/gateway.js';
import {event,encodeAudio,type AudioHeader} from '../apps/server/src/protocol.js';

test('primary chain: browser → main window scheduler → authenticated independent ASR API', {skip:!process.env.ASR_REPO},async()=>{
  const {createAsrApi}=await import(pathToFileURL(resolve(process.env.ASR_REPO!,'src/api.ts')).href);
  const key='SIMULATED_ASR_API_KEY_24_CHARS';let calls=0;
  const api=createAsrApi({infer:async(pcm:Buffer)=>{assert.ok(pcm.length>0);calls++;return 'SIMULATED_API_TRANSCRIPT';}},{apiKey:key,model:'small'});
  api.listen(0,'127.0.0.1');await new Promise<void>(r=>api.once('listening',r));
  const baseUrl=`http://127.0.0.1:${api.address().port}/v1`;
  const clientToken='SIMULATED_CLIENT_AUTH_24_CHARS';
  const gateway=createGateway({clientToken,workerToken:'SIMULATED_UNUSED_WORKER_TOKEN',localBootstrap:true,asr:{baseUrl,apiKey:key,model:'small'}});
  await gateway.probe();gateway.server.listen(0,'127.0.0.1');await new Promise<void>(r=>gateway.server.once('listening',r));
  const origin=`http://127.0.0.1:${(gateway.server.address() as any).port}`;
  let client:WebSocket|undefined;
  try{
    const bootstrap=await fetch(origin+'/api/bootstrap').then(r=>r.json()) as any;
    assert.equal(bootstrap.clientToken,clientToken);assert.equal(bootstrap.ready,true);assert.equal(bootstrap.asr.keyConfigured,true);assert.ok(!JSON.stringify(bootstrap).includes(key));
    assert.equal((await fetch(origin+'/api/bootstrap',{headers:{Origin:'https://wrong.example'}})).status,403);
    assert.equal(await new Promise<number>(resolve=>{http.get(origin+'/api/bootstrap',{headers:{Host:'wrong.example'}},res=>{res.resume();resolve(res.statusCode!);});}),403);
    assert.equal((await fetch(origin+'/api/asr',{method:'POST',headers:{Origin:origin},body:'{}'})).status,403);
    const post=(body:any)=>fetch(origin+'/api/asr',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${clientToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({baseUrl,model:'small',apiKey:'invalid'})).status,400);
    assert.equal((await post({baseUrl,model:'small',apiKey:''})).status,200);
    const queue:any[]=[];const waiters:((m:any)=>void)[]=[];
    const next=()=>queue.length?Promise.resolve(queue.shift()):Promise.race([new Promise<any>(r=>waiters.push(r)),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('API chain timeout')),4000);timer.unref();})]);
    client=new WebSocket(origin.replace('http:','ws:')+'/ws/client',{origin});
    client.on('message',data=>{const m=JSON.parse(data.toString());const waiter=waiters.shift();if(waiter)waiter(m);else queue.push(m);});
    await new Promise<void>(r=>client!.once('open',r));
    const id='api-session-12345678';const send=(type:string,payload={})=>client!.send(JSON.stringify(event(type,id,payload)));
    send('auth',{token:clientToken});assert.equal((await next()).type,'auth.ok');send('session.start');assert.equal((await next()).type,'session.ready');
    assert.equal((await post({baseUrl,model:'small'})).status,409);
    const audio=(i:number,count=3200)=>client!.send(encodeAudio({...event('audio.frame',id),type:'audio.frame',payload:{seq:i,start_sample:i*3200,sample_count:count,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:48000,source_start_sample:i*9600,source_end_sample:i*9600+count*3}} as AudioHeader,Buffer.alloc(count*2)));
    for(let i=0;i<10;i++)audio(i);
    const first=await next();assert.equal(first.type,'asr.partial');assert.equal(first.payload.text,'SIMULATED_API_TRANSCRIPT');
    audio(10,1600);send('session.stop');const tail=await next();assert.equal(tail.payload.window_end_sample,33600);assert.equal(tail.payload.final,true);assert.equal((await next()).type,'session.stopped');assert.equal(calls,2);
  }finally{client?.terminate();await gateway.close();api.closeAllConnections();await new Promise<void>(r=>api.close(()=>r()));}
});
