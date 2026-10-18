import {BrowserAsrSession,discoverModels,testConnection,validateProfile} from './direct-asr.js';
import {StableUnitJournal} from './stable-units.js';
import {SentenceWorker} from './sentence-worker.js';
import {restoreTranslationProgress,pendingTranscriptAfterCommits} from './translation-recovery.js';
import {loadProfiles,saveProfile,saveLesson,listLessons,listClassrooms,createClassroom,renameClassroom,listClassroomRecordings,localCalendarDate,saveAudioChunk,recordingWav,saveHypothesis,lessonHypothesesJson,beginEvidenceSession,markEvidenceWriteFailure,finishEvidenceSession,lessonEvidenceStatus,saveBilingualSentences,loadBilingualSentences,saveTextRequestMetric,loadTextRequestMetrics,clearBrowserData} from './local-store.js';

const $=id=>document.getElementById(id);
const kinds=['speech','image','text'];
let profiles={speech:null,image:null,text:null};
const stages=Object.fromEntries(kinds.map(kind=>[kind,{revision:0,ready:false,manual:false}]));
let running=false,stopping=false,starting=false,stream,context,source,capture,asr,lessonId='',sampleCount=0,chunkIndex=0;
let activeClassroom=null,classroomOptions=[],classroomRevision=0,renderedClassroomKey='';
let startedAt=0,flushResolve=null,writing=Promise.resolve(),lessonWrites=Promise.resolve(),evidenceWrites=Promise.resolve(),evidenceWarning='';
let evidenceReceived=0,evidenceFailed=0,evidenceActive=false;
const CLIENT_VERSION='0.4.0'; // Selected frontend build label, not attested ASR engine metadata.
let stable='',draft='',hasTranscript=false,marks=[],sourceJournal=null,sentenceWorker=null;
const translationWorkers=new Map(); // A finished recording may continue draining while another starts.
let playbackUrl=null,playbackRevision=0;
const errorMessage=e=>e instanceof Error?e.message:String(e);
function renderClassroomLock(){
  // Older markup lacked id="transcription", causing a null access and
  // leaving the right-hand caption pane permanently locked after selection.
  $('transcription').classList.toggle('is-locked',!activeClassroom);
  $('transcription-lock').hidden=Boolean(activeClassroom);
  $('session-history').hidden=!activeClassroom;
  $('classroom-date').textContent=activeClassroom?.date||'尚未选择课程';
  $('classroom-title').textContent=activeClassroom?.title||'请选择一节课';
  buttons();
}
function renderClassroomList(){
  const holder=$('classroom-list');
  holder.replaceChildren();
  for(const item of classroomOptions){
    const button=document.createElement('button');
    button.type='button';
    button.className='classroom-list-item'+(item.key===activeClassroom?.key?' is-selected':'');
    button.setAttribute('aria-current',item.key===activeClassroom?.key?'true':'false');
    const date=document.createElement('time');
    date.textContent=item.date;
    const name=document.createElement('strong');
    name.textContent=item.title;
    const meta=document.createElement('small');
    meta.textContent=(item.sessionCount||0)+' 段录音';
    button.append(date,name,meta);
    button.onclick=()=>{
      if(running||starting||stopping)return;
      releasePlayback();
      lessonId='';
      activeClassroom=item;
      $('classroom-feedback').textContent='';
      $('error').textContent='';
      renderClassroomLock(); // Unlock synchronously, before awaited IndexedDB.
      $('classroom-rename-form').hidden=true;
      renderClassroomList();
      void renderSelectedClassroom();
      void renderLessons();
    };
    holder.append(button);
  }
  if(!classroomOptions.length){
    const empty=document.createElement('p');
    empty.className='classroom-list-empty';
    empty.textContent='还没有课程。点击「添加课程」创建第一节课。';
    holder.append(empty);
  }
}
async function renderSelectedClassroom({historyOnly=false}={}){
  const revision=++classroomRevision;
  const holder=$('session-history');
  holder.replaceChildren();
  renderClassroomLock();
  // Do not display the previously selected class's transcript while the new
  // class's asynchronous IndexedDB read is pending.
  const selectedKey=activeClassroom?.key||'';
  if(selectedKey!==renderedClassroomKey){
    renderedClassroomKey=selectedKey;
    stable='';draft='';renderCaption();
    $('latency').textContent='—';
  }
  if(!activeClassroom){
    stable='';draft='';sourceJournal=null;
    renderCaption();$('duration').textContent='00:00';
    $('latency').textContent='—';return;
  }
  const key=activeClassroom.key;
  try{
    const sessions=await listClassroomRecordings(key);
    if(revision!==classroomRevision||key!==activeClassroom?.key||(!historyOnly&&(starting||running)))return;
    $('history-empty').hidden=sessions.length>0;
    const translations=await Promise.all(sessions.map(s=>loadBilingualSentences(s.id)));
    if(revision!==classroomRevision||key!==activeClassroom?.key||(!historyOnly&&(starting||running)))return;
    for(const [index,session] of sessions.entries()){
      const article=document.createElement('article');
      article.className='session-history-item';
      article.dataset.recordingId=session.id;
      const rows=translations[index];
      const sentences=document.createElement('div');
      sentences.className='session-sentences';
      // One paired row per saved sentence: RU and ZH can never drift apart
      // when their line heights differ or a recording contains many sentences.
      for(const sentence of rows){
        const pair=document.createElement('div');pair.className='history-sentence-row';
        const ru=document.createElement('p');ru.lang='ru';ru.textContent=sentence.ru;
        const zh=document.createElement('p');zh.lang='zh-CN';zh.textContent=sentence.zh;
        pair.append(ru,zh);sentences.append(pair);
      }
      article.append(sentences);
      if(Array.isArray(session.stableUnits)&&session.stableUnits.length){
        const last=session.stableUnits.at(-1);
        // Retain provenance in the recording itself; the visible history is
        // deliberately a continuous sentence table, not per-recording cards.
        article.dataset.confirmedWindowEndSample=String(last.confirmedWindowEndSample);
      }
      const pendingSource=pendingTranscriptAfterCommits(session,rows);
      // Pending source stays in the LOWER live area while this recording runs.
      // For a completed session it remains recoverable, clearly distinguished
      // from officially translated sentence pairs (never a fake Chinese row).
      if(pendingSource && !(session.id===lessonId&&(running||starting||stopping))){
        const details=document.createElement('details');
        details.className='history-remaining';details.open=!rows.length;
        const summary=document.createElement('summary');
        summary.textContent=rows.length?'未翻译的原始俄语（展开查看）':'原始俄语（尚无正式翻译）';
        const raw=document.createElement('p');raw.lang='ru';raw.textContent=pendingSource;
        details.append(summary,raw);article.append(details);
      }
      holder.append(article);
    }
    if(historyOnly)return; // LLM history updates must NEVER reset live RU.
    const last=sessions.at(-1);
    // After a reload there is no in-memory ACK journal. Restore the pending
    // suffix from durable sentence-unit IDs so acknowledged text does not
    // reappear below. Within the active session, renderCaption handles ACKs.
    if(last && sourceJournal?.recordingId===last.id)stable=last.transcript||'';
    else{
      sourceJournal=null;
      stable=last?pendingTranscriptAfterCommits(last,translations.at(-1)||[]):'';
    }
    draft='';
    renderCaption();
    $('duration').textContent=last?
      String(Math.floor((last.durationSeconds||0)/60)).padStart(2,'0')+':'+
      String(Math.floor((last.durationSeconds||0)%60)).padStart(2,'0'):'00:00';
    $('latency').textContent=last?'已加载课堂历史录音':'—';
  }catch(e){
    if(revision===classroomRevision)
      $('classroom-feedback').textContent='读取课堂失败：'+errorMessage(e);
  }
}
async function refreshClassrooms(preferredKey=''){
  try{
    const entries=await listClassrooms();
    classroomOptions=entries;
    const selected=entries.find(x=>x.key===(preferredKey||activeClassroom?.key));
    activeClassroom=selected||null;
    $('classroom-feedback').textContent='';
    renderClassroomLock();
    renderClassroomList();
    await renderSelectedClassroom();
    await renderLessons();
  }catch(e){
    activeClassroom=null;renderClassroomLock();
    $('classroom-feedback').textContent='读取课程列表失败：'+errorMessage(e);
  }
}
$('classroom-add').onclick=()=>{
  if(starting||running||stopping)return;
  $('classroom-create-form').hidden=true;
  $('classroom-create-feedback').textContent='';
  $('classroom-dialog').showModal();
  renderClassroomList();
  void renderLessons();
};
$('classroom-rename').onclick=()=>{
  if(!activeClassroom||starting||running||stopping)return;
  $('classroom-rename-title').value=activeClassroom.title;
  $('classroom-rename-feedback').textContent='';
  $('classroom-rename-form').hidden=false;
  $('classroom-rename-title').focus();
};
$('classroom-rename-cancel').onclick=()=>{
  $('classroom-rename-form').hidden=true;
  $('classroom-rename-feedback').textContent='';
};
$('classroom-rename-form').onsubmit=e=>{
  e.preventDefault();
  if(!activeClassroom||starting||running||stopping)return;
  const source=activeClassroom;
  const submit=$('classroom-rename-submit');
  submit.disabled=true;
  void (async()=>{
    try{
      const renamed=await renameClassroom(source.key,$('classroom-rename-title').value);
      $('classroom-rename-form').hidden=true;
      releasePlayback();
      await refreshClassrooms(renamed.key);
    }catch(err){
      $('classroom-rename-feedback').textContent=
        errorMessage(err)==='CLASSROOM_ALREADY_EXISTS'?
        '同一天已有同名课程，请使用其他名称。':
        '重命名失败：'+errorMessage(err);
    }finally{submit.disabled=false;}
  })();
};
$('classroom-close').onclick=()=>$('classroom-dialog').close();
$('classroom-dialog').addEventListener('close',()=>{
  releasePlayback();
  $('classroom-rename-form').hidden=true;
  $('classroom-create-form').hidden=true;
});
$('classroom-new').onclick=()=>{
  $('new-classroom-title').value='';
  $('new-classroom-date').value=localCalendarDate(Date.now());
  $('classroom-create-feedback').textContent='';
  $('classroom-create-form').hidden=false;
  $('new-classroom-title').focus();
};
$('classroom-cancel').onclick=()=>{
  $('classroom-create-form').hidden=true;
  $('classroom-create-feedback').textContent='';
};
$('classroom-create-form').onsubmit=e=>{
  e.preventDefault();
  if(starting||running||stopping)return;
  const submit=$('classroom-submit');
  submit.disabled=true;
  const requestedTitle=$('new-classroom-title').value;
  const requestedDate=$('new-classroom-date').value;
  void (async()=>{
    try{
      const created=await createClassroom({title:requestedTitle,date:requestedDate});
      $('classroom-create-form').hidden=true;
      await refreshClassrooms(created.key);
    }catch(err){
      $('classroom-create-feedback').textContent=
        errorMessage(err)==='CLASSROOM_ALREADY_EXISTS'?
        '这一天已存在同名课程，请直接从左侧列表选择。':
        '无法添加课程：'+errorMessage(err);
    }finally{submit.disabled=false;}
  })();
};

