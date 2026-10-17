#!/usr/bin/env node
/**
 * Offline P1 forensic aid: combine *private* 16-kHz PCM16 WAV and saved
 * Whisper-window hypotheses. Emits no recognized text or audio on stdout.
 * Does NOT infer actual words from energy; no caption decisions are changed.
 *
 * Usage: node scripts/audit-private-audio.mjs --wav /private/class.wav \
 *   --windows /private/C1.json --indices 30,120 \
 *   --output-dir /private/new-review-directory [--threshold 0.02]
 */
import {openSync, closeSync, fstatSync, readSync, readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {wavHeader} from '../apps/web/local-store.js';

const RATE=16000;
const FRAME=320; // 20 ms; threshold is RMS on normalized PCM16 samples.
const MIN_RUN=4; // 80 ms of consecutive energy above threshold.
const REVIEW_PADDING=2*RATE;

function ensure(test,code){if(!test)throw Error(code);}
function readAt(fd,count,position){
  const out=Buffer.alloc(count);
  let off=0;
  while(off<count){const n=readSync(fd,out,off,count-off,position+off);if(n<=0)throw Error('INVALID_OR_TRUNCATED_WAV');off+=n;}
  return out;
}
export function openWave(path){
  const fd=openSync(path,'r');
  try{
    const size=fstatSync(fd).size;
    ensure(size>=44,'INVALID_WAV_HEADER');
    const header=readAt(fd,12,0);
    ensure(header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WAVE','INVALID_WAV_HEADER');
    const riffEnd=8+header.readUInt32LE(4);
    ensure(riffEnd<=size,'INVALID_WAV_RIFF_LENGTH');
    let position=12,format=false,dataOffset=-1,dataBytes=0;
    while(position+8<=riffEnd){
      const chunk=readAt(fd,8,position),length=chunk.readUInt32LE(4);
      const start=position+8;
      ensure(start+length<=riffEnd,'INVALID_WAV_CHUNK_LENGTH');
      const kind=chunk.toString('ascii',0,4);
      if(kind==='fmt '){
        ensure(!format&&length>=16,'INVALID_WAV_FORMAT');
        const fmt=readAt(fd,16,start);
        ensure(fmt.readUInt16LE(0)===1&&fmt.readUInt16LE(2)===1&&
          fmt.readUInt32LE(4)===RATE&&fmt.readUInt32LE(8)===RATE*2&&
          fmt.readUInt16LE(12)===2&&fmt.readUInt16LE(14)===16,
          'WAV_MUST_BE_16KHZ_MONO_PCM16');
        format=true;
      }
      if(kind==='data'){
        ensure(dataOffset<0&&length>0&&length%2===0,'INVALID_WAV_DATA');
        dataOffset=start;dataBytes=length;
      }
      position=start+length+(length%2);
    }
    ensure(format&&dataOffset>=0,'INVALID_WAV_FORMAT_OR_DATA');
    return {fd,frames:dataBytes/2,dataOffset,sampleRate:RATE,close(){closeSync(fd);},
      read(start,end){
        ensure(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end<=dataBytes/2,'INVALID_AUDIO_RANGE');
        return readAt(fd,(end-start)*2,dataOffset+start*2);
      }};
  }catch(e){closeSync(fd);throw e;}
}

export function loadWindows(path){
  const raw=readFileSync(path,'utf8');
  let json;
  try{json=JSON.parse(raw);}catch{
    json=raw.split(/\r?\n/u).filter(x=>x.trim()).map(line=>JSON.parse(line));
  }
  const entries=Array.isArray(json)?json:json?.windows??json?.updates;
  ensure(Array.isArray(entries)&&entries.length>0&&entries.length<=200000,'INVALID_WINDOWS_COLLECTION');
  let lastEnd=-1;
  return entries.map((x,index)=>{
    const text=x.text??x.hypothesis??x.raw_text??x.raw_hypothesis_text;
    const start=x.window_start_sample??x.windowStart??x.window_start??x.startSample;
    const end=x.window_end_sample??x.windowEnd??x.window_end??x.endSample;
    ensure(typeof text==='string'&&text.length<=20000&&Number.isSafeInteger(start)&&
      Number.isSafeInteger(end)&&start>=0&&end>start&&end>=lastEnd,'INVALID_WINDOW_'+index);
    lastEnd=end;
    return {index,text,start,end,final:x.final===true};
  });
}

function rmsStats(pcm,threshold=0.02){
  ensure(Number.isFinite(threshold)&&threshold>0&&threshold<1,'INVALID_THRESHOLD');
  const frames=Math.floor(pcm.length/2/FRAME);
  let maxRun=0,run=0,activeFrames=0,maxRms=0;
  for(let frame=0;frame<frames;frame++){
    let sumSq=0;
    for(let i=0;i<FRAME;i++){
      const sample=pcm.readInt16LE(2*(frame*FRAME+i))/32768;
      sumSq+=sample*sample;
    }
    const rms=Math.sqrt(sumSq/FRAME);
    maxRms=Math.max(maxRms,rms);
    if(rms>=threshold){run++;activeFrames++;maxRun=Math.max(maxRun,run);}
    else run=0;
  }
  return {active:maxRun>=MIN_RUN,maxRunMs:maxRun*20,activeMs:activeFrames*20,
    maxRms:Number(maxRms.toFixed(5)),analyzedMs:frames*20};
}
export function activityInRange(wav,start,end,threshold=0.02){
  ensure(start>=0&&end<=wav.frames&&end>=start,'WINDOW_OUTSIDE_AUDIO');
  return rmsStats(wav.read(start,end),threshold);
}
function normalized(text){return text.normalize('NFKC').toLocaleLowerCase('ru-RU').trim().replace(/\s+/gu,' ');}

/**
 * Only investigate equal text emitted for overlapping windows. Strong energy
 * in BOTH exclusive intervals plus NO strong energy in the shared interval
 * provides evidence of *separated sound episodes*, not proof of two uttered
 * copies of this sentence (ASR hallucination/noise remain possible).
 */
export function probeAdjacentExactMatches(wav,windows,threshold=0.02){
  const found=[];
  for(let i=1;i<windows.length;i++){
    const a=windows[i-1],b=windows[i];
    if(normalized(a.text)!==normalized(b.text)||!normalized(a.text))continue;
    const overlapStart=Math.max(a.start,b.start),overlapEnd=Math.min(a.end,b.end);
    if(overlapEnd<=overlapStart)continue;
    const early=activityInRange(wav,a.start,overlapStart,threshold);
    const shared=activityInRange(wav,overlapStart,overlapEnd,threshold);
    const late=activityInRange(wav,overlapEnd,b.end,threshold);
    if(early.active&&late.active&&!shared.active){
      found.push({previousIndex:a.index,currentIndex:b.index,
        overlapStartSample:overlapStart,overlapEndSample:overlapEnd,
        acousticSeparationCandidate:true,early,shared,late});
    }
  }
  return found;
}

function privateReview(wav,windows,indices,outputDir,threshold){
  // Refuse existing dirs, symlink endpoints and overwrite of any private data.
  // A newly created directory is only owner-traversable; files owner-readable.
  mkdirSync(outputDir,{mode:0o700});
  const reports=[];
  for(const index of indices){
    ensure(Number.isSafeInteger(index)&&index>=0&&index<windows.length,'INVALID_REVIEW_INDEX');
    const row=windows[index];
    const clipStart=Math.max(0,row.start-REVIEW_PADDING);
    const clipEnd=Math.min(wav.frames,row.end+REVIEW_PADDING);
    const basename='review-'+String(index).padStart(4,'0');
    const pcm=wav.read(clipStart,clipEnd);
    const head=Buffer.from(wavHeader(clipEnd-clipStart));
    writeFileSync(join(outputDir,basename+'.wav'),Buffer.concat([head,pcm]),{flag:'wx',mode:0o600});
    const neighborhood=windows.slice(Math.max(0,index-2),Math.min(windows.length,index+3))
      .map(x=>({index:x.index,text:x.text,window_start_sample:x.start,
        window_end_sample:x.end,final:x.final}));
    writeFileSync(join(outputDir,basename+'-private.json'),JSON.stringify({
      format:'ru-class-private-p1-review-v1',
      // In the clip's file, input sample 0 maps to class sample clipStart.
      clip_start_sample:clipStart,clip_end_sample:clipEnd,
      focused_window_index:index,neighbors:neighborhood
    },null,2),{flag:'wx',mode:0o600});
    reports.push({index,windowStartSample:row.start,windowEndSample:row.end,
      clipStartSample:clipStart,clipEndSample:clipEnd,
      audioActivity:activityInRange(wav,row.start,row.end,threshold),
      audioFile:basename+'.wav',privateNeighborFile:basename+'-private.json'});
  }
  return reports;
}
function parseArgs(args){
  const out={};
  for(let i=0;i<args.length;i++){
    const item=args[i];
    ensure(['--wav','--windows','--indices','--output-dir','--threshold'].includes(item)&&i+1<args.length,'INVALID_ARGUMENTS');
    ensure(!(item in out),'DUPLICATE_ARGUMENT');
    out[item]=args[++i];
  }
  ensure(out['--wav']&&out['--windows'],'REQUIRED_WAV_AND_WINDOWS');
  ensure(!!out['--indices']===!!out['--output-dir'],'INDICES_AND_PRIVATE_OUTPUT_DIR_REQUIRED_TOGETHER');
  const indices=out['--indices']?.split(',').map(x=>{ensure(/^\d+$/u.test(x),'INVALID_INDICES');return Number(x);})??[];
  ensure(new Set(indices).size===indices.length&&indices.length<=50,'INVALID_INDICES');
  const threshold=out['--threshold']===undefined?0.02:Number(out['--threshold']);
  ensure(Number.isFinite(threshold)&&threshold>0&&threshold<1,'INVALID_THRESHOLD');
  return {wav:out['--wav'],windows:out['--windows'],indices,
    outputDir:out['--output-dir'],threshold};
}
export function audit({wav,wavPath,windows,indices=[],outputDir,threshold=0.02}){
  const reader=wav??openWave(wavPath);
  const ownsReader=!wav;
  try{
    ensure(windows.every(w=>w.end<=reader.frames),'WINDOW_OUTSIDE_AUDIO');
    const possible=probeAdjacentExactMatches(reader,windows,threshold);
    const review=outputDir?privateReview(reader,windows,indices,outputDir,threshold):[];
    return {format:'ru-class-private-audio-audit-v1',
      sampleRate:reader.sampleRate,audioSamples:reader.frames,
      inputWindows:windows.length,
      thresholdRms:threshold,
      separatedAcousticCandidates:possible,
      reviewed:review,
      warning:'Energy-based activity is not speech recognition or word alignment. No text/audio exported to stdout. Only locally saved private JSON contains hypotheses; do not commit.'};
  }finally{if(ownsReader)reader.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const opt=parseArgs(process.argv.slice(2));
    const windows=loadWindows(opt.windows);
    const result=audit({wavPath:opt.wav,windows,indices:opt.indices,outputDir:opt.outputDir,threshold:opt.threshold});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(e){
    // Do NOT echo filesystem paths, private text or stack traces on stdout.
    console.error('Private audio audit failed:',/^([A-Z0-9_]+|INVALID_WINDOW_\d+)$/u.test(e.message)?e.message:'CHECK_INPUT_OR_PRIVATE_OUTPUT');
    process.exitCode=1;
  }
}
