#!/usr/bin/env node
/**
 * Offline P1 acoustic-region review of existing private C1/C2 evidence.
 * Provisional window-overlap bounds, NOT forced alignment or spoken words.
 * Reads only private PCM16 WAV, review metadata, source ASR window cache
 * and previously obtained cross-ASR JSON. Outputs only numeric metadata.
 *
 * node scripts/audit-candidate-time-regions.mjs --windows <private> \
 *   --cross-asr <private> --clip <review-0030.wav> \
 *   --clip-evidence <review-0030-private.json> --case C1 --index 30
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {TranscriptBuffer} from '../apps/web/transcript.js';
import {openWave} from './audit-private-audio.mjs';
import {matchedWordMask,loadWindows,readCrossAsr} from './audit-candidate-attribution.mjs';

const SAMPLE_RATE=16000;
const FRAME=320;
const THRESHOLDS=[0.01,0.02];
const MIN_STRONG_FRAMES=4;
const MERGE_GAP_FRAMES=3;

function ensure(condition,code){if(!condition)throw Error(code);}
function normalize(text){
  return text.normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replaceAll('ё','е').match(/[\p{L}\p{N}]+/gu)??[];
}
function union(a,b){return a.map((v,i)=>v||b[i]);}
function both(a,b){return a.map((v,i)=>v&&b[i]);}
function excluded(a,b){return a.map((v,i)=>v&&!b[i]);}
function spans(mask){
  const result=[];
  for(let i=0;i<mask.length;){
    if(!mask[i]){i++;continue;}
    const start=i;
    while(i<mask.length&&mask[i])i++;
    result.push({candidateWordStart:start,candidateWordEndExclusive:i,candidateWordPositions:i-start});
  }
  return result;
}
function append(left,right){return [left,right].filter(Boolean).join(' ');}
function capturedState(windows,focus){
  const buffer=new TranscriptBuffer();
  let origin=null,stable='',partial='',candidate=null,sourceIndex=null,events=null;
  for(let i=0;i<windows.length;i++){
    const row=windows[i],prior=buffer.unanchored;
    const before=buffer.unanchoredReplacementCount;
    const predecessorOrigin=origin;
    const priorText=prior?.map(x=>x.display).join(' ')??null;
    const next=buffer.update(row.text,row.start,row.end,row.final);
    stable=append(stable,next.stable_delta);
    partial=next.partial_text;
    if(i===focus){
      events=buffer.unanchoredReplacementCount-before;
      candidate=priorText;
      sourceIndex=predecessorOrigin;
    }
    if(buffer.unanchored&&buffer.unanchored!==prior)origin=i;
    else if(!buffer.unanchored)origin=null;
  }
  ensure(events===1&&candidate&&sourceIndex!==null,
    'FOCUS_NOT_ACTUAL_CANDIDATE_REPLACEMENT');
  const stopped=buffer.flush();
  return {candidate,sourceIndex,finalText:append(stable,stopped.stable_delta)};
}
function intersect(...ranges){
  const start=Math.max(...ranges.map(r=>r.start));
  const end=Math.min(...ranges.map(r=>r.end));
  return end>start?{start,end}:null;
}
function frameLevel(wave,clipStart,start,end,threshold){
  const from=Math.max(start,clipStart);
  const to=Math.min(end,clipStart+wave.frames);
  if(to<=from)return {frames:0,activeFrames:0,segments:[]};
  // Frame positions are explicit original-sample offsets. 20ms energy
  // measurements may detect other noises and do NOT localize words.
  const levels=[];
  for(let cursor=from;cursor+FRAME<=to;cursor+=FRAME){
    const pcm=wave.read(cursor-clipStart,cursor-clipStart+FRAME);
    let sum=0;
    for(let j=0;j<FRAME;j++){
      const value=pcm.readInt16LE(j*2)/32768;
      sum+=value*value;
    }
    levels.push({start:cursor,end:cursor+FRAME,
      rms:Math.sqrt(sum/FRAME)});
  }
  const active=levels.map(x=>x.rms>=threshold);
  const bursts=[];
  for(let i=0;i<active.length;){
    if(!active[i]){i++;continue;}
    const begin=i;
    while(i<active.length&&active[i])i++;
    bursts.push({begin,end:i,activeFrames:i-begin});
  }
  // Merge tiny energy dips, but never pretend a merged gap was speech.
  const joined=[];
  for(const burst of bursts){
    const prev=joined.at(-1);
    if(prev&&burst.begin-prev.end<=MERGE_GAP_FRAMES){
      prev.end=burst.end;
      prev.activeFrames+=burst.activeFrames;
    }else joined.push({...burst});
  }
  const segments=joined.filter(x=>x.activeFrames>=MIN_STRONG_FRAMES).map(x=>({
    startSample:levels[x.begin].start,
    endSample:levels[x.end-1].end,
    durationMs:(levels[x.end-1].end-levels[x.begin].start)/SAMPLE_RATE*1000,
    activeMs:x.activeFrames*FRAME/SAMPLE_RATE*1000
  }));
  return {frames:levels.length,activeFrames:active.filter(Boolean).length,
    segments};
}

/**
 * Outputs a separate temporal possibility for every independent *later*
 * hypothesis, never concatenating windows or inventing word timestamps.
 */
