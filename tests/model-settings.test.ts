import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createGateway} from '../apps/server/src/gateway.js';
import {createModelStore, normalizeAccount, probeAccount} from '../apps/server/src/model-settings.js';

const speech={baseUrl:'http://127.0.0.1:8090/v1',model:'small',apiKey:'speech-secret-123456'};
test('three profiles persist independently without tests or leaking keys',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-models-'));const file=join(dir,'config.json');
  const provider=http.createServer((req,res)=>{
    if(req.url!=='/v1/models'||req.headers.authorization!=='Bearer vision-secret'){res.writeHead(401).end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'vision-model'}]}));
  });
  provider.listen(0,'127.0.0.1');await new Promise<void>(r=>provider.once('listening',r));
  const port=(provider.address() as any).port;
  const initial={speech:{...speech},image:{baseUrl:'',model:'',apiKey:''},text:{baseUrl:'',model:'',apiKey:''}};
  await writeFile(file,JSON.stringify({listen:{port:4545},asr:{baseUrl:'legacy'},site:{publicOrigin:''}}));
  const gateway=createGateway({clientToken:'client-token-at-least-24-characters',workerToken:'worker-token-at-least-24-characters',localBootstrap:true,configPath:file,asr:speech,modelSettings:{image:initial.image,text:initial.text}});
  gateway.server.listen(0,'127.0.0.1');await new Promise<void>(r=>gateway.server.once('listening',r));
  const origin='http://127.0.0.1:'+(gateway.server.address() as any).port;
  const headers={Origin:origin,Authorization:'Bearer client-token-at-least-24-characters','Content-Type':'application/json'};
  const post=(kind:string,action:string,data:any)=>fetch(origin+'/api/models/'+kind+'/'+action,{method:'POST',headers,body:JSON.stringify(data)});
  try {
    const image={baseUrl:'http://127.0.0.1:'+port+'/v1',model:'vision-model',apiKey:'vision-secret'};
    const save=await post('image','save',image);
    assert.equal(save.status,200);
    assert.equal((await save.json()).profile.keyConfigured,true);
    let disk=JSON.parse(await readFile(file,'utf8'));
    assert.equal(disk.listen.port,4545);assert.equal(disk.asr.baseUrl,'legacy');
    assert.equal(disk.models.image.apiKey,'vision-secret');
    assert.ok(!disk.models.text);
    let bootstrap=await fetch(origin+'/api/bootstrap').then(r=>r.json());
    assert.equal(bootstrap.models.image.apiKey,undefined);
    assert.equal(bootstrap.models.image.keyConfigured,true);
    assert.ok(!JSON.stringify(bootstrap).includes('vision-secret'));
    assert.equal((await post('image','test',{...image,apiKey:''})).status,200);
    const bad=await post('image','test',{...image,baseUrl:'http://localhost:9/v1',apiKey:''});
    assert.equal(bad.status,400); // Blank keys cannot move to a different endpoint.
    assert.equal((await post('text','save',{baseUrl:'https://text.example.test/v1',model:'text-model',apiKey:'text-secret'})).status,200);
    disk=JSON.parse(await readFile(file,'utf8'));
    assert.equal(disk.models.image.apiKey,'vision-secret');
    assert.equal(disk.models.text.apiKey,'text-secret');
    assert.equal(disk.models.speech,undefined);
    assert.equal((await post('image','save',{...image,apiKey:''})).status,200);
    disk=JSON.parse(await readFile(file,'utf8'));assert.equal(disk.models.image.apiKey,'vision-secret');
    assert.equal((await post('image','save',{...image,baseUrl:'http://127.0.0.1:8989/v1',apiKey:''})).status,400);
    const speechDraft={baseUrl:image.baseUrl,model:'vision-model',apiKey:'vision-secret'};
    assert.equal((await post('speech','save',speechDraft)).status,200);
    assert.equal((await fetch(origin+'/health').then(r=>r.json())).worker_online,false);
    assert.equal((await post('speech','test',{...speechDraft,apiKey:''})).status,200);
    assert.equal((await fetch(origin+'/health').then(r=>r.json())).worker_online,true);
    disk=JSON.parse(await readFile(file,'utf8'));
    assert.equal(disk.models.speech.model,'vision-model');
    assert.equal(disk.models.image.apiKey,'vision-secret');
    assert.equal(disk.models.text.apiKey,'text-secret');
  }finally{await gateway.close();await new Promise<void>(r=>provider.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

test('endpoint validator forbids HTTP remote secrets and retains same-endpoint key only',()=>{
  assert.throws(()=>normalizeAccount({baseUrl:'http://untrusted.example/v1',model:'m',apiKey:'key'},speech),/MODEL_REMOTE_REQUIRES_HTTPS/);
  assert.throws(()=>normalizeAccount({baseUrl:'https://new.example/v1',model:'m',apiKey:''},speech),/NEW_MODEL_URL_REQUIRES_KEY/);
  assert.equal(normalizeAccount({baseUrl:speech.baseUrl,model:'different',apiKey:''},speech).apiKey,speech.apiKey);
});
