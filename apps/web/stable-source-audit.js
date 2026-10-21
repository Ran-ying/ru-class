/**
 * Privacy-safe v0.3 verification of one exported raw-ASR journal plus its
 * optional stable-unit projection. NEVER return speech text or raw hashes.
 * This replays the SAME TranscriptBuffer implementation used in Safari.
 */
import {TranscriptBuffer} from './transcript.js';
import {StableUnitJournal,RATE} from './stable-units.js';
import {captionProjectionText,captionProjectionSegments} from './asr-hallucination.js';

export function auditStableSourceExport(input){
  const windows=input?.windows;
  if(!Array.isArray(windows)||!windows.length)throw Error('INVALID_SOURCE_WINDOWS');
  if(input?.sample_rate!==RATE)throw Error('UNSUPPORTED_SOURCE_SAMPLE_RATE');
  const metadata=input?.metadata||{};
  const units=input?.source_units;
  const hasUnits=Array.isArray(units);
  if(units!==undefined&&!hasUnits)throw Error('INVALID_SOURCE_UNITS');
  const recording=input?.recording;
  if(hasUnits&&(!recording||typeof recording.recording_id!=='string'||
    !recording.recording_id||typeof recording.classroom_id!=='string'||
    !recording.classroom_id))throw Error('INVALID_RECORDING_IDENTITY');

  const transcript=new TranscriptBuffer();
  const journal=hasUnits?new StableUnitJournal({
    recordingId:recording.recording_id,
    classroomId:recording.classroom_id,
    startedAt:Number.isFinite(recording.started_at_ms)?recording.started_at_ms:0
  }):null;
  let previousEnd=-1,invalidWindows=0,finalCount=0;
  for(const row of windows){
    const start=row?.window_start_sample,end=row?.window_end_sample;
    if(typeof row.text!=='string'||!Number.isSafeInteger(start)||
      !Number.isSafeInteger(end)||start<0||end<=start||
      end<previousEnd){invalidWindows++;continue;}
    // Fail rather than claim valid projection if the source is corrupted.
    if(invalidWindows)break;
    previousEnd=end;
    if(row.final===true)finalCount++;
    if(finalCount>1)throw Error('MULTIPLE_FINAL_SOURCE_WINDOWS');
    // Same caption input as the browser: credit filter and v0.6 segments.
    const update=transcript.update(captionProjectionText(row.text),start,end,row.final===true,
      captionProjectionSegments(row.segments));
    if(journal)journal.add({
      ...update,window_start_sample:start,window_end_sample:end,final:row.final===true
    });
  }
  if(invalidWindows)throw Error('INVALID_SOURCE_WINDOW_ORDER');
  // When final fetch is already covered by last rolling window, the runtime
  // emits only a synthetic flush update and NO additional raw ASR record.
  if(!finalCount){
    const last=windows.at(-1);
    const stop=transcript.flush();
    if(journal)journal.add({...stop,
      window_start_sample:last.window_start_sample,
      window_end_sample:last.window_end_sample,final:true
    });
  }
  const expected=journal?.export()||[];
  const sourceWindowEnds=new Set(windows.map(row=>row.window_end_sample));
  const compared=Math.max(expected.length,hasUnits?units.length:0);
  let textMismatches=0,provenanceMismatches=0,identityMismatches=0;
  let confirmationEpoch=null,estimatedClockMismatches=0;
  for(let i=0;i<compared;i++){
    const want=expected[i],have=units?.[i];
    if(!want||!have){provenanceMismatches++;continue;}
    if(have.text!==want.text)textMismatches++;
    if(have.id!==want.id||have.ordinal!==i||
       have.recordingId!==recording.recording_id||
       have.classroomId!==recording.classroom_id)identityMismatches++;
    if(have.sourceWindowStartSample!==want.sourceWindowStartSample||
       have.confirmedWindowEndSample!==want.confirmedWindowEndSample||
       !sourceWindowEnds.has(have.confirmedWindowEndSample)||
       have.state!=='stable'||have.speechStartSample!==want.speechStartSample||
       have.speechEndSample!==want.speechEndSample)provenanceMismatches++;
    if(have.timeBasis!=='estimated_capture_epoch_plus_confirmation_window_end'||
       !Number.isFinite(have.estimatedConfirmationWallTimeMs)){
      estimatedClockMismatches++;
    }else{
      const derivedEpoch=have.estimatedConfirmationWallTimeMs-
        have.confirmedWindowEndSample/RATE*1000;
      if(confirmationEpoch===null)confirmationEpoch=derivedEpoch;
      else if(Math.abs(confirmationEpoch-derivedEpoch)>1)
        estimatedClockMismatches++;
    }
  }
  const issues=textMismatches+provenanceMismatches+
    identityMismatches+estimatedClockMismatches;
  return {
    inputWindows:windows.length,
    lastWindowEndSample:previousEnd,
    status:!hasUnits?'legacy_no_source_units':
      issues?'source_unit_mismatch':
      metadata.status==='complete'?'source_units_replay_match':'source_units_match_incomplete_session',
    storedUnits:hasUnits?units.length:null,
    replayedUnits:hasUnits?expected.length:null,
    stableTextMismatches:textMismatches,
    identityMismatches,
    provenanceMismatches,
    estimatedClockMismatches,
    finalFromProvider:finalCount===1,
    note:'Numerical audit only. No speech text, credentials, paths or inferred word timestamps are printed. Replay match is not WER.'
  };
}
