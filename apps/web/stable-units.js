/**
 * v0.3: immutable, session-scoped stable text units plus a conservative
 * four-second-after-CONFIRMATION boundary for v0.4.0 faster formal history.
 *
 * An ASR response supplies a WINDOW, not word timestamps. The sample interval
 * below is evidence provenance only; it is NOT the time a phrase was spoken.
 * Never promote pending/partial_text based on elapsed time alone.
 */
export const RATE=16000;
export const STABLE_AGE_SAMPLES=4*RATE;
// Keep every character and its order, but split ONE Whisper-confirmed delta
// at whitespace-delimited sentence punctuation. IDs stay immutable and form
// exact, whole-unit prefixes for the model and crash-safe recovery. These are
// textual boundaries only, NOT inferred audio/word timestamps.
export function splitStableSentenceUnits(text){
  if(typeof text!=='string')throw Error('INVALID_STABLE_DELTA');
  const source=text.trim();
  if(!source)return [];
  return source.split(/(?<=[.!?。！？…])\s+(?=\S)/u).filter(Boolean);
}
export function isSentenceEnd(text){
  // A trailing ellipsis marks a possibly unfinished thought; don't fast-track
  // it as a complete sentence. It may still be sent via the aged fallback.
  const tail=text.trim().replace(/["'»”）)\]]+$/u,'');
  return /[!?。！？]$/u.test(tail)||(tail.endsWith('.')&&!tail.endsWith('..'));
}
const validTime=t=>Array.isArray(t)&&Number.isSafeInteger(t[0])&&Number.isSafeInteger(t[1])&&
  t[0]>=0&&t[1]>=t[0]?[t[0],t[1]]:null;
export class StableUnitJournal{
  constructor({classroomId,recordingId,startedAt}){
    if(typeof classroomId!=='string'||!classroomId||
       typeof recordingId!=='string'||!recordingId||
       !Number.isFinite(startedAt))throw Error('INVALID_UNIT_SESSION');
    this.classroomId=classroomId;
    this.recordingId=recordingId;
    this.startedAt=startedAt;
    this.units=[];
    this.delivered=new Set();
    this.lastWindowEnd=0;
    this.finalized=false;
  }
  add(update){
    const start=update?.window_start_sample,end=update?.window_end_sample;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
      start<0||end<start||end<this.lastWindowEnd)
      throw Error('INVALID_UNIT_WINDOW');
    if(this.finalized)throw Error('UNIT_JOURNAL_FINALIZED');
    this.lastWindowEnd=end;
    const delta=update?.stable_delta;
    if(typeof delta!=='string')throw Error('INVALID_STABLE_DELTA');
    const additions=[];
    const texts=splitStableSentenceUnits(delta);
    // v0.6: per-word [start,end] samples from Whisper segments, one entry per
    // delta token. Ignore (untimed) if absent or not token-aligned.
    const times=Array.isArray(update.stable_times)&&
      update.stable_times.length===texts.reduce((n,t)=>n+t.split(/\s+/u).length,0)?
      update.stable_times:null;
    let cursor=0;
    for(const text of texts){
      const ordinal=this.units.length;
      const count=text.split(/\s+/u).length;
      const wordTimes=times?times.slice(cursor,cursor+count).map(validTime):null;
      cursor+=count;
      const timed=wordTimes?.filter(Boolean)||[];
      const unit={
        id:this.recordingId+':'+ordinal,
        classroomId:this.classroomId,
        recordingId:this.recordingId,
        ordinal,
        text,
        state:'stable',
        sourceWindowStartSample:start,
        confirmedWindowEndSample:end,
        estimatedConfirmationWallTimeMs:this.startedAt+end/RATE*1000,
        timeBasis:'estimated_capture_epoch_plus_confirmation_window_end',
        // v0.6 estimate from Whisper segment times interpolated by character
        // position; null when the provider gave no segments. Not forced alignment.
        speechStartSample:timed.length?Math.min(...timed.map(t=>t[0])):null,
        speechEndSample:timed.length?Math.max(...timed.map(t=>t[1])):null,
        ...(timed.length?{speechTimeSource:'whisper_segment_interpolated',wordTimes}:{})
      };
      this.units.push(unit);
      additions.push(unit);
    }
    if(update.final===true)this.finalized=true;
    return additions;
  }
  /** Only confirmed stable units become LLM input, never ASR draft. */
  ready(){
    // Never accept a caller-supplied "future" audio position or finalized
    // override: advancing either would silently bypass the four-second gate.
    // Only processed ASR windows, or the actual final flush, move the clock.
    const cutoff=this.finalized?Number.POSITIVE_INFINITY:
      this.lastWindowEnd-STABLE_AGE_SAMPLES;
    return this.units.filter(u=>
      !this.delivered.has(u.id)&&u.confirmedWindowEndSample<=cutoff
    );
  }
  acknowledge(unitIds){
    if(!Array.isArray(unitIds))throw Error('INVALID_UNIT_ACK');
    const existing=new Set(this.units.map(x=>x.id));
    for(const id of unitIds)if(!existing.has(id))throw Error('UNKNOWN_UNIT_ACK');
    for(const id of unitIds)this.delivered.add(id);
  }
  export(){
    return this.units.map(unit=>({...unit}));
  }
}
