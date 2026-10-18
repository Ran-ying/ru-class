#!/usr/bin/env node
/**
 * P1: private candidate attribution, OFFLINE research tool.
 *
 * Read existing Whisper window evidence and the ALREADY OBTAINED
 * independent Qwen3-ASR report. Identify an actual unanchored replacement
 * in the unmodified production reducer and ask which candidate word runs
 * have (a) independent-model support, (b) later-window support, and
 * (c) lexical coverage in the final visible transcript.
 *
 * No fresh inference, network calls, word timestamps or transcript edits.
 * No recognized words or private paths are printed or written.
 *
 * node scripts/audit-candidate-attribution.mjs \
 *   --windows /private/C1-fixed-windows-converted.json \
 *   --cross-asr /private/cross-asr-private.json --case C1 --index 30
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {TranscriptBuffer} from '../apps/web/transcript.js';

const TOKEN_RE=/[\p{L}\p{N}]+/gu;
const MIN_CONTIGUOUS_WORDS=3;
const LOOKAHEAD_WINDOWS=2;
function check(test,code){if(!test)throw Error(code);}
function tokens(value){
  check(typeof value==='string'&&value.length<=20000,'INVALID_TEXT');
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replaceAll('ё','е').match(TOKEN_RE)??[];
}
function asNumbers(item,index){
  const text=item?.text??item?.hypothesis??item?.raw_text;
  const start=item?.window_start_sample??item?.windowStart??item?.window_start;
  const end=item?.window_end_sample??item?.windowEnd??item?.window_end;
  check(typeof text==='string'&&text.length<=20000&&
    Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
    start>=0&&end>start,'INVALID_WINDOW_'+index);
  return {text,start,end,final:item.final===true};
}
export function loadWindows(file){
  const raw=readFileSync(file,'utf8');
  let data;
  try{data=JSON.parse(raw);}
  catch{data=raw.split(/\r?\n/u).filter(x=>x.trim()).map(line=>JSON.parse(line));}
  const items=Array.isArray(data)?data:data?.windows;
  check(Array.isArray(items)&&items.length>0&&items.length<=200000,'INVALID_WINDOW_COLLECTION');
  let previousEnd=-1;
  return items.map((item,index)=>{
    const next=asNumbers(item,index);
    check(next.end>=previousEnd,'OUT_OF_ORDER_WINDOW');
    previousEnd=next.end;
    return next;
  });
}
export function readCrossAsr(file,caseName,index,focus){
  const data=JSON.parse(readFileSync(file,'utf8'));
  check(data&&data.format==='ru-class-p1-dashscope-cross-asr-private-v1'&&
    Array.isArray(data.cases),'UNSUPPORTED_CROSS_ASR_REPORT');
  const id=caseName+' #'+index;
  const matches=data.cases.filter(x=>x?.case===id);
  check(matches.length===1,'CROSS_ASR_CASE_MISMATCH');
  const item=matches[0];
  const input=item.input;
  check(input&&input.focused_window_start_sample===focus.start&&
    input.focused_window_end_sample===focus.end&&
    input.sample_rate===16000,'CROSS_ASR_COORDINATE_MISMATCH');
  check(item.original_whisper_focused_window===focus.text,
    'CROSS_ASR_WHISPER_MISMATCH');
  const independent=item.independent_dashscope_qwen3_asr;
  check(independent&&typeof independent.focused_8s_text==='string'&&
    typeof independent.context_text==='string'&&
    independent.focused_8s_text.length<=20000&&
    independent.context_text.length<=20000,'INVALID_INDEPENDENT_HYPOTHESES');
  check(independent.focused_language==='ru'&&
    independent.context_language==='ru'&&
    independent.focused_finish_reason==='stop'&&
    independent.context_finish_reason==='stop',
    'CROSS_ASR_NOT_SUCCESSFUL');
  return {focus:independent.focused_8s_text,context:independent.context_text};
}

/** Return coverage in FIRST input, from contiguous matches (not a word aligner). */
export function matchedWordMask(first,second,minLength=MIN_CONTIGUOUS_WORDS){
  check(Array.isArray(first)&&Array.isArray(second)&&
    first.length<=20000&&second.length<=20000,'INVALID_TOKEN_SEQUENCE');
  const mask=Array(first.length).fill(false);
  const prev=new Uint32Array(second.length+1);
  let maxRun=0;
  for(let i=1;i<=first.length;i++){
    // prev[j] holds the previous row until the cell has been updated;
    // previousDiagonal tracks the prior row and prior column.
    let previousDiagonal=0;
    for(let j=1;j<=second.length;j++){
      const old=prev[j];
      const length=first[i-1]===second[j-1]?previousDiagonal+1:0;
      prev[j]=length;
      previousDiagonal=old;
      if(length>maxRun)maxRun=length;
      if(length>=minLength){
        for(let k=i-length;k<i;k++)mask[k]=true;
      }
    }
  }
  return {mask,maxContiguousRun:maxRun,matchedCandidateWords:mask.filter(Boolean).length};
}
function countBoth(a,b){return a.reduce((n,x,i)=>n+(x&&b[i]?1:0),0);}
function countTriple(a,b,c){return a.reduce((n,x,i)=>n+(x&&b[i]&&c[i]?1:0),0);}
function countSupportedButMissing(a,b){return a.reduce((n,x,i)=>n+(x&&!b[i]?1:0),0);}
function union(a,b){return a.map((x,i)=>x||b[i]);}
function appended(stable,delta){return [stable,delta].filter(Boolean).join(' ');}
function visible(stable,partial){return [stable,partial].filter(Boolean).join(' ');}
function overlapping(a,b){
  return Math.max(a.start,b.start)<Math.min(a.end,b.end);
}