function buttons(){
  $('record').disabled=stopping||starting||!activeClassroom;
  $('record').textContent=stopping?'正在停止…':starting?'正在启动…':running?'停止录音':'开始录音';
  $('classroom-add').disabled=starting||running||stopping;
  $('classroom-new').disabled=starting||running||stopping;
  $('classroom-rename').disabled=starting||running||stopping||!activeClassroom;
  for(const id of ['speech-url','speech-model','speech-model-select','speech-key','speech-save','speech-test','speech-list','speech-refresh'])
    $(id).disabled=starting||running||stopping;
}
function renderCaption(){
  // Separate immutable LocalAgreement prefix and replaceable hypothesis tail.
  // These are text containers only; no CSS-driven suppression of raw evidence.
  const delivered=sourceJournal?.units.filter(unit=>sourceJournal.delivered.has(unit.id)).map(unit=>unit.text).join(' ')||'';
  const pending=delivered && (stable===delivered||stable.startsWith(delivered+' '))?
    stable.slice(delivered.length).trimStart():stable;
  $('ru-stable').textContent=pending;
  $('ru-draft').textContent=draft?(pending?' '+draft:draft):'';
}

function showBilingualSentenceRows(rows,recordingId,classroomId){
  if(!activeClassroom||activeClassroom.id!==classroomId)return;
  // A prior completed recording can drain while a new recording is active.
  // Only update the lower RU when these ACKs belong to its own session.
  if(recordingId===lessonId)renderCaption();
  $('translation-status').textContent='正式双语句子已保存。';
  // Rebuild the selected classroom's aligned sentence rows after each commit.
  // Never append a duplicate "current recording" article after stop().
  // History-only reads are allowed during live recording, and MUST NOT reset
  // the current ASR stable/draft or the microphone clock.
  void renderSelectedClassroom({historyOnly:true});
}
// Usage records are local and intentionally omit prompts, answers, URLs and keys.
let metricViewRevision=0;
async function refreshTextMetrics(){
  const revision=++metricViewRevision;
  const info=$('llm-metrics-summary'),holder=$('llm-metrics-rows');
  try{
    const rows=await loadTextRequestMetrics();
    if(revision!==metricViewRevision)return;
    const succeeded=rows.filter(r=>r.status==='ok');
    const measured=succeeded.filter(r=>r.totalTokens!==null);
    const tokens=measured.reduce((n,r)=>n+r.totalTokens,0);
    const reasoning=rows.filter(r=>r.reasoningTokens!==null);
    const reasonTotal=reasoning.reduce((n,r)=>n+r.reasoningTokens,0);
    const avg=rows.length?Math.round(rows.reduce((n,r)=>n+r.elapsedMs,0)/rows.length):0;
    info.textContent=rows.length?
      rows.length+' 次请求 · '+succeeded.length+' 次成功响应 · 平均 '+(avg/1000).toFixed(1)+
      ' 秒 · 已报告总 Token '+tokens.toLocaleString()+
      ' · 已报告推理 Token '+reasonTotal.toLocaleString():
      '暂无文字模型请求记录。录音或恢复翻译后会显示。';
    holder.replaceChildren();
    for(const record of rows.slice(0,30)){
      const tr=document.createElement('tr');
      const cols=[new Date(record.at).toLocaleString(),record.model,
        record.status==='ok'?'成功':record.status,
        (record.elapsedMs/1000).toFixed(2)+' s',
        record.totalTokens??'—',record.reasoningTokens??'—'];
      for(const value of cols){
        const td=document.createElement('td');td.textContent=String(value);tr.append(td);
      }
      holder.append(tr);
    }
  }catch(e){if(revision===metricViewRevision)info.textContent='无法读取本地统计：'+errorMessage(e);}
}
function recordTextRequestMetric(metric){
  void saveTextRequestMetric(metric).then(()=>{
    if(!$('panel-about').hidden)void refreshTextMetrics();
  }).catch(()=>{
    // Analytics may be unavailable (quota, private mode); never block ASR
    // or an otherwise successful durable translation commit.
    if(!$('panel-about').hidden)$('llm-metrics-summary').textContent='本地请求统计写入失败，翻译不受影响。';
  });
}
function startSentenceWorker(){
  sentenceWorker?.close();
  sentenceWorker=null;
  const p=profiles.text;
  if(!p?.baseUrl||!p?.model||!p?.apiKey){
    $('translation-status').textContent='未配置文字模型：继续仅显示俄语。';
    return;
  }
  const id=lessonId,journal=sourceJournal,selectedClass=activeClassroom.id;
  const worker=new SentenceWorker({
    journal,profile:{...p},
    onRequestMetric:recordTextRequestMetric,
    save:rows=>saveBilingualSentences(id,rows),
    onCommit:rows=>showBilingualSentenceRows(rows,id,selectedClass),
    onError:code=>{
      if(activeClassroom?.id!==selectedClass||lessonId!==id)return;
      $('translation-status').textContent=code==='LLM_TIMEOUT'?
        '文字模型请求超过45秒；俄语原文已保留，将有限重试。':
        code==='LLM_NETWORK_FAILED'?
        '文字模型连接失败（网络或 CORS），俄语原文已保留。':
        '翻译暂不可用（'+code+'），俄语原文已保留。';
    },
    onDrain:({status,pending,reason})=>{
      if(translationWorkers.get(id)===worker)translationWorkers.delete(id);
      if(sentenceWorker===worker)sentenceWorker=null;
      if(activeClassroom?.id!==selectedClass||lessonId!==id)return;
      $('translation-status').textContent=status==='complete'?
        '这段录音的已确认俄语已全部转入双语历史。':
        '本段尚有 '+pending+' 个稳定片段未翻译（'+reason+
          '）；原文仍已保存，可在课程管理中手动恢复。';
      // Do not clear the final transcript on any failed/incomplete drain.
      renderCaption();
    }
  });
  sentenceWorker=worker;
  translationWorkers.set(id,worker);
  $('translation-status').textContent='正在等待稳定俄语并逐句处理…';
  worker.start();
}

