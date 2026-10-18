import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createSite,loadSiteConfig} from '../apps/server/src/site.js';
// @ts-ignore Browser runtime JavaScript intentionally has no TypeScript declarations.
import {AudioRing,BrowserAsrSession,discoverModels,endpoint,wavBlob,testConnection} from '../apps/web/direct-asr.js';
// @ts-ignore Browser runtime JavaScript intentionally has no TypeScript declarations.
import {TranscriptBuffer} from '../apps/web/transcript.js';
// @ts-ignore Browser runtime JavaScript intentionally has no TypeScript declarations.
import {wavHeader,pcm16} from '../apps/web/local-store.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('public RU-Class serves static pages, never user-provider proxy or site login',async()=>{
  const site=createSite();
  site.listen(0,'127.0.0.1');await new Promise<void>(r=>site.once('listening',r));
  const root='http://127.0.0.1:'+(site.address() as any).port;
  try{
    for(const path of ['/','/app.js','/direct-asr.js','/transcript.js','/local-store.js','/audio.js','/capture-worklet.js','/stable-units.js','/sentence-worker.js','/translation-recovery.js','/stable-source-audit.js']){
      const response=await fetch(root+path);
      assert.equal(response.status,200,path);
    }
    for(const path of ['/api/bootstrap','/api/models/speech/save','/api/models/speech/list','/ws/client','/api/asr']){
      const response=await fetch(root+path);
      assert.equal(response.status,404,path);
    }
    const homepage=await fetch(root+'/').then(r=>r.text());
    assert.match(homepage,/课程管理/);
    assert.match(homepage,/id="local-lessons"/);
    assert.doesNotMatch(homepage,/id="panel-access"|id="tab-access"/);
    assert.doesNotMatch(homepage,/站点访问令牌|保存访问令牌|id="site-auth"/);
    const csp=(await fetch(root+'/')).headers.get('content-security-policy')||'';
    assert.match(csp,/connect-src 'self' https:/);
    assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);
    assert.equal((await fetch(root+'/api/models/speech/save',{method:'POST'})).status,405);
  }finally{site.closeAllConnections();await new Promise<void>(r=>site.close(()=>r()));}
});


test('all browser ES modules are served with executable JavaScript MIME, not 404',async()=>{
  const site=createSite();
  site.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>site.once('listening',resolve));
  const root='http://127.0.0.1:'+(site.address() as any).port;
  try{
    // Guard the actual static manifest against drift whenever an import or
    // new browser module is added. A single missing dependency prevents
    // app.js from executing and leaves both Settings and + inert.
    const modules=readdirSync('apps/web').filter(name=>name.endsWith('.js'));
    assert.ok(modules.includes('app.js'));
    assert.ok(modules.includes('translation-recovery.js'));
    for(const filename of modules){
      const path='/'+filename;
      const response=await fetch(root+path);
      assert.equal(response.status,200,'Missing browser ES module: '+path);
      assert.match(response.headers.get('content-type')||'',/^text\/javascript\b/,path);
      assert.ok((await response.text()).length>0,path);
      const head=await fetch(root+path,{method:'HEAD'});
      assert.equal(head.status,200,'HEAD '+path);
      assert.match(head.headers.get('content-type')||'',/^text\/javascript\b/,path);
    }
    const app=await fetch(root+'/app.js').then(r=>r.text());
    for(const [,source] of app.matchAll(/\bfrom\s*['"]((?:\.\/)[^'"]+\.js)['"]/g)){
      const dependency=new URL(source,root+'/app.js');
      const response=await fetch(dependency);
      assert.equal(response.status,200,'Unresolved app.js import: '+source);
    }
    for(const forbidden of ['/config.json','/package.json','/api/bootstrap','/unknown.js']){
      assert.equal((await fetch(root+forbidden)).status,404,forbidden);
    }
  }finally{
    site.closeAllConnections();
    await new Promise<void>(resolve=>site.close(()=>resolve()));
  }
});

