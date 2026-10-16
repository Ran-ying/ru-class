import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Session } from './session.js';
import { OpenAICompatibleAsr, type AsrOptions } from './inference.js';
import { Continuity, decodeAudio, event, parseEvent } from './protocol.js';
import { createModelStore, normalizeAccount, probeAccount, publicAccount, validKind, envSpeechOverride, type Accounts } from './model-settings.js';

type Config = {clientToken: string; workerToken: string; publicOrigin?: string; webRoot?: string; asr?:AsrOptions; localBootstrap?:boolean; configPath?:string; modelSettings?:Pick<Accounts,'image'|'text'>};
export function createGateway(config: Config) {
  if (config.clientToken.length < 24 || config.workerToken.length < 24 || config.clientToken === config.workerToken) throw new Error('Configure distinct CLIENT_TOKEN and WORKER_TOKEN (at least 24 characters)');
  let directAdapter=config.asr ? new OpenAICompatibleAsr(config.asr) : undefined;
  let directReady=false;
  const modelStore=createModelStore(config.configPath||'config.json', {
    speech: config.asr?{...config.asr}:{baseUrl:'',model:'',apiKey:''},
    image: config.modelSettings?.image||{baseUrl:'',model:'',apiKey:''},
    text: config.modelSettings?.text||{baseUrl:'',model:'',apiKey:''}
  });
  const directStatus=()=>({model:directAdapter?.options.model||'未配置',os:'ASR API',backend:'remote:unverified',ready:true});
  const ready=()=>directAdapter ? directReady : !!worker;
  const status=()=>directAdapter ? directStatus() : workerStatus;
  const webRoot = config.webRoot ?? resolve('apps/web');
  const assets: Record<string, [string, string]> = {'/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/audio.js': ['audio.js', 'text/javascript'], '/capture-worklet.js': ['capture-worklet.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']};
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    res.setHeader('Cache-Control', 'no-store');
    const apiPath=new URL(req.url??'/','http://localhost').pathname;
    let host = '';
    try { host = new URL('http://' + (req.headers.host || '')).hostname; } catch { /* Invalid host is never local. */ }
    const local=config.localBootstrap && ['localhost','127.0.0.1','[::1]'].includes(host) && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'') && !config.publicOrigin;
    if(apiPath==='/api/bootstrap') {
      if(req.method!=='GET'||!local||(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)){res.writeHead(403).end();return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({clientToken:config.clientToken,asr:{baseUrl:directAdapter?.options.baseUrl||'',model:directAdapter?.options.model||'small',keyConfigured:!!directAdapter?.options.apiKey},ready:directReady,models:Object.fromEntries((['speech','image','text'] as const).map(k=>[k,publicAccount(modelStore.models[k])]))}));return;
    }
    const profileRoute=/^\/api\/models\/(speech|image|text)\/(save|test)$/.exec(apiPath);
    if(profileRoute){
      const kind=profileRoute[1],operation=profileRoute[2];
      if(req.method!=='POST'||!local||req.headers.origin!==`http://${req.headers.host}`||req.headers.authorization!==`Bearer ${config.clientToken}`){res.writeHead(403).end();return;}
      res.setHeader('Content-Type','application/json');
      if(!validKind(kind)){res.writeHead(400).end(JSON.stringify({error:'INVALID_MODEL_KIND'}));return;}
      if(operation==='save' && kind==='speech' && active){res.writeHead(409).end(JSON.stringify({error:'录音进行中，不能更换语音模型'}));return;}
      if(operation==='save' && kind==='speech' && envSpeechOverride()){res.writeHead(409).end(JSON.stringify({error:'语音模型由环境变量配置，请先移除 ASR_* 环境变量覆盖'}));return;}
      try{
        let body='';for await(const part of req){body+=part;if(body.length>8192)throw new Error('MODEL_REQUEST_TOO_LARGE');}
        const account=normalizeAccount(JSON.parse(body),modelStore.models[kind]);
        if(operation==='test'){
          await probeAccount(account);
          res.end(JSON.stringify({ok:true,detail:'已验证模型列表接口和模型名称；尚未测试实际推理'}));return;
        }
        await modelStore.persist(kind,account);
        if(kind==='speech'){
          directAdapter=new OpenAICompatibleAsr(account);
          directReady=false;
          clients.forEach(c=>send(c,'connection.status','',{worker_online:false}));
        }
        res.end(JSON.stringify({ok:true,profile:publicAccount(account)}));
      }catch(e){
        const code=e instanceof Error?e.message:'INVALID_MODEL_CONFIG';
        const safe=/^(INVALID_|MODEL_|NEW_MODEL_URL_)/.test(code)?code:'MODEL_SAVE_OR_TEST_FAILED';
        res.writeHead(safe==='MODEL_SAVE_OR_TEST_FAILED'?502:400).end(JSON.stringify({error:safe}));
      }
      return;
    }
    if(apiPath==='/api/asr') {
      if(req.method!=='POST'||!local||req.headers.origin!==`http://${req.headers.host}`||req.headers.authorization!==`Bearer ${config.clientToken}`){res.writeHead(403).end();return;}
      if(active){res.writeHead(409).end(JSON.stringify({error:'请先停止录音'}));return;}
      try {let raw='';for await(const part of req){raw+=part;if(raw.length>8192)throw new Error('请求过大');}
        const body=JSON.parse(raw);if(!body.apiKey&&directAdapter&&body.baseUrl!==directAdapter.options.baseUrl)throw new Error('ASR_NEW_URL_REQUIRES_KEY');const adapter=new OpenAICompatibleAsr({baseUrl:body.baseUrl,model:body.model,apiKey:body.apiKey||directAdapter?.options.apiKey||''});
        await adapter.probe();if(active)throw new Error('请先停止录音');directAdapter=adapter;directReady=true;
        clients.forEach(c=>send(c,'connection.status','',{worker_online:true,worker:directStatus()}));
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
      }catch(e){res.writeHead(400).end(JSON.stringify({error:e instanceof Error&&/^(ASR_|INVALID_ASR)/.test(e.message)?e.message:'API 配置无效或连接失败'}));}return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ok: true, worker_online: ready()})); return; }
    const asset = assets[path];
    if (!asset) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', `${asset[1]}; charset=utf-8`); res.end(await readFile(`${webRoot}/${asset[0]}`)); }
    catch { res.writeHead(500).end('Asset unavailable'); }
  });
  const wss = new WebSocketServer({noServer: true, maxPayload: 40000, perMessageDeflate: false});
  let worker: WebSocket | undefined;
  let workerConnection: WebSocket | undefined;
  let stopTimeout: ReturnType<typeof setTimeout> | undefined;
  let workerStatus: Record<string, any> = {};
  let active: {id: string; client: WebSocket; continuity: Continuity; stopping: boolean; session?:Session} | undefined;
  const clients = new Set<WebSocket>();
  const send = (ws: WebSocket | undefined, type: string, id = '', payload = {}) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event(type, id, payload))); };
  function fail(ws: WebSocket, code: string, id = '') { send(ws, 'session.error', id, {code}); }
  function abort(code: string) {
    if (!active) return;
    fail(active.client, code, active.id);
    active.session?.cancel();
    send(worker, 'session.cancel', active.id);
    active = undefined; clearTimeout(stopTimeout);
  }
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const role = path === '/ws/client' ? 'client' : path === '/ws/worker' ? 'worker' : null;
    const expected = config.publicOrigin || `http://${req.headers.host}`;
    if (!role || (directAdapter && role==='worker') || (role === 'client' && req.headers.origin !== expected) || wss.clients.size >= 12) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      let authenticated = false;
      let alive = true;
      const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
      ws.on('pong', () => { alive = true; });
      const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 15000);
      ws.on('message', (data, binary) => {
        try {
          if (!authenticated) {
            if (binary) throw new Error('AUTH_REQUIRED');
            const m = parseEvent(data.toString());
            const token = m.payload.token;
            const expectedToken = role === 'client' ? config.clientToken : config.workerToken;
            if (m.type !== 'auth' || typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(expectedToken) || !timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) { ws.close(1008, 'Authentication failed'); return; }
            if (role === 'worker' && workerConnection) { ws.close(1013, 'Worker already online'); return; }
            authenticated = true; clearTimeout(authTimer);
            if (role === 'worker') workerConnection = ws;
            if (role === 'client') clients.add(ws);
            send(ws, 'auth.ok', '', {worker_online: ready(), worker: status()});
            return;
          }
          if (binary) {
            if (role !== 'client') throw new Error('UNEXPECTED_BINARY');
            const {header,pcm} = decodeAudio(Buffer.from(data as Buffer));
            if (!active || active.client !== ws || active.id !== header.session_id || active.stopping) throw new Error('UNKNOWN_SESSION');
            active.continuity.accept(header);
            if(directAdapter){active.session!.push(header,pcm);return;}
            if (!worker || worker.bufferedAmount > 1024 * 1024) { abort('WORKER_UNAVAILABLE_OR_SLOW'); return; }
            worker.send(data, {binary: true}); return;
          }
          const m = parseEvent(data.toString());
          if (m.type === 'ping') { send(ws, 'pong', m.session_id); return; }
          if (role === 'worker') {
            if (m.type === 'worker.ready' && workerConnection === ws && !worker) {
              if (typeof m.payload.model !== 'string' || typeof m.payload.os !== 'string' || typeof m.payload.backend !== 'string' || m.payload.ready !== true) throw new Error('INVALID_WORKER_STATUS');
              worker = ws; workerStatus = m.payload;
              clients.forEach(c => send(c, 'connection.status', '', {worker_online: true, worker: status()})); return;
            }
            if (worker !== ws || !active || m.session_id !== active.id) throw new Error('UNKNOWN_SESSION');
            if (m.type === 'asr.partial') {
              const p = m.payload;
              if (typeof p.text !== 'string' || p.text.length > 20000 || !Number.isSafeInteger(p.window_start_sample) || !Number.isSafeInteger(p.window_end_sample) || p.window_start_sample < 0 || p.window_end_sample > active.continuity.sample || p.window_end_sample <= p.window_start_sample || p.sample_rate !== 16000 || p.alignment_quality !== 'window_only' || typeof p.final !== 'boolean' || !Number.isFinite(p.queue_audio_ms) || p.queue_audio_ms < 0 || !Number.isFinite(p.inference_ms) || p.inference_ms < 0) throw new Error('INVALID_ASR_RESULT');
              send(active.client, m.type, m.session_id, p);
            } else if (m.type === 'session.stopped') { send(active.client, m.type, m.session_id); active = undefined; clearTimeout(stopTimeout); }
            else if (m.type === 'session.error') abort('INFERENCE_FAILED');
            else throw new Error('UNKNOWN_EVENT');
            return;
          }
          if (m.type === 'session.start') {
            if (!/^[a-zA-Z0-9-]{16,64}$/.test(m.session_id)) throw new Error('INVALID_SESSION_ID');
            if (active) throw new Error('SESSION_BUSY');
            if (!ready()) throw new Error('WORKER_OFFLINE');
            active = {id: m.session_id, client: ws, continuity: new Continuity(), stopping: false};
            if(directAdapter){
              const owner=active;
              owner.session=new Session(directAdapter,result=>{if(active===owner)send(ws,'asr.partial',owner.id,result);},()=>{if(active===owner)abort('INFERENCE_FAILED');});
            }
            send(worker, 'session.start', active.id);
            send(ws, 'session.ready', active.id, {worker: status()});
          } else if (m.type === 'session.stop') {
            if (!active || active.client !== ws || active.id !== m.session_id) throw new Error('UNKNOWN_SESSION');
            active.stopping = true; send(worker, 'session.stop', active.id);
            stopTimeout = setTimeout(() => abort('STOP_TIMEOUT'), 65000);
            if(active.session){const owner=active;void owner.session!.stop().then(()=>{if(active===owner){send(ws,'session.stopped',owner.id);active=undefined;clearTimeout(stopTimeout);}});}
          } else throw new Error('UNKNOWN_EVENT');
        } catch (e) {
          const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_MESSAGE';
          if (active?.client === ws && binary) abort(code); else fail(ws, code);
        }
      });
      ws.on('error', () => {});
      ws.on('close', () => {
        clearTimeout(authTimer); clearInterval(heartbeat); clients.delete(ws);
        if (workerConnection === ws) workerConnection = undefined;
        if (worker === ws) { worker = undefined; workerStatus = {}; abort('WORKER_DISCONNECTED'); clients.forEach(c => send(c, 'connection.status', '', {worker_online: false})); }
        if (active?.client === ws) { active.session?.cancel(); send(worker, 'session.cancel', active.id); active = undefined; clearTimeout(stopTimeout); }
      });
    });
  });
  const probe=async()=>{if(directAdapter){try{await directAdapter.probe();directReady=true;}catch{directReady=false;}}};
  return {server, probe, close: async () => { active?.session?.cancel(); for (const ws of wss.clients) ws.terminate(); await new Promise<void>(r => wss.close(() => r())); await new Promise<void>(r => server.close(() => r())); }};
}