function showTranscript(update){
  const panel=$('ru');
  const follow=panel.scrollHeight-panel.clientHeight-panel.scrollTop<64;
  // The source journal reads the exact same append-only stable delta but
  // never changes the existing LocalAgreement reducer's decision.
  sourceJournal?.add(update);
  // Wake the sentence worker when new confirmed source arrives; polling alone
  // adds unnecessary latency to an already buffered completed sentence.
  if(update.stable_delta?.trim()||update.final)sentenceWorker?.wake();
  if(update.stable_delta?.trim())stable=stable?[stable,update.stable_delta.trim()].join(' '):update.stable_delta.trim();
  draft=update.partial_text?.trim()||'';
  const text=[stable,draft].filter(Boolean).join(' ');
  // Silence or an empty ASR window leaves the reserved RU region blank.
  renderCaption();
  if(text)hasTranscript=true;
  if(follow)panel.scrollTop=panel.scrollHeight;
  const point=marks.find(m=>m.end>=update.window_end_sample);
  const lag=point?Math.max(0,performance.now()-point.time).toFixed(0)+' ms':'—';
  $('latency').textContent='识别窗 '+(update.window_start_sample/16000).toFixed(1)+'–'+(update.window_end_sample/16000).toFixed(1)+' s（非逐词时间） · 推理 '+update.inference_ms.toFixed(0)+' ms · 音频末端至显示 '+lag;
  if(lessonId)void finishLesson('recording').catch(e=>{$('error').textContent='课堂文本本地保存失败：'+errorMessage(e);});
}
function archiveRawHypothesis(entry){
  if(!lessonId)return Promise.resolve();
  // Save provider evidence BEFORE the lossy TranscriptBuffer changes state.
  // Keep writes ordered; a failed write is visible, but does not destroy
  // access to the rest of the lesson or terminate the audio recording.
  const id=lessonId;
  evidenceReceived++;
  evidenceWrites=evidenceWrites.then(()=>saveHypothesis(id,entry))
    .catch(async e=>{
      evidenceFailed++;
      evidenceWarning='原始识别窗口在此浏览器保存失败：'+errorMessage(e);
      $('error').textContent=evidenceWarning;
      // Keep a durable error flag if storage is still writable. Otherwise
      // the initial recording state remains incomplete across reloads.
      try{await markEvidenceWriteFailure(id);}catch{};
    });
  return evidenceWrites;
}
async function cleanupMicrophone(){
  running=false;
  stream?.getTracks().forEach(t=>t.stop());
  capture?.disconnect();source?.disconnect();
  if(context&&context.state!=='closed')await context.close().catch(()=>{});
  stream=null;capture=null;source=null;context=null;
}
function finishLesson(outcome){
  // Snapshot at the time of scheduling, never after a later async callback.
  const record={id:lessonId,title:activeClassroom.title,lessonDate:activeClassroom.date,
    classroomId:activeClassroom.id,classroomKey:activeClassroom.key,
    startedAt,durationSeconds:sampleCount/16000,
    transcript:[stable,draft].filter(Boolean).join(' '),
    stableUnits:sourceJournal?.export()||[],
    sourceTimeBasis:'window_confirmation_not_word_alignment',
    outcome,hasAudio:chunkIndex>0};
  lessonWrites=lessonWrites.catch(()=>{}).then(()=>saveLesson(record));
  return lessonWrites;
}
async function onFailure(e){
  const message=errorMessage(e);
  if(!running&&!stopping&&!context){starting=false;$('error').textContent=message;buttons();return;}
  asr?.cancel();
  if(sentenceWorker){
    sentenceWorker.close();
    translationWorkers.delete(sentenceWorker.journal.recordingId);
  }
  sentenceWorker=null;
  $('error').textContent=message;
  try{
    await cleanupMicrophone();
    await Promise.all([writing,evidenceWrites]);
    if(lessonId)await finishLesson('interrupted');
    if(evidenceActive){
      await finishEvidenceSession(lessonId,{receivedCount:evidenceReceived,
        failedCount:evidenceFailed,frameCount:sampleCount,completed:false});
      evidenceActive=false;
    }
  }catch(storageError){$('error').textContent+='；本地保存失败：'+errorMessage(storageError);}
  starting=false;stopping=false;buttons();
}
async function start(){
  if(running||stopping||starting)return;
  if(!activeClassroom){$('error').textContent='请先在左侧添加并选择课程。';buttons();return;}
  // A previous completed recording must finish draining independently.
  // Only an unfinalized/interrupted worker is cancelled.
  if(sentenceWorker&&!sentenceWorker.journal.finalized){
    sentenceWorker.close();
    translationWorkers.delete(sentenceWorker.journal.recordingId);
  }
  sentenceWorker=null;
  releasePlayback(); // Never play existing audio into a new microphone recording.
  const p=profiles.speech;
  if(!p?.baseUrl||!p?.model||!p?.apiKey){
    $('error').textContent='请先在“设置 → 模型 → 语音”中填写自己的 API 地址、模型和 Token。';
    $('settings').showModal();return;
  }
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode){
    $('error').textContent='录音需要安全上下文（HTTPS 或 localhost）以及 AudioWorklet。';
    return;
  }
  starting=true;classroomRevision++;buttons();
  lessonId=crypto.randomUUID();startedAt=Date.now();
  sampleCount=0;chunkIndex=0;marks=[];writing=Promise.resolve();lessonWrites=Promise.resolve();evidenceWrites=Promise.resolve();evidenceWarning='';
  evidenceReceived=0;evidenceFailed=0;evidenceActive=false;
  stable='';draft='';hasTranscript=false;
  sourceJournal=new StableUnitJournal({classroomId:activeClassroom.id,
    recordingId:lessonId,startedAt});
  renderCaption();
  $('duration').textContent='00:00';$('error').textContent='';$('latency').textContent='—';
  try{
    // Safari: construct/resume audio inside the user's click handler.
    context=new AudioContext();await context.resume();
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    await finishLesson('recording'); // Recovery metadata exists before audio chunks arrive.
    await beginEvidenceSession(lessonId,{clientVersion:CLIENT_VERSION,selectedModelId:p.model});
    evidenceActive=true;
    await context.audioWorklet.addModule('/capture-worklet.js');
    source=context.createMediaStreamSource(stream);
    capture=new AudioWorkletNode(context,'ru-capture');
    asr=new BrowserAsrSession(p,showTranscript,e=>void onFailure(e),archiveRawHypothesis);
    capture.port.onmessage=({data})=>{
      if(data?.type==='flushed'){flushResolve?.();flushResolve=null;return;}
      if(data?.type!=='audio'||!running)return;
      const samples=data.samples;
      const index=chunkIndex++;
      sampleCount+=samples.length;
      // The first actual PCM callback anchors approximate absolute times.
      // No word-level speech timestamps are implied.
      if(chunkIndex===1&&sourceJournal)
        sourceJournal.startedAt=Date.now()-sampleCount/16000*1000;
      marks.push({end:sampleCount,time:performance.now()});if(marks.length>100)marks.shift();
      writing=writing.then(()=>saveAudioChunk(lessonId,index,samples))
        .catch(e=>{void onFailure(new Error('浏览器录音存储失败：'+errorMessage(e)));throw e;});
      asr.push(samples);
      const seconds=Math.floor(sampleCount/16000);
      $('duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    };
    running=true;starting=false;buttons();
    startSentenceWorker();
    source.connect(capture);capture.connect(context.destination);
    const track=stream.getAudioTracks()[0];
    if(!track||track.readyState!=='live')throw Error('麦克风不可用');
    track.onended=()=>{if(running&&!stopping)void onFailure(Error('麦克风已中断'));};
    track.onmute=()=>{if(running&&!stopping)void onFailure(Error('麦克风已暂停'));};
    context.onstatechange=()=>{if(running&&!stopping&&context?.state==='suspended')void onFailure(Error('浏览器暂停了录音，请保持页面处于前台'));};
  }catch(e){await onFailure(e);}
}
async function stop(){
  if(!running||stopping)return;
  stopping=true;buttons();
  try{
    await Promise.race([
      new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('音频采集停止超时')),3000);
        flushResolve=()=>{clearTimeout(timer);resolve();};
        capture.port.postMessage('flush');
      }),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('音频采集停止超时')),3500))
    ]);
    await cleanupMicrophone();
    await asr.stop();
    // The ASR final flush is independent of LLM latency and may release
    // confirmed end-of-class fragments for the history worker.
    sentenceWorker?.finish();
    if(sentenceWorker){
      $('translation-status').textContent='录音已结束，正在继续翻译剩余已确认句子…';
    }
    // stop() may emit the final raw hypothesis, so capture the latest
    // evidenceWrites promise only after its completion.
    await Promise.all([writing,evidenceWrites]);
    await finishLesson('completed');
    if(evidenceActive){
      const complete=await finishEvidenceSession(lessonId,{receivedCount:evidenceReceived,
        failedCount:evidenceFailed,frameCount:sampleCount,completed:true});
      evidenceActive=false;
      if(!complete && !evidenceWarning)evidenceWarning='原始识别窗口记录不完整；导出将明确标注。';
    }
    // A successful microphone stop must not clear a failed evidence-write
    // warning: the raw ASR history might be incomplete despite a saved WAV.
    $('error').textContent=evidenceWarning;
  }catch(e){
    asr?.cancel();$('error').textContent='停止或保存失败：'+errorMessage(e);
    if(evidenceActive){
      try{await Promise.all([writing,evidenceWrites]);
        await finishEvidenceSession(lessonId,{receivedCount:evidenceReceived,
          failedCount:evidenceFailed,frameCount:sampleCount,completed:false});
        evidenceActive=false;
      }catch{/* Keep the previous recording/incomplete manifest: fail closed. */}
    }
  }finally{
    stopping=false;buttons();
    void renderLessons();
    void renderSelectedClassroom();
  }
}
$('record').onclick=()=>running?void stop():void start();
window.addEventListener('pagehide',()=>{
  for(const worker of translationWorkers.values())worker.close();
  translationWorkers.clear();
  sentenceWorker?.close();
  releasePlayback();
  stream?.getTracks().forEach(t=>t.stop());
  asr?.cancel();
});

