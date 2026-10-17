import {BrowserAsrSession,discoverModels,testConnection,validateProfile} from './direct-asr.js';
import {loadProfiles,saveProfile,saveLesson,listLessons,listClassrooms,createClassroom,renameClassroom,listClassroomRecordings,localCalendarDate,saveAudioChunk,recordingWav,saveHypothesis,lessonHypothesesJson,beginEvidenceSession,markEvidenceWriteFailure,finishEvidenceSession,lessonEvidenceStatus,clearBrowserData} from './local-store.js';

const $=id=>document.getElementById(id);
const kinds=['speech','image','text'];
let profiles={speech:null,image:null,text:null};
const stages=Object.fromEntries(kinds.map(kind=>[kind,{revision:0,ready:false,manual:false}]));
let running=false,stopping=false,starting=false,stream,context,source,capture,asr,lessonId='',sampleCount=0,chunkIndex=0;
let activeClassroom=null,classroomOptions=[],classroomRevision=0;
let startedAt=0,flushResolve=null,writing=Promise.resolve(),lessonWrites=Promise.resolve(),evidenceWrites=Promise.resolve(),evidenceWarning='';
let evidenceReceived=0,evidenceFailed=0,evidenceActive=false;
const CLIENT_VERSION='0.2.2'; // Selected frontend build label, not attested ASR engine metadata.
let stable='',draft='',hasTranscript=false,marks=[];
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
async function renderSelectedClassroom(){
  const revision=++classroomRevision;
  const holder=$('session-history');
  holder.replaceChildren();
  renderClassroomLock();
  if(!activeClassroom){
    $('ru').textContent='';$('duration').textContent='00:00';
    $('latency').textContent='—';stable='';draft='';return;
  }
  const key=activeClassroom.key;
  try{
    const sessions=await listClassroomRecordings(key);
    if(revision!==classroomRevision||key!==activeClassroom?.key||starting||running)return;
    $('history-empty').hidden=sessions.length>0;
    for(const [index,session] of sessions.entries()){
      const article=document.createElement('article');
      article.className='session-history-item';
      const label=document.createElement('time');
      label.textContent='录音 '+(index+1)+' · '+
        new Date(session.startedAt).toLocaleTimeString()+
        ' · '+Math.round(session.durationSeconds||0)+' 秒'+
        (session.outcome==='interrupted'?' · 中断':'');
      const columns=document.createElement('div');
      columns.className='session-bilingual';
      const ru=document.createElement('p');
      ru.lang='ru';ru.textContent=session.transcript||'（这段录音没有识别文本）';
      const zh=document.createElement('p');
      zh.lang='zh-CN';
      zh.textContent=session.translation||'（中文翻译尚未生成）';
      columns.append(ru,zh);
      article.append(label,columns);holder.append(article);
    }
    const last=sessions.at(-1);
    stable=last?.transcript||'';draft='';
    $('ru').textContent=stable;
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
function showTranscript(update){
  const panel=$('ru');
  const follow=panel.scrollHeight-panel.clientHeight-panel.scrollTop<64;
  if(update.stable_delta?.trim())stable=stable?[stable,update.stable_delta.trim()].join(' '):update.stable_delta.trim();
  draft=update.partial_text?.trim()||'';
  const text=[stable,draft].filter(Boolean).join(' ');
  // Silence or an empty ASR window leaves the reserved RU region blank.
  panel.textContent=text;
  if(text)hasTranscript=true;
  if(follow)panel.scrollTop=panel.scrollHeight;
  const point=marks.find(m=>m.end>=update.window_end_sample);
  const lag=point?Math.max(0,performance.now()-point.time).toFixed(0)+' ms':'—';
  $('latency').textContent='窗口 '+((update.window_end_sample-update.window_start_sample)/16000).toFixed(1)+' s · 推理 '+update.inference_ms.toFixed(0)+' ms · 音频末端至显示 '+lag;
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
    transcript:[stable,draft].filter(Boolean).join(' '),outcome,hasAudio:chunkIndex>0};
  lessonWrites=lessonWrites.catch(()=>{}).then(()=>saveLesson(record));
  return lessonWrites;
}
async function onFailure(e){
  const message=errorMessage(e);
  if(!running&&!stopping&&!context){starting=false;$('error').textContent=message;buttons();return;}
  asr?.cancel();
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
  releasePlayback(); // Never play existing audio into a new microphone recording.
  const p=profiles.speech;
  if(!p?.baseUrl||!p?.model||!p?.apiKey){
    $('error').textContent='请先在“设置 → 模型 → 语音”中填写自己的 API 地址、模型和 Token。';
    $('settings').showModal();setTab('models');return;
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
  $('ru').textContent='';
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
      marks.push({end:sampleCount,time:performance.now()});if(marks.length>100)marks.shift();
      writing=writing.then(()=>saveAudioChunk(lessonId,index,samples))
        .catch(e=>{void onFailure(new Error('浏览器录音存储失败：'+errorMessage(e)));throw e;});
      asr.push(samples);
      const seconds=Math.floor(sampleCount/16000);
      $('duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    };
    running=true;starting=false;buttons();
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
$('settings-open').onclick=()=>{
  displayProfiles();
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
  try{releasePlayback();await clearBrowserData();profiles={speech:null,image:null,text:null};displayProfiles();activeClassroom=null;lessonId='';await refreshClassrooms();$('local-feedback').textContent='已清空此浏览器的 RU-Class 数据。';}
  catch(e){$('local-feedback').textContent='清空失败：'+errorMessage(e);}
};
try{profiles={speech:null,image:null,text:null,...await loadProfiles()};}
catch(e){$('error').textContent='浏览器本地存储不可用：'+errorMessage(e);}
buttons();
void refreshClassrooms();
