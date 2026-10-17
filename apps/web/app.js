import {BrowserAsrSession,discoverModels,testConnection,validateProfile} from './direct-asr.js';
import {loadProfiles,saveProfile,saveLesson,listLessons,saveAudioChunk,recordingWav,saveHypothesis,lessonHypothesesJson,clearBrowserData} from './local-store.js';

const $=id=>document.getElementById(id);
const kinds=['speech','image','text'];
let profiles={speech:null,image:null,text:null};
const stages=Object.fromEntries(kinds.map(kind=>[kind,{revision:0,ready:false,manual:false}]));
let running=false,stopping=false,stream,context,source,capture,asr,lessonId='',sampleCount=0,chunkIndex=0;
let startedAt=0,flushResolve=null,writing=Promise.resolve(),lessonWrites=Promise.resolve(),evidenceWrites=Promise.resolve(),evidenceWarning='';
let stable='',draft='',hasTranscript=false,marks=[];
const errorMessage=e=>e instanceof Error?e.message:String(e);
function buttons(){
  $('record').disabled=stopping;
  $('record').textContent=stopping?'正在停止…':running?'停止录音':'开始录音';
  for(const id of ['speech-url','speech-model','speech-model-select','speech-key','speech-save','speech-test','speech-list','speech-refresh'])
    $(id).disabled=running||stopping;
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
  evidenceWrites=evidenceWrites.then(()=>saveHypothesis(id,entry))
    .catch(e=>{
      evidenceWarning='原始识别窗口在此浏览器保存失败：'+errorMessage(e);
      $('error').textContent=evidenceWarning;
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
  const record={id:lessonId,title:$('lesson').value.trim(),startedAt,durationSeconds:sampleCount/16000,
    transcript:[stable,draft].filter(Boolean).join(' '),outcome,hasAudio:chunkIndex>0};
  lessonWrites=lessonWrites.catch(()=>{}).then(()=>saveLesson(record));
  return lessonWrites;
}
async function onFailure(e){
  const message=errorMessage(e);
  if(!running&&!stopping&&!context){$('error').textContent=message;return;}
  asr?.cancel();
  $('error').textContent=message;
  try{
    await cleanupMicrophone();
    await Promise.all([writing,evidenceWrites]);
    if(lessonId)await finishLesson('interrupted');
  }catch(storageError){$('error').textContent+='；本地保存失败：'+errorMessage(storageError);}
  stopping=false;buttons();
}
async function start(){
  if(running||stopping)return;
  const p=profiles.speech;
  if(!p?.baseUrl||!p?.model||!p?.apiKey){
    $('error').textContent='请先在“设置 → 模型 → 语音”中填写自己的 API 地址、模型和 Token。';
    $('settings').showModal();setTab('models');return;
  }
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode){
    $('error').textContent='录音需要安全上下文（HTTPS 或 localhost）以及 AudioWorklet。';
    return;
  }
  lessonId=crypto.randomUUID();startedAt=Date.now();
  sampleCount=0;chunkIndex=0;marks=[];writing=Promise.resolve();lessonWrites=Promise.resolve();evidenceWrites=Promise.resolve();evidenceWarning='';
  stable='';draft='';hasTranscript=false;
  $('ru').textContent='';
  $('duration').textContent='00:00';$('error').textContent='';$('latency').textContent='—';
  try{
    // Safari: construct/resume audio inside the user's click handler.
    context=new AudioContext();await context.resume();
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    await finishLesson('recording'); // Recovery metadata exists before audio chunks arrive.
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
    running=true;buttons();
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
    // A successful microphone stop must not clear a failed evidence-write
    // warning: the raw ASR history might be incomplete despite a saved WAV.
    $('error').textContent=evidenceWarning;
  }catch(e){
    asr?.cancel();$('error').textContent='停止或保存失败：'+errorMessage(e);
  }finally{
    stopping=false;buttons();
    void renderLessons();
  }
}
$('record').onclick=()=>running?void stop():void start();
window.addEventListener('pagehide',()=>{
  stream?.getTracks().forEach(t=>t.stop());
  asr?.cancel();
});

// User-model configuration. The RU-Class server is NEVER consulted.
function setTab(page){
  for(const name of ['models','access']){
    const selected=(name===page);
    $('panel-'+name).hidden=!selected;
    $('tab-'+name).setAttribute('aria-selected',String(selected));
    $('tab-'+name).tabIndex=selected?0:-1;
  }
}
$('tab-models').onclick=()=>setTab('models');
$('tab-access').onclick=()=>{setTab('access');void renderLessons();};
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
  setTab('models');
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
async function renderLessons(){
  const holder=$('local-lessons');
  if(!holder)return;
  try{
    const lessons=await listLessons();
    holder.replaceChildren();
    for(const item of lessons.slice(0,25)){
      const row=document.createElement('div');
      row.className='saved-lesson';
      const label=document.createElement('span');
      label.textContent=new Date(item.startedAt).toLocaleString()+' · '+(item.title||'未命名课堂')+' · '+Math.round(item.durationSeconds)+' 秒';
      row.append(label);
      if(item.hasAudio){
        const button=document.createElement('button');button.type='button';
        button.textContent='下载 WAV';
        button.onclick=async()=>{
          try{
            const wav=await recordingWav(item.id);
            const url=URL.createObjectURL(wav);
            const link=document.createElement('a');link.href=url;link.download='ru-class-'+item.id+'.wav';
            link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
          }catch(e){$('local-feedback').textContent=errorMessage(e);}
        };
        row.append(button);
      }
      const evidenceButton=document.createElement('button');
      evidenceButton.type='button';
      evidenceButton.textContent='下载原始识别窗口';
      evidenceButton.title='导出此浏览器保存的原始 ASR 窗口，不是人工校对文本；包含课堂原话，请妥善保管';
      evidenceButton.onclick=async()=>{
        try{
          const data=await lessonHypothesesJson(item.id);
          const url=URL.createObjectURL(data);
          const link=document.createElement('a');link.href=url;link.download='ru-class-'+item.id+'-asr-windows.json';
          link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
        }catch(e){$('local-feedback').textContent=errorMessage(e);}
      };
      row.append(evidenceButton);
      holder.append(row);
      const caption=document.createElement('p');
      caption.className='saved-transcript';caption.textContent=item.transcript||'（无识别文本）';
      holder.append(caption);
    }
  }catch(e){$('local-feedback').textContent=errorMessage(e);}
}
$('clear-local').onclick=async()=>{
  if(running||stopping){$('local-feedback').textContent='请先停止录音，再清空浏览器数据。';return;}
  if(!confirm('确定清空此浏览器里所有 API 配置、课堂文本和录音吗？此操作无法撤销。'))return;
  try{await clearBrowserData();profiles={speech:null,image:null,text:null};displayProfiles();await renderLessons();$('local-feedback').textContent='已清空此浏览器的 RU-Class 数据。';}
  catch(e){$('local-feedback').textContent='清空失败：'+errorMessage(e);}
};
try{profiles={speech:null,image:null,text:null,...await loadProfiles()};}
catch(e){$('error').textContent='浏览器本地存储不可用：'+errorMessage(e);}
buttons();