// User-model configuration. The RU-Class server is NEVER consulted.
function reset(kind,clearKey=true){
  const step=stages[kind];step.revision++;step.ready=false;step.manual=false;
  $(kind+'-discovery').hidden=false;
  $(kind+'-model-stage').hidden=true;
  $(kind+'-model-choice').hidden=true;
  $(kind+'-model-manual-wrap').hidden=true;
  $(kind+'-actions').hidden=true;
  $(kind+'-model-select').replaceChildren();
  $(kind+'-model-select').required=false;
  $(kind+'-model').required=false;
  $(kind+'-model').value='';
  if(clearKey)$(kind+'-key').value='';
  $(kind+'-model-count').textContent='';
  $(kind+'-feedback').textContent='';
}
function choice(kind){
  return stages[kind].manual?$(kind+'-model').value.trim():$(kind+'-model-select').value;
}
function keyFor(kind){
  const old=profiles[kind];
  const url=$(kind+'-url').value.trim();
  return $(kind+'-key').value || ((old?.baseUrl===url)?old.apiKey:'') || '';
}
function updateActions(kind){
  $(kind+'-actions').hidden=!(stages[kind].ready&&choice(kind)&&keyFor(kind));
}
function showModels(kind,ids){
  const step=stages[kind],oldChoice=step.ready?choice(kind):profiles[kind]?.baseUrl===$(kind+'-url').value.trim()?profiles[kind].model:'';
  step.ready=true;step.manual=ids.length===0;
  $(kind+'-discovery').hidden=true;
  $(kind+'-model-count').textContent='';
  $(kind+'-model-stage').hidden=false;
  $(kind+'-model-choice').hidden=!ids.length;
  $(kind+'-model-manual-wrap').hidden=!!ids.length;
  $(kind+'-model-select').required=!!ids.length;
  $(kind+'-model').required=!ids.length;
  if(ids.length){
    const place=document.createElement('option');place.value='';place.textContent='请选择模型';
    const options=ids.map(id=>{const item=document.createElement('option');item.value=id;item.textContent=id;return item;});
    const select=$(kind+'-model-select');
    select.replaceChildren(place,...options);select.value=ids.includes(oldChoice)?oldChoice:'';
  }else $(kind+'-model').value=oldChoice||'';
  updateActions(kind);
}
async function discover(kind){
  const url=$(kind+'-url').value.trim();
  const token=$(kind+'-key').value || (profiles[kind]?.baseUrl===url?profiles[kind].apiKey:'') || '';
  const step=stages[kind],revision=++step.revision;
  const discovery=$(kind+'-discovery');
  const feedback=discovery.hidden?$(kind+'-feedback'):$(kind+'-model-count');
  feedback.textContent='获取可用模型中…';
  const list=$(kind+'-list'),refresh=$(kind+'-refresh');list.disabled=true;refresh.disabled=true;
  try{
    const {models}=await discoverModels(url,token);
    if(step.revision!==revision)return;
    showModels(kind,models);
    feedback.textContent='';
  }catch(e){
    if(step.revision!==revision)return;
    const message=errorMessage(e);
    if(/MODEL_HTTP_40[13]/.test(message)){
      // Token is available from the start, so retry without changing stages.
      // Never interpret 401/403 as an empty model list.
      discovery.hidden=false;
      $(kind+'-actions').hidden=true;
      $(kind+'-model-count').textContent='API 拒绝了模型列表请求（401/403），请检查 Token 后重试。';
    }else feedback.textContent='获取失败：'+message;
  }finally{
    if(step.revision===revision){list.disabled=kind==='speech'&&(running||stopping);refresh.disabled=kind==='speech'&&(running||stopping);}
  }
}
async function modelAction(kind,mode){
  const label=$(kind+'-feedback');
  const candidate={baseUrl:$(kind+'-url').value.trim(),model:choice(kind),apiKey:keyFor(kind)};
  try{
    if(!stages[kind].ready)throw Error('请先获取可用模型');
    const profile=validateProfile(candidate);
    const save=$(kind+'-save'),test=$(kind+'-test');
    save.disabled=true;test.disabled=true;
    try{
      if(mode==='save'){
        await saveProfile(kind,profile);
        profiles[kind]=profile;
        $(kind+'-key').value='';
        $(kind+'-key').placeholder='已存储在此浏览器中；留空继续使用';
        label.textContent='已保存到此浏览器。';
      }else{
        await testConnection(profile);
        label.textContent='连接成功：API 模型列表包含所选模型。';
      }
    }finally{save.disabled=false;test.disabled=false;updateActions(kind);buttons();}
  }catch(e){label.textContent='操作失败：'+errorMessage(e);}
}
function displayProfiles(){
  for(const kind of kinds){
    const p=profiles[kind];
    $(kind+'-url').value=p?.baseUrl||'';
    reset(kind);
    $(kind+'-key').placeholder=p?.apiKey?'已存储在此浏览器中；留空继续使用':'输入自己的 API Token';
  }
}
function showSettingsTab(name){
  for(const [tab,panel] of [['models','panel-models'],['about','panel-about']]){
    const active=name===tab;
    $('tab-'+tab).setAttribute('aria-selected',String(active));
    $('tab-'+tab).tabIndex=active?0:-1;
    $(panel).hidden=!active;
  }
  if(name==='about')void refreshTextMetrics();
}
for(const tab of ['models','about']){
  $('tab-'+tab).onclick=()=>showSettingsTab(tab);
}
$('settings-open').onclick=()=>{
  displayProfiles();
  showSettingsTab('models');
  $('settings').showModal();
};
for(const kind of kinds){
  $('model-'+kind).onsubmit=e=>{e.preventDefault();void modelAction(kind,'save');};
  $(kind+'-test').onclick=()=>void modelAction(kind,'test');
  $(kind+'-list').onclick=()=>void discover(kind);
  $(kind+'-refresh').onclick=()=>void discover(kind);
  $(kind+'-url').oninput=()=>reset(kind);
  $(kind+'-model-select').onchange=()=>updateActions(kind);
  $(kind+'-model').oninput=()=>updateActions(kind);
  // Model lists can depend on the API Token. Changing it invalidates the
  // earlier selection and any in-flight discovery without clearing the draft.
  $(kind+'-key').oninput=()=>reset(kind,false);
}
function releasePlayback(){
  playbackRevision++;
  const player=$('local-player');
  if(player){
    player.pause();
    player.removeAttribute('src');
    player.load();
  }
  if(playbackUrl){URL.revokeObjectURL(playbackUrl);playbackUrl=null;}
  const section=$('local-playback');
  if(section)section.hidden=true;
}
async function loadPlayback(item){
  if(running||stopping||starting){$('local-feedback').textContent='录音期间不能播放以前的课堂，请先停止录音。';return;}
  releasePlayback();
  const revision=playbackRevision;
  $('local-feedback').textContent='正在读取本地完整录音…';
  try{
    const wav=await recordingWav(item.id);
    if(revision!==playbackRevision)return; // Old slow IndexedDB result is stale.
    const url=URL.createObjectURL(wav);
    playbackUrl=url;
    $('local-player').src=url;
    $('local-playback-title').textContent=item.title||'未命名课堂';
    $('local-playback').hidden=false;
    // Safari can block autoplay after an awaited IndexedDB read; use native
    // controls and let the user press Play to start private local playback.
    $('local-feedback').textContent='录音已加载，请在下方播放器点击播放。';
  }catch(e){
    if(revision===playbackRevision)
      $('local-feedback').textContent='无法播放录音：'+errorMessage(e);
  }
}
$('local-player').addEventListener('error',()=>{
  if(playbackUrl)$('local-feedback').textContent='本地音频解码失败，请下载 WAV 检查数据是否完整。';
});

