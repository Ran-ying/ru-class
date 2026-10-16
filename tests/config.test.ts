import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../apps/server/src/config.js';

test('config.json listener overrides defaults and public access remains authenticated',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-config-'));const file=join(dir,'config.json');
  const keys=['HOST','PORT','PUBLIC_ORIGIN','SITE_ACCESS_TOKEN','CLIENT_TOKEN','ASR_BASE_URL','ASR_MODEL','ASR_API_KEY'];
  const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const key of keys)delete process.env[key];
  try{
    await writeFile(file,JSON.stringify({listen:{host:'127.0.0.1',port:4312},asr:{baseUrl:'https://asr.example.test/v1',model:'small',apiKey:'private-test-key'}}));
    let c=loadConfig(file);
    assert.equal(c.port,4312);assert.equal(c.host,'127.0.0.1');assert.equal(c.localBootstrap,true);assert.equal(c.asr.model,'small');
    assert.ok(c.clientToken.length>=24);assert.equal(c.asr.apiKey,'private-test-key');
    await writeFile(file,JSON.stringify({listen:{host:'0.0.0.0',port:4545},site:{publicOrigin:'https://class.example.test',accessToken:'public-test-token-with-32-characters'}}));
    c=loadConfig(file);assert.equal(c.port,4545);assert.equal(c.host,'0.0.0.0');assert.equal(c.publicOrigin,'https://class.example.test');assert.equal(c.localBootstrap,false);
    assert.equal(c.clientToken,'public-test-token-with-32-characters');
    process.env.PORT='4747';assert.equal(loadConfig(file).port,4747);delete process.env.PORT;
    await writeFile(file,JSON.stringify({listen:{host:'0.0.0.0',port:3000}}));
    assert.throws(()=>loadConfig(file),/Non-loopback/);
    await writeFile(file,JSON.stringify({site:{publicOrigin:'http://insecure.test',accessToken:'public-test-token-with-32-characters'}}));
    assert.throws(()=>loadConfig(file),/HTTPS/);
    await writeFile(file,'{bad');assert.throws(()=>loadConfig(file),/Invalid config/);
  }finally{
    for(const key of keys){if(prev[key]===undefined)delete process.env[key];else process.env[key]=prev[key];}
    await rm(dir,{recursive:true,force:true});
  }
});