test('static site config requires no shared token, model address or user database',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ru-class-site-'));
  const file=join(dir,'config.json');
  const original={HOST:process.env.HOST,PORT:process.env.PORT,PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN};
  delete process.env.HOST;delete process.env.PORT;delete process.env.PUBLIC_ORIGIN;
  try{
    await writeFile(file,JSON.stringify({listen:{host:'127.0.0.1',port:4567},site:{publicOrigin:'https://class.example.test'}}));
    assert.deepEqual(loadSiteConfig(file),{host:'127.0.0.1',port:4567,publicOrigin:'https://class.example.test'});
    await writeFile(file,JSON.stringify({listen:{host:'0.0.0.0',port:4567}}));
    assert.throws(()=>loadSiteConfig(file),/NON_LOOPBACK_REQUIRES_HTTPS/);
  }finally{
    for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await rm(dir,{recursive:true,force:true});
  }
});

test('browser-owned ring retains exactly last 8 seconds without accumulating unbounded PCM',()=>{
  const ring=new AudioRing();
  for(let i=0;i<12;i++)ring.push(new Float32Array(16000).fill(i/20));
  const snap=ring.snapshot();
  assert.equal(snap.end,12*16000);
  assert.equal(snap.start,4*16000);
  assert.equal(snap.pcm.length,8*16000);
  assert.equal(snap.pcm[0],Math.fround(4/20));
  assert.equal(snap.pcm.at(-1),Math.fround(11/20));
});

test('direct API calls support CORS-compatible model discovery and real WAV multipart',async()=>{
  const previous=globalThis.fetch;
  const seen:any[]=[];
  globalThis.fetch=(async(url:any,options:any)=>{
    seen.push({url,options});
    if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'small'},{id:'small'},{id:'tiny'}]}),{status:200});
    if(String(url).endsWith('/audio/transcriptions')){
      const file=options.body.get('file');
      assert.equal(options.body.get('language'),'ru');
      assert.equal(options.body.get('model'),'small');
      assert.equal(file.name,'window.wav');
      const bytes=new Uint8Array(await file.arrayBuffer());
      assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');
      return new Response(JSON.stringify({text:'  Сегодня мы обсуждаем методы защиты  '}),{status:200});
    }
    throw Error('Unexpected request: '+url);
  }) as any;
  try{
    assert.deepEqual((await discoverModels('https://my-asr.example/v1','own-key')).models,['small','tiny']);
    assert.equal(await testConnection({baseUrl:'https://my-asr.example/v1',model:'small',apiKey:'own-key'}),true);
    const results:any[]=[];
    const session=new BrowserAsrSession({baseUrl:'https://my-asr.example/v1',model:'small',apiKey:'own-key'},(x:any)=>results.push(x),(e:any)=>assert.fail(String(e)));
    session.ring.push(new Float32Array(16000*2));
    await session.run();
    await session.stop();
    assert.ok(results.some(x=>x.stable_delta.includes('Сегодня')));
    assert.equal(results.at(-1).partial_text,'');
    assert.equal(results.at(-1).final,true);
    assert.equal(results[0].raw_hypothesis_text,'  Сегодня мы обсуждаем методы защиты  ',
      'Evidence preserves exact provider text including whitespace');
    assert.equal(results[0].window_start_sample,0);
    assert.equal(results[0].window_end_sample,32000);
    assert.equal(results.at(-1).raw_hypothesis_text,undefined,
      'A pure flush must never manufacture or duplicate a provider hypothesis');
    assert.equal(seen.filter(x=>String(x.url).includes('/audio/transcriptions')).length,1);
    assert.ok(seen.every(x=>String(x.url).startsWith('https://my-asr.example/v1/')));
    assert.equal(seen.at(-1).options.credentials,'omit');
  }finally{globalThis.fetch=previous;}
});

