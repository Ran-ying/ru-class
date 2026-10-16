import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../apps/server/src/config.js';

test('deployment configuration never provides default AI providers or ASR environment overrides',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-config-'));
  const file=join(dir,'config.json'),user=join(dir,'data','local-models.json');
  const keys=['HOST','PORT','PUBLIC_ORIGIN','SITE_ACCESS_TOKEN','CLIENT_TOKEN','ASR_BASE_URL','ASR_MODEL','ASR_API_KEY','RU_CLASS_LOCAL_MODELS_PATH'];
  const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const k of keys)delete process.env[k];
  process.env.RU_CLASS_LOCAL_MODELS_PATH=user;
  try {
    await writeFile(file,JSON.stringify({listen:{host:'127.0.0.1',port:4312},models:{speech:{baseUrl:'https://global-should-not-be-used.test/v1',model:'global',apiKey:'not-for-users'}},asr:{baseUrl:'https://legacy-should-not-be-used.test/v1',model:'legacy',apiKey:'not-for-users'}}));
    process.env.ASR_BASE_URL='https://environment-should-not-be-used.test/v1';
    process.env.ASR_MODEL='environment';
    process.env.ASR_API_KEY='environment-secret';
    let c=loadConfig(file);
    assert.equal(c.port,4312);assert.equal(c.host,'127.0.0.1');
    assert.equal(c.asr,undefined);assert.equal(c.modelSettings.image.baseUrl,'');
    assert.ok(c.clientToken.length>=24);
    assert.equal(c.configPath,user);
    await mkdir(join(dir,'data'),{recursive:true});
    await writeFile(user,JSON.stringify({models:{speech:{baseUrl:'https://user-provided.example/v1',model:'chosen-model',apiKey:'user-owned-secret'},image:{baseUrl:'',model:'',apiKey:''}}}));
    c=loadConfig(file);
    assert.deepEqual(c.asr,{baseUrl:'https://user-provided.example/v1',model:'chosen-model',apiKey:'user-owned-secret'});
    await writeFile(file,JSON.stringify({listen:{host:'0.0.0.0',port:4545},site:{publicOrigin:'https://class.example.test',accessToken:'public-test-token-with-32-characters'}}));
    c=loadConfig(file);
    assert.equal(c.localBootstrap,false);
    assert.equal(c.asr,undefined); // Never preload the local user's secret into public runtime.
    assert.equal(c.modelSettings.image.baseUrl,'');
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
