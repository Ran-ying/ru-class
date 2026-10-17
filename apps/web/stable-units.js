/**
 * v0.3: immutable, session-scoped stable text units plus a conservative
 * eight-second-after-CONFIRMATION candidate boundary for future v0.4 LLM.
 *
 * An ASR response supplies a WINDOW, not word timestamps. The sample interval
 * below is evidence provenance only; it is NOT the time a phrase was spoken.
 * Never promote pending/partial_text based on elapsed time alone.
 */
export const RATE=16000;
export const STABLE_AGE_SAMPLES=8*RATE;
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
    const text=delta.trim();
    const additions=[];
    if(text){
      const ordinal=this.units.length;
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
        // Explicitly unavailable until a future verified alignment is added.
        speechStartSample:null,
        speechEndSample:null
      };
      this.units.push(unit);
      additions.push(unit);
    }
    if(update.final===true)this.finalized=true;
    return additions;
  }
  /** Stable immutable units only. Future v0.4 may use these as LLM input. */
  ready(){
    // Never accept a caller-supplied "future" audio position or finalized
    // override: advancing either would silently bypass the eight-second gate.
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
