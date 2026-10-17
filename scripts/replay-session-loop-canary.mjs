#!/usr/bin/env node
/**
 * Verify the NEW session-scoped browser canary on privately cached ASR
 * windows (not old PR #22's separate experimental wrapper).
 *
 * Strictly offline. Never emits transcript, ASR text, user paths, credentials.
 * Usage: node scripts/replay-session-loop-canary.mjs /private/windows.json
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {TranscriptBuffer} from '../apps/web/transcript.js';
import {LoopQuarantineTranscript} from '../apps/web/caption-loop-guard.js';

function ensure(ok,msg){if(!ok)throw Error(msg);}
function readWindows(file){
  const raw=readFileSync(file,'utf8');
  let parsed;
  try{parsed=JSON.parse(raw);}
  catch{parsed=raw.split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));}
  const rows=Array.isArray(parsed)?parsed:parsed?.windows;
  ensure(Array.isArray(rows)&&rows.length>0&&rows.length<=200000,'INVALID_WINDOWS');
  let prevEnd=-1;
  return rows.map((w,i)=>{
    const text=w?.text??w?.hypothesis??w?.raw_text;
    const start=w?.window_start_sample??w?.windowStart??w?.window_start;
    const end=w?.window_end_sample??w?.windowEnd??w?.window_end;
    ensure(typeof text==='string'&&text.length<=20000&&
      Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
      start>=0&&end>start&&end>=prevEnd,'INVALID_WINDOW_'+i);
    prevEnd=end;
    return {text,start,end,final:w.final===true};
  });
}
function duplicateState(t){
  if(t instanceof LoopQuarantineTranscript){
    const b=Object.assign(new LoopQuarantineTranscript(),structuredClone({...t}));
    b.buffer=Object.assign(new TranscriptBuffer(),structuredClone({...t.buffer}));
    return b;
  }
  return Object.assign(new TranscriptBuffer(),structuredClone({...t}));
}
function words(s){return s.trim()?s.trim().split(/\s+/u).length:0;}
function show(stable,partial){return [stable,partial].filter(Boolean).join(' ');}
function add(a,b){return [a,b].filter(Boolean).join(' ');}
export function compareSessionCanary(rows){
  ensure(Array.isArray(rows)&&rows.length>0,'INVALID_WINDOWS');
  const normal=new TranscriptBuffer(),canary=new LoopQuarantineTranscript();
  let normalStable='',normalPartial='',trialStable='',trialPartial='';
  const visibleDifferentIndices=[],stableDifferentIndices=[];
  let firstStopViolations=0,sameRangeViolations=0;
  let prevEnd=-1;
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    ensure(r&&typeof r.text==='string'&&
      Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&
      r.start>=0&&r.end>r.start&&r.end>=prevEnd,'INVALID_WINDOW_'+i);
    prevEnd=r.end;
    const a=normal.update(r.text,r.start,r.end,r.final===true);
    const b=canary.update(r.text,r.start,r.end,r.final===true);
    normalStable=add(normalStable,a.stable_delta);normalPartial=a.partial_text;
    trialStable=add(trialStable,b.stable_delta);trialPartial=b.partial_text;
    const left=show(normalStable,normalPartial),right=show(trialStable,trialPartial);
    if(left!==right)visibleDifferentIndices.push(i);
    if(a.stable_delta!==b.stable_delta)stableDifferentIndices.push(i);
    for(const [t,stable,shown] of [[normal,normalStable,left],[canary,trialStable,right]]){
      const checkpoint=duplicateState(t).flush();
      if(show(stable,checkpoint.stable_delta)!==shown||checkpoint.partial_text)
        firstStopViolations++;
    }
    if(!r.final){
      const old=JSON.stringify(canary.diagnostics());
      const duplicate=canary.update(r.text,r.start,r.end);
      trialStable=add(trialStable,duplicate.stable_delta);
      trialPartial=duplicate.partial_text;
      if(duplicate.stable_delta||show(trialStable,trialPartial)!==right||
          JSON.stringify(canary.diagnostics())!==old)sameRangeViolations++;
    }
  }
  const a=normal.flush(),b=canary.flush();
  normalStable=add(normalStable,a.stable_delta);
  trialStable=add(trialStable,b.stable_delta);
  const baselineFinal=show(normalStable,a.partial_text);
  const canaryFinal=show(trialStable,b.partial_text);
  const doubleFlushAdded=!!canary.flush().stable_delta;
  const quarantined=canary.diagnostics().quarantinedWindows;
  return {
    format:'ru-class-p1-browser-canary-private-v1',
    inputWindows:rows.length,
    captionPolicy:'extreme-loop-quarantine (off by default)',
    flaggedIndices:quarantined.map(x=>x.index),
    flaggedMetrics:quarantined,
    visibleDifferentIndices,
    stableDifferentIndices,
    counts:{
      quarantinedWindows:quarantined.length,
      visibleChangedWindows:visibleDifferentIndices.length,
      stableDeltaChangedWindows:stableDifferentIndices.length,
      finalBaselineWords:words(baselineFinal),
      finalCanaryWords:words(canaryFinal),
      finalStringsEqual:baselineFinal===canaryFinal
    },
    mechanicalContracts:{
      firstStopViolations,sameRangeReplayViolations:sameRangeViolations,
      doubleFlushStableGrowth:doubleFlushAdded
    },
    productionDefaultChanged:false,
    humanWordTruthVerified:false,
    note:'Counts and indices ONLY, not confirmed speech accuracy; no raw private text was emitted.'
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    ensure(process.argv.length===3,'EXPECTED_PRIVATE_WINDOWS_FILE');
    const result=compareSessionCanary(readWindows(process.argv[2]));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    const checks=result.mechanicalContracts;
    if(checks.firstStopViolations||checks.sameRangeReplayViolations||
       checks.doubleFlushStableGrowth)process.exitCode=1;
  }catch(e){
    const message=String(e?.message??'');
    console.error('P1 canary replay error: '+(/^(?:[A-Z0-9_]+|INVALID_WINDOW_\d+)$/u.test(message)?
      message:'PRIVATE_INPUT_OR_RUNTIME_FAILURE'));
    process.exitCode=1;
  }
}
