import {StableUnitJournal} from './stable-units.js';

/**
 * The browser may be reloaded after model output has been durably saved.
 * Only remove a verified WHOLE stable-unit prefix; never use loose lexical
 * matching to remove repeated speech or discard unconfirmed ASR draft.
 */
export function pendingTranscriptAfterCommits(recording,rows){
  const raw=typeof recording?.transcript==='string'?recording.transcript:'';
  if(!rows?.length||!Array.isArray(recording?.stableUnits))return raw;
  let cursor=0,lastGroup='',rowIndex=0;
  for(const row of rows){
    if(row?.recordingId!==recording.id||row?.classroomId!==recording.classroomId||
       row.index!==rowIndex++||!Array.isArray(row.consumedUnitIds))return raw;
    const key=JSON.stringify(row.consumedUnitIds);
    if(key===lastGroup)continue; // multiple sentence pairs from one response
    if(!row.consumedUnitIds.length)return raw;
    const batch=recording.stableUnits.slice(cursor,cursor+row.consumedUnitIds.length);
    if(batch.length!==row.consumedUnitIds.length||
       batch.some((unit,i)=>unit.id!==row.consumedUnitIds[i])||
       row.sourcePrefix!==batch.map(unit=>unit.text).join(' '))return raw;
    cursor+=batch.length;lastGroup=key;
  }
  if(!cursor)return raw;
  const consumed=recording.stableUnits.slice(0,cursor).map(unit=>unit.text).join(' ');
  if(raw===consumed)return '';
  if(raw.startsWith(consumed+' '))return raw.slice(consumed.length+1);
  return raw; // uncertain prefix: retain complete source instead of losing it
}

/**
 * Restore only a COMPLETED recording and its already committed bilingual
 * sentence rows. Do not fabricate final flush for interrupted recordings.
 * All source units and provider output remain private in the browser.
 */
export function restoreTranslationProgress(recording,sentenceRows){
  if(recording?.outcome!=='completed'||typeof recording.id!=='string'||
     !recording.id||typeof recording.classroomId!=='string'||
     !recording.classroomId||!Array.isArray(recording.stableUnits)||
     !Number.isFinite(recording.startedAt)||!Array.isArray(sentenceRows))
    throw Error('TRANSLATION_RECOVERY_UNAVAILABLE');
  const journal=new StableUnitJournal({
    classroomId:recording.classroomId,recordingId:recording.id,
    startedAt:recording.startedAt
  });
  let previousEnd=-1;
  for(let i=0;i<recording.stableUnits.length;i++){
    const u=recording.stableUnits[i];
    if(u?.id!==recording.id+':'+i||u?.ordinal!==i||
       u?.recordingId!==recording.id||
       u?.classroomId!==recording.classroomId||
       u?.state!=='stable'||typeof u.text!=='string'||!u.text.trim()||
       !Number.isSafeInteger(u.sourceWindowStartSample)||
       !Number.isSafeInteger(u.confirmedWindowEndSample)||
       u.sourceWindowStartSample<0||
       u.confirmedWindowEndSample<u.sourceWindowStartSample||
       u.confirmedWindowEndSample<previousEnd)
      throw Error('TRANSLATION_SOURCE_INVALID');
    previousEnd=u.confirmedWindowEndSample;
    journal.units.push({...u});
  }
  journal.lastWindowEnd=Math.max(0,previousEnd);
  journal.finalized=true;
  let offset=0,index=0;
  while(offset<sentenceRows.length){
    const first=sentenceRows[offset];
    if(first?.index!==index||first.recordingId!==recording.id||
       first.classroomId!==recording.classroomId||
       !Array.isArray(first.consumedUnitIds)||!first.consumedUnitIds.length||
       typeof first.sourcePrefix!=='string')
      throw Error('TRANSLATION_HISTORY_INVALID');
    const ids=first.consumedUnitIds;
    const pending=journal.units.filter(u=>!journal.delivered.has(u.id));
    if(ids.length>pending.length||
       ids.some((id,i)=>id!==pending[i].id)||
       first.sourcePrefix!==pending.slice(0,ids.length).map(u=>u.text).join(' '))
      throw Error('TRANSLATION_HISTORY_INVALID');
    // One provider reply may generate several RU/ZH sentence rows. They all
    // bear the same consumed IDs and source prefix, with sequential indices.
    while(offset<sentenceRows.length){
      const row=sentenceRows[offset];
      if(row.index!==index||row.recordingId!==recording.id||
         row.classroomId!==recording.classroomId)
        throw Error('TRANSLATION_HISTORY_INVALID');
      if(row.consumedUnitIds.join('|')!==ids.join('|')||
         row.sourcePrefix!==first.sourcePrefix)break;
      offset++;index++;
    }
    journal.acknowledge(ids);
  }
  return {journal,nextIndex:index,remainingUnits:journal.ready().length};
}
