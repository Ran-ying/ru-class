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
    let stable='',partial='',duplicateViolations=0,duplicateStableDeltas=0;
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
      const response=reducer.update(text,start,end);
      if(response.stable_delta)stable=[stable,response.stable_delta].filter(Boolean).join(' ');
      partial=response.partial_text;
      const before=[stable,partial].filter(Boolean).join(' ');
      // This is the exact same-range replay control from the user's report:
      // ZERO new audio, same text, same start/end.
      const repeated=reducer.update(text,start,end);
      if(repeated.stable_delta)duplicateStableDeltas++;
      const after=[stable, repeated.partial_text].filter(Boolean).join(' ');
      if(repeated.stable_delta || after!==before)duplicateViolations++;
      partial=repeated.partial_text;
    }
    const finished=reducer.flush();
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
      doubleFlushSafe:flushIdempotent,
      finalWordCount:once.trim()?once.trim().split(/\s+/u).length:0,
      note:'No raw transcripts or API keys were printed. This does not measure WER or prove real-audio fidelity.'
    };
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(duplicateViolations||!flushIdempotent)process.exitCode=1;
  }catch(e){console.error('Local private replay failed:',e.message);process.exitCode=1;}
}