/**
 * Shadow-evidence only. Requires the focused replacement event to have
 * occurred in the actual production reducer. No speculative source strings
 * enter any report.
 */
export function auditAttribution(windows,model,caseName,index){
  check(caseName==='C1'||caseName==='C2','INVALID_CASE');
  check(Number.isSafeInteger(index)&&index>=0&&index<windows.length,'INVALID_FOCUS_INDEX');
  const reducer=new TranscriptBuffer();
  let stable='',partial='',candidate=null,source=null;
  let origin=null;
  let sourceIndex=null;
  const snapshots=[];
  for(let i=0;i<windows.length;i++){
    const item=windows[i];
    const before=reducer.unanchored;
    const beforeCount=reducer.unanchoredReplacementCount;
    const preCandidate=i===index&&before?before.map(x=>x.display).join(' '):null;
    const beforeOrigin=origin;
    const output=reducer.update(item.text,item.start,item.end,item.final);
    stable=appended(stable,output.stable_delta);
    partial=output.partial_text;
    if(i===index){
      check(reducer.unanchoredReplacementCount-beforeCount===1&&
        preCandidate!==null,'FOCUSED_WINDOW_NOT_REPLACEMENT');
      candidate=preCandidate;
      sourceIndex=beforeOrigin;
      source=sourceIndex===null?null:windows[sourceIndex];
    }
    if(reducer.unanchored&&reducer.unanchored!==before){
      origin=i;
    }else if(!reducer.unanchored)origin=null;
    if(i===index||i===index+1||i===index+2||i===windows.length-1){
      snapshots.push({index:i,text:visible(stable,partial)});
    }
  }
  check(typeof candidate==='string'&&candidate.length>0,'NO_CANDIDATE');
  const stopped=reducer.flush();
  stable=appended(stable,stopped.stable_delta);
  const finalText=visible(stable,stopped.partial_text);
  const candidateTokens=tokens(candidate);
  const firstWindow=windows[index];
  const next=windows.slice(index+1,index+LOOKAHEAD_WINDOWS+1);
  // A concatenated sequence could invent a match crossing two separate
  // hypotheses. Match each actual later window independently.
  const laterTokens=next.map(x=>tokens(x.text));
  const focused=matchedWordMask(candidateTokens,tokens(model.focus));
  const context=matchedWordMask(candidateTokens,tokens(model.context));
  const modelMask=union(focused.mask,context.mask);
  const laterMatches=laterTokens.map(x=>matchedWordMask(candidateTokens,x));
  const laterMask=laterMatches.reduce((acc,x)=>union(acc,x.mask),
    Array(candidateTokens.length).fill(false));
  const laterMaxRun=Math.max(0,...laterMatches.map(x=>x.maxContiguousRun));
  const final=matchedWordMask(candidateTokens,tokens(finalText));
  // A word matched lexically somewhere in the final document is NOT
  // necessarily the same occurrence or even the same utterance.
  const modelWords=modelMask.filter(Boolean).length;
  const doubleSupported=countBoth(modelMask,laterMask);
  const notCovered=countSupportedButMissing(modelMask,final.mask);
  const independentlyAndLaterSupportedButFinalUnmatched=
    modelMask.reduce((n,x,i)=>n+(x&&laterMask[i]&&!final.mask[i]?1:0),0);
  const sourceInterval=source?{windowIndex:sourceIndex,
    windowStartSample:source.start,windowEndSample:source.end}:null;
  return {
    format:'ru-class-p1-candidate-attribution-v1',
    target:{case:caseName,index,
      windowStartSample:firstWindow.start,
      windowEndSample:firstWindow.end,
      candidateSource:sourceInterval,
      candidateSourceAndReplacementWindowsOverlap:source?overlapping(source,firstWindow):null},
    candidateWords:candidateTokens.length,
    independentModel:{
      focusedMaxContiguousMatch:focused.maxContiguousRun,
      contextMaxContiguousMatch:context.maxContiguousRun,
      focusedMatchedCandidateWords:focused.matchedCandidateWords,
      contextMatchedCandidateWords:context.matchedCandidateWords,
      supportedCandidateWordsUnion:modelWords
    },
    subsequentWindows:{
      examined:next.length,
      lastIndex:next.length?index+next.length:null,
      maxContiguousMatch:laterMaxRun,
      matchedCandidateWords:laterMask.filter(Boolean).length,
      modelAndLaterSupportedWords:doubleSupported
    },
    finalVisibility:{
      lexicallyCoveredCandidateWords:final.matchedCandidateWords,
      maxContiguousCandidateMatch:final.maxContiguousRun,
      modelSupportedButNotLexicallyCoveredWords:notCovered,
      modelAndLaterSupportedButNotLexicallyCoveredWords:
        independentlyAndLaterSupportedButFinalUnmatched,
      modelLaterAndCoveredWords:countTriple(modelMask,laterMask,final.mask)
    },
    limitedPostWindowSnapshots:snapshots.filter(x=>x.index!==windows.length-1)
      .map(x=>({index:x.index,
        candidateMatchedWords:matchedWordMask(candidateTokens,tokens(x.text)).matchedCandidateWords})),
    admission:{
      status:'REVIEW_ONLY_NO_AUTOMATIC_RESTORATION',
      verifiedWordTimestamps:false,
      measuredSpeechOmissions:null,
      trueWordRecovery:null,
      productionChanged:false
    },
    caveat:'Raw windows give only window-level time bounds, not word timestamps. A lexical match in final text may belong to another utterance. Scores are not WER or proof of spoken omissions.'
  };
}
function parseArgs(args){
  const options={};
  for(let i=0;i<args.length;i+=2){
    const flag=args[i],value=args[i+1];
    check(['--windows','--cross-asr','--case','--index'].includes(flag)&&
      value!==undefined&&options[flag]===undefined,'INVALID_ARGUMENTS');
    options[flag]=value;
  }
  check(Object.keys(options).length===4,'REQUIRED_FOUR_ARGUMENTS');
  check(/^(0|[1-9]\d*)$/u.test(options['--index']),'INVALID_FOCUS_INDEX');
  return options;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const args=parseArgs(process.argv.slice(2));
    const caseName=args['--case'],index=Number(args['--index']);
    const windows=loadWindows(args['--windows']);
    check(index<windows.length,'INVALID_FOCUS_INDEX');
    const model=readCrossAsr(args['--cross-asr'],caseName,index,windows[index]);
    const result=auditAttribution(windows,model,caseName,index);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(e){
    // Never leak private paths, Russian text, credentials or provider body.
    const message=String(e?.message??'');
    const code=/^(?:[A-Z0-9_]+|INVALID_WINDOW_\d+)$/u.test(message)
      ?message:'PRIVATE_INPUT_OR_RUNTIME_FAILURE';
    console.error('P1 candidate attribution failed: '+code);
    process.exitCode=1;
  }
}
