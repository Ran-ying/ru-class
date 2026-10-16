import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGateway } from '../apps/server/src/gateway.js';
import { event, encodeAudio, type AudioHeader } from '../apps/server/src/protocol.js';
const clientToken='client-test-token-at-least-24-chars';
const workerToken='worker-test-token-at-least-24-chars';
export class Peer {
  ws:WebSocket; queue:any[]=[]; waiters:((value:any)=>void)[]=[];
  constructor(url:string,origin?:string) {this.ws=new WebSocket(url,origin?{origin}:{});this.ws.on('message',data=>{const m=JSON.parse(data.toString());const waiter=this.waiters.shift();if(waiter)waiter(m);else this.queue.push(m);});}
  async open(){await new Promise<void>((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject);});}
  send(type:string,id='',payload={}){this.ws.send(JSON.stringify(event(type,id,payload)));}
  async next(){if(this.queue.length)return this.queue.shift();return Promise.race([new Promise<any>(r=>this.waiters.push(r)),new Promise<never>((_,r)=>{const t=setTimeout(()=>r(new Error('message timeout')),3000);t.unref();})]);}
}
test('authenticated routing, unknown session, continuity, stop and Worker disconnect',async()=>{
  const app=createGateway({clientToken,workerToken});app.server.listen(0,'127.0.0.1');await new Promise<void>(r=>app.server.once('listening',r));
  const port=(app.server.address() as any).port;const origin=`http://127.0.0.1:${port}`;const root=`ws://127.0.0.1:${port}`;
  try {
    const worker=new Peer(root+'/ws/worker');await worker.open();worker.send('auth','',{token:workerToken});assert.equal((await worker.next()).type,'auth.ok');worker.send('worker.ready','',{model:'SIMULATED_TEST',os:'test',backend:'mock',ready:true});
    const client=new Peer(root+'/ws/client',origin);await client.open();client.send('auth','',{token:clientToken});assert.equal((await client.next()).type,'auth.ok');
    client.send('session.stop','unknown-session-id');assert.equal((await client.next()).payload.code,'UNKNOWN_SESSION');
    const id='1234567890123456';client.send('session.start',id);assert.equal((await client.next()).type,'session.ready');assert.equal((await worker.next()).type,'session.start');
    // Capture binary forwarding independently from JSON control parsing.
    worker.ws.removeAllListeners('message');
    const received=new Promise<Buffer>(resolve=>worker.ws.once('message',(data,isBinary)=>{assert.ok(isBinary);resolve(Buffer.from(data as Buffer));}));
    const h={...event('audio.frame',id),type:'audio.frame',payload:{seq:0,start_sample:0,sample_count:3200,sample_rate:16000,channels:1,encoding:'pcm_s16le',source_sample_rate:48000,source_start_sample:0,source_end_sample:9600}} as AudioHeader;
    const packet=encodeAudio(h,Buffer.alloc(6400));client.ws.send(packet);assert.deepEqual(await received,packet);
    worker.ws.send(JSON.stringify(event('asr.partial',id,{text:'SIMULATED_TEST',window_start_sample:0,window_end_sample:3200,sample_rate:16000,inference_ms:2,queue_audio_ms:0,alignment_quality:'window_only',final:false})));
    assert.equal((await client.next()).payload.text,'SIMULATED_TEST');
    client.ws.send(packet);assert.equal((await client.next()).payload.code,'AUDIO_DISCONTINUITY');
    client.send('session.start','abcdefghijklmnop');assert.equal((await client.next()).type,'session.ready');worker.ws.close();
    assert.equal((await client.next()).payload.code,'WORKER_DISCONNECTED');assert.equal((await client.next()).payload.worker_online,false);
    client.send('session.start','another-session-id');assert.equal((await client.next()).payload.code,'WORKER_OFFLINE');
  } finally {await app.close();}
});
test('bad authentication, origin and required distinct secrets are rejected',async()=>{
  assert.throws(()=>createGateway({clientToken:'short',workerToken}));assert.throws(()=>createGateway({clientToken,workerToken:clientToken}));
  const app=createGateway({clientToken,workerToken});app.server.listen(0,'127.0.0.1');await new Promise<void>(r=>app.server.once('listening',r));
  const port=(app.server.address() as any).port;const root=`ws://127.0.0.1:${port}`;
  try {
    const peer=new Peer(root+'/ws/client',`http://127.0.0.1:${port}`);await peer.open();peer.send('auth','',{token:'wrong'});const code=await new Promise<number>(r=>peer.ws.once('close',r));assert.equal(code,1008);
    const wrong=new WebSocket(root+'/ws/client',{origin:'https://evil.example'});wrong.on('error',()=>{});const status=await new Promise<number>(r=>wrong.once('unexpected-response',(_,res)=>{r(res.statusCode!);res.resume();wrong.terminate();}));assert.equal(status,403);
  } finally {await app.close();}
});
