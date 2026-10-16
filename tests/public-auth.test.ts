import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createGateway} from '../apps/server/src/gateway.js';
import {event} from '../apps/server/src/protocol.js';

test('reverse-proxy mode never leaks bootstrap token and requires exact public Origin and access token',async()=>{
  const token='test-public-client-access-token-32-characters';
  const app=createGateway({clientToken:token,workerToken:'separate-worker-test-token-32-chars',publicOrigin:'https://class.example.test',localBootstrap:false});
  app.server.listen(0,'127.0.0.1');await new Promise<void>(r=>app.server.once('listening',r));
  const port=(app.server.address() as any).port;const address='http://127.0.0.1:'+port;
  let ws:WebSocket|undefined;
  try{
    const bootstrap=await fetch(address+'/api/bootstrap',{headers:{Host:'localhost:'+port}});assert.equal(bootstrap.status,403);
    const wrong=new WebSocket(address.replace('http:','ws:')+'/ws/client',{origin:'https://wrong.example.test'});
    wrong.on('error',()=>{});
    const code=await new Promise<number>(r=>wrong.once('unexpected-response',(_,res)=>{res.resume();r(res.statusCode||0);wrong.terminate();}));
    assert.equal(code,403);
    ws=new WebSocket(address.replace('http:','ws:')+'/ws/client',{origin:'https://class.example.test'});
    await new Promise<void>((r,reject)=>{ws!.once('open',r);ws!.once('error',reject);});
    const authenticated=new Promise<any>(r=>ws!.once('message',data=>r(JSON.parse(data.toString()))));
    ws.send(JSON.stringify(event('auth','',{token})));
    const result=await authenticated;assert.equal(result.type,'auth.ok');
  }finally{ws?.terminate();await app.close();}
});