export function analyzeTimeRegions(windows,report,review,wave,actualSha,caseName,index){
  ensure(caseName==='C1'||caseName==='C2','INVALID_CASE');
  ensure(Number.isSafeInteger(index)&&index>=0&&index<windows.length,
    'INVALID_FOCUS_INDEX');
  const focused=windows[index],model=readCrossAsr(report,caseName,index,focused);
  const raw=JSON.parse(readFileSync(report,'utf8'));
  const row=raw.cases.find(c=>c.case===caseName+' #'+index);
  const metadata=JSON.parse(readFileSync(review,'utf8'));
  const provenance=row?.input;
  ensure(metadata?.format==='ru-class-private-p1-review-v1'&&
    metadata.focused_window_index===index&&
    Number.isSafeInteger(metadata.clip_start_sample)&&
    Number.isSafeInteger(metadata.clip_end_sample)&&
    metadata.clip_end_sample-metadata.clip_start_sample===wave.frames,
    'CLIP_REVIEW_COORDINATES_INVALID');
  ensure(typeof provenance?.wav_sha256==='string'&&
    provenance.wav_sha256===actualSha&&
    provenance.clip_start_sample===metadata.clip_start_sample&&
    provenance.clip_end_sample===metadata.clip_end_sample,
    'CLIP_CROSS_ASR_SOURCE_MISMATCH');
  const neighbors=metadata.neighbors;
  ensure(Array.isArray(neighbors)&&neighbors.length>0,'REVIEW_NEIGHBORS_MISSING');
  for(const n of neighbors){
    ensure(Number.isSafeInteger(n.index)&&n.index>=0&&
      n.index<windows.length&&n.text===windows[n.index].text&&
      n.window_start_sample===windows[n.index].start&&
      n.window_end_sample===windows[n.index].end,
      'REVIEW_NEIGHBOR_MISMATCH');
  }
  const state=capturedState(windows,index);
  const source=windows[state.sourceIndex];
  const tokenList=normalize(state.candidate);
  const modelFocus=matchedWordMask(tokenList,normalize(model.focus));
  const modelContext=matchedWordMask(tokenList,normalize(model.context));
  const modelMask=union(modelFocus.mask,modelContext.mask);
  const finalMatch=matchedWordMask(tokenList,normalize(state.finalText));
  const provisional=excluded(modelMask,finalMatch.mask);
  const outcomes=[];
  const sourceRange={start:source.start,end:source.end};
  const focusedRange={start:focused.start,end:focused.end};
  const contextRange={start:metadata.clip_start_sample,end:metadata.clip_end_sample};
  for(let delta=1;delta<=2&&index+delta<windows.length;delta++){
    const i=index+delta,window=windows[i];
    const support=matchedWordMask(tokenList,normalize(window.text));
    const joint=both(provisional,support.mask);
    const jointFocus=both(joint,modelFocus.mask);
    const jointContext=both(joint,modelContext.mask);
    for(const [kind,mask,modelRange] of [
      ['QWEN_FOCUSED',jointFocus,focusedRange],
      ['QWEN_CONTEXT',jointContext,contextRange]
    ]){
      if(!mask.some(Boolean))continue;
      const bounds=intersect(sourceRange,{start:window.start,end:window.end},modelRange);
      for(const group of spans(mask)){
        const interval=bounds?{
          startSample:bounds.start,
          endSample:bounds.end,
          startSeconds:+(bounds.start/SAMPLE_RATE).toFixed(5),
          endSeconds:+(bounds.end/SAMPLE_RATE).toFixed(5),
          widthSeconds:+((bounds.end-bounds.start)/SAMPLE_RATE).toFixed(5)
        }:null;
        const energy=interval?THRESHOLDS.map(threshold=>({
          threshold,
          ...frameLevel(wave,metadata.clip_start_sample,bounds.start,bounds.end,threshold)
        })):[];
        outcomes.push({
          laterWindowIndex:i,modelEvidence:kind,
          ...group,
          conditionalSameOccurrenceWindowIntersection:interval,
          acousticActivityByThreshold:energy
        });
      }
    }
  }
  const sourceAndFocus=intersect(sourceRange,focusedRange,contextRange);
  return {
    format:'ru-class-p1-private-time-region-v1',
    focus:{case:caseName,index,sourceWindowIndex:state.sourceIndex,
      sourceWindowStartSample:source.start,
      sourceWindowEndSample:source.end,
      replacementWindowStartSample:focused.start,
      replacementWindowEndSample:focused.end,
      reviewedClipStartSample:metadata.clip_start_sample,
      reviewedClipEndSample:metadata.clip_end_sample,
      candidateWords:tokenList.length},
    evidence:{
      modelSupportedPositions:modelMask.filter(Boolean).length,
      modelSupportedButFinalUnmatchedPositions:provisional.filter(Boolean).length,
      sourceAndFocusIntersectSamples:sourceAndFocus?
        [sourceAndFocus.start,sourceAndFocus.end]:null,
      localAudioSha256Verified:true,
      originalCacheAndQwenWhisperEvidenceMatched:true,
      laterRawWindowCount:Math.min(2,windows.length-index-1)
    },
    conditionalRegions:outcomes,
    status:'UNVERIFIED_WORD_TIME_AND_SPEECH',
    verifiedWordTimeIntervals:0,
    restoredSpokenWords:0,
    productionChanged:false,
    warning:'Regions are only intersections of ASR WINDOW bounds under an unproved same-utterance assumption. RMS detects energy, not language or words. No sound clip or text exposed.'
  };
}
function argumentsFrom(args){
  const map={};
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    ensure(['--windows','--cross-asr','--clip','--clip-evidence','--case','--index']
      .includes(key)&&value!==undefined&&map[key]===undefined,'INVALID_ARGUMENTS');
    map[key]=value;
  }
  ensure(Object.keys(map).length===6,'EXPECTED_SIX_ARGUMENTS');
  ensure(/^(0|[1-9]\d*)$/u.test(map['--index']),
    'INVALID_FOCUS_INDEX');
  return map;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const a=argumentsFrom(process.argv.slice(2));
    const windows=loadWindows(a['--windows']);
    const clipBytes=readFileSync(a['--clip']);
    const hash=createHash('sha256').update(clipBytes).digest('hex');
    const wave=openWave(a['--clip']);
    try{
      const report=analyzeTimeRegions(windows,a['--cross-asr'],a['--clip-evidence'],
        wave,hash,a['--case'],Number(a['--index']));
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
    }finally{wave.close();}
  }catch(e){
    const message=String(e?.message??'');
    const code=/^[A-Z0-9_]+$/u.test(message)?message:'PRIVATE_INPUT_OR_RUNTIME_FAILURE';
    console.error('P1 time region audit failed: '+code);
    process.exitCode=1;
  }
}