async function retrySavedRecordingTranslation(item){
  if(running||starting||stopping){
    $('local-feedback').textContent='请先停止录音，再恢复此前录音的翻译。';
    return;
  }
  if(!activeClassroom||item.classroomId!==activeClassroom.id){
    $('local-feedback').textContent='请选择该录音所属的课程。';
    return;
  }
  const p=profiles.text;
  if(!p?.baseUrl||!p?.model||!p?.apiKey){
    $('local-feedback').textContent='请先在设置 → 文字中配置自己的文字模型。';
    return;
  }
  // Do not run two paid workers for the same recording.
  if(translationWorkers.has(item.id)){
    $('local-feedback').textContent='这段录音正在后台处理剩余翻译，请等待完成。';
    return;
  }
  // Explicit user action only. Never run billable recovery on page load.
  // A completed recording can finish independently of another recording.
  if(sentenceWorker&&!sentenceWorker.journal.finalized){
    sentenceWorker.close();
    translationWorkers.delete(sentenceWorker.journal.recordingId);
  }
  sentenceWorker=null;
  const classroomId=activeClassroom.id,recordingId=item.id;
  try{
    const rows=await loadBilingualSentences(recordingId);
    if(running||starting||stopping||activeClassroom?.id!==classroomId)return;
    const {journal,nextIndex,remainingUnits}=restoreTranslationProgress(item,rows);
    if(!remainingUnits){
      $('local-feedback').textContent='这段录音已没有待翻译的稳定文字。';
      return;
    }
    const worker=new SentenceWorker({
      journal,profile:{...p},
      onRequestMetric:recordTextRequestMetric,
      save:newRows=>saveBilingualSentences(recordingId,newRows),
      onCommit:()=>{
        if(sentenceWorker!==worker||activeClassroom?.id!==classroomId)return;
        $('local-feedback').textContent='已保存恢复处理的双语句子。';
        void renderSelectedClassroom({historyOnly:true});
      },
      onError:code=>{
        if(activeClassroom?.id===classroomId)
          $('local-feedback').textContent='处理失败（'+code+'），原始俄语仍完整保留。';
      },
      onDrain:({status,pending,reason})=>{
        if(translationWorkers.get(recordingId)===worker)translationWorkers.delete(recordingId);
        if(sentenceWorker===worker)sentenceWorker=null;
        if(activeClassroom?.id===classroomId){
          $('local-feedback').textContent=status==='complete'?
            '已完成这段录音的剩余翻译。':
            '还剩 '+pending+' 个稳定片段未翻译（'+reason+'），可以稍后再试。';
          void renderSelectedClassroom({historyOnly:true});
        }
      }
    });
    worker.nextIndex=nextIndex;
    sentenceWorker=worker;
    translationWorkers.set(recordingId,worker);
    $('local-feedback').textContent='正在处理这段录音尚未翻译的稳定文字…';
    worker.finish();
  }catch(e){
    $('local-feedback').textContent='无法恢复翻译：'+errorMessage(e);
  }
}

