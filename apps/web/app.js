import { encodeFrame } from './audio.js';
const $ = id => document.getElementById(id);
let ws, stream, context, capture, source, sessionId, seq = 0, samples = 0, running = false, stopping = false;
let clientToken='', publicMode = false, hasTranscript = false;
let sent = [], stopTimer, startTimer, flushResolve;
let stableRussian = '', provisionalRussian = '', transcriptRevision = 0;
const errors = {WORKER_OFFLINE:'语音识别 API 未就绪，请在设置中检查地址、key 和模型。',WORKER_DISCONNECTED:'ASR Worker 已断开，录音已停止，本次缺失音频不能续传。',AUDIO_DISCONTINUITY:'检测到音频采样缺口，录音已停止，请重新开始。',SESSION_BUSY:'已有课堂正在录音，请先结束当前会话。',INFERENCE_FAILED:'Whisper 推理失败，录音已停止。',WORKER_UNAVAILABLE_OR_SLOW:'Worker 不可用或处理积压，录音已停止。'};
function send(type, payload = {}) { ws.send(JSON.stringify({protocol_version:'0.1',type,session_id:type === 'auth' ? '' : sessionId || '',message_id:crypto.randomUUID(),payload})); }
function controls(active) { $('record').textContent = stopping ? '正在停止…' : running ? '停止录音' : active ? '连接中…' : '开始录音'; $('record').disabled = stopping || (active && !running); for(const id of ['speech-url','speech-model','speech-key','speech-save','speech-test'])$(id).disabled=active; }
function setConnected(online) { $('connection-state').hidden = online || hasTranscript; $('ru').hidden = !online && !hasTranscript; }
function updateWorker(online, worker = {}) { const label = online ? workerLabel(worker) : '等待语音识别 API'; $('worker').textContent = label; $('worker-detail').textContent = label; setConnected(online); }
async function cleanup() {
  running = false; clearTimeout(stopTimer); clearTimeout(startTimer); stream?.getTracks().forEach(t => t.stop());
  capture?.disconnect(); source?.disconnect();
  if (context && context.state !== 'closed') await context.close().catch(() => {});
  context = undefined; capture = undefined; source = undefined; stream = undefined;
}
async function fail(message) {
  $('error').textContent = message; $('status').textContent = '已停止 · 发生错误';
  await cleanup(); stopping = false; updateWorker(false); controls(false); ws?.close();
}
function workerLabel(p) { return `${p.model || '未知模型'} · ${p.os || '未知系统'} · 后端：${p.backend || '未验证'}`; }
async function startRecording() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { await fail('录音需要 HTTPS（或 localhost）以及支持 AudioWorklet 的浏览器。'); return; }

  controls(true); $('error').textContent = ''; $('status').textContent = '请求麦克风权限…';
  sessionId = crypto.randomUUID(); seq = 0; samples = 0; sent = []; stopping = false; hasTranscript = false;
  stableRussian = ''; provisionalRussian = ''; transcriptRevision = 0;
  $('duration').textContent = '00:00'; $('ru').textContent = '开始录音后，俄语字幕将在这里更新。'; $('latency').textContent = '等待第一条识别结果…'; $('connection-state').hidden=false;
  try {
    // Resume inside the user gesture before waiting for network events (Safari requirement).
    context = new AudioContext(); await context.resume();
    if(!clientToken)await loadConfig();
    if(!clientToken) {
      if(!$('settings').open) $('settings').showModal();
      selectTab('access');
      throw new Error('请先在设置中输入站点访问令牌。');
    }
    stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    await context.audioWorklet.addModule('/capture-worklet.js');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/client`);
    const socket = ws;
    startTimer = setTimeout(() => void fail('建立录音会话超时，请检查网关与 Worker。'),15000);
    ws.onopen = () => send('auth', {token:clientToken});
    ws.onmessage = async ({data}) => {
      if(ws !== socket) return;
      try {
        const m = JSON.parse(data);
        if (m.protocol_version !== '0.1') throw new Error('协议版本不匹配');
        if (m.type === 'auth.ok') { updateWorker(m.payload.worker_online, m.payload.worker); send('session.start', {lesson_name:$('lesson').value}); }
        else if (m.type === 'session.ready' && m.session_id === sessionId) {
          clearTimeout(startTimer);
          updateWorker(true, m.payload.worker);
          const track = stream.getAudioTracks()[0];
          if(!track || track.readyState !== 'live') throw new Error('麦克风已中断，请重新开始。');
          source = context.createMediaStreamSource(stream); capture = new AudioWorkletNode(context, 'ru-capture');
          capture.port.onmessage = ({data: audio}) => {
            if (audio.type === 'flushed') { flushResolve?.(); return; }
            if (audio.type !== 'audio' || !running) return;
            if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 512000) { void fail('音频网络发送积压，录音已停止；请检查连接后重新开始。'); return; }
            const packet = encodeFrame(sessionId, crypto.randomUUID(), seq++, samples, audio.samples, audio.sourceRate);
            samples += audio.samples.length; sent.push({end:samples,at:performance.now()}); if(sent.length > 100) sent.shift();
            ws.send(packet); const seconds = Math.floor(samples / 16000); $('duration').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
          };
          running = true; source.connect(capture); capture.connect(context.destination);
          context.onstatechange = () => { if(running && !stopping && context?.state === 'suspended') void fail('浏览器暂停了音频采集，请保持页面在前台并重新开始。'); };
          track.onended = () => { if(running && !stopping) void fail('麦克风采集中断，请重新开始。'); };
          track.onmute = () => { if(running && !stopping) void fail('麦克风输入暂停，录音已停止，请检查设备后重新开始。'); };
          $('status').textContent = '录音中 · 俄语识别'; controls(true);
        } else if (m.type === 'asr.partial' && m.session_id === sessionId) {
          const ruPanel = $('ru');
          const autoFollow = Number.isFinite(ruPanel.scrollHeight) &&
            ruPanel.scrollHeight - ruPanel.clientHeight - ruPanel.scrollTop < 64;
          const p = m.payload;
          if (Number.isSafeInteger(p.revision) && typeof p.stable_delta === 'string' && typeof p.partial_text === 'string') {
            // The server sends only newly confirmed words. Overlapping Whisper
            // windows must never be appended directly to the displayed text.
            if (p.revision > transcriptRevision) {
              transcriptRevision = p.revision;
              if (p.stable_delta.trim()) stableRussian = stableRussian ? stableRussian + ' ' + p.stable_delta.trim() : p.stable_delta.trim();
              provisionalRussian = p.partial_text.trim();
              const combined = [stableRussian, provisionalRussian].filter(Boolean).join(' ');
              $('ru').textContent = combined || '当前窗口未识别到语音';
              if (combined) hasTranscript = true;
            }
          } else {
            // Legacy Worker protocol: newest window only; never pretend that
            // this is a stable history.
            $('ru').textContent = p.text || '当前窗口未识别到语音';
            if (p.text?.trim()) hasTranscript = true;
          }
          if (hasTranscript) $('connection-state').hidden=true;
          if (autoFollow) ruPanel.scrollTop = ruPanel.scrollHeight;
          const anchor = sent.find(x => x.end >= m.payload.window_end_sample);
          const displayMs = anchor ? performance.now() - anchor.at : null;
          $('latency').textContent = `窗口 ${((m.payload.window_end_sample-m.payload.window_start_sample)/16000).toFixed(1)} s · 推理 ${m.payload.inference_ms.toFixed(0)} ms · 音频末端至显示 ${displayMs === null ? '—' : displayMs.toFixed(0)+' ms'}`;
        } else if(m.type === 'session.stopped' && m.session_id === sessionId) {
          await cleanup(); stopping = false; $('status').textContent=''; $('worker').textContent=''; $('connection-state').hidden=true; $('ru').hidden=!hasTranscript; controls(false); ws.close();
        } else if(m.type === 'session.error') await fail(errors[m.payload.code] || `服务错误：${m.payload.code}`);
        else if(m.type === 'connection.status') updateWorker(m.payload.worker_online, m.payload.worker);
      } catch(e) { await fail(e.message || '无法处理服务端消息'); }
    };
    ws.onclose = event => {
      if(ws !== socket || !(running || stopping || context))return;
      if(event.code === 1008 && publicMode) { sessionStorage.removeItem('ru-class-site-token'); clientToken = ''; }
      void fail(event.code === 1008 ? '站点认证失败，请在设置中检查访问令牌。' : '网关连接已断开，录音已停止。v0.1 不支持断网续传。');
    };
    ws.onerror = () => { if(ws === socket) void fail('无法连接网关，请检查网络与 HTTPS/WSS 配置。'); };
  } catch(e) { await fail(e.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器设置中允许访问后重试。' : `无法开始录音：${e.message}`); }
}
async function stopRecording() {
  if(!running || stopping) return;
  stopping = true; controls(true); $('status').textContent = '正在停止并识别尾部…';
  try {
    await Promise.race([new Promise(resolve => { flushResolve = resolve; capture.port.postMessage('flush'); }),new Promise((_,reject) => setTimeout(() => reject(new Error('音频采集未响应停止请求')),2000))]);
    await cleanup(); send('session.stop');
    stopTimer = setTimeout(() => void fail('尾部识别超时，连接已关闭。'),70000);
  } catch(e) { await fail(e.message); }
}
$('record').onclick = async () => {
  if ($('record').disabled || stopping) return;
  if (running) await stopRecording(); else await startRecording();
};
window.addEventListener('pagehide', () => { stream?.getTracks().forEach(t => t.stop()); ws?.close(); });

const profiles=['speech','image','text'];
let savedProfiles={speech:{baseUrl:'',model:'',keyConfigured:false},image:{baseUrl:'',model:'',keyConfigured:false},text:{baseUrl:'',model:'',keyConfigured:false}};
function selectTab(page){
  const models=page==='models';
  $('panel-models').hidden=!models; $('panel-access').hidden=models;
  for (const name of ['models','access']){
    const tab=$('tab-'+name);
    tab.setAttribute?.('aria-selected',String(name===page));
    tab.tabIndex=name===page?0:-1;
  }
}
$('tab-models').onclick=()=>selectTab('models');
$('tab-access').onclick=()=>selectTab('access');

function displayProfiles(data){
  if(!data)return;
  for(const kind of profiles){
    const profile=data[kind]||{};
    savedProfiles[kind]=profile;
    $(kind+'-url').value=profile.baseUrl||'';
    $(kind+'-model').value=profile.model||'';
    $(kind+'-key').value='';
    $(kind+'-key').placeholder=profile.keyConfigured?'已保存密钥；留空继续使用':'输入 API Key';
  }
}
async function loadConfig() {
  const res=await fetch('/api/bootstrap');
  if(res.status===403) {
    publicMode=true;
    $('models-unavailable').hidden=false; $('model-cards').hidden=true;
    $('site-auth').hidden=false; $('local-access-help').hidden=true;
    if(!clientToken)clientToken=sessionStorage.getItem('ru-class-site-token')||'';
    $('worker-detail').textContent='服务端模型配置不在公网网页中修改。';
    return;
  }
  if(!res.ok)throw new Error('无法读取本地配置。');
  publicMode=false;
  $('models-unavailable').hidden=true; $('model-cards').hidden=false;
  $('site-auth').hidden=true; $('local-access-help').hidden=false;
  const config=await res.json();
  clientToken=config.clientToken;
  displayProfiles(config.models||{speech:config.asr});
  $('worker-detail').textContent=config.ready?'语音识别 API 已连接':'语音识别 API 尚未验证连接';
}
$('settings-open').onclick=async()=>{
  if(!$('settings').open)$('settings').showModal();
  selectTab('models');
  try{await loadConfig();if(publicMode)selectTab('access');}
  catch(e){$('worker-detail').textContent=e.message;}
};
$('site-auth').onsubmit=event=>{
  event.preventDefault();
  const token=$('site-token').value.trim();
  if(token.length<24){$('site-feedback').textContent='访问令牌至少需要 24 个字符。';return;}
  clientToken=token;
  sessionStorage.setItem('ru-class-site-token', token);
  $('site-token').value='';
  $('site-feedback').textContent='令牌已保存到本标签页会话中。';
  $('settings').close();
};
async function modelAction(kind,operation){
  if(publicMode)return;
  const feedback=$(kind+'-feedback');
  feedback.textContent=operation==='save'?'正在保存配置…':'正在测试模型列表接口…';
  $(kind+'-save').disabled=true;$(kind+'-test').disabled=true;
  try{
    if(!clientToken)await loadConfig();
    const res=await fetch('/api/models/'+kind+'/'+operation,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${clientToken}`},
      body:JSON.stringify({baseUrl:$(kind+'-url').value.trim(),model:$(kind+'-model').value.trim(),apiKey:$(kind+'-key').value})
    });
    const result=await res.json();
    if(!res.ok)throw new Error(result.error||'请求失败');
    if(operation==='save'){
      savedProfiles[kind]=result.profile;
      $(kind+'-key').value='';
      $(kind+'-key').placeholder='已保存密钥；留空继续使用';
      feedback.textContent='已独立保存到服务器 config.json；尚未测试连接。';
    } else {
      feedback.textContent='测试成功：可访问模型列表并找到该模型；尚未验证实际推理。';
    }
  }catch(e){feedback.textContent='操作失败：'+e.message;}
  finally{
    $(kind+'-save').disabled=kind==='speech'&&(running||stopping);
    $(kind+'-test').disabled=kind==='speech'&&(running||stopping);
  }
}
for(const kind of profiles){
  $('model-'+kind).onsubmit=e=>{e.preventDefault();void modelAction(kind,'save');};
  $(kind+'-test').onclick=()=>void modelAction(kind,'test');
}