test('real final ASR call preserves the provider text and exact window range',async()=>{
  const previous=globalThis.fetch;
  let count=0;
  globalThis.fetch=(async()=>{
    count++;
    return new Response(JSON.stringify({text:'  Карточка отслеживается.  '}),{status:200});
  }) as any;
  try{
    const events:any[]=[];
    const session=new BrowserAsrSession(
      {baseUrl:'https://private-asr.example/v1',model:'small',apiKey:'own-key'},
      (x:any)=>events.push(x),(e:any)=>assert.fail(String(e))
    );
    session.ring.push(new Float32Array(2*16000));
    await session.run();
    session.ring.push(new Float32Array(16000));
    await session.stop();
    assert.equal(count,2);
    assert.equal(events.length,2);
    assert.equal(events[0].final,false);
    assert.equal(events[0].window_end_sample,32000);
    assert.equal(events[1].final,true);
    assert.equal(events[1].window_start_sample,0);
    assert.equal(events[1].window_end_sample,48000);
    assert.equal(events[1].raw_hypothesis_text,'  Карточка отслеживается.  ',
      'The original provider response must not be replaced with trimmed live captions');
    assert.equal(events[1].partial_text,'');
  }finally{globalThis.fetch=previous;}
});

test('provider evidence is saved before subtitle projection, even when projection throws',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(async()=>new Response(
    JSON.stringify({text:'  Оригинальная распознанная фраза.  '}),{status:200}
  )) as any;
  try{
    const sequence:string[]=[];
    const saved:any[]=[];
    const session=new BrowserAsrSession(
      {baseUrl:'https://private-asr.example/v1',model:'small',apiKey:'own-key'},
      ()=>sequence.push('subtitle'),
      (e:any)=>{sequence.push('error: '+String(e));},
      async(raw:any)=>{
        await Promise.resolve();
        saved.push(raw);
        sequence.push('evidence');
      }
    );
    session.transcript.update=()=>{throw Error('PROJECTION_FAILURE');};
    session.ring.push(new Float32Array(2*16000));
    await assert.rejects(session.run(),/PROJECTION_FAILURE/);
    assert.deepEqual(sequence,['evidence'],'No subtitle callback may precede raw evidence');
    assert.equal(saved.length,1);
    assert.equal(saved[0].text,'  Оригинальная распознанная фраза.  ');
    assert.equal(saved[0].startSample,0);
    assert.equal(saved[0].endSample,32000);
    assert.equal(saved[0].final,false);
    session.cancel();
  }finally{globalThis.fetch=originalFetch;}
});

test('unsupported models endpoint is manual-only; API without CORS is rejected rather than proxied',async()=>{
  const previous=globalThis.fetch;
  try{
    globalThis.fetch=(async()=>new Response('',{status:404})) as any;
    assert.deepEqual(await discoverModels('https://provider.example/v1',''),{models:[],unsupported:true});
    globalThis.fetch=(async()=>{throw new TypeError('Failed to fetch');}) as any;
    await assert.rejects(discoverModels('https://provider.example/v1','my-token'),/CORS/);
    assert.throws(()=>endpoint('http://third-party.example/v1'),/HTTPS/);
    assert.throws(()=>endpoint('javascript:alert(1)'),/API 地址格式/);
  }finally{globalThis.fetch=previous;}
});

test('browser transcript stabilization retains confirmed speech across windows',()=>{
  const buffer=new TranscriptBuffer();
  const rows=[
    buffer.update('Сегодня мы говорим о защите',0,32000),
    buffer.update('мы говорим о защите информации',16000,48000),
    buffer.flush()
  ];
  assert.equal(rows.map(x=>x.stable_delta).filter(Boolean).join(' '),'Сегодня мы говорим о защите информации');
});

test('PCM16 and WAV header are valid for offline browser recordings',()=>{
  const frame=pcm16(new Float32Array([-1,0,1]));
  const view=new DataView(frame.buffer);
  assert.equal(view.getInt16(0,true),-32768);
  assert.equal(view.getInt16(2,true),0);
  assert.equal(view.getInt16(4,true),32767);
  const header=wavHeader(3);
  assert.equal(new DataView(header.buffer).getUint32(4,true),42);
  assert.equal(wavBlob(new Float32Array([0,1])).size,48);
});