let recordsRevision=0;
async function renderLessons(){
  const revision=++recordsRevision;
  const holder=$('local-lessons');
  const key=activeClassroom?.key;
  const classroom=activeClassroom;
  $('classroom-records-title').textContent=classroom?
    classroom.date+' · '+classroom.title:'请选择左侧课程';
  $('classroom-rename').disabled=!classroom||running||starting||stopping;
  holder.replaceChildren();
  if(!key){
    releasePlayback();
    $('local-feedback').textContent='';
    return;
  }
  try{
    const lessons=await listClassroomRecordings(key);
    if(revision!==recordsRevision||key!==activeClassroom?.key)return;
    if(!lessons.length){
      const blank=document.createElement('p');
      blank.className='classroom-records-empty';
      blank.textContent='这节课还没有录音。选择后可以在主页面开始录音。';
      holder.append(blank);
      return;
    }
    for(const item of lessons){
      if(revision!==recordsRevision||key!==activeClassroom?.key)return;
      const row=document.createElement('div');
      row.className='saved-lesson';
      const label=document.createElement('span');
      label.textContent=new Date(item.startedAt).toLocaleString()+
        ' · '+Math.round(item.durationSeconds||0)+' 秒';
      row.append(label);
      if(item.hasAudio){
        const estimatedMiB=(Math.max(0,Number(item.durationSeconds)||0)*32000/(1024*1024)).toFixed(1);
        const audioInfo=document.createElement('span');
        audioInfo.textContent='录音约 '+estimatedMiB+' MiB（未校验完整性）';
        row.append(audioInfo);
        const playButton=document.createElement('button');
        playButton.type='button';playButton.textContent='播放录音';
        playButton.disabled=running||stopping||starting;
        playButton.onclick=()=>void loadPlayback(item);
        row.append(playButton);
        const button=document.createElement('button');
        button.type='button';button.textContent='下载 WAV';
        button.onclick=async()=>{
          try{
            const wav=await recordingWav(item.id);
            const url=URL.createObjectURL(wav);
            const link=document.createElement('a');
            link.href=url;link.download='ru-class-'+item.id+'.wav';
            link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
          }catch(e){$('local-feedback').textContent=errorMessage(e);}
        };
        row.append(button);
      }
      const evidenceButton=document.createElement('button');
      evidenceButton.type='button';evidenceButton.textContent='下载原始识别窗口';
      evidenceButton.title='仅导出该录音会话保存的原始 ASR 窗口，包含私人课堂原话';
      evidenceButton.onclick=async()=>{
        try{
          const data=await lessonHypothesesJson(item.id);
          const url=URL.createObjectURL(data);
          const link=document.createElement('a');
          link.href=url;link.download='ru-class-'+item.id+'-asr-windows.json';
          link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
        }catch(e){$('local-feedback').textContent=errorMessage(e);}
      };
      row.append(evidenceButton);
      if(item.outcome==='completed'&&Array.isArray(item.stableUnits)&&item.stableUnits.length){
        const retryButton=document.createElement('button');
        retryButton.type='button';
        retryButton.textContent='恢复未完成翻译';
        retryButton.title='只发送该录音尚未翻译的已确认俄语；会使用你配置的文字模型，可能产生 API 费用';
        retryButton.disabled=running||starting||stopping;
        retryButton.onclick=()=>void retrySavedRecordingTranslation(item);
        row.append(retryButton);
      }
      const status=await lessonEvidenceStatus(item.id);
      if(revision!==recordsRevision||key!==activeClassroom?.key)return;
      if(status.savedCount||status.status!=='legacy_unverified'){
        const badge=document.createElement('span');
        badge.className='saved-evidence-status';
        badge.textContent=status.status==='complete'?'原始窗口已完整保存':
          status.status==='incomplete'?'原始窗口记录不完整':'旧记录：完整性未知';
        row.append(badge);
      }
      const caption=document.createElement('p');
      caption.className='saved-transcript';
      caption.textContent=item.transcript||'（无识别文本）';
      const wrapper=document.createElement('article');
      wrapper.className='classroom-recording';
      wrapper.append(row,caption);
      holder.append(wrapper);
    }
  }catch(e){
    if(revision===recordsRevision)
      $('local-feedback').textContent='读取课堂记录失败：'+errorMessage(e);
  }
}
$('clear-local').onclick=async()=>{
  if(running||stopping||starting){$('local-feedback').textContent='请先停止录音，再清空浏览器数据。';return;}
  if(!confirm('确定清空此浏览器里所有 API 配置、课堂文本和录音吗？此操作无法撤销。'))return;
  try{
    for(const worker of translationWorkers.values())worker.close();
    translationWorkers.clear();sentenceWorker=null;
    metricViewRevision++;
    releasePlayback();await clearBrowserData();profiles={speech:null,image:null,text:null};displayProfiles();activeClassroom=null;lessonId='';await refreshClassrooms();$('local-feedback').textContent='已清空此浏览器的 RU-Class 数据。';}
  catch(e){$('local-feedback').textContent='清空失败：'+errorMessage(e);}
};
try{profiles={speech:null,image:null,text:null,...await loadProfiles()};}
catch(e){$('error').textContent='浏览器本地存储不可用：'+errorMessage(e);}
buttons();
void refreshClassrooms();
