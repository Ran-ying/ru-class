#!/usr/bin/env node
/**
 * Compare two LOCAL Git revisions of the real browser TranscriptBuffer against
 * the same PRIVATE ASR window caches. No audio engine, API requests, network,
 * classroom text, sample transcript fragments or API keys are emitted.
 *
 * Example (after git fetch origin):
 * node scripts/compare-transcript-caches.mjs origin/main HEAD \
 *   /private/C1-fixed-windows-converted.json \
 *   /private/C2-realtime-windows-converted.json
 *
 * The repeated 5-gram metric is a lexical SCREEN, not an error count: a
 * lecturer may genuinely repeat phrases. It is deliberately NOT reported as
 * the original Codex regression script's 36/32 "candidate spans" metric.
 */
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';

function fail(message){throw Error(message);}
function loadWindows(path){
  const raw=readFileSync(path,'utf8');
  let source;
  try{source=JSON.parse(raw);}
  catch{source=raw.split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));}
  const entries=Array.isArray(source)?source:source?.windows;
  if(!Array.isArray(entries)||!entries.length)fail('Expected a nonempty array / {windows: []}: '+basename(path));
  if(entries.length>100000)fail('Too many windows');
  let prior=-1;
  return entries.map((x,i)=>{
    const text=x.text??x.raw_text??x.hypothesis;
    const start=x.window_start_sample??x.windowStart??x.window_start;
    const end=x.window_end_sample??x.windowEnd??x.window_end;
    if(typeof text!=='string'||text.length>20000||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
       start<0||end<=start||end<prior)fail('Invalid window at '+basename(path)+' index '+i);
    prior=end;
    return {text,start,end,final:x.final===true};
  });
}
function tokens(s){
  return s.normalize('NFKC').toLocaleLowerCase('ru-RU').split(/\s+/u).filter(Boolean).map(x=>
    x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'')).filter(Boolean);
}
function repeated5Grams(s){
  // Number of repeated 5-gram starting positions (excluding first
  // occurrence). Not an independent count of repeated spoken phrases.
  const t=tokens(s),seen=new Set();
  let repeated=0;
  for(let i=0;i+5<=t.length;i++){
    const key=t.slice(i,i+5).join('\u0000');
    if(seen.has(key))repeated++;
    seen.add(key);
  }
  return repeated;
}
function wordEditDistance(a,b){
  // Levenshtein distance for *descriptive* word-level differences. This
  // cannot identify genuine lost speech without human-audited timestamps.
  const t=tokens(a),u=tokens(b);
  if(t.length*u.length>10_000_000)return null;
  let prev=Array.from({length:u.length+1},(_,i)=>i);
  for(let i=1;i<=t.length;i++){
    const row=[i];
    for(let j=1;j<=u.length;j++)row[j]=Math.min(
      prev[j]+1,row[j-1]+1,prev[j-1]+(t[i-1]===u[j-1]?0:1)
    );
    prev=row;
  }
  return prev[u.length];
}
function snapshot(buffer){
  const value={...buffer};
  delete value.revision;
  return JSON.stringify(value);
}
function run(Buffer,windows){
  const b=new Buffer();
  let stable='',partial='',duplicateViolations=0,duplicateStateChanges=0,
    firstStopVisibilityViolations=0,stableRewriteViolations=0,
    partialRepeated5GramUpdates=0,finalUpdates=0;
  let beforeStable='';
  for(const w of windows){
    const response=b.update(w.text,w.start,w.end,w.final);
    if(response.stable_delta)stable=[stable,response.stable_delta].filter(Boolean).join(' ');
    partial=response.partial_text;
    if(!stable.startsWith(beforeStable))stableRewriteViolations++;
    beforeStable=stable;
    if(repeated5Grams(partial)>0)partialRepeated5GramUpdates++;
    if(w.final)finalUpdates++;
    const before=[stable,partial].filter(Boolean).join(' ');
    const check=Object.assign(new Buffer(),structuredClone({...b}));
    const firstStop=check.flush();
    const after=[stable,firstStop.stable_delta,firstStop.partial_text].filter(Boolean).join(' ');
    if(before!==after)firstStopVisibilityViolations++;
    if(!w.final){
      const stateBefore=snapshot(b);
      const replay=b.update(w.text,w.start,w.end);
      if(replay.stable_delta||replay.partial_text!==partial)duplicateViolations++;
      if(stateBefore!==snapshot(b))duplicateStateChanges++;
    }
  }
  const finished=b.flush();
  if(finished.stable_delta)stable=[stable,finished.stable_delta].filter(Boolean).join(' ');
  partial=finished.partial_text;
  const finalText=[stable,partial].filter(Boolean).join(' ');
  const second=b.flush();
  return {
    windowCount:windows.length,
    lastSample:windows.at(-1).end,
    rawFinalText:finalText, // internal only; MUST NOT print
    totalWords:tokens(finalText).length,
    totalCharacters:finalText.length,
    repeated5GramStarts:repeated5Grams(finalText),
    partialRepeated5GramUpdates,
    duplicateViolations,
    duplicateStateChanges,
    firstStopVisibilityViolations,
    stableRewriteViolations,
    doubleFlushSafe:!second.stable_delta&&!second.partial_text,
    finalUpdates
  };
}
function safe(r){
  const {rawFinalText,...rest}=r;return rest;
}

