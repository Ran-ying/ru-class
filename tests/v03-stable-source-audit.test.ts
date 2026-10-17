import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-ignore Browser ESM JavaScript intentionally has no TypeScript declarations.
import {TranscriptBuffer} from '../apps/web/transcript.js';
// @ts-ignore
import {StableUnitJournal} from '../apps/web/stable-units.js';
// @ts-ignore
import {auditStableSourceExport} from '../apps/web/stable-source-audit.js';

const WINDOW_A={
  text:'Сегодня рассматриваем методы защиты информации',
  window_start_sample:0,window_end_sample:32000,final:false,inference_ms:125
};
const WINDOW_B={
  text:'рассматриваем методы защиты информации в лаборатории',
  window_start_sample:16000,window_end_sample:48000,final:false,inference_ms:150
};
function makeExport(finalFromProvider=false){
  const windows=[{...WINDOW_A},{...WINDOW_B,final:finalFromProvider}];
  const recording={recording_id:'recording-a',classroom_id:'class-a',started_at_ms:1780000000000};
  const reducer=new TranscriptBuffer();
  const journal=new StableUnitJournal({
    classroomId:recording.classroom_id,recordingId:recording.recording_id,
    startedAt:recording.started_at_ms
  });
  for(const w of windows){
    const update=reducer.update(w.text,w.window_start_sample,w.window_end_sample,w.final);
    journal.add({...update,window_start_sample:w.window_start_sample,
      window_end_sample:w.window_end_sample,final:w.final});
  }
  if(!finalFromProvider){
    const flush=reducer.flush();
    journal.add({...flush,window_start_sample:WINDOW_B.window_start_sample,
      window_end_sample:WINDOW_B.window_end_sample,final:true});
  }
  return {
    format:'ru-class-asr-windows-v1',sample_rate:16000,
    metadata:{status:'complete',receivedCount:2,savedCount:2,frameCount:48000},
    recording,source_units:journal.export(),windows
  };
}
test('replay checks every retained stable delta from genuine TranscriptBuffer while hiding text',()=>{
  for(const finalProvider of [false,true]){
    const source=makeExport(finalProvider);
    const result=auditStableSourceExport(source);
    assert.equal(result.status,'source_units_replay_match');
    assert.equal(result.inputWindows,2);
    assert.equal(result.replayedUnits,source.source_units.length);
    assert.equal(result.stableTextMismatches,0);
    assert.equal(result.provenanceMismatches,0);
    assert.equal(result.identityMismatches,0);
    assert.equal(result.estimatedClockMismatches,0);
    assert.equal(result.finalFromProvider,finalProvider);
    assert.ok(!JSON.stringify(result).includes('Сегодня'));
    assert.ok(!JSON.stringify(result).includes('лаборатории'));
  }
});
test('fake word timing and altered source window positions are NOT treated as accepted provenance',()=>{
  const data=makeExport();
  assert.ok(data.source_units.length>0);
  data.source_units[0].speechStartSample=1;
  assert.equal(auditStableSourceExport(data).status,'source_unit_mismatch');
  data.source_units[0].speechStartSample=null;
  data.source_units[0].confirmedWindowEndSample=999999;
  assert.ok(auditStableSourceExport(data).provenanceMismatches>0);
});
test('source text, stable order and session identity tampering are caught independently',()=>{
  const data=makeExport(true);
  assert.ok(data.source_units.length>0);
  data.source_units[0].text='Поправленный текст';
  assert.equal(auditStableSourceExport(data).stableTextMismatches,1);
  data.source_units[0].text=makeExport(true).source_units[0].text;
  data.source_units[0].id='someone-else:0';
  assert.equal(auditStableSourceExport(data).identityMismatches,1);
  data.source_units[0].id='recording-a:0';
  data.source_units[0].estimatedConfirmationWallTimeMs+=1500;
  assert.ok(auditStableSourceExport(data).estimatedClockMismatches<=1);
});
test('legacy files are correctly reported unverified rather than inventing stable units',()=>{
  const data=makeExport();
  delete (data as any).source_units;
  delete (data as any).recording;
  const result=auditStableSourceExport(data);
  assert.equal(result.status,'legacy_no_source_units');
  assert.equal(result.storedUnits,null);
  assert.equal(result.replayedUnits,null);
});
test('incomplete recordings never get a full-session replay PASS label',()=>{
  const data=makeExport();
  data.metadata.status='incomplete';
  assert.equal(auditStableSourceExport(data).status,'source_units_match_incomplete_session');
});
test('source frames out of order or malformed are refused before projection comparison',()=>{
  const data=makeExport();
  const changed=structuredClone(data);
  changed.windows[1].window_end_sample=changed.windows[0].window_end_sample-1;
  assert.throws(()=>auditStableSourceExport(changed),/INVALID_SOURCE_WINDOW_ORDER/);
  changed.windows[1].window_end_sample=48000;
  changed.sample_rate=8000;
  assert.throws(()=>auditStableSourceExport(changed),/UNSUPPORTED_SOURCE_SAMPLE_RATE/);
});
test('switching classrooms clears stale live subtitles before async IndexedDB finishes',()=>{
  const code=readFileSync('apps/web/app.js','utf8');
  const start=code.indexOf('async function renderSelectedClassroom(');
  const fetch=code.indexOf('const sessions=await listClassroomRecordings(key);',start);
  const clear=code.indexOf("if(selectedKey!==renderedClassroomKey){",start);
  assert.ok(start>=0&&clear>start&&clear<fetch);
  assert.ok(code.slice(clear,fetch).includes("stable='';draft='';renderCaption();"));
});
test('eight-second cut-off cannot be bypassed with a forged external finalized/clock override',()=>{
  const j=new StableUnitJournal({
    classroomId:'class-a',recordingId:'session-a',startedAt:1780000000000
  });
  j.add({stable_delta:'Это уже подтверждено',window_start_sample:0,
    window_end_sample:32000,final:false});
  // Callers MUST NOT be able to accelerate the watermark by fake options.
  assert.deepEqual(j.ready({finalized:true,currentEndSample:1000000}),[]);
  j.add({stable_delta:'',window_start_sample:32000,window_end_sample:160000,final:false});
  assert.deepEqual(j.ready().map((u:any)=>u.id),['session-a:0']);
});
