#!/usr/bin/env node
/**
 * P1 SHADOW-ONLY subtitle risk metrics for already captured private ASR windows.
 *
 * Does NOT change TranscriptBuffer, browser output, source files, or contact
 * models/providers. CLI emits indices + aggregate numerical metrics only,
 * NEVER recognized speech. Flags do not identify audible words or prove loss.
 *
 * node scripts/inspect-private-caption-risks.mjs /private/C1-windows.json
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {TranscriptBuffer} from '../apps/web/transcript.js';

const SAMPLE_RATE=16000;
const RISK_CRITERIA=Object.freeze({
  minTokens:40,
  minTokensPerSecond:8,
  maxUniqueRatio:0.25,
  minRepeatedTrigram:8
});
function fail(test,code){if(!test)throw Error(code);}
export function inspectHypothesis(text,start,end){
  fail(typeof text==='string'&&text.length<=20000,'INVALID_HYPOTHESIS');
  fail(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start,
    'INVALID_AUDIO_RANGE');
  const tokens=(text.normalize('NFKC').toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu)??[]);
  const tokenCount=tokens.length;
  const durationSeconds=(end-start)/SAMPLE_RATE;
  const wordRate=tokenCount/durationSeconds;
  const uniqueCount=new Set(tokens).size;
  const repeated=new Map();
  let maxRepeatedTrigram=0;
  for(let i=2;i<tokens.length;i++){
    // Delimiter is never part of regex-matched word tokens.
    const gram=tokens[i-2]+'\0'+tokens[i-1]+'\0'+tokens[i];
    const count=(repeated.get(gram)??0)+1;
    repeated.set(gram,count);
    if(count>maxRepeatedTrigram)maxRepeatedTrigram=count;
  }
  const uniqueRatio=tokenCount?uniqueCount/tokenCount:1;
  // The conjunction is deliberately conservative, not calibrated to audio
  // truth. Genuine rapid/repeated speech can still be misclassified.
  const lexicalLoopRisk=tokenCount>=RISK_CRITERIA.minTokens
    &&wordRate>=RISK_CRITERIA.minTokensPerSecond
    &&uniqueRatio<=RISK_CRITERIA.maxUniqueRatio
    &&maxRepeatedTrigram>=RISK_CRITERIA.minRepeatedTrigram;
  return {tokenCount,uniqueCount,wordRate:+wordRate.toFixed(3),
    uniqueRatio:+uniqueRatio.toFixed(4),maxRepeatedTrigram,
    lexicalLoopRisk};
}
export function loadPrivateWindows(path){
  const raw=readFileSync(path,'utf8');
  let content;
  try{content=JSON.parse(raw);}
  catch {content=raw.split(/\r?\n/u).filter(x=>x.trim()).map(x=>JSON.parse(x));}
  const windows=Array.isArray(content)?content:content?.windows;
  fail(Array.isArray(windows)&&windows.length>0&&windows.length<=200000,
    'INVALID_WINDOWS_COLLECTION');
  let prevEnd=-1;
  return windows.map((item,index)=>{
    const text=item?.text??item?.hypothesis??item?.raw_text;
    const start=item?.window_start_sample??item?.windowStart??item?.window_start;
    const end=item?.window_end_sample??item?.windowEnd??item?.window_end;
    fail(typeof text==='string'&&text.length<=20000&&
      Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
      start>=0&&end>start&&end>=prevEnd,'INVALID_WINDOW_'+index);
    prevEnd=end;
    return {text,start,end,final:item.final===true};
  });
}
export function shadowAudit(windows){
  const buffer=new TranscriptBuffer();
  let previousEnd=-1;
  const lexicalLoopWindows=[],unanchoredReplacementWindows=[];
  let totalUnanchoredEvents=0;
  for(let index=0;index<windows.length;index++){
    const {text,start,end,final=false}=windows[index];
    fail(end>=previousEnd,'TRANSCRIPT_WINDOW_ORDER');
    previousEnd=end;
    const hypothesis=inspectHypothesis(text,start,end);
    if(hypothesis.lexicalLoopRisk){
      lexicalLoopWindows.push({
        index,windowStartSample:start,windowEndSample:end,...hypothesis
      });
    }
    const oldCount=buffer.unanchoredReplacementCount;
    const oldTokens=buffer.unanchoredReplacementTokens;
    buffer.update(text,start,end,final);
    const count=buffer.unanchoredReplacementCount-oldCount;
    if(count){
      unanchoredReplacementWindows.push({
        index,windowStartSample:start,windowEndSample:end,
        replacementEvents:count,
        overwrittenCandidateTokens:buffer.unanchoredReplacementTokens-oldTokens
      });
      totalUnanchoredEvents+=count;
    }
  }
  return {
    format:'ru-class-p1-shadow-risk-v1',
    inputWindows:windows.length,
    sampleRate:SAMPLE_RATE,
    riskCriteria:RISK_CRITERIA,
    lexicalLoopWindows,
    unanchoredReplacementWindows,
    totals:{
      lexicalLoopRiskWindows:lexicalLoopWindows.length,
      unanchoredReplacementEvents:totalUnanchoredEvents
    },
    classifiedSpeechAccuracy:'UNVERIFIED',
    warning:'Shadow-only candidate-risk metrics, not human-audited speech, omissions, hallucinations, or WER. No captions were changed.'
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    fail(process.argv.length===3,'REQUIRED_ONE_PRIVATE_WINDOWS_PATH');
    process.stdout.write(JSON.stringify(shadowAudit(loadPrivateWindows(process.argv[2])),null,2)+'\n');
  }catch(e){
    // Do not leak a private path or JSON payload from an exception.
    const code=/^(?:[A-Z0-9_]+|INVALID_WINDOW_\d+)$/u.test(e.message)
      ?e.message:'PRIVATE_INPUT_OR_RUNTIME_FAILURE';
    console.error('P1 shadow risk audit failed: '+code);
    process.exitCode=1;
  }
}
