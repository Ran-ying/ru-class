#!/usr/bin/env node
/**
 * Recheck locally stored *private* Whisper window hypotheses against the
 * production browser TranscriptBuffer. No audio/model/API/network required.
 * No recognized text is ever printed or persisted by this tool.
 *
 * Usage: node scripts/replay-browser-transcript.mjs /private/path/windows.json
 *
 * Expected input: JSON array, {"windows":[...]}, or JSONL (one object/line).
 * Each window: {text,window_start_sample,window_end_sample}.
 * Alternate names windowStart/windowEnd (16kHz samples) are also accepted.
 * Do not commit classroom fixtures or output to public repositories.
 */
import {readFileSync} from 'node:fs';
import {TranscriptBuffer} from '../apps/web/transcript.js';

const file=process.argv[2];
if(!file){
  console.error('Usage: node scripts/replay-browser-transcript.mjs /private/path/windows.json');
  process.exitCode=2;
}else{
  try{
    const raw=readFileSync(file,'utf8');
    let content;
    try{content=JSON.parse(raw);}
    catch{content=raw.split(/\r?\n/).filter(x=>x.trim()).map(line=>JSON.parse(line));}
    const windows=Array.isArray(content)?content:content?.windows;
    if(!Array.isArray(windows)||!windows.length)throw Error('Expected nonempty JSON array or {windows:array}');
    const reducer=new TranscriptBuffer();
    const plain=new TranscriptBuffer();
    let stable='',partial='',duplicateViolations=0,duplicateStableDeltas=0;
    let firstStopVisibilityViolations=0,plainVsInjectedMismatches=0;
    let minEnd=Infinity,maxEnd=0,previousEnd=-1;
    for(let index=0;index<windows.length;index++){
      const item=windows[index];
      const text=item.text??item.hypothesis??item.raw_text;
      const start=item.window_start_sample??item.windowStart??item.window_start;
      const end=item.window_end_sample??item.windowEnd??item.window_end;
      if(typeof text!=='string'||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
        start<0||end<=start||end<previousEnd){
        throw Error('Invalid/out-of-order window at index '+index+' (start/end must be 16kHz sample positions)');
      }
      previousEnd=end;minEnd=Math.min(minEnd,end);maxEnd=Math.max(maxEnd,end);
      // Retain the input's final flag: some real replay fixtures already
      // include a final update from a normal stop at the end of the file.
      const final=item.final===true;
      const response=reducer.update(text,start,end,final);
      const expected=plain.update(text,start,end,final);
      if(response.stable_delta!==expected.stable_delta ||
         response.partial_text!==expected.partial_text)plainVsInjectedMismatches++;
      if(response.stable_delta)stable=[stable,response.stable_delta].filter(Boolean).join(' ');
      partial=response.partial_text;
      const before=[stable,partial].filter(Boolean).join(' ');
      // A stop at ANY earlier prefix must commit the exact words displayed
      // immediately before stop. This caught 16/11 real-cache regressions in
      // the previous PR review that a second-flush-only test missed.
      const checkpoint=Object.assign(new TranscriptBuffer(),structuredClone({...reducer}));
      const stop=checkpoint.flush();
      const atStop=[stable,stop.stable_delta,stop.partial_text].filter(Boolean).join(' ');
      if(atStop!==before)firstStopVisibilityViolations++;
      // No new audio. Non-final replay should have zero text/state effect.
      if(!final){
        const repeated=reducer.update(text,start,end);
        if(repeated.stable_delta)duplicateStableDeltas++;
        const after=[stable,repeated.partial_text].filter(Boolean).join(' ');
        if(repeated.stable_delta || after!==before)duplicateViolations++;
        partial=repeated.partial_text;
      }
    }
    const finished=reducer.flush();
    const plainFinished=plain.flush();
    if(finished.stable_delta!==plainFinished.stable_delta ||
       finished.partial_text!==plainFinished.partial_text)plainVsInjectedMismatches++;
    if(finished.stable_delta)stable=[stable,finished.stable_delta].filter(Boolean).join(' ');
    partial=finished.partial_text;
    const once=[stable,partial].filter(Boolean).join(' ');
    const again=reducer.flush();
    const flushIdempotent=!again.stable_delta&&!again.partial_text;
    const result={
      inputWindows:windows.length,
      audioStartEndSamples:{firstEnd:minEnd,lastEnd:maxEnd},
      sameRangeReplayViolations:duplicateViolations,
      sameRangeReplayStableDeltas:duplicateStableDeltas,
      firstStopVisibilityViolations,
      plainVsInjectedMismatches,
      doubleFlushSafe:flushIdempotent,
      finalWordCount:once.trim()?once.trim().split(/\s+/u).length:0,
      // These are diagnostic risk counters, NOT proof of dropped words.
      // Real speech can be lexically indistinguishable from an ASR rewrite.
      ambiguousCandidateReplacements:reducer.unanchoredReplacementCount,
      ambiguousCandidateTokens:reducer.unanchoredReplacementTokens,
      note:'No raw transcripts or API keys were printed. Ambiguous replacements are risk signals, not measured word loss or WER; review private audio/window evidence.'
    };
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(duplicateViolations||duplicateStableDeltas||firstStopVisibilityViolations||
       plainVsInjectedMismatches||!flushIdempotent)process.exitCode=1;
  }catch(e){console.error('Local private replay failed:',e.message);process.exitCode=1;}
}
