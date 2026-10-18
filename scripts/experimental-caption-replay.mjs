#!/usr/bin/env node
/**
 * RU-Class P1 OFFLINE EXPERIMENT ONLY.
 *
 * A separate, unshipped candidate reducer that:
 *   (1) holds back implausible ASR lexical-loop windows instead of feeding
 *       them to a fresh TranscriptBuffer, and
 *   (2) keeps overwritten unanchored text in an ephemeral private evidence
 *       ledger for two future windows, measuring later lexical support.
 *
 * This is NOT speech VAD, word alignment, a production fix or verified WER.
 * No raw hypotheses, visible captions, or private paths are printed.
 * All paths are read-only; no networking or model calls.
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {TranscriptBuffer} from '../apps/web/transcript.js';
import {inspectHypothesis} from './inspect-private-caption-risks.mjs';

const MAX_WINDOWS=200000;
const MAX_WORDS=20000;
const FUTURE_WINDOW_BUDGET=2;
const LATER_SUPPORT_TOKENS=4;

function ensure(value,code){if(!value)throw Error(code);}
function normalizeWords(text){
  return (text.normalize('NFKC').toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu)??[]);
}
function lengthOfContiguousOverlap(a,b){
  const prev=new Uint16Array(b.length+1);
  let best=0;
  for(const word of a){
    let preceding=0;
    for(let j=1;j<=b.length;j++){
      const old=prev[j];
      prev[j]=(word===b[j-1])?preceding+1:0;
      best=Math.max(best,prev[j]);
      preceding=old;
    }
  }
  return best;
}
export function loadWindows(path){
  const raw=readFileSync(path,'utf8');
  let data;
  try{data=JSON.parse(raw);}
  catch{data=raw.split(/\r?\n/u).filter(x=>x.trim()).map(line=>JSON.parse(line));}
  const items=Array.isArray(data)?data:data?.windows;
  ensure(Array.isArray(items)&&items.length>0&&items.length<=MAX_WINDOWS,'INVALID_WINDOWS');
  let lastEnd=-1;
  return items.map((item,index)=>{
    const text=item?.text??item?.hypothesis??item?.raw_text;
    const start=item?.window_start_sample??item?.windowStart??item?.window_start;
    const end=item?.window_end_sample??item?.windowEnd??item?.window_end;
    ensure(typeof text==='string'&&text.length<=MAX_WORDS&&
      Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
      start>=0&&end>start&&end>=lastEnd,'INVALID_WINDOW_'+index);
    lastEnd=end;
    return {text,start,end,final:item.final===true};
  });
}
function append(current,delta){
  return [current,delta].filter(Boolean).join(' ');
}
function countTokens(text){
  return text.trim()?text.trim().split(/\s+/u).length:0;
}
function view(stable,partial){
  return [stable,partial].filter(Boolean).join(' ');
}

export class ExperimentalCaptionBuffer {
  constructor(){
    this.reducer=new TranscriptBuffer();
    this.lastInputStart=-1;
    this.lastInputEnd=-1;
    this.nextWindowIndex=0;
    this.heldLoopWindows=[];
    this.candidateEvidence=[];
    this.unresolvedCandidates=[];
    this.supportedCandidates=[];
    // Raw evidence is retained in memory only; it is never serialized.
    this.activeCandidates=[];
  }
  update(text,start,end,final=false){
    ensure(typeof text==='string'&&text.length<=MAX_WORDS&&
      Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
      start>=0&&end>start&&end>=this.lastInputEnd,'TRANSCRIPT_WINDOW_ORDER');
    if(start===this.lastInputStart&&end===this.lastInputEnd){
      return final?this.flush():this.reducer.state();
    }
    const index=this.nextWindowIndex++;
    this.lastInputStart=start;
    this.lastInputEnd=end;
    const info=inspectHypothesis(text,start,end);
    // Every new non-loop window may corroborate text lost in a prior
    // unanchored replacement. This NEVER inserts recovered words.
    const words=normalizeWords(text);
    const keep=[];
    for(const record of this.activeCandidates){
      const run=info.lexicalLoopRisk?0:lengthOfContiguousOverlap(record.tokens,words);
      if(run>=LATER_SUPPORT_TOKENS){
        this.supportedCandidates.push({
          replacementIndex:record.replacementIndex,
          supportingWindowIndex:index,
          candidateTokenCount:record.tokens.length,
          matchedContiguousTokens:run
        });
      }else if(index-record.replacementIndex>=FUTURE_WINDOW_BUDGET){
        this.unresolvedCandidates.push({
          replacementIndex:record.replacementIndex,
          candidateTokenCount:record.tokens.length,
          resolution:'NO_MATCH_IN_TWO_SUBSEQUENT_WINDOWS'
        });
      }else keep.push(record);
    }
    this.activeCandidates=keep;
    if(info.lexicalLoopRisk){
      // Quarantine for the *counterfactual comparison* only: no ingestion,
      // no stalling or dropping any production recording/transcript.
      this.heldLoopWindows.push({index,windowStartSample:start,
        windowEndSample:end,tokenCount:info.tokenCount,
        uniqueCount:info.uniqueCount,
        maxRepeatedTrigram:info.maxRepeatedTrigram});
      return final?this.flush():this.reducer.state();
    }
    const discarded=this.reducer.unanchored?.map(x=>x.display)??[];
    const previousCount=this.reducer.unanchoredReplacementCount;
    const previousTokens=this.reducer.unanchoredReplacementTokens;
    const result=this.reducer.update(text,start,end,final);
    const increment=this.reducer.unanchoredReplacementCount-previousCount;
    if(increment){
      // Keep source evidence in RAM even when the baseline throws away the
      // candidate; this is not a vote to show or commit the text.
      const tokens=normalizeWords(discarded.join(' '));
      const rawTokenDelta=this.reducer.unanchoredReplacementTokens-previousTokens;
      this.candidateEvidence.push({
        replacementIndex:index,
        overwrittenCandidateTokens:rawTokenDelta,
        action:'RETAIN_FOR_TWO_FUTURE_WINDOWS_ONLY'
      });
      this.activeCandidates.push({replacementIndex:index,tokens});
    }
    return result;
  }
  flush(){
    const result=this.reducer.flush();
    for(const record of this.activeCandidates){
      this.unresolvedCandidates.push({
        replacementIndex:record.replacementIndex,
        candidateTokenCount:record.tokens.length,
        resolution:'STOP_BEFORE_FUTURE_EVIDENCE'
      });
    }
    this.activeCandidates=[];
    return result;
  }
  clone(){
    const copy=new ExperimentalCaptionBuffer();
    Object.assign(copy,structuredClone({...this}));
    copy.reducer=Object.assign(new TranscriptBuffer(),structuredClone({...this.reducer}));
    return copy;
  }
  publicMetrics(){
    return {
      loopWindows:this.heldLoopWindows,
      candidateReplacements:this.candidateEvidence,
      laterLexicalSupport:this.supportedCandidates,
      unresolvedCandidates:this.unresolvedCandidates,
      outstandingCandidates:this.activeCandidates.map(x=>({
        replacementIndex:x.replacementIndex,candidateTokenCount:x.tokens.length
      }))
    };
  }
}

export function counterfactualReplay(windows){
  ensure(Array.isArray(windows)&&windows.length>0&&windows.length<=MAX_WINDOWS,'INVALID_WINDOWS');
  const baseline=new TranscriptBuffer();
  const candidate=new ExperimentalCaptionBuffer();
  let bStable='',bPartial='',cStable='',cPartial='';
  let baselineStopViolations=0,experimentalStopViolations=0;
  let sameRangeReplayViolations=0,firstDivergenceIndex=null;
  let displayChangedWindows=0,stableDeltaChangedWindows=0;
  let prevEnd=-1;
  const changes=[];
  for(let index=0;index<windows.length;index++){
    const w=windows[index];
    ensure(w&&typeof w.text==='string'&&w.text.length<=MAX_WORDS&&
      Number.isSafeInteger(w.start)&&Number.isSafeInteger(w.end)&&
      w.start>=0&&w.end>w.start&&w.end>=prevEnd,'INVALID_WINDOW_'+index);
    prevEnd=w.end;
    const b=baseline.update(w.text,w.start,w.end,w.final===true);
    const c=candidate.update(w.text,w.start,w.end,w.final===true);
    bStable=append(bStable,b.stable_delta);bPartial=b.partial_text;
    cStable=append(cStable,c.stable_delta);cPartial=c.partial_text;
    const bText=view(bStable,bPartial),cText=view(cStable,cPartial);
    const changed=bText!==cText;
    if(changed){
      displayChangedWindows++;
      if(firstDivergenceIndex===null)firstDivergenceIndex=index;
      changes.push({index,
        baselineVisibleWords:countTokens(bText),
        experimentalVisibleWords:countTokens(cText)});
    }
    if(b.stable_delta!==c.stable_delta)stableDeltaChangedWindows++;
    // At each prefix, stopping must preserve exactly the displayed text
    // even when a speculative outlier has been held out.
    const bClone=Object.assign(new TranscriptBuffer(),structuredClone({...baseline}));
    const cClone=candidate.clone();
    if(view(bStable,bClone.flush().stable_delta)!==bText)baselineStopViolations++;
    if(view(cStable,cClone.flush().stable_delta)!==cText)experimentalStopViolations++;
    // Duplicate *identical sample* injection should not alter any display.
    if(!w.final){
      const cbefore=cText;
      const previous=candidate.publicMetrics();
      const replay=candidate.update(w.text,w.start,w.end);
      cStable=append(cStable,replay.stable_delta);cPartial=replay.partial_text;
      if(replay.stable_delta||view(cStable,cPartial)!==cbefore||
        JSON.stringify(previous)!==JSON.stringify(candidate.publicMetrics())){
        sameRangeReplayViolations++;
      }
    }
  }
  const bStop=baseline.flush(),cStop=candidate.flush();
  bStable=append(bStable,bStop.stable_delta);bPartial=bStop.partial_text;
  cStable=append(cStable,cStop.stable_delta);cPartial=cStop.partial_text;
  const afterBase=view(bStable,bPartial),afterTrial=view(cStable,cPartial);
  return {
    format:'ru-class-p1-counterfactual-v1',
    trial:'LEXICAL_LOOP_QUARANTINE_AND_LATER_EVIDENCE_LEDGER',
    inputWindows:windows.length,
    firstDivergenceIndex,
    displayChangedWindows,
    stableDeltaChangedWindows,
    visibleDifferences:changes,
    finalComparison:{
      finalStringsEqual:afterBase===afterTrial,
      baselineVisibleWords:countTokens(afterBase),
      experimentalVisibleWords:countTokens(afterTrial),
      verifiedSpokenWordGain:null
    },
    replayContracts:{
      baselineFirstStopViolations:baselineStopViolations,
      experimentalFirstStopViolations:experimentalStopViolations,
      experimentSameRangeReplayViolations:sameRangeReplayViolations,
      experimentDoubleFlushStableDelta:!!candidate.flush().stable_delta
    },
    ...candidate.publicMetrics(),
    humanAudioVerified:false,
    productionCodeChanged:false,
    warning:'Research comparison only. Neither fewer tokens nor later lexical support proves correctness. No private text is exported.'
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    ensure(process.argv.length===3,'EXPECTED_ONE_PRIVATE_CACHE_PATH');
    const result=counterfactualReplay(loadWindows(process.argv[2]));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    const r=result.replayContracts;
    if(r.baselineFirstStopViolations||r.experimentalFirstStopViolations||
       r.experimentSameRangeReplayViolations||r.experimentDoubleFlushStableDelta){
      process.exitCode=1;
    }
  }catch(e){
    const code=/^(?:[A-Z0-9_]+|INVALID_WINDOW_\d+)$/u.test(e.message)
      ?e.message:'PRIVATE_INPUT_OR_RUNTIME_FAILURE';
    console.error('Experimental replay error: '+code);
    process.exitCode=1;
  }
}
