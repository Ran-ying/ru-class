#!/usr/bin/env node
/**
 * Read-only, offline diagnostic of ambiguous unanchored-candidate replacements.
 * Outputs numerical metadata only (no raw words, audio, paths, hashes or keys).
 * Run: node scripts/audit-private-replacements.mjs /private/lesson-asr-windows.json
 * This DOES NOT determine whether speech was actually omitted.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {TranscriptBuffer} from '../apps/web/transcript.js';

function tokens(text) {
  return String(text).trim().split(/\s+/u).filter(Boolean)
    .map(display => display.normalize('NFKC').toLocaleLowerCase('ru-RU')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}
function commonMultisetSize(a,b) {
  const available=new Map();
  for(const key of b)available.set(key,(available.get(key)||0)+1);
  let matched=0;
  for(const key of a){const n=available.get(key)||0;if(n>0){matched++;available.set(key,n-1);}}
  return matched;
}
function longestSharedRun(a,b) {
  if(!a.length||!b.length)return 0;
  const prev=new Uint32Array(b.length+1);
  let max=0;
  for(const term of a){
    for(let j=b.length;j>=1;j--){
      const n=term===b[j-1]?prev[j-1]+1:0;
      prev[j]=n;
      if(n>max)max=n;
    }
  }
  return max;
}
function parseWindows(content){
  const rows=Array.isArray(content)?content:content?.windows;
  if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw Error('INVALID_WINDOWS');
  let lastEnd=-1;
  return rows.map((row,i)=>{
    const text=row?.text??row?.hypothesis??row?.raw_text;
    const start=row?.window_start_sample??row?.windowStart??row?.window_start;
    const end=row?.window_end_sample??row?.windowEnd??row?.window_end;
    if(typeof text!=='string'||text.length>20000||
      !Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
      start<0||end<=start||end<lastEnd)throw Error('INVALID_WINDOW_'+i);
    lastEnd=end;
    return {text,start,end,final:row.final===true};
  });
}
export function auditAmbiguousReplacements(input){
  const rows=parseWindows(input);
  const reducer=new TranscriptBuffer();
  const detailed=[];
  let unanchoredOrigin=null;
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    const previousUnanchored=reducer.unanchored;
    const previousOrigin=unanchoredOrigin;
    const prevEvents=reducer.unanchoredReplacementCount;
    const prevWords=reducer.unanchoredReplacementTokens;
    reducer.update(row.text,row.start,row.end,row.final);
    const diff=reducer.unanchoredReplacementCount-prevEvents;
    const removed=reducer.unanchoredReplacementTokens-prevWords;
    if(diff<0||diff>1||(diff===0&&removed!==0)||(diff===1&&(!previousUnanchored||removed!==previousUnanchored.length)))
      throw Error('UNEXPECTED_REDUCER_DIAGNOSTIC');
    if(diff){
      detailed.push({
        replacingWindowIndex:i,
        replacingWindowStartSample:row.start,
        replacingWindowEndSample:row.end,
        candidateSourceWindowIndex:previousOrigin?.index??null,
        candidateSourceStartSample:previousOrigin?.start??null,
        candidateSourceEndSample:previousOrigin?.end??null,
        candidateTokens:removed,
        // Keys stay in memory only, are never returned/serialized.
        keys:previousUnanchored.map(word=>word.key).filter(Boolean)
      });
    }
    // A new object identity indicates the reducer replaced its tentative
    // hypothesis with text from THIS exact raw input window. No live code
    // instrumentation or mutation is required.
    if(reducer.unanchored !== previousUnanchored){
      unanchoredOrigin=reducer.unanchored?{index:i,start:row.start,end:row.end}:null;
    }
  }
  reducer.flush();
  const finalTokens=reducer.stable.map(word=>word.key).filter(Boolean);
  const events=detailed.map(({keys,...e})=>{
    const finalLexicalMultisetMatches=commonMultisetSize(keys,finalTokens);
    const longestContiguousFinalMatch=longestSharedRun(keys,finalTokens);
    const subsequent=rows.slice(e.replacingWindowIndex+1);
    const longestContiguousLaterRawMatch=subsequent.reduce((best,row)=>
      Math.max(best,longestSharedRun(keys,tokens(row.text))),0);
    return {...e,
      finalLexicalMultisetMatches,
      longestContiguousFinalMatch,
      longestContiguousLaterRawMatch
    };
  });
  if(events.length!==reducer.unanchoredReplacementCount||
     events.reduce((n,e)=>n+e.candidateTokens,0)!==reducer.unanchoredReplacementTokens)
    throw Error('REPLACEMENT_COUNTER_MISMATCH');
  return {
    format:'ru-class-numeric-unanchored-audit-v1',
    inputWindows:rows.length,
    finalWordCount:reducer.stable.length,
    ambiguousCandidateReplacements:reducer.unanchoredReplacementCount,
    ambiguousCandidateTokens:reducer.unanchoredReplacementTokens,
    events,
    note:'Candidate origin is tracked by reducer state identity, not audio word timing. All lexical matches are weak token/string proxies across overlapping windows; neither a match nor its absence proves spoken-word restoration/loss or WER. No text, key, WAV or path is emitted.'
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==3)throw Error('EXPECTED_PRIVATE_JSON_PATH');
    let raw=readFileSync(process.argv[2],'utf8');
    let parsed;
    try{parsed=JSON.parse(raw);}catch{parsed=raw.split(/\r?\n/u).filter(Boolean).map(x=>JSON.parse(x));}
    process.stdout.write(JSON.stringify(auditAmbiguousReplacements(parsed),null,2)+'\n');
  }catch(e){
    const msg=String(e?.message||'');
    console.error('Private numeric replay failed: '+(/^(?:[A-Z0-9_]+|INVALID_WINDOW_\d+)$/u.test(msg)?msg:'PRIVATE_INPUT_OR_RUNTIME_FAILURE'));
    process.exitCode=1;
  }
}