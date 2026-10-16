import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Continuity, decodeAudio, event, parseEvent } from './protocol.js';

type Config = {clientToken: string; workerToken: string; publicOrigin?: string; webRoot?: string};
export function createGateway(config: Config) {
  if (config.clientToken.length < 24 || config.workerToken.length < 24 || config.clientToken === config.workerToken) throw new Error('Configure distinct CLIENT_TOKEN and WORKER_TOKEN (at least 24 characters)');
  const webRoot = config.webRoot ?? resolve('apps/web');
  const assets: Record<string, [string, string]> = {'/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/audio.js': ['audio.js', 'text/javascript'], '/capture-worklet.js': ['capture-worklet.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']};
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ok: true, worker_online: !!worker})); return; }
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
  let active: {id: string; client: WebSocket; continuity: Continuity; stopping: boolean} | undefined;
  const clients = new Set<WebSocket>();
  const send = (ws: WebSocket | undefined, type: string, id = '', payload = {}) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event(type, id, payload))); };
  function fail(ws: WebSocket, code: string, id = '') { send(ws, 'session.error', id, {code}); }
  function abort(code: string) {
    if (!active) return;
    fail(active.client, code, active.id);
    send(worker, 'session.cancel', active.id);
    active = undefined; clearTimeout(stopTimeout);
  }
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const role = path === '/ws/client' ? 'client' : path === '/ws/worker' ? 'worker' : null;
    const expected = config.publicOrigin || `http://${req.headers.host}`;
    if (!role || (role === 'client' && req.headers.origin !== expected) || wss.clients.size >= 12) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
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
            send(ws, 'auth.ok', '', {worker_online: !!worker, worker: workerStatus});
            return;
          }
          if (binary) {
            if (role !== 'client') throw new Error('UNEXPECTED_BINARY');
            const {header} = decodeAudio(Buffer.from(data as Buffer));
            if (!active || active.client !== ws || active.id !== header.session_id || active.stopping) throw new Error('UNKNOWN_SESSION');
            active.continuity.accept(header);
            if (!worker || worker.bufferedAmount > 1024 * 1024) { abort('WORKER_UNAVAILABLE_OR_SLOW'); return; }
            worker.send(data, {binary: true}); return;
          }
          const m = parseEvent(data.toString());
          if (m.type === 'ping') { send(ws, 'pong', m.session_id); return; }
          if (role === 'worker') {
            if (m.type === 'worker.ready' && workerConnection === ws && !worker) {
              if (typeof m.payload.model !== 'string' || typeof m.payload.os !== 'string' || typeof m.payload.backend !== 'string' || m.payload.ready !== true) throw new Error('INVALID_WORKER_STATUS');
              worker = ws; workerStatus = m.payload;
              clients.forEach(c => send(c, 'connection.status', '', {worker_online: true, worker: workerStatus})); return;
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
            if (!worker) throw new Error('WORKER_OFFLINE');
            active = {id: m.session_id, client: ws, continuity: new Continuity(), stopping: false};
            send(worker, 'session.start', active.id);
            send(ws, 'session.ready', active.id, {worker: workerStatus});
          } else if (m.type === 'session.stop') {
            if (!active || active.client !== ws || active.id !== m.session_id) throw new Error('UNKNOWN_SESSION');
            active.stopping = true; send(worker, 'session.stop', active.id);
            stopTimeout = setTimeout(() => abort('STOP_TIMEOUT'), 65000);
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
        if (active?.client === ws) { send(worker, 'session.cancel', active.id); active = undefined; clearTimeout(stopTimeout); }
      });
    });
  });
  return {server, close: async () => { for (const ws of wss.clients) ws.terminate(); await new Promise<void>(r => wss.close(() => r())); await new Promise<void>(r => server.close(() => r())); }};
}
