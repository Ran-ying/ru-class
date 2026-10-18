import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser modules intentionally have no JS declarations.
import {StableUnitJournal,RATE} from '../apps/web/stable-units.js';
// @ts-ignore
import {restoreTranslationProgress,pendingTranscriptAfterCommits} from '../apps/web/translation-recovery.js';
import {readFileSync} from 'node:fs';

function saved(){
  const journal=new StableUnitJournal({
    classroomId:'class-1',recordingId:'recording-1',startedAt:1780000000000
  });
  for(const [index,text] of ['Первая фраза','Первая фраза','Третья фраза'].entries())
    journal.add({stable_delta:text,window_start_sample:index*RATE,
      window_end_sample:(index+8)*RATE,final:index===2});
  return {id:'recording-1',classroomId:'class-1',
    startedAt:1780000000000,outcome:'completed',stableUnits:journal.export()};
}
function acceptedRows(){
  const input=saved().stableUnits;
  const ids=input.slice(0,2).map((u:any)=>u.id);
  const source=input.slice(0,2).map((u:any)=>u.text).join(' ');
  return [
    {index:0,recordingId:'recording-1',classroomId:'class-1',
      sourcePrefix:source,consumedUnitIds:ids,ru:'Первая фраза.',zh:'第一句。'},
    {index:1,recordingId:'recording-1',classroomId:'class-1',
      sourcePrefix:source,consumedUnitIds:ids,ru:'Первая фраза.',zh:'第二句。'}
  ];
}
test('v0.4 recovery marks durable consumed units and resumes only unprocessed UUIDs',()=>{
  const restored=restoreTranslationProgress(saved(),acceptedRows());
  assert.equal(restored.nextIndex,2);
  assert.equal(restored.remainingUnits,1);
  assert.deepEqual(restored.journal.ready().map((u:any)=>u.id),['recording-1:2']);
  assert.equal(restored.journal.finalized,true);
});
test('legitimate repeated identical Russian speech is not deduplicated by lexical equality',()=>{
  const source=saved();
  const rows=[{...acceptedRows()[0],sourcePrefix:source.stableUnits[0].text,
    consumedUnitIds:[source.stableUnits[0].id]}];
  const resumed=restoreTranslationProgress(source,rows);
  assert.deepEqual(resumed.journal.ready().map((u:any)=>u.id),['recording-1:1','recording-1:2']);
});
test('completed source with no prior translation has all source units eligible',()=>{
  assert.equal(restoreTranslationProgress(saved(),[]).remainingUnits,3);
});
test('completed source with all units consumed never triggers a duplicate paid request',()=>{
  const recording=saved(),rows=acceptedRows();
  rows.push({
    index:2,recordingId:'recording-1',classroomId:'class-1',
    sourcePrefix:recording.stableUnits[2].text,
    consumedUnitIds:['recording-1:2'],ru:'Третья фраза.',zh:'第三句。'
  });
  const restored=restoreTranslationProgress(recording,rows);
  assert.equal(restored.remainingUnits,0);
  assert.equal(restored.nextIndex,3);
});
test('refuse interrupted/unfinalized or mismatched evidence instead of fabricating stable source',()=>{
  const recording=saved();
  assert.throws(()=>restoreTranslationProgress({...recording,outcome:'interrupted'},[]),/TRANSLATION_RECOVERY_UNAVAILABLE/);
  assert.throws(()=>restoreTranslationProgress({...recording,stableUnits:null},[]),/TRANSLATION_RECOVERY_UNAVAILABLE/);
  assert.throws(()=>restoreTranslationProgress(recording,[{...acceptedRows()[0],
    sourcePrefix:'invented'}]),/TRANSLATION_HISTORY_INVALID/);
  assert.throws(()=>restoreTranslationProgress(recording,[{...acceptedRows()[0],
    consumedUnitIds:['recording-1:1']}]),/TRANSLATION_HISTORY_INVALID/);
});
test('recovery is an explicit user control, not automatic on page load',()=>{
  const code=readFileSync('apps/web/app.js','utf8');
  assert.match(code,/retryButton.textContent='恢复未完成翻译'/);
  assert.match(code,/retryButton.onclick=\(\)=>void retrySavedRecordingTranslation\(item\)/);
  assert.match(code,/if\(!remainingUnits\)/);
  assert.match(code,/worker.nextIndex=nextIndex/);
  assert.doesNotMatch(code.slice(code.lastIndexOf('try{profiles=')),/retrySavedRecordingTranslation/);
});

// Static render projection is conservative: it removes only verified prefix
// unit IDs, and does not delete a legitimate repeated later utterance.
test('reloaded caption shows only pending text after durable bilingual commit',()=>{
  const session=saved();
  session.transcript='Первая фраза Первая фраза Третья фраза';
  const rows=[{...acceptedRows()[0],sourcePrefix:'Первая фраза',
    consumedUnitIds:['recording-1:0']}];
  assert.equal(pendingTranscriptAfterCommits(session,rows),
    'Первая фраза Третья фраза');
  assert.equal(pendingTranscriptAfterCommits(session,[]),session.transcript);
  const first={...acceptedRows()[0]};
  assert.equal(pendingTranscriptAfterCommits(session,[first,acceptedRows()[1]]),
    'Третья фраза');
  const all=[first,acceptedRows()[1],{
    index:2,recordingId:'recording-1',classroomId:'class-1',
    sourcePrefix:'Третья фраза',consumedUnitIds:['recording-1:2'],
    ru:'Третья фраза.',zh:'第三句。'
  }];
  assert.equal(pendingTranscriptAfterCommits(session,all),'');
});
test('unknown or forged consumption never removes original transcript on reload',()=>{
  const session=saved();
  session.transcript='Первая фраза Первая фраза Третья фраза';
  const first=acceptedRows()[0];
  assert.equal(pendingTranscriptAfterCommits(session,[{...first,sourcePrefix:'wrong'}]),
    session.transcript);
  assert.equal(pendingTranscriptAfterCommits(session,[{...first,
    consumedUnitIds:['recording-1:1']}]),session.transcript);
  assert.equal(pendingTranscriptAfterCommits({...session,transcript:'Неожиданная поправка'},[first]),
    'Неожиданная поправка');
  assert.equal(pendingTranscriptAfterCommits(session,[]),session.transcript);
});
