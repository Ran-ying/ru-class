import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
// @ts-ignore: isolated JS CLI experiment.
import {analyzeTimeRegions} from '../scripts/audit-candidate-time-regions.mjs';
// @ts-ignore: production audio reader is plain JS.
import {openWave} from '../scripts/audit-private-audio.mjs';

const S=16000;
const windows=[
  {text:'Первый раздел лекции подробно',start:0,end:8*S},
  {text:'Совершенно новая отдельная мысль',start:S,end:9*S},
  {text:'Непохожее продолжение другой темы',start:2*S,end:10*S},
  {text:'Совершенно новая отдельная мысль продолжается',start:3*S,end:11*S},
  {text:'И наконец другие предметы лекции сегодня',start:4*S,end:12*S,final:true}
];
function wavBytes(sampleCount:number){
  const b=Buffer.alloc(44+sampleCount*2);
  b.write('RIFF',0,'ascii');b.writeUInt32LE(36+sampleCount*2,4);b.write('WAVE',8,'ascii');
  b.write('fmt ',12,'ascii');b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(S,24);b.writeUInt32LE(2*S,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write('data',36,'ascii');b.writeUInt32LE(sampleCount*2,40);
  // A one-second non-speech sine tone, not a fabricated Russian utterance.
  for(let i=4*S;i<5*S;i++){
    b.writeInt16LE(Math.round(10000*Math.sin(2*Math.PI*300*(i/S))),44+i*2);
  }
  return b;
}
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'p1-time-private-'));
  const audio=join(dir,'private.wav');
  const evidence=join(dir,'private-review.json');
  const cross=join(dir,'cross-asr-private.json');
  const windowFile=join(dir,'windows.json');
  const bytes=wavBytes(12*S);
  writeFileSync(audio,bytes);
  const sha=createHash('sha256').update(bytes).digest('hex');
  const review={
    format:'ru-class-private-p1-review-v1',
    focused_window_index:2,
    clip_start_sample:0,
    clip_end_sample:12*S,
    neighbors:windows.map((w,index)=>({
      index,text:w.text,window_start_sample:w.start,window_end_sample:w.end,final:w.final===true
    }))
  };
  writeFileSync(evidence,JSON.stringify(review));
  const payload={
    format:'ru-class-p1-dashscope-cross-asr-private-v1',
    cases:[{case:'C1 #2',
      input:{focused_window_start_sample:windows[2].start,
        focused_window_end_sample:windows[2].end,
        clip_start_sample:0,clip_end_sample:12*S,
        wav_sha256:sha,sample_rate:S},
      original_whisper_focused_window:windows[2].text,
      independent_dashscope_qwen3_asr:{
        focused_8s_text:'Совершенно новая отдельная мысль',
        context_text:'Совершенно новая отдельная мысль в лекции',
        focused_language:'ru',context_language:'ru',
        focused_finish_reason:'stop',context_finish_reason:'stop'}
    }]
  };
  writeFileSync(cross,JSON.stringify(payload));
  writeFileSync(windowFile,JSON.stringify(windows.map(w=>({
    text:w.text,window_start_sample:w.start,window_end_sample:w.end,final:w.final===true
  }))));
  return {dir,audio,evidence,cross,windowFile,sha,payload,review};
}
test('rejects forged WAV identity and mismatched private review coordinates',()=>{
  const f=fixture();
  try{
    const reader=openWave(f.audio);
    try{
      assert.throws(()=>analyzeTimeRegions(windows,f.cross,f.evidence,
        reader,'0'.repeat(64),'C1',2),/CLIP_CROSS_ASR_SOURCE_MISMATCH/);
      f.review.neighbors[2].text='forged hypothesis';
      writeFileSync(f.evidence,JSON.stringify(f.review));
      assert.throws(()=>analyzeTimeRegions(windows,f.cross,f.evidence,
        reader,f.sha,'C1',2),/REVIEW_NEIGHBOR_MISMATCH/);
    }finally{reader.close();}
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('audio review is window-bound, read-only and cannot invent word timestamps',()=>{
  const f=fixture();
  try{
    const reader=openWave(f.audio);
    try{
      const report=analyzeTimeRegions(windows,f.cross,f.evidence,reader,f.sha,'C1',2);
      assert.equal(report.focus.index,2);
      assert.equal(report.focus.sourceWindowIndex,1);
      assert.equal(report.focus.candidateWords,4);
      assert.equal(report.evidence.localAudioSha256Verified,true);
      assert.equal(report.status,'UNVERIFIED_WORD_TIME_AND_SPEECH');
      assert.equal(report.verifiedWordTimeIntervals,0);
      assert.equal(report.restoredSpokenWords,0);
      assert.equal(report.productionChanged,false);
      assert.ok(Array.isArray(report.conditionalRegions));
      for(const item of report.conditionalRegions){
        assert.ok(item.laterWindowIndex===3||item.laterWindowIndex===4);
        const interval=item.conditionalSameOccurrenceWindowIntersection;
        if(interval){
          assert.ok(interval.startSample>=S);
          assert.ok(interval.endSample<=9*S,
            'a candidate phrase cannot be assigned outside original source window');
          assert.ok(item.acousticActivityByThreshold.every(
            (x:{segments:{startSample:number,endSample:number}[]})=>
              x.segments.every(y=>y.startSample>=interval.startSample&&
                y.endSample<=interval.endSample)));
        }
      }
      assert.doesNotMatch(JSON.stringify(report),/Совершенно|Непохожее|лекции/);
    }finally{reader.close();}
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('CLI private numeric output and invalid input errors never reveal raw private data',()=>{
  const f=fixture();
  try{
    const cmd=['scripts/audit-candidate-time-regions.mjs',
      '--windows',f.windowFile,'--cross-asr',f.cross,
      '--clip',f.audio,'--clip-evidence',f.evidence,'--case','C1','--index','2'];
    const good=spawnSync(process.execPath,cmd,{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(good.status,0,good.stderr);
    const data=JSON.parse(good.stdout);
    assert.equal(data.focus.index,2);
    assert.doesNotMatch(good.stdout+good.stderr,
      /Совершенно|Непохожее|private-review|p1-time-private|cross-asr-private|lectures/);
    const bad=spawnSync(process.execPath,[...cmd.slice(0,-1),'999'],
      {cwd:process.cwd(),encoding:'utf8'});
    assert.equal(bad.status,1);
    assert.doesNotMatch(bad.stderr,/p1-time-private|Совершенно|private.wav/);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