const [, ,baselineRef,candidateRef,...paths]=process.argv;
if(!baselineRef||!candidateRef||!paths.length){
  console.error('Usage: node scripts/compare-transcript-caches.mjs BASE_REV CANDIDATE_REV private-C1.json [private-C2.json]');
  process.exitCode=2;
}else{
  let temporary;
  try{
    temporary=mkdtemp(join(tmpdir(),'ru-class-transcript-ab-'));
    const versions=[];
    for(const [i,ref] of [baselineRef,candidateRef].entries()){
      // No shell, no network, no code submitted to remote services.
      // Both inputs must be trusted revisions of the user's own repository.
      const source=execFileSync('git',['show',ref+':apps/web/transcript.js'],{encoding:'utf8',maxBuffer:2_000_000});
      const path=join(temporary,'revision-'+i+'.mjs');
      writeFileSync(path,source,{mode:0o600});
      versions.push((await import(pathToFileURL(path).href)).TranscriptBuffer);
    }
    const files=[];
    for(const path of paths){
      const windows=loadWindows(path);
      const baseline=run(versions[0],windows),candidate=run(versions[1],windows);
      files.push({
        fixture:basename(path),inputWindows:windows.length,
        baseline:safe(baseline),candidate:safe(candidate),
        changes:{
          wordEditDistance:wordEditDistance(baseline.rawFinalText,candidate.rawFinalText),
          wordCountDelta:candidate.totalWords-baseline.totalWords,
          repeated5GramStartDelta:candidate.repeated5GramStarts-baseline.repeated5GramStarts,
          partialRepeatUpdateDelta:candidate.partialRepeated5GramUpdates-baseline.partialRepeated5GramUpdates,
          finalTextIdentical:baseline.rawFinalText===candidate.rawFinalText
        }
      });
    }
    // No transcript text or token contents; only bounded scalar counters.
    process.stdout.write(JSON.stringify({
      baselineRevision:baselineRef,candidateRevision:candidateRef,files,
      limitations:[
        'Repeated 5-grams are lexical candidates, not proven duplicate audio.',
        'Word edit distance is between ASR outputs, not WER/CER.',
        'Stable/partial counts alone cannot detect suppressed genuine repetitions.',
        'For PR approval, manually inspect private word diffs and 227 stop prefixes.'
      ]
    },null,2)+'\n');
    if(files.some(x=>
      x.candidate.duplicateViolations||x.candidate.duplicateStateChanges||
      x.candidate.firstStopVisibilityViolations||x.candidate.stableRewriteViolations||
      !x.candidate.doubleFlushSafe))process.exitCode=1;
  }catch(e){
    console.error('Local comparison failed:',e.message);
    process.exitCode=1;
  }finally{if(temporary)rmSync(temporary,{recursive:true,force:true});}
}
