import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';

const files:Record<string,[string,string]>={
  '/':['index.html','text/html; charset=utf-8'],
  '/index.html':['index.html','text/html; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/audio.js':['audio.js','text/javascript; charset=utf-8'],
  '/capture-worklet.js':['capture-worklet.js','text/javascript; charset=utf-8'],
  '/direct-asr.js':['direct-asr.js','text/javascript; charset=utf-8'],
  '/asr-hallucination.js':['asr-hallucination.js','text/javascript; charset=utf-8'],
  '/stable-units.js':['stable-units.js','text/javascript; charset=utf-8'],
  '/history-scroll.js':['history-scroll.js','text/javascript; charset=utf-8'],
  '/speech-bounds.js':['speech-bounds.js','text/javascript; charset=utf-8'],
  '/caption-display.js':['caption-display.js','text/javascript; charset=utf-8'],
  '/live-translation.js':['live-translation.js','text/javascript; charset=utf-8'],
  '/api-parameters.js':['api-parameters.js','text/javascript; charset=utf-8'],
  '/sentence-worker.js':['sentence-worker.js','text/javascript; charset=utf-8'],
  '/translation-recovery.js':['translation-recovery.js','text/javascript; charset=utf-8'],
  '/stable-source-audit.js':['stable-source-audit.js','text/javascript; charset=utf-8'],
  '/transcript.js':['transcript.js','text/javascript; charset=utf-8'],
  '/local-store.js':['local-store.js','text/javascript; charset=utf-8'],
  '/style.css':['style.css','text/css; charset=utf-8']
};
type SiteConfig={listen?:{host?:string;port?:number};site?:{publicOrigin?:string}};
export function loadSiteConfig(path=process.env.RU_CLASS_CONFIG||'config.json'){
  let config:SiteConfig={};
  try{
    config=JSON.parse(readFileSync(resolve(path),'utf8'));
    if(!config||typeof config!=='object'||Array.isArray(config))throw Error('INVALID_DEPLOYMENT_CONFIG');
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const host=process.env.HOST||config.listen?.host||'127.0.0.1';
  const port=Number(process.env.PORT||config.listen?.port||3000);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_PORT');
  const publicOrigin=process.env.PUBLIC_ORIGIN||config.site?.publicOrigin||'';
  if(publicOrigin){
    const url=new URL(publicOrigin);
    if(url.protocol!=='https:'||url.origin!==publicOrigin)throw Error('PUBLIC_ORIGIN_REQUIRES_HTTPS');
  }else if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('NON_LOOPBACK_REQUIRES_HTTPS_ORIGIN');
  return {host,port,publicOrigin};
}
export function createSite(root=resolve('apps/web')){
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','microphone=(self)');
    res.setHeader('Cache-Control','no-store');
    // Dynamic user-chosen HTTPS API origins must be allowed; no server proxy.
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    let path;
    try{path=new URL(req.url||'/','http://localhost').pathname;}catch{res.writeHead(400).end();return;}
    const asset=files[path];
    if(!asset){res.writeHead(404).end();return;}
    try{
      const body=await readFile(resolve(root,asset[0]));
      res.setHeader('Content-Type',asset[1]);
      res.writeHead(200);
      res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(500).end('Website asset unavailable');}
  });
}
